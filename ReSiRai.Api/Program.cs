using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using ReSiRai.Api.Services.Pos;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddWindowsService(options => { options.ServiceName = "ReSiRai"; });

string programDataPath = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
string reSiRaiConfigDirectory = Path.Combine(programDataPath, "ReSiRai");
string reSiRaiConfigFile = Path.Combine(reSiRaiConfigDirectory, "ReSiRai.config.json");
builder.Configuration.AddJsonFile(reSiRaiConfigFile, optional: true, reloadOnChange: true);

builder.Services.AddControllers();
builder.Services.AddScoped<RadiologyStorageService>();
builder.Services.AddScoped<StudyAccessService>();
builder.Services.AddScoped<AiClient>();
builder.Services.AddScoped<AppEventLogger>();
builder.Services.AddSingleton<TimeProvider>(TimeProvider.System);
builder.Services.AddSingleton<LoginAttemptLimiter>();
builder.Services.AddScoped<BackupService>();
builder.Services.AddHostedService<BackupScheduler>();
// تبدیلِ PDF فقط روی ویندوز ممکن است (و برنامه هم ویندوزی است)؛ روی سیستمِ
// دیگر، سرویس ثبت نمی‌شود و آپلودِ PDF همان‌طور PDF می‌ماند.
if (OperatingSystem.IsWindows()) builder.Services.AddScoped<PdfToImageService>();
// POS terminals: the registry resolves the protocol named in the settings, so a
// new vendor only needs a new IPosProtocol implementation registered here.
builder.Services.AddSingleton<IPosProtocol, GenericTcpPosProtocol>();
builder.Services.AddSingleton<PosProtocolRegistry>();
// Patient messaging: sends SMS and records every attempt in tblPatientMessages.
builder.Services.AddScoped<PatientMessagingService>();
// Reading the radiology SMS that arrived on a paired phone: matching a message
// to a patient and importing the pictures its links point at.
builder.Services.AddScoped<SmsInboxService>();
// Central communication service: Kavenegar is the default SMS provider, while the provider remains configurable.
builder.Services.AddSingleton<ICommunicationService, CommunicationService>();
// Client for fetching images behind a share link. It calls back into this
// same server, so loopback must bypass any system proxy (see LoopbackBypassProxy).
builder.Services.AddHttpClient("ShareImages", client => client.Timeout = TimeSpan.FromSeconds(60))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        UseProxy = true,
        Proxy = new ReSiRai.Api.Services.LoopbackBypassProxy()
    });
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();

// ReSiRai is a browser application served by the same ASP.NET Core backend,
// therefore an HttpOnly authentication cookie is simpler and safer than storing
// a bearer token in browser storage. SameAsRequest keeps LAN development over
// HTTP working; deployed HTTPS automatically receives a Secure cookie.
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "ReSiRai.Auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });

// Security is the default for every controller/action. An endpoint is public only
// when it explicitly declares [AllowAnonymous] (for example api/auth/login).
// This prevents a newly added API from acciteethly being exposed on the clinic LAN.
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});

builder.Services.Configure<RadiologyStorageOptions>(builder.Configuration.GetSection("RadiologyStorage"));
// The connection string key used to be "ReSiRai". Existing installations still
// carry that key in their config file, so both names are accepted; "ReSiRai" wins
// when present.
builder.Services.AddDbContext<ReSiRaiDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("ReSiRai")
        ?? builder.Configuration.GetConnectionString("ReSiRai")));
