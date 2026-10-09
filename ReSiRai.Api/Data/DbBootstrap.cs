using System.Diagnostics.CodeAnalysis;
using Microsoft.EntityFrameworkCore;
using ReSiRai.Api.Models;
#pragma warning disable EF1002 // رشتههای DDL ثابتِ کامپایلاند (بدون ورودی کاربر)

namespace ReSiRai.Api.Data;

/// <summary>
/// راه‌اندازی اولیهٔ دیتابیس — دو لهجه.
///
/// • SQL Server (نصبهای دسکتاپی): ساختار از اسکریپت Installer میآید و این بخش
///   فقط «اضافهها» را به همان سبک تاریخی T-SQL اعمال میکند — رفتار موجود دستنخورده.
/// • PostgreSQL (سرور میزبانی): دیتابیس تازه است؛ کل ساختار از روی مدل EF با
///   EnsureCreated ساخته میشود و همان «اضافهها» با گرامر PG اعمال میکنند.
///
/// هر بلوک خطا را میبلعد: راهاندازی هرگز نباید به‌خاطر یک بلوک خراب شود.
/// </summary>
public static class DbBootstrap
{
    public static async Task RunAsync(ReSiRaiDbContext db, bool isPostgres)
    {
        if (isPostgres)
        {
            await PostgresAsync(db);
        }
        else
        {
            await SqlServerAsync(db);
        }
    }

    // ------------------------------------------------------------------ PostgreSQL

    private static async Task PostgresAsync(ReSiRaiDbContext db)
    {
        // Schra کامل از مدل (۳۲ جدول) — دیتابیسِ تازه میزبانی
        try { await db.Database.EnsureCreatedAsync(); } catch { }

        // اضافههای ستونی (نسخهٔ PG از همان بلوکهای T-SQL)
        try
        {
            await db.Database.ExecuteSqlRawAsync("""
                ALTER TABLE "tblUsers" ADD COLUMN IF NOT EXISTS "RecoveryMobile" text NULL;
                ALTER TABLE "tblUsers" ADD COLUMN IF NOT EXISTS "ViewReports" boolean NOT NULL DEFAULT false;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "BloodType" text NULL;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "Mobile2" text NULL;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "EmergencyContactName" text NULL;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "EmergencyContactRelation" text NULL;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "EmergencyContactPhone" text NULL;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "BaseInsuranceTypeID" integer NULL;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "BaseInsuranceNo" text NULL;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "Supp1InsuranceTypeID" integer NULL;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "Supp1InsuranceNo" text NULL;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "Supp2InsuranceTypeID" integer NULL;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "Supp2InsuranceNo" text NULL;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "FileNumber" text NULL;
                ALTER TABLE "tblPatients" ADD COLUMN IF NOT EXISTS "ContactPreference" text NULL;
                """);
        }
        catch { }

        try
        {
            await db.Database.ExecuteSqlRawAsync("""
                CREATE UNIQUE INDEX IF NOT EXISTS "UX_tblInsuranceTypes_Name_Kind"
                    ON "tblInsuranceTypes" ("InsuranceTypeName", "IsSupplementary");
                """);
        }
        catch { }

        await InsuranceSeedAsync(db);

        // «کارت سابقه» — نوع ثابت سند
        try
        {
            if (!await db.ImageTypes.AnyAsync(t => t.ImageTypeName == "کارت سابقه"))
            {
                db.ImageTypes.Add(new ImageType { ImageTypeName = "کارت سابقه", IsActive = true });
                await db.SaveChangesAsync();
            }
        }
        catch { }

        // لاگ رویدادها: همان ایندکسهای نسخهٔ SQL Server
        try
        {
            await db.Database.ExecuteSqlRawAsync("""
                CREATE INDEX IF NOT EXISTS "IX_tblAppEvents_EventAt" ON "tblAppEvents" ("EventAt" DESC);
                CREATE INDEX IF NOT EXISTS "IX_tblAppEvents_Kind_EventAt" ON "tblAppEvents" ("Kind", "EventAt" DESC);
                """);
        }
        catch { }
    }

