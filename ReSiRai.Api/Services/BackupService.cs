using System.Diagnostics;
using System.Text.Json;
using ReSiRai.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace ReSiRai.Api.Services;

/// <summary>
/// پشتیبان‌گیریِ خودکارِ دیتابیس و تصاویر.
///
/// دو قاعدهٔ ساده که برای مطبِ محلی کافی است:
///  - دیتابیس: فایلِ BAK با فشرده‌سازی، و فقط N نسخهٔ آخر نگه داشته می‌شود.
///  - تصاویر: کپیِ تکمیلی (فقط اضافه‌ها/تغییرها، بدونِ حذف) ⇒ اگر فایلی در مطب
///    اشتباهی پاک شد، در پشتیبان می‌ماند.
///
/// مسیر در ReSiRai.config.json و بخش Backup قابلِ تغییر است؛ اجرای خودکار
/// هر ساعت بررسی می‌شود و اگر آخرین پشتیبان بیش از ۲۳ ساعت پیش بوده اجرا می‌شود —
/// یعنی اگر کامپیوتر مطب شب‌ها خاموش باشد، هنگامِ روشن شدن جبران می‌شود.
/// </summary>
public sealed class BackupService
{
    private readonly IConfiguration _configuration;
    private readonly ReSiRaiDbContext _db;
    private readonly RadiologyStorageService _storage;
    private readonly ILogger<BackupService> _logger;
    private readonly AppEventLogger _events;

    private static readonly object Gate = new();
    private static bool _running;

    public BackupService(IConfiguration configuration, ReSiRaiDbContext db,
        RadiologyStorageService storage, ILogger<BackupService> logger, AppEventLogger events)
    {
        _configuration = configuration;
        _db = db;
        _storage = storage;
        _logger = logger;
        _events = events;
    }

    /// <summary>
    /// مسیرِ پشتیبان — پیشفرض: ویندوز D:\ReSiRaiBackup / لینوکس /var/lib/ReSiRaiBackup.
    /// </summary>
    public string RootPath
    {
        get
        {
            var configured = _configuration["Backup:RootPath"];
            return string.IsNullOrWhiteSpace(configured) ? DefaultRootPath() : configured.Trim();
        }
    }

    private static string DefaultRootPath() => OperatingSystem.IsWindows()
        ? @"D:\ReSiRaiBackup"
        : Path.Combine("/var", "lib", "ReSiRaiBackup");

    public int KeepBackups
    {
        get
        {
            int n = int.TryParse(_configuration["Backup:KeepBackups"], out var v) ? v : 0;
            return n > 0 ? n : 7;
        }
    }

    private string DbFolder => Path.Combine(RootPath, "db");
    private string ImagesFolder => Path.Combine(RootPath, "images");
    private string StateFile => Path.Combine(RootPath, "backup-state.json");

    /// <summary>رویدادها چقدر نگه داشته شوند (روز) — توافق شده: ۱۸۰ روز.</summary>
    private const int EventRetentionDays = 180;

    private sealed class BackupState
    {
        public DateTime? LastRun { get; set; }
        public bool Ok { get; set; }
        public string? Error { get; set; }
    }

    private BackupState ReadState()
    {
        try
        {
            if (File.Exists(StateFile))
                return JsonSerializer.Deserialize<BackupState>(File.ReadAllText(StateFile)) ?? new BackupState();
        }
        catch { /* وضعیتِ خراب ⇒ مثلِ اینکه پشتیبان نداشته‌ایم */ }
        return new BackupState();
    }

    private void WriteState(bool ok, string? error)
    {
        try
        {
            Directory.CreateDirectory(RootPath);
            File.WriteAllText(StateFile, JsonSerializer.Serialize(new BackupState
            {
                LastRun = DateTime.Now,
                Ok = ok,
                Error = error
            }));
        }
        catch (Exception e) { _logger.LogWarning("[ReSiRai پشتیبان] نوشتنِ وضعیت نشد: {E}", e.Message); }
    }

