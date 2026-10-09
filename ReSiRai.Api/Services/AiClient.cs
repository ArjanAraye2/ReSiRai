using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace ReSiRai.Api.Services;

// یک خطای قابلِ نمایش برای کاربر — پیام فارسی است چون خواننده دندان‌پزشک است، نه توسعه‌دهنده.
public sealed class AiException : Exception
{
    public AiException(string userMessage, int httpStatus = 502, string? detail = null, bool retryable = false)
        : base(userMessage)
    {
        UserMessage = userMessage;
        HttpStatus = httpStatus;
        Detail = detail;
        Retryable = retryable;
    }

    public string UserMessage { get; }
    public int HttpStatus { get; }
    public string? Detail { get; }
    /// <summary>سرویسِ رایگان گاهی می‌آویزد؛ در این حالت ارزش دارد مدلِ دیگر را امتحان کنیم.</summary>
    public bool Retryable { get; }
}

// تنها جایی که با مدلِ بینایی حرف می‌زند.
//
// اینکه کدام سرویس کارِ تحلیل را بکند، **کانفیگ است نه کد**: AI:BaseUrl ،AI:ApiKey و
// AI:Model می‌توانند به OpenRouter یا Hugging Face یا SiliconFlow یا خودِ OpenAI اشاره کنند.
// اگر نخستین مدل جواب ندهد (آویزان شدن، خطای سرور) یک بار با AI:FallbackModel امتحان
// می‌شود، چون سرویسِ رایگان گاهی یک مدل را برای دقایقی از دست می‌دهد.
public sealed class AiClient
{
    // سقفِ زمانِ **هر** تلاش: سرویسِ رایگان برای چند تصویر گاهی بیش از سه دقیقه
    // جواب می‌دهد (اندازه‌گیری شده: 216 ثانیه)، پس پیش‌فرض بلند است و با
    // AI:TimeoutSeconds در ReSiRai.config.json قابلِ تنظیم.
    private const int DefaultAttemptTimeoutSeconds = 240;

    private int AttemptTimeoutSeconds
    {
        get
        {
            string? raw = _configuration["AI:TimeoutSeconds"];
            return int.TryParse(raw, out int seconds) && seconds > 0
                ? seconds
                : DefaultAttemptTimeoutSeconds;
        }
    }

    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _httpClients;

    public AiClient(IConfiguration configuration, IHttpClientFactory httpClients)
    {
        _configuration = configuration;
        _httpClients = httpClients;
    }

    private static string? First(params string?[] values)
    {
        foreach (var value in values)
            if (!string.IsNullOrWhiteSpace(value))
                return value;
        return null;
    }

    public string? ApiKey => First(_configuration["AI:ApiKey"], _configuration["OpenAI:ApiKey"],
        Environment.GetEnvironmentVariable("OPENAI_API_KEY"));

    public string BaseUrl => (First(_configuration["AI:BaseUrl"], _configuration["OpenAI:BaseUrl"])
        ?? "https://api.openai.com/v1").TrimEnd('/');

    public string? Model => First(_configuration["AI:Model"], _configuration["OpenAI:Model"]);

    /// <summary>
    /// مدل‌های جایگزین به‌ترتیب. مدلِ رایگانِ گاهی بالادستی محدود می‌شود؛ در آن
    /// حالت مدلِ بعدیِ فهرست امتحان می‌شود تا کاربر به‌جای خطا جواب بگیرد.
    /// </summary>
    public IReadOnlyList<string> FallbackModels
    {
        get
        {
            var list = new List<string>();
            string raw = First(_configuration["AI:FallbackModels"], _configuration["AI:FallbackModel"])
                ?? string.Empty;
            foreach (var part in raw.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string m = part.Trim();
                if (m.Length > 0 && !list.Contains(m, StringComparer.OrdinalIgnoreCase))
                    list.Add(m);
            }
            return list;
        }
    }