    private static readonly (string Name, bool IsSupp)[] InsuranceList =
    {
        /* بیمه‌های پایه */
        ("آزاد / بدون بیمه", false),
        ("تأمین اجتماعی", false),
        ("تأمین اجتماعی (طرح روستایی و عشایری)", false),
        ("تأمین اجتماعی صنعت نفت", false),
        ("خدمات درمانی", false),
        ("نیروهای مسلح", false),
        ("بیمه سلامت", false),
        ("کمیته امداد امام خمینی (ره)", false),
        ("بهزیستی", false),
        ("بنیاد شهید و امور ایثارگران", false),
        ("بیمه اتباع", false),
        /* شرکت‌های بیمهٔ تکمیلی */
        ("آسیا", true), ("آتیه‌سازان", true), ("آسماری", true), ("پاسارگاد", true), ("پارسیان", true),
        ("ایران معین", true), ("تجارت نو", true), ("توسعه", true), ("دانا", true), ("البرز", true),
        ("سامان", true), ("سرمد", true), ("حافظ", true), ("ما", true), ("معلم", true), ("ملت", true),
        ("دی", true), ("رازی", true), ("سینا", true), ("نوین", true), ("تعاون", true), ("خاور", true),
        ("کوثر", true), ("کارآفرین", true), ("میهن", true), ("آریا", true), ("آنکارا", true),
        ("امید (تأمین اجتماعی)", true), ("پاسار", true), ("پیشرو", true), ("ایران", true), ("صادرات", true),
        ("فولاد", true),
        /* بیمه‌های گروهی کارکنان (بانک‌ها و سازمان‌ها) */
        ("بانک ملی", true), ("بانک صادرات", true), ("بانک ملت", true), ("بانک سپه", true),
        ("بانک تجارت", true), ("بانک رفاه کارگران", true), ("بانک شهر", true), ("بانک پاسارگاد", true),
        ("بانک مسکن", true), ("بانک کشاورزی", true), ("شرکت ملی نفت ایران", true), ("فولاد مبارکه", true),
        ("ذوب‌آهن اصفهان", true), ("خودگردان نیروهای مسلح", true), ("شهرداری", true),
        ("وزارت بهداشت و آموزش پزشکی", true),
    };

    /// <summary>
    /// درج هر ردیف فقط در نبودِ همان «نام + نوع» — هم‌رفتار با نسخهٔ T-SQL.
    /// </summary>
    private static async Task InsuranceSeedAsync(ReSiRaiDbContext db)
    {
        try
        {
            var present = await db.InsuranceTypes
                .Select(t => new { t.InsuranceTypeName, t.IsSupplementary })
                .ToListAsync();
            var presentKeys = present.Select(t => (t.InsuranceTypeName, t.IsSupplementary)).ToHashSet();

            var missing = InsuranceList
                .Where(v => !presentKeys.Contains((v.Name, v.IsSupp)))
                .Select(v => new InsuranceType { InsuranceTypeName = v.Name, IsSupplementary = v.IsSupp, IsActive = true })
                .ToList();

            if (missing.Count > 0)
            {
                db.InsuranceTypes.AddRange(missing);
                await db.SaveChangesAsync();
            }
        }
        catch { }
    }

    // ------------------------------------------------------------------ SQL Server

    private static async Task SqlServerAsync(ReSiRaiDbContext db)
    {
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
            await db.Database.ExecuteSqlRawAsync($"""
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
                {InsuranceSeedTSql()}
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
    }

    /// <summary>دیتای اولیهٔ بیمه‌ها به‌صورت T-SQL (برایِ نصب‌های دسکتاپی).</summary>
    private static string InsuranceSeedTSql()
    {
        var rows = new System.Text.StringBuilder();
        foreach (var (name, isSupp) in InsuranceList)
        {
            var safe = name.Replace("'", "''");
            rows.Append($"({safe}, {(isSupp ? "1" : "0")}),");
        }
        rows.Length--; // last comma
        return $"""
                INSERT INTO dbo.tblInsuranceTypes (InsuranceTypeName, IsSupplementary)
                SELECT v.Name, v.IsSupp
                FROM (VALUES
                    {rows}
                ) AS v (Name, IsSupp)
                WHERE NOT EXISTS (
                    SELECT 1 FROM dbo.tblInsuranceTypes t
                    WHERE t.InsuranceTypeName = v.Name AND t.IsSupplementary = v.IsSupp);
                """;
    }
}