    /// <summary>آیا نوبتِ پشتیبان رسیده؟ (بیش از ۲۳ ساعت از آخرین)</summary>
    public bool IsDue()
    {
        var state = ReadState();
        if (state.LastRun is null) return true;
        return DateTime.Now - state.LastRun.Value > TimeSpan.FromHours(23);
    }

    public bool IsRunning
    {
        get { lock (Gate) return _running; }
    }

    public async Task<(bool ok, string? error)> RunAsync(CancellationToken cancellationToken = default)
    {
        lock (Gate)
        {
            if (_running) return (false, "پشتیبان قبلاً در حال اجراست.");
            _running = true;
        }
        try
        {
            var watch = Stopwatch.StartNew();
            string? error = null;
            try
            {
                await RunCoreAsync(cancellationToken);
            }
            catch (Exception e)
            {
                error = e.Message;
                _logger.LogError(e, "[ReSiRai پشتیبان] ناموفق");
            }
            WriteState(error is null, error);
            if (error is null) _logger.LogInformation("[ReSiRai پشتیبان] انجام شد ← {Path}", RootPath);

            // اجرای پشتیبان یک رویداد است (برای دیدن در لاگ) و همان‌جا هم قدیمی‌ترین
            // رویدادها پاک می‌شوند: لاگِ سامانه ۱۸۰ روز نگه داشته می‌شود.
            await _events.LogAsync("backup",
                outcome: error is null ? "ok" : "fail",
                detail: error is null
                    ? $"پشتیبان گرفته شد ← {RootPath} (نگه‌داری {KeepBackups} نسخه)"
                    : $"پشتیبان ناموفق — {error}",
                durationMs: (int)watch.ElapsedMilliseconds);
            await PruneEventsAsync();

            return (error is null, error);
        }
        finally
        {
            lock (Gate) _running = false;
        }
    }

    private async Task RunCoreAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(DbFolder);
        Directory.CreateDirectory(ImagesFolder);

        bool pg = Data.DbRuntime.IsPostgres;

        // ۱) دیتابیس
        string bak = Path.Combine(DbFolder, $"resirai_{DateTime.Now:yyyyMMdd_HHmmss}.bak");
        if (pg)
        {
            DumpPostgresAsync(bak, cancellationToken).GetAwaiter().GetResult();
        }
        else
        {
            // بدونِ رشتهٔ درون‌کاشته (EF1002)؛ مسیر فقط از کانفیگ می‌آید و ' هم گریخته شده.
            string backupSql = "BACKUP DATABASE [ReSiRai] TO DISK = '" + bak.Replace("'", "''") + "' WITH INIT, COMPRESSION";
            await _db.Database.ExecuteSqlRawAsync(backupSql, cancellationToken);
        }

        // نگه‌داشتنِ فقط N نسخهٔ آخر
        var old = Directory.GetFiles(DbFolder, "resirai_*.bak")
            .OrderByDescending(File.GetLastWriteTime)
            .Skip(KeepBackups);
        foreach (var f in old) { try { File.Delete(f); } catch { } }

        // ۲) تصاویر: کپیِ تکمیلی بدونِ حذف (فایل‌ها تغییرناپذیرند؛ فقط اضافه می‌شوند)
        string source = _storage.GetRootPath();
        if (!Directory.Exists(source)) return;