builder.Services.AddOpenApi();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ReSiRaiDbContext>();
    try { await db.Database.ExecuteSqlRawAsync("IF COL_LENGTH('tblUsers', 'RecoveryMobile') IS NULL ALTER TABLE tblUsers ADD RecoveryMobile nvarchar(30) NULL"); } catch { }
    // دسترسیِ «گزارش‌ها»: برای کاربرانِ عادی یک پرچمِ جدا تا حسابدار/منشیٔ مالی
    // بتواند گزارش ببیند بی‌آنکه مدیرِ سیستم شود.
    try { await db.Database.ExecuteSqlRawAsync("IF COL_LENGTH('tblUsers', 'ViewReports') IS NULL ALTER TABLE tblUsers ADD ViewReports bit NOT NULL CONSTRAINT DF_tblUsers_ViewReports DEFAULT (0)"); } catch { }

    // ---- پروندهٔ بیمار: «اطلاعات تکمیلی» (همه اختیاری) ---------------------
    // یک‌بار ساخته می‌شود؛ نصب‌های موجود هم بدون مهاجرت دستی به‌روز می‌شوند.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            IF COL_LENGTH('tblPatients', 'BloodType') IS NULL ALTER TABLE tblPatients ADD BloodType nvarchar(5) NULL;
            IF COL_LENGTH('tblPatients', 'Mobile2') IS NULL ALTER TABLE tblPatients ADD Mobile2 nvarchar(30) NULL;
            IF COL_LENGTH('tblPatients', 'EmergencyContactName') IS NULL ALTER TABLE tblPatients ADD EmergencyContactName nvarchar(100) NULL;
            IF COL_LENGTH('tblPatients', 'EmergencyContactRelation') IS NULL ALTER TABLE tblPatients ADD EmergencyContactRelation nvarchar(50) NULL;
            IF COL_LENGTH('tblPatients', 'EmergencyContactPhone') IS NULL ALTER TABLE tblPatients ADD EmergencyContactPhone nvarchar(30) NULL;
            IF COL_LENGTH('tblPatients', 'BaseInsuranceTypeID') IS NULL ALTER TABLE tblPatients ADD BaseInsuranceTypeID int NULL;
            IF COL_LENGTH('tblPatients', 'BaseInsuranceNo') IS NULL ALTER TABLE tblPatients ADD BaseInsuranceNo nvarchar(50) NULL;
            IF COL_LENGTH('tblPatients', 'Supp1InsuranceTypeID') IS NULL ALTER TABLE tblPatients ADD Supp1InsuranceTypeID int NULL;
            IF COL_LENGTH('tblPatients', 'Supp1InsuranceNo') IS NULL ALTER TABLE tblPatients ADD Supp1InsuranceNo nvarchar(50) NULL;
            IF COL_LENGTH('tblPatients', 'Supp2InsuranceTypeID') IS NULL ALTER TABLE tblPatients ADD Supp2InsuranceTypeID int NULL;
            IF COL_LENGTH('tblPatients', 'Supp2InsuranceNo') IS NULL ALTER TABLE tblPatients ADD Supp2InsuranceNo nvarchar(50) NULL;
            IF COL_LENGTH('tblPatients', 'FileNumber') IS NULL ALTER TABLE tblPatients ADD FileNumber nvarchar(50) NULL;
            IF COL_LENGTH('tblPatients', 'ContactPreference') IS NULL ALTER TABLE tblPatients ADD ContactPreference nvarchar(20) NULL;
            """);
    }
    catch { }

    // ---- دیکشنری بیمه + دیتای اولیهٔ کامل ---------------------------------
    // پایه و تکمیلی در یک جدول‌اند و با IsSupplementary تفکیک می‌شوند. نگهداری
    // فقط در اختیار مدیر سیستم است. درجِ هر ردیف «فقط در نبودِ همان نام و نوع»
    // انجام می‌شود؛ پس نصب‌های موجود و ردیف‌های اضافه‌شدهٔ مدیر تکرار یا حذف نمی‌شوند.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            IF OBJECT_ID(N'dbo.tblInsuranceTypes', N'U') IS NULL
            BEGIN
                CREATE TABLE dbo.tblInsuranceTypes (
                    InsuranceTypeID int IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblInsuranceTypes PRIMARY KEY,
                    InsuranceTypeName nvarchar(100) NOT NULL,
                    IsSupplementary bit NOT NULL CONSTRAINT DF_tblInsuranceTypes_IsSupplementary DEFAULT (0),
                    IsActive bit NOT NULL CONSTRAINT DF_tblInsuranceTypes_IsActive DEFAULT (1)
                );
                CREATE UNIQUE INDEX UX_tblInsuranceTypes_Name_Kind ON dbo.tblInsuranceTypes (InsuranceTypeName, IsSupplementary);
            END;
            INSERT INTO dbo.tblInsuranceTypes (InsuranceTypeName, IsSupplementary)
            SELECT v.Name, v.IsSupp
            FROM (VALUES
                /* بیمه‌های پایه */
                (N'آزاد / بدون بیمه', 0),
                (N'تأمین اجتماعی', 0),
                (N'تأمین اجتماعی (طرح روستایی و عشایری)', 0),
                (N'تأمین اجتماعی صنعت نفت', 0),
                (N'خدمات درمانی', 0),
                (N'نیروهای مسلح', 0),
                (N'بیمه سلامت', 0),
                (N'کمیته امداد امام خمینی (ره)', 0),
                (N'بهزیستی', 0),
                (N'بنیاد شهید و امور ایثارگران', 0),
                (N'بیمه اتباع', 0),
                /* شرکت‌های بیمهٔ تکمیلی */
                (N'آسیا', 1),
                (N'آتیه‌سازان', 1),
                (N'آسماری', 1),
                (N'پاسارگاد', 1),
                (N'پارسیان', 1),
                (N'ایران معین', 1),
                (N'تجارت نو', 1),
                (N'توسعه', 1),
                (N'دانا', 1),
                (N'البرز', 1),
                (N'سامان', 1),
                (N'سرمد', 1),
                (N'حافظ', 1),
                (N'ما', 1),
                (N'معلم', 1),
                (N'ملت', 1),
                (N'دی', 1),
                (N'رازی', 1),
                (N'سینا', 1),
                (N'نوین', 1),
                (N'تعاون', 1),
                (N'خاور', 1),
                (N'کوثر', 1),
                (N'کارآفرین', 1),
                (N'میهن', 1),
                (N'آریا', 1),
                (N'آنکارا', 1),
                (N'امید (تأمین اجتماعی)', 1),
                (N'پاسار', 1),
                (N'پیشرو', 1),
                (N'ایران', 1),
                (N'صادرات', 1),
                (N'فولاد', 1),
                /* بیمه‌های گروهی کارکنان (بانک‌ها و سازمان‌ها) */
                (N'بانک ملی', 1),
                (N'بانک صادرات', 1),
                (N'بانک ملت', 1),
                (N'بانک سپه', 1),
                (N'بانک تجارت', 1),
                (N'بانک رفاه کارگران', 1),
                (N'بانک شهر', 1),
                (N'بانک پاسارگاد', 1),
                (N'بانک مسکن', 1),
                (N'بانک کشاورزی', 1),
                (N'شرکت ملی نفت ایران', 1),
                (N'فولاد مبارکه', 1),
                (N'ذوب‌آهن اصفهان', 1),
                (N'خودگردان نیروهای مسلح', 1),
                (N'شهرداری', 1),
                (N'وزارت بهداشت و آموزش پزشکی', 1)
            ) AS v (Name, IsSupp)
            WHERE NOT EXISTS (
                SELECT 1 FROM dbo.tblInsuranceTypes t
                WHERE t.InsuranceTypeName = v.Name AND t.IsSupplementary = v.IsSupp);
            """);
    }
    catch { }
    // نتیجهٔ تحلیلِ AI تصویر، تا تصویرِ بیمار فقط یک بار از مطب خارج شود و
    // بازدیدهای بعدی بدون هزینه و بدونِ ارسالِ دوباره انجام شود.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            IF OBJECT_ID(N'dbo.tblAIImageAnalyses', N'U') IS NULL
            BEGIN
                CREATE TABLE dbo.tblAIImageAnalyses (
                    AIImageAnalysisID bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblAIImageAnalyses PRIMARY KEY,
                    ImageID bigint NOT NULL,
                    Kind tinyint NOT NULL CONSTRAINT DF_tblAIImageAnalyses_Kind DEFAULT (1),
                    Model nvarchar(120) NOT NULL CONSTRAINT DF_tblAIImageAnalyses_Model DEFAULT (N''),
                    PromptVersion int NOT NULL CONSTRAINT DF_tblAIImageAnalyses_PromptVersion DEFAULT (0),
                    AnalysisJson nvarchar(max) NOT NULL,
                    AnalyzedAt datetime2 NOT NULL CONSTRAINT DF_tblAIImageAnalyses_AnalyzedAt DEFAULT (SYSUTCDATETIME()),
                    AnalyzedByUserID int NULL,
                    CONSTRAINT FK_tblAIImageAnalyses_RadiologyImages
                        FOREIGN KEY (ImageID) REFERENCES dbo.tblRadiologyImages (ImageID) ON DELETE CASCADE
                );
                CREATE UNIQUE INDEX IX_tblAIImageAnalyses_ImageID_Kind
                    ON dbo.tblAIImageAnalyses (ImageID, Kind);
            END
            """);
    }
    catch { }

    // «کارت سابقه» نوعِ ثابتِ سند است: عکسِ کارتِ دستنویس که هنگامِ ثبتِ مراجعه
    // گرفته می‌شود، در گریدِ تصاویر دیده نمی‌شود و جزءِ شمارشِ تصاویر نیست.
    try
    {
        await db.Database.ExecuteSqlRawAsync(
            "IF NOT EXISTS (SELECT 1 FROM dbo.tblImageTypes WHERE ImageTypeName = N'کارت سابقه') " +
            "INSERT INTO dbo.tblImageTypes (ImageTypeName, IsActive) VALUES (N'کارت سابقه', 1)");
    }
    catch { }

    // لاگِ رویدادها: ورود، پیامک، تحلیل AI، پشتیبان و شروعِ برنامه — برایِ پیگیری
    // در مطب. رکوردها ۱۸۰ روز نگه داشته و در هر اجرای پشتیبان پاک می‌شوند.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            IF OBJECT_ID(N'dbo.tblAppEvents', N'U') IS NULL
            BEGIN
                CREATE TABLE dbo.tblAppEvents (
                    EventID bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblAppEvents PRIMARY KEY,
                    EventAt datetime2 NOT NULL CONSTRAINT DF_tblAppEvents_EventAt DEFAULT (GETDATE()),
                    Kind nvarchar(40) NOT NULL,
                    Outcome nvarchar(20) NOT NULL CONSTRAINT DF_tblAppEvents_Outcome DEFAULT (N'ok'),
                    Detail nvarchar(500) NOT NULL CONSTRAINT DF_tblAppEvents_Detail DEFAULT (N''),
                    UserID int NULL,
                    UserName nvarchar(64) NULL,
                    DurationMs int NULL
                );
                CREATE INDEX IX_tblAppEvents_EventAt ON dbo.tblAppEvents (EventAt DESC);
                CREATE INDEX IX_tblAppEvents_Kind_EventAt ON dbo.tblAppEvents (Kind, EventAt DESC);
            END
            """);
    }
    catch { }

    // شروعِ برنامه هم یک رویداد است تا بتوان گفت سامانه کی بالا آمده.
    try
    {
        var events = scope.ServiceProvider.GetRequiredService<AppEventLogger>();
        await events.LogAsync("app.start", detail: $"اجرای برنامه روی {Environment.MachineName}");
    }
    catch { }
}
if (app.Environment.IsDevelopment()) app.MapOpenApi();