    // نبودِ کلید، ایرادِ راه‌اندازی است نه خطای سرویس ⇒ فراخواننده 503 برمی‌گرداند.
    public string? ConfigurationError()
    {
        // مسیرِ بدونِ کلید که فعال باشد، محصول بدونِ هیچ کلیدی هم کار می‌کند.
        if (KeylessAllowed) return null;
        if (string.IsNullOrWhiteSpace(ApiKey))
            return "کلیدِ هوش مصنوعی تنظیم نشده است. ساختِ کلیدِ رایگان: openrouter.ai/keys و سپس AI:ApiKey در ReSiRai.config.json";
        if (string.IsNullOrWhiteSpace(Model))
            return "مدلِ هوش مصنوعی تنظیم نشده است (AI:Model در ReSiRai.config.json).";
        return null;
    }

    // مدل‌های ضعیف گاهی JSON را در متن یا توضیح می‌پیچند؛ اولین شیءٔ متوازن
    // را بیرون می‌کشیم تا پاسخِ قابلِ استفاده هدر نرود.
    private static string ExtractFirstJson(string text)
    {
        int start = text.IndexOf('{');
        if (start < 0) return string.Empty;
        int depth = 0;
        bool inString = false, escaped = false;
        for (int i = start; i < text.Length; i++)
        {
            char c = text[i];
            if (inString)
            {
                if (escaped) escaped = false;
                else if (c == '\\') escaped = true;
                else if (c == '"') inString = false;
                continue;
            }
            if (c == '"') inString = true;
            else if (c == '{') depth++;
            else if (c == '}')
            {
                depth--;
                if (depth == 0) return text.Substring(start, i - start + 1);
            }
        }
        return string.Empty;
    }

    private static bool IsValidJson(string text)
    {
        if (text.Length == 0) return false;
        try { using var _ = JsonDocument.Parse(text); return true; }
        catch (JsonException) { return false; }
    }

    // پاسخ را فقط وقتی تحویل می‌دهیم که واقعاً JSON معتبر باشد؛ وگرنه متنِ خام
    // را از دلش بیرون می‌کشیم.
    private static string AcceptJson(string raw, string text)
    {
        string normalized = NormalizeJson(text);
        if (normalized.Length > 0 && (normalized[0] == '{' || normalized[0] == '[') && IsValidJson(normalized))
            return normalized;
        string extracted = ExtractFirstJson(text);
        if (extracted.Length > 0 && IsValidJson(extracted)) return extracted;
        extracted = ExtractFirstJson(raw);
        return extracted.Length > 0 && IsValidJson(extracted) ? extracted : string.Empty;
    }