        ProcessStartInfo psi;
        if (pg)
        {
            // rsync --update: فقط جدیدترها و جاهای خالی، مثل /E /XO
            psi = new ProcessStartInfo
            {
                FileName = "rsync",
                Arguments = $"-a --update \"{source}/\" \"{ImagesFolder}/\"",
            };
        }
        else
        {
            psi = new ProcessStartInfo
            {
                FileName = "robocopy",
                Arguments = $"\"{source}\" \"{ImagesFolder}\" /E /XO /R:1 /W:1 /NP /NDL /NJH /NFL /BYTES",
            };
        }
        psi.CreateNoWindow = true;
        psi.UseShellExecute = false;
        using var proc = Process.Start(psi);
        if (proc is not null)
        {
            await proc.WaitForExitAsync(cancellationToken);
            bool ok = pg ? proc.ExitCode == 0 : proc.ExitCode < 8;
            if (!ok)
                throw new InvalidOperationException(
                    $"{(pg ? "rsync" : "robocopy")} با کد {proc.ExitCode} خطا داد.");
        }
    }

    /// <summary>pg_dump با فرمتِ فشردهٔ Custom (-Fc) — رویِ مسیرِ PSQL داده میشود.</summary>
    private async Task DumpPostgresAsync(string outputFile, CancellationToken cancellationToken)
    {
        string? cs = _db.Database.GetConnectionString();
        if (string.IsNullOrWhiteSpace(cs))
            throw new InvalidOperationException("رشتهٔ اتصالِ PostgreSQL برای پشتیبان پیدا نشد.");
        var builder = new Npgsql.NpgsqlConnectionStringBuilder(cs);

        var psi = new ProcessStartInfo
        {
            FileName = "pg_dump",
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };
        psi.ArgumentList.Add("--format=custom");
        psi.ArgumentList.Add("--no-owner");
        psi.ArgumentList.Add("--host");
        psi.ArgumentList.Add(builder.Host ?? "localhost");
        psi.ArgumentList.Add("--port");
        psi.ArgumentList.Add(builder.Port.ToString());
        psi.ArgumentList.Add("--username");
        psi.ArgumentList.Add(builder.Username ?? "postgres");
        psi.ArgumentList.Add("--file");
        psi.ArgumentList.Add(outputFile);
        psi.ArgumentList.Add(builder.Database ?? "resirai");
        if (!string.IsNullOrEmpty(builder.Password))
            psi.Environment["PGPASSWORD"] = builder.Password;

        using var proc = Process.Start(psi)
            ?? throw new InvalidOperationException("اجرای pg_dump ممکن نشد — postgresql-client نصب نیست.");
        string err = await proc.StandardError.ReadToEndAsync(cancellationToken);
        await proc.WaitForExitAsync(cancellationToken);
        if (proc.ExitCode != 0)
            throw new InvalidOperationException($"pg_dump با کد {proc.ExitCode} خطا داد: {err}");
    }

    /// <summary>یک فایلِ BAK قابلِ انتخاب برای بازگردانی.</summary>
    public sealed record RestorePoint(string File, long SizeBytes, DateTime Created);

    /// <summary>فایل‌های پشتیبانِ دیتابیس، از جدیدترین به قدیمی‌ترین.</summary>
    public IReadOnlyList<RestorePoint> GetRestorePoints()
    {
        if (!Directory.Exists(DbFolder)) return Array.Empty<RestorePoint>();
        return Directory.GetFiles(DbFolder, "resirai_*.bak")
            .Select(f => new FileInfo(f))
            .OrderByDescending(f => f.LastWriteTime)
            .Select(f => new RestorePoint(f.Name, f.Length, f.LastWriteTime))
            .ToList();
    }

    /// <summary>
    /// دیتابیس را از یکی از همان فایل‌های پشتیبان برمی‌گرداند.
    ///
    /// دو قاعدهٔ ایمنی: فقط نامِ فایل پذیرفته میشود و فایل باید در پوشهٔ خودِ
    /// پشتیبان باشد (هیچ مسیرِ بیرونی خوانده نمیشود)؛
    /// SQL Server: اتصال به master و RESTORE WITH REPLACE.
    /// PostgreSQL: به "database" postgres وصل میشود، اتصالهای دیتابیس را
    /// خاتم میدهد، DROP WITH (FORCE) + CREATE و سپس pg_restore.
    /// </summary>
    public async Task RestoreDatabaseAsync(string? fileName, CancellationToken cancellationToken = default)
    {
        if (Data.DbRuntime.IsPostgres)
        {
            await RestorePostgresAsync(fileName, cancellationToken);
            Npgsql.NpgsqlConnection.ClearAllPools();
            return;
        }
        await RestoreSqlServerAsync(fileName, cancellationToken);
        Microsoft.Data.SqlClient.SqlConnection.ClearAllPools();
    }

    private async Task RestorePostgresAsync(string? fileName, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(fileName) ||
            fileName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 ||
            fileName.Contains('\\') || fileName.Contains('/'))
            throw new ArgumentException("نامِ فایلِ پشتیبان نامعتبر است.");
        string dump = Path.Combine(DbFolder, fileName);
        if (!File.Exists(dump))
            throw new FileNotFoundException("فایلِ پشتیبان پیدا نشد.", fileName);

        string? cs = _db.Database.GetConnectionString();
        if (string.IsNullOrWhiteSpace(cs))
            throw new InvalidOperationException("رشتهٔ اتصالِ PostgreSQL برای بازگردانی پیدا نشد.");
        var builder = new Npgsql.NpgsqlConnectionStringBuilder(cs);
        string dbName = builder.Database ?? "resirai";

        // ۱) به دیتابیسِ سیستمی postgres وصل میشویم (خودِ دیتابیس را نمیتواند وسطِ
        // جایگزینی عوض کند) و همهٔ جلساتِ باز را میبندیم.
        var sys = new Npgsql.NpgsqlConnectionStringBuilder(cs) { Database = "postgres" };
        await using (var conn = new Npgsql.NpgsqlConnection(sys.ConnectionString))
        {
            await conn.OpenAsync(cancellationToken);
            await ExecuteNpgsqlAsync(conn,
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity " +
                "WHERE datid IS NOT NULL AND datname = '" + dbName.Replace("'", "''") + "' " +
                "AND pid <> pg_backend_pid()", cancellationToken);
            await ExecuteNpgsqlAsync(conn,
                "DROP DATABASE IF EXISTS \"" + dbName.Replace("\"", "\"\"") + "\" WITH (FORCE)", cancellationToken);
            await ExecuteNpgsqlAsync(conn,
                "CREATE DATABASE \"" + dbName.Replace("\"", "\"\"") + "\" ENCODING 'UTF8'", cancellationToken);
        }

        // ۲) بارگذاریِ فایلِ Custom با pg_restore
        var psi = new ProcessStartInfo { FileName = "pg_restore", RedirectStandardError = true };
        psi.ArgumentList.Add("--no-owner");
        psi.ArgumentList.Add("--host"); psi.ArgumentList.Add(builder.Host ?? "localhost");
        psi.ArgumentList.Add("--port"); psi.ArgumentList.Add(builder.Port.ToString());
        psi.ArgumentList.Add("--username"); psi.ArgumentList.Add(builder.Username ?? "postgres");
        psi.ArgumentList.Add("--dbname"); psi.ArgumentList.Add(dbName);
        if (!string.IsNullOrEmpty(builder.Password))
            psi.Environment["PGPASSWORD"] = builder.Password;
        using (var proc = Process.Start(psi)
               ?? throw new InvalidOperationException("اجرای pg_restore ممکن نشد — postgresql-client نصب نیست."))
        {
            string err = await proc.StandardError.ReadToEndAsync(cancellationToken);
            await proc.WaitForExitAsync(cancellationToken);
            if (proc.ExitCode != 0)
                throw new InvalidOperationException($"pg_restore با کد {proc.ExitCode} خطا داد: {err}");
        }

        _logger.LogInformation("[ReSiRai پشتیبان] بازگردانیِ PostgreSQL انجام شد ← {Db}", dbName);
    }

    private static async Task ExecuteNpgsqlAsync(
        Npgsql.NpgsqlConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task RestoreSqlServerAsync(string? fileName, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(fileName) ||
            fileName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 ||
            fileName.Contains('\\') || fileName.Contains('/'))
            throw new ArgumentException("نامِ فایلِ پشتیبان نامعتبر است.");
        string bak = Path.Combine(DbFolder, fileName);
        if (!File.Exists(bak))
            throw new FileNotFoundException("فایلِ پشتیبان پیدا نشد.", fileName);

        var masterConnection = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(_db.Database.GetConnectionString())
        {
            InitialCatalog = "master"
        };

        await using var master = new Microsoft.Data.SqlClient.SqlConnection(masterConnection.ConnectionString);
        await master.OpenAsync(cancellationToken);

        // دیتابیس باید تنها باشد؛ اتصال‌هایِ دیگر (از جمله همین برنامه) قطع می‌شوند.
        await ExecuteAsync(master, "ALTER DATABASE [ReSiRai] SET SINGLE_USER WITH ROLLBACK IMMEDIATE", cancellationToken);
        try
        {
            await ExecuteAsync(master,
                "RESTORE DATABASE [ReSiRai] FROM DISK = '" + bak.Replace("'", "''") + "' WITH REPLACE, RECOVERY",
                cancellationToken);
        }
        finally
        {
            // حتی اگر بازگردانی شکست بخورد، دیتابیس نباید در حالتِ تک‌کاربره بماند.
            try { await ExecuteAsync(master, "ALTER DATABASE [ReSiRai] SET MULTI_USER", CancellationToken.None); }
            catch (Exception e) { _logger.LogError(e, "[ReSiRai پشتیبان] بازگردانیِ حالتِ چندکاربره ناموفق"); }
        }

        // اتصال‌هایِ در صفِ قبلی دیگر معتبر نیستند.
        Microsoft.Data.SqlClient.SqlConnection.ClearAllPools();
    }

    private static async Task ExecuteAsync(Microsoft.Data.SqlClient.SqlConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>
    /// تصاویرِ غایب از پشتیبان برمی‌گردند. /XO یعنی فایلِ تازه‌تر در مقصد هرگز
    /// بازنویسی نمی‌شود ⇒ فقط جاهایِ خالی پر می‌شوند.
    /// </summary>
    public async Task<int> RestoreImagesAsync(CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(ImagesFolder))
            throw new InvalidOperationException("پشتیبانِ تصاویر پیدا نشد.");
        string destination = _storage.GetRootPath();
        Directory.CreateDirectory(destination);

        var psi = new ProcessStartInfo
        {
            FileName = "robocopy",
            Arguments = $"\"{ImagesFolder}\" \"{destination}\" /E /XO /R:1 /W:1 /NP /NDL /NJH /NFL /BYTES",
            CreateNoWindow = true,
            UseShellExecute = false
        };
        using var proc = Process.Start(psi);
        if (proc is null) throw new InvalidOperationException("اجرای robocopy ممکن نشد.");
        await proc.WaitForExitAsync(cancellationToken);
        if (proc.ExitCode >= 8)
            throw new InvalidOperationException($"robocopy با کد {proc.ExitCode} خطا داد.");
        return proc.ExitCode;
    }

    /// <summary>لاگِ رویدادها ۱۸۰ روز نگه داشته می‌شود؛ پاک‌سازی در همین اجرا انجام می‌شود.</summary>
    private async Task PruneEventsAsync()
    {
        try
        {
            var cutoff = DateTime.Now.AddDays(-EventRetentionDays);
            await _db.AppEvents.Where(x => x.EventAt < cutoff)
                .ExecuteDeleteAsync(CancellationToken.None);
        }
        catch (Exception e)
        {
            _logger.LogWarning("[ReSiRai پشتیبان] پاک‌سازیِ لاگِ رویدادها نشد: {E}", e.Message);
        }
    }

    /// <summary>
    /// مسیر و تعدادِ نسخه را در فایلِ کانفیگ می‌نویسد. فایل با reloadOnChange
    /// بارگذاری شده، پس تغییر بدونِ ریستارت اعمال می‌شود.
    /// </summary>
    public void UpdateSettings(string? rootPath, int keepBackups)
    {
        string path = (rootPath ?? string.Empty).Trim().TrimEnd('\\', '/');
        if (path.Length == 0)
            throw new ArgumentException("مسیرِ ذخیرهٔ پشتیبان خالی است.");
        if (!Path.IsPathRooted(path))
            throw new ArgumentException("مسیر باید کامل باشد، مثل D:\\ReSiRaiBackup");
        if (string.Equals(path.TrimEnd('\\'), _storage.GetRootPath().TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("مسیرِ پشتیبان نمی‌تواند همان پوشهٔ تصاویر باشد.");
        int keep = Math.Clamp(keepBackups, 1, 100);

        string file = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "ReSiRai", "ReSiRai.config.json");

        System.Text.Json.Nodes.JsonObject root;
        try
        {
            string json = File.Exists(file) ? File.ReadAllText(file, System.Text.Encoding.UTF8) : "{}";
            root = System.Text.Json.Nodes.JsonNode.Parse(json) as System.Text.Json.Nodes.JsonObject
                ?? new System.Text.Json.Nodes.JsonObject();
        }
        catch (Exception e)
        {
            throw new InvalidOperationException($"فایلِ کانفیگ خوانده نشد: {e.Message}");
        }

        var backup = root["Backup"] as System.Text.Json.Nodes.JsonObject ?? new System.Text.Json.Nodes.JsonObject();
        backup["RootPath"] = path;
        backup["KeepBackups"] = keep;
        root["Backup"] = backup;

        File.WriteAllText(file, root.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }),
            new System.Text.UTF8Encoding(false));
    }

    /// <summary>وضعیت برای نمایش در تنظیمات/داشبورد.</summary>
    public object GetStatus()
    {
        var state = ReadState();
        int dbCount = Directory.Exists(DbFolder) ? Directory.GetFiles(DbFolder, "resirai_*.bak").Length : 0;
        long imagesBytes = 0;
        if (Directory.Exists(ImagesFolder))
        {
            try
            {
                imagesBytes = Directory.EnumerateFiles(ImagesFolder, "*", SearchOption.AllDirectories)
                    .Sum(f => new FileInfo(f).Length);
            }
            catch { /* دسترسی نامعتبر ⇒ صفر نشان می‌دهیم */ }
        }

        bool sameDrive = false;
        try
        {
            sameDrive = string.Equals(
                Path.GetPathRoot(RootPath)?.TrimEnd('\\'),
                Path.GetPathRoot(_storage.GetRootPath())?.TrimEnd('\\'),
                StringComparison.OrdinalIgnoreCase);
        }
        catch { /* مسیر نامعتبر */ }

        return new
        {
            rootPath = RootPath,
            keepBackups = KeepBackups,
            lastRun = state.LastRun,
            lastOk = state.Ok,
            lastError = state.Error,
            dbBackupCount = dbCount,
            imagesBytes,
            sameDriveWarning = sameDrive,
            due = IsDue(),
            running = IsRunning
        };
    }
}

/// <summary>ساعتِ پشتیبان: هر ساعت بررسی؛ اگر آخرین پشتیبان بیش از ۲۳ ساعت پیش بوده، اجرا.</summary>
public sealed class BackupScheduler : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<BackupScheduler> _logger;

    public BackupScheduler(IServiceProvider services, ILogger<BackupScheduler> logger)
    {
        _services = services;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // کمی تأخیر تا برنامه بالا بیاید و رابطِ کاربری آماده شود.
        try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); } catch { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _services.CreateScope();
                var backup = scope.ServiceProvider.GetRequiredService<BackupService>();
                if (backup.IsDue())
                {
                    _logger.LogInformation("[ReSiRai پشتیبان] شروعِ خودکار…");
                    await backup.RunAsync(stoppingToken);
                }
            }
            catch (Exception e)
            {
                _logger.LogError(e, "[ReSiRai پشتیبان] خطای زمان‌بند");
            }
            try { await Task.Delay(TimeSpan.FromHours(1), stoppingToken); } catch { return; }
        }
    }
}