app.Use(async (context, next) =>
{
    if (context.Request.Path == "/" || context.Request.Path == "/index.html")
    {
        string indexPath = Path.Combine(app.Environment.WebRootPath, "index.html");
        if (File.Exists(indexPath))
        {
            string html = await File.ReadAllTextAsync(indexPath);
            const string loginStyle = "<link rel=\"stylesheet\" href=\"/css/login.css?v=20261001.19\" />";
            const string cardExtractionStyle = "<link rel=\"stylesheet\" href=\"/css/card-extraction.css?v=20261001.19\" />";
            html = html.Replace("</head>", $"{loginStyle}{Environment.NewLine}{cardExtractionStyle}{Environment.NewLine}</head>", StringComparison.OrdinalIgnoreCase);
            // login-ui.js is declared in index.html before app.js. Do not inject it here:
            // loading the authentication bootstrap twice creates two independent initializers
            // and makes login/logout behavior unpredictable.
            const string featureScripts =
                "<script src=\"/js/mobile-camera-loader.js?v=20261001.19\"></script>\n" +
                "<script src=\"/js/study-type-lookup.js?v=20261001.19\"></script>\n" +
                "<script src=\"/js/ai-study-analysis.js?v=20261001.19\"></script>\n" +
                "<script src=\"/js/card-extraction.js?v=20261001.19\"></script>\n" +
                "<script src=\"/js/ai-chat.js?v=20261001.19\"></script>\n" +
                "<script src=\"/js/study-card-scan.js?v=20261001.19\"></script>\n" +
                "<script src=\"/js/dictation.js?v=20261001.19\"></script>\n" +
                "<script src=\"/js/events-ui.js?v=20261001.19\"></script>\n" +
                "<script src=\"/js/backup-settings.js?v=20261001.19\"></script>\n" +
                "<script src=\"/js/reports-ui.js?v=20261001.19\"></script>";
            html = html.Replace("</body>", $"{featureScripts}{Environment.NewLine}</body>", StringComparison.OrdinalIgnoreCase);
            context.Response.ContentType = "text/html; charset=utf-8";
            // The entry page is rewritten on every request (feature scripts are
            // injected here), so browsers must not hold an old copy of it -
            // otherwise brand, layout or script-version changes keep showing
            // from cache.
            context.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
            await context.Response.WriteAsync(html);
            return;
        }
    }
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseHttpsRedirection();
app.UseRouting();
app.UseMiddleware<LoginRateLimitMiddleware>();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.Run();
