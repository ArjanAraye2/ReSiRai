using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using ReSiRai.Api.Services.Pos;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

var builder = WebApplication.CreateBuilder(args);

// ReSiRai stores wall-clock clinic time (DateTime with Kind=Local) everywhere,
// mirroring SQL Server's datetime. PostgreSQL's newest format (timestamptz)
// refuses local values, so opt into the legacy mapping: DateTime becomes
// `timestamp without time zone` — same semantic as SQL Server.
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

builder.Services.AddWindowsService(options => { options.ServiceName = "ReSiRai"; });

// Config lives in ProgramData on desktop; on the hosted server the container
// mounts a config file and points at it via the "ReSiRaiConfig" env variable.
string reSiRaiConfigOverride = builder.Configuration["ReSiRaiConfig"] ?? string.Empty;
string reSiRaiConfigFile = string.IsNullOrWhiteSpace(reSiRaiConfigOverride)
    ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                   "ReSiRai", "ReSiRai.config.json")
    : reSiRaiConfigOverride.Trim();
builder.Configuration.AddJsonFile(reSiRaiConfigFile, optional: true, reloadOnChange: true);
// The ProgramData file is appended after the built-in sources, which would make
// it silently win over environment variables and command-line arguments. Push
// those back on top so diagnostics can still override the installed config.
{
    var sources = (IList<IConfigurationSource>)builder.Configuration.Sources;
    foreach (var s in sources.Where(s => s.GetType().Name.Contains("CommandLine") ||
                                         s.GetType().Name.Contains("EnvironmentVariables")).ToList())
    {
        sources.Remove(s);
        sources.Add(s);
    }
}

builder.Services.AddControllers();
builder.Services.AddScoped<RadiologyStorageService>();
builder.Services.AddScoped<StudyAccessService>();
builder.Services.AddScoped<AiClient>();
builder.Services.AddScoped<AppEventLogger>();
builder.Services.AddSingleton<TimeProvider>(TimeProvider.System);
builder.Services.AddSingleton<LoginAttemptLimiter>();
builder.Services.AddScoped<BackupService>();
builder.Services.AddHostedService<BackupScheduler>();
// تبدیلِ PDF با SkiaSharp است و رویِ همهٔ سیستمها (مطب ویندوزی و سرور لینوکس) کار میکند.
builder.Services.AddScoped<PdfToImageService>();
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
// Provider: desktop installs run SQL Server (Windows default); the hosted
// server runs PostgreSQL. Selection order:
//   1. "Database:Provider" app setting ("Postgres" | "SqlServer")
//   2. "Provider" key inside the connection strings section
//   3. automatic: on Linux it is Postgres, on Windows SQL Server — and a
//      connection string that clearly is PostgreSQL ("Host=...") decides for
//      Postgres regardless of the platform.
string dbProvider =
    (builder.Configuration["Database:Provider"]
     ?? builder.Configuration.GetConnectionString("Provider")
     ?? (OperatingSystem.IsWindows() ? "SqlServer" : "Postgres")).Trim();
bool usePostgres = dbProvider.Equals("Postgres", StringComparison.OrdinalIgnoreCase);
DbRuntime.IsPostgres = usePostgres;

// Legacy desktop installs keep their "ReSiRai" connection string; the hosted
// server supplies "Postgres". Anything else falls back to the same key name.
string ReSiRaiConnectionKey() =>
    !string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString("ReSiRai"))
        ? "ReSiRai"
        : usePostgres ? "Postgres" : "SqlServer";

builder.Services.AddDbContext<ReSiRaiDbContext>(options =>
{
    string connectionString =
        builder.Configuration.GetConnectionString(ReSiRaiConnectionKey())
        ?? throw new InvalidOperationException(
            $"No database connection string found for provider {dbProvider}.");
    if (usePostgres)
        options.UseNpgsql(connectionString);
    else
        options.UseSqlServer(connectionString);
});
builder.Services.AddOpenApi();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ReSiRaiDbContext>();
    // راه‌اندازی دیتابیس — دودله: SQL Server (نصب دسکتاپی) / PostgreSQL (سرور)
    await DbBootstrap.RunAsync(db, usePostgres);

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
                "<script src=\"/js/study-card-scan.js?v=20261008.1\"></script>\n" +
                "<script src=\"/js/dictation.js?v=20261008.3\"></script>\n" +
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