    // پرامپت + تصویرها را می‌فرستد و **متنِ JSON آمادهٔ پارس** برمی‌گرداند.
    public async Task<string> CompleteJsonAsync(string prompt, IReadOnlyList<(string Mime, byte[] Bytes)> images,
        CancellationToken cancellationToken, bool compactImages = false)
    {
        string? configError = ConfigurationError();
        if (configError is not null) throw new AiException(configError, 503);

        // کوچک‌سازیِ فقط برایِ همین درخواست — فایلِ ذخیره‌شده دست نمی‌خورد.
        // (با حلقه و نه lambda، تا گاردِ ویندوز برایِ تحلیل‌گر هم قابلِ اثبات باشد)
        var prepared = new List<(string Mime, byte[] Bytes)>(images.Count);
        foreach (var item in images)
        {
            if (OperatingSystem.IsWindows())
                prepared.Add(PrepareForAi(item.Mime, item.Bytes, compactImages));
            else
                prepared.Add(item);
        }

        var attempts = new List<string?>();
        if (!string.IsNullOrWhiteSpace(Model)) attempts.Add(Model);
        foreach (var fallback in FallbackModels)
            if (!attempts.Any(m => string.Equals(m, fallback, StringComparison.OrdinalIgnoreCase)))
                attempts.Add(fallback);

        AiException? last = null;
        foreach (var model in attempts)
        {
            var watch = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                string raw = await SendCoreAsync(prompt, prepared, model, cancellationToken);
                string text = ExtractText(raw) ?? string.Empty;
                string normalized = AcceptJson(raw, text);
                if (normalized.Length > 0)
                {
                    // کدام مدل جواب داد و چقدر طول کشید؟ برای انتخابِ پایدارترین سرویس لازم است.
                    Console.WriteLine($"[ReSiRai AI] ok via {model ?? "default"} in {watch.ElapsedMilliseconds}ms");
                    return normalized;
                }

                // پاسخِ ۲۰۰ ولی بی‌محتوا (مدلِ استدلالی، خطا در خودِ بدنه، نتیجهٔ ناقص):
                // به‌جای دادنِ خطا به کاربر، مدلِ بعدیِ فهرست را امتحان می‌کنیم و خامه را
                // در لاگ می‌گذاریم تا بعداً قابلِ بررسی باشد.
                Console.WriteLine($"[ReSiRai AI] unusable reply from {model ?? "default"}: "
                    + raw.Substring(0, Math.Min(400, raw.Length)));
                last = new AiException("پاسخِ سرویسِ هوش مصنوعی قابلِ استفاده نبود. دوباره تلاش کنید.",
                    502, retryable: true);
            }
            catch (AiException e)
            {
                // هر خطا (قطعی، کلید، پاسخِ بد) → مدلِ بعدی؛ اگر همه شکستند، مسیرِ رایگان.
                last = e;
            }
        }
        if (KeylessAllowed)
            return await KeylessAsync(prompt, prepared, cancellationToken);
        throw last ?? new AiException("ارتباط با سرویسِ هوش مصنوعی برقرار نشد.", 502);
    }

    // یک مدل: با JSON-mode، و اگر مدل آن را نداشت، بدونِ آن.
    private async Task<string> SendCoreAsync(string prompt, IReadOnlyList<(string Mime, byte[] Bytes)> images,
        string? model, CancellationToken cancellationToken)
    {
        try
        {
            return await SendAsync(BuildBody(prompt, images, model, jsonMode: true), cancellationToken);
        }
        catch (AiException e) when (e.HttpStatus == 400 && e.Detail is not null &&
                                    e.Detail.Contains("response_format", StringComparison.OrdinalIgnoreCase))
        {
            // بعضی مدل‌های رایگان خروجیِ ساختاریافته ندارند؛ همان درخواست را بدونِ آن می‌فرستیم.
            return await SendAsync(BuildBody(prompt, images, model, jsonMode: false), cancellationToken);
        }
    }

    // تصویرِ ارسالی به سرویسِ AI کوچک می‌شود تا چند مگابایت به بیرون نرود.
    // فقط نسخهٔ ارسالی تغییر می‌کند: فایلِ ذخیره‌شده در مطب با همان کیفیتِ
    // کامل باقی می‌ماند، چون کیفیتِ بالینی قابلِ معامله نیست.
    private const int MaxSide = 1536;
    private const long MaxBytes = 700L * 1024;
    // در تحلیلِ چندتصویری هر تصویر کوچک‌تر فرستاده می‌شود تا مجموعِ پیام زیرِ حدِی
    // بماند که خطوطِ ناپایدار یا سرویس آن را وسطِ ارسال قطع نکنند.
    private const int CompactMaxSide = 1024;
    private const long CompactMaxBytes = 320L * 1024;

    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    private static (string Mime, byte[] Bytes) PrepareForAi(string mime, byte[] bytes, bool compact)
    {
        return ImageOps.Resize(mime, bytes, compact ? CompactMaxSide : MaxSide, compact ? CompactMaxBytes : MaxBytes);
    }

    private object BuildBody(string prompt, IReadOnlyList<(string Mime, byte[] Bytes)> images, string? model,
        bool jsonMode)
    {
        var content = new List<object> { new { type = "text", text = prompt } };
        foreach (var (mime, bytes) in images)
        {
            if (bytes is not { Length: > 0 }) continue;
            string type = string.IsNullOrWhiteSpace(mime) || !mime.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                ? "image/jpeg" : mime;
            content.Add(new { type = "image_url", image_url = new { url = $"data:{type};base64,{Convert.ToBase64String(bytes)}" } });
        }

        var messages = new object[] { new { role = "user", content } };
        return jsonMode
            ? new { model, temperature = 0.1, response_format = new { type = "json_object" }, messages }
            : new { model, temperature = 0.1, messages };
    }

    private async Task<string> SendAsync(object body, CancellationToken cancellationToken)
    {
        var client = _httpClients.CreateClient();
        // سرویسِ رایگان گاهی دقایقی می‌آویزد؛ بیش از این ارزشِ منتظر ماندن ندارد چون
        // مدلِ جایگزین در همین زمان امتحان می‌شود.
        client.Timeout = TimeSpan.FromSeconds(AttemptTimeoutSeconds);

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ApiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        try
        {
            using var response = await client.SendAsync(request, cancellationToken);
            string raw = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                // متنِ خام خطا در لاگ می‌ماند تا بعداً دقیقاً بفهمیم کدام سقف یا کدام ارائه‌دهنده بوده است.
                Console.WriteLine($"[ReSiRai AI] HTTP {(int)response.StatusCode}: "
                    + raw.Substring(0, Math.Min(400, raw.Length)));
                throw Translate(response.StatusCode, raw);
            }
            return raw;
        }
        catch (AiException) { throw; }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new AiException(
                "پاسخِ سرویسِ هوش مصنوعی دیر رسید. چند لحظه بعد دوباره تلاش کنید.", 504, retryable: true);
        }
        catch (HttpRequestException e)
        {
            throw new AiException("ارتباط با سرویسِ هوش مصنوعی برقرار نشد. اتصال اینترنت را بررسی کنید.",
                502, e.Message, retryable: true);
        }
    }

    /// <summary>
    /// A 403 is not always a bad key: filtering gateways and security software
    /// answer with their own "denied" text before the request ever reaches the
    /// AI provider. The doctor must not go hunting in the config for a key that
    /// is perfectly fine - so the message names the real cause whenever the body
    /// makes it clear.
    /// </summary>
    private static AiException BlockedOrKey(string detail)
    {
        bool blocked = detail.Contains("security policy", StringComparison.OrdinalIgnoreCase)
            || detail.Contains("access denied", StringComparison.OrdinalIgnoreCase)
            || detail.Contains("blocked", StringComparison.OrdinalIgnoreCase);
        return blocked
            ? new AiException(
                "اتصال به سرویسِ هوش مصنوعی قطع شده است (فیلترینگِ شبکه جلوی آن را گرفته). کلیدِ شما سالم است؛ با اتصالِ بدونِ فیلتر دوباره تلاش کنید یا کمی بعد امتحان کنید.", 502, detail)
            : new AiException(
                "کلیدِ هوش مصنوعی نامعتبر است یا دسترسی ندارد. کلید را در ReSiRai.config.json بررسی کنید.", 502, detail);
    }

    // --- مسیرِ بدونِ کلید (رایگان) -------------------------------------------
    // وقتی سرویسِ کلیددار در دسترس نیست (قطعی/تحریم/بدونِ کلید)، محصول نباید
    // بایستد: صفحه‌ها محلی با Tesseract خوانده می‌شوند و یک مدلِ متنیِ رایگان
    // نتیجه را ساختار می‌دهد. برایِ خاموش کردن: AI:AllowKeylessFallback=false
    private bool KeylessAllowed =>
        !string.Equals(_configuration["AI:AllowKeylessFallback"], "false", StringComparison.OrdinalIgnoreCase);

    private string TesseractExe
    {
        get
        {
            string? configured = _configuration["AI:TesseractExe"];
            if (!string.IsNullOrWhiteSpace(configured)) return configured;
            string[] candidates =
            {
                Path.Combine(AppContext.BaseDirectory, "Tools", "Tesseract-OCR", "tesseract.exe"),
                @"C:\Program Files\Tesseract-OCR\tesseract.exe",
                @"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"
            };
            return candidates.FirstOrDefault(File.Exists) ?? string.Empty;
        }
    }

    private string TessdataDir
    {
        get
        {
            string? configured = _configuration["AI:TessdataDir"];
            if (!string.IsNullOrWhiteSpace(configured)) return configured;
            string bundled = Path.Combine(AppContext.BaseDirectory, "Tools", "tessdata");
            if (Directory.Exists(bundled)) return bundled;
            return Path.Combine(Path.GetDirectoryName(TesseractExe) ?? string.Empty, "tessdata");
        }
    }

    // OCR محلی: اول جهتِ صفحه (عکسِ موبایل اغلب ۹۰ درجه چرخیده است)، بعد خواندن.
    public async Task<string> OcrTextAsync(byte[] bytes, CancellationToken cancellationToken)
        => (await OcrRunAsync(bytes, string.Empty, true, cancellationToken)).Text;

    // همان OCR، اما خروجیِ TSV با مختصاتِ هر کلمه؛ برایِ بازسازیِ جدول‌های متراکم
    // که در متنِ ساده ردیف‌ها را به هم می‌ریزند.
    public async Task<string> OcrTsvAsync(byte[] bytes, CancellationToken cancellationToken)
        => (await OcrRunAsync(bytes, "tsv", false, cancellationToken)).Text;

    /// <summary>TSV plus the upright (rotated) image the coordinates refer to.</summary>
    public async Task<(string Text, byte[] Image)> OcrDataAsync(byte[] bytes, CancellationToken cancellationToken)
        => await OcrRunAsync(bytes, "tsv", false, cancellationToken);

    /// <summary>
    /// تصویر همان‌طور که OCR دید (راست‌چین): مختصاتِ ردیف‌های استخراج‌شده فقط
    /// با این نسخه می‌خواند. برایِ نمایشِ تکهٔ برگه و بازخوانیِ نقطه‌ای لازم است.
    /// </summary>
    public async Task<byte[]> UprightAsync(byte[] bytes, CancellationToken cancellationToken)
    {
        string exe = TesseractExe;
        if (exe.Length == 0 || !OperatingSystem.IsWindows()) return bytes;
        string temp = Path.Combine(Path.GetTempPath(), "resirai-upright-" + Guid.NewGuid().ToString("N") + ".jpg");
        try
        {
            await File.WriteAllBytesAsync(temp, bytes, cancellationToken);
            string osd = string.Empty;
            try
            {
                osd = await RunTesseractAsync(exe, temp, "--psm 0 -l osd", cancellationToken) ?? string.Empty;
            }
            catch (AiException) { return bytes; }
            var match = System.Text.RegularExpressions.Regex.Match(osd, @"Rotate:\s*(\d+)");
            if (!match.Success) return bytes;
            RotateToUpright(temp, int.Parse(match.Groups[1].Value) % 360);
            return await File.ReadAllBytesAsync(temp, cancellationToken);
        }
        finally
        {
            try { File.Delete(temp); } catch { }
        }
    }

    private async Task<(string Text, byte[] Image)> OcrRunAsync(byte[] bytes, string outputMode, bool persianFirst,
        CancellationToken cancellationToken)
    {
        byte[] upright = bytes;
        string exe = TesseractExe;
        if (exe.Length == 0)
            return (outputMode.Length == 0 ? await OcrSpaceAsync(bytes, cancellationToken) : string.Empty, upright);
        string temp = Path.Combine(Path.GetTempPath(), "resirai-ocr-" + Guid.NewGuid().ToString("N") + ".jpg");
        string tempOrig = Path.Combine(Path.GetTempPath(), "resirai-ocr0-" + Guid.NewGuid().ToString("N") + ".jpg");
        try
        {
            await File.WriteAllBytesAsync(temp, bytes, cancellationToken);
            await File.WriteAllBytesAsync(tempOrig, bytes, cancellationToken);
            // تشخیصِ جهت باید روی خودِ تصویرِ کامل باشد؛ نسخهٔ کوچک OSD را به
            // اشتباه می‌اندازد (برگه وارونه خوانده می‌شد). شکستِ OSD هم مهلک
            // نیست: تکه‌های کوچک اغلب OSD ندارند و همان‌طور که هستند خوانده می‌شوند.
            string osd = string.Empty;
            try
            {
                osd = await RunTesseractAsync(exe, temp, "--psm 0 -l osd", cancellationToken) ?? string.Empty;
            }
            catch (AiException) { /* بدونِ چرخش ادامه می‌دهیم */ }
            var match = System.Text.RegularExpressions.Regex.Match(osd, @"Rotate:\s*(\d+)");
            bool turned = false;
            if (match.Success && OperatingSystem.IsWindows())
            {
                int angle = int.Parse(match.Groups[1].Value) % 360;
                if (angle != 0)
                {
                    RotateToUpright(temp, angle);
                    upright = await File.ReadAllBytesAsync(temp, cancellationToken);
                    turned = true;
                }
            }
            async Task<string> ReadAsync(string file)
            {
                if (!persianFirst)
                    return await RunTesseractAsync(exe, file, $"--psm 6 -l eng {outputMode}", cancellationToken) ?? string.Empty;
                try
                {
                    return await RunTesseractAsync(exe, file, $"--psm 6 -l fas+eng {outputMode}", cancellationToken) ?? string.Empty;
                }
                catch (AiException)
                {
                    // اگر دادهٔ زبانِ فارسی نصب نبود، همان انگلیسی بهتر از هیچ است.
                    return await RunTesseractAsync(exe, file, $"--psm 6 -l eng {outputMode}", cancellationToken) ?? string.Empty;
                }
            }
            if (!turned) return (await ReadAsync(temp), upright);
            // OSD می‌تواند اشتباه کند (عکسِ نمایشگر، عکسِ با مانع) و چرخشِ اشتباه
            // OCR را نابود می‌کند؛ هر دو حالت خوانده می‌شود و خواناتر می‌ماند.
            string turnedText = await ReadAsync(temp);
            string straightText = await ReadAsync(tempOrig);
            if (OcrScore(straightText, outputMode) > OcrScore(turnedText, outputMode))
            {
                upright = bytes;
                return (straightText, upright);
            }
            return (turnedText, upright);
        }
        finally
        {
            try { File.Delete(temp); } catch { }
            try { File.Delete(tempOrig); } catch { }
        }
    }

    /// <summary>
    /// خواناییِ خروجیِ OCR برایِ انتخابِ بینِ حالتِ چرخیده و اصلی: کلمه‌هایِ
    /// مطمئنِ TSV یا حروفِ متنِ ساده.
    /// </summary>
    private static int OcrScore(string text, string outputMode)
    {
        if (outputMode != "tsv") return text.Count(char.IsLetter);
        int score = 0;
        foreach (var line in text.Split('\n').Skip(1))
        {
            var parts = line.Split('\t');
            if (parts.Length < 11) continue;
            if (double.TryParse(parts[10], System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out double conf) && conf >= 50) score++;
        }
        return score;
    }

    /// <summary>
    /// برگه‌ای که وارونه افتاده و تشخیصِ جهت نتوانسته درستش کند: یک‌بار دیگر
    /// با چرخشِ ۱۸۰ درجه خوانده می‌شود و نتیجهٔ بهتر می‌ماند.
    /// </summary>
    public async Task<string> OcrTsvTurnedAsync(byte[] bytes, CancellationToken cancellationToken)
    {
        if (!OperatingSystem.IsWindows() || TesseractExe.Length == 0) return string.Empty;
        byte[] turned = ImageOps.RotateJpeg(bytes, 180);
        return await OcrTsvAsync(turned, cancellationToken);
    }

    // فقط ویندوز (System.Drawing)؛ مانندِ PrepareForAi صریح می‌گوییم.
    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    private static void RotateToUpright(string path, int rotate)
    {
        ImageOps.RotateFileJpeg(path, rotate);
    }

    private static async Task<string?> RunTesseractAsync(string exe, string imagePath, string args,
        CancellationToken cancellationToken)
    {
        var info = new System.Diagnostics.ProcessStartInfo
        {
            FileName = exe,
            // Tesseract: image and output first, then options and config files.
            // Putting the "tsv" config before the image made Tesseract read the
            // config name as the image path and return nothing.
            Arguments = $"\"{imagePath}\" stdout {args}",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using var process = System.Diagnostics.Process.Start(info);
        if (process is null) throw new AiException("برنامهٔ خواندنِ متن اجرا نشد.", 502);
        string stdout = await process.StandardOutput.ReadToEndAsync(cancellationToken);
        string stderr = await process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        if (process.ExitCode != 0 && stdout.Trim().Length == 0)
            throw new AiException("خواندنِ متنِ تصویر ناموفق بود.", 502, stderr);
        return stdout;
    }

    // پشتیبان: اگر Tesseract نصب نبود، سرویسِ OCR رایگان (سقفِ حجم/روز دارد).
    private async Task<string> OcrSpaceAsync(byte[] bytes, CancellationToken cancellationToken)
    {
        var client = _httpClients.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(Math.Max(60, AttemptTimeoutSeconds));
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("helloworld"), "apikey");
        form.Add(new StringContent("eng"), "language");
        form.Add(new StringContent("false"), "isOverlayRequired");
        form.Add(new ByteArrayContent(bytes), "file", "page.jpg");
        using var response = await client.PostAsync("https://api.ocr.space/parse/image", form, cancellationToken);
        string raw = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode) throw new AiException("سرویسِ خواندنِ متن در دسترس نیست.", 502, raw);
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.TryGetProperty("ParsedResults", out var results) && results.ValueKind == JsonValueKind.Array)
            {
                var sb = new System.Text.StringBuilder();
                foreach (var r in results.EnumerateArray())
                    if (r.TryGetProperty("ParsedText", out var t) && t.ValueKind == JsonValueKind.String)
                        sb.AppendLine(t.GetString());
                return sb.ToString();
            }
        }
        catch (JsonException) { }
        return string.Empty;
    }

    // سرویس‌های رایگانِ بدونِ کلید — متنی؛ تصویرها قبلاً با OCR خوانده شده‌اند.
    private async Task<string> KeylessAsync(string prompt, IReadOnlyList<(string Mime, byte[] Bytes)> images,
        CancellationToken cancellationToken)
    {
        // سقفِ اندازه برایِ سرویس‌های رایگان؛ بزرگ‌تر از این با 402/400 رد می‌شود.
        const int MaxPromptChars = 9000;

        // از وسط فشرده می‌شود: آغازِ داده‌ها و پایانِ قراردادِ JSON سالم می‌مانند.
        static string CompressPrompt(string text, int max)
        {
            int head = max * 2 / 5;
            int tail = max - head - 60;
            return text[..head] + "\n...[abbreviated]...\n" + text[^tail..];
        }

        string finalPrompt = prompt;
        if (images.Count > 0)
        {
            var sb = new System.Text.StringBuilder();
            sb.Append(prompt);
            sb.Append("\n\nThe printed content of the photographed page(s) was read with OCR and may contain noise:\n---\n");
            foreach (var (mime, bytes) in images)
                if (bytes is { Length: > 0 }) sb.AppendLine(await OcrTextAsync(bytes, cancellationToken));
            sb.Append("---\nStructure the result from the text above. Fix obvious OCR noise (for example a missing decimal point) using the printed reference ranges and context. Never invent rows.");
            finalPrompt = sb.ToString();
        }

        // سرویس‌های رایگان پرامپتِ بزرگ را با 402/400 رد می‌کنند؛ از وسط فشرده
        // می‌شود تا آغازِ داده‌ها و پایانِ قراردادِ JSON سالم بمانند.
        if (finalPrompt.Length > MaxPromptChars)
            finalPrompt = CompressPrompt(finalPrompt, MaxPromptChars);

        (string Url, string Model)[] attempts =
        {
            // مدل‌ها روزانه عوض می‌شوند؛ این‌ها با تستِ زنده تأیید شده‌اند.
            ("https://api.llm7.io/v1/chat/completions", "gpt-oss-120b:free"),
            ("https://text.pollinations.ai/openai", "openai-fast")
        };
        AiException? last = null;
        foreach (var (url, model) in attempts)
        {
            try
            {
                var client = _httpClients.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(AttemptTimeoutSeconds);
                var body = new { model, temperature = 0.1, messages = new object[] { new { role = "user", content = finalPrompt } } };
                using var request = new HttpRequestMessage(HttpMethod.Post, url);
                request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
                using var response = await client.SendAsync(request, cancellationToken);
                string raw = await response.Content.ReadAsStringAsync(cancellationToken);
                if (!response.IsSuccessStatusCode) throw Translate(response.StatusCode, raw);
                string text = ExtractText(raw) ?? string.Empty;
                string normalized = AcceptJson(raw, text);
                if (normalized.Length > 0)
                {
                    Console.WriteLine($"[ReSiRai AI] ok via keyless {model} in {url}");
                    return normalized;
                }
                last = new AiException("پاسخِ سرویسِ رایگان قابلِ استفاده نبود.", 502, retryable: true);
            }
            catch (AiException e)
            {
                last = e;
            }
        }
        throw last ?? new AiException("ارتباط با سرویسِ رایگان برقرار نشد.", 502);
    }

    private static AiException Translate(HttpStatusCode status, string raw)
    {
        string detail = raw.Length > 500 ? raw[..500] : raw;
        return status switch
        {
            HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => BlockedOrKey(detail),
            HttpStatusCode.PaymentRequired => new AiException(
                "اعتبارِ حسابِ هوش مصنوعی تمام شده است.", 502, detail),
            HttpStatusCode.TooManyRequests => new AiException(
                "سقفِ استفادهٔ رایگان تمام شد. کمی بعد دوباره تلاش کنید یا مدلِ دیگری انتخاب کنید.", 429, detail,
                // محدودیتِ گاهی از سویِ خودِ ارائه‌دهندهٔ مدل است نه حسابِ ما؛ پس یک
                // بار با مدلِ جایگزین هم امتحان می‌کنیم تا اگر بود حل شود.
                retryable: true),
            HttpStatusCode.BadRequest => new AiException(
                "درخواست توسط سرویسِ هوش مصنوعی پذیرفته نشد.", 502, detail),
            _ => new AiException("سرویسِ هوش مصنوعی پاسخ موفق نداد.", 502, detail,
                retryable: (int)status >= 500)
        };
    }

    private static string? ExtractText(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("choices", out var choices) ||
                choices.ValueKind != JsonValueKind.Array || choices.GetArrayLength() == 0) return null;
            if (!choices[0].TryGetProperty("message", out var message) ||
                !message.TryGetProperty("content", out var content)) return null;

            if (content.ValueKind == JsonValueKind.String) return content.GetString();
            if (content.ValueKind != JsonValueKind.Array) return null;

            var sb = new StringBuilder();
            foreach (var part in content.EnumerateArray())
                if (part.ValueKind == JsonValueKind.Object && part.TryGetProperty("text", out var text) &&
                    text.ValueKind == JsonValueKind.String)
                    sb.Append(text.GetString());
            return sb.ToString();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // مدل‌ها گاهی ```json می‌نویسند یا متنِ اضافه دورِ JSON می‌گذارند؛ در هر دو حالت، خودِ JSON را درمی‌آوریم.
    private static string NormalizeJson(string text)
    {
        string t = text.Trim();
        if (t.StartsWith("```", StringComparison.Ordinal))
        {
            int firstNewline = t.IndexOf('\n');
            if (firstNewline >= 0)
            {
                t = t[(firstNewline + 1)..];
                int fence = t.LastIndexOf("```", StringComparison.Ordinal);
                t = (fence >= 0 ? t[..fence] : t).Trim();
            }
        }
        if (t.StartsWith("{", StringComparison.Ordinal) || t.StartsWith("[", StringComparison.Ordinal)) return t;

        int open = t.IndexOfAny(['{', '[']);
        if (open < 0) return t;
        char close = t[open] == '{' ? '}' : ']';
        int end = t.LastIndexOf(close);
        return end > open ? t[open..(end + 1)] : t;
    }
}
