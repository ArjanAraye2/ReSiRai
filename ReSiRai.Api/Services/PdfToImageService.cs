using System.Runtime.InteropServices;
using Docnet.Core;
using Docnet.Core.Converters;
using Docnet.Core.Models;
using SkiaSharp;

namespace ReSiRai.Api.Services;

/// <summary>یک صفحهٔ تبدیل‌شده از PDF — آمادهٔ ذخیره به‌عنوان تصویر.</summary>
public sealed record PdfPage(string FileName, byte[] Bytes);

/// <summary>
/// PDF → JPG. کاملاً محلی (pdfium) و بدونِ شبکه، پس سندِ بیمار از مطب خارج نمی‌شود.
/// همهٔ صفحات تبدیل می‌شوند تا سندِ چندصفحه‌ای هم در گرید دیده شود و هم قابلِ تحلیل باشد.
/// رندرند و ذخیرهٔ تصویر با SkiaSharp است تا رویِ ویندوز مطب و لینوکس سرور یکسان کار کند.
/// اگر تبدیل شکست بخورد، لیست خالی برمی‌گردد و فراخواننده خودِ PDF را نگه می‌دارد —
/// هیچ سندی به‌خاطرِ تبدیل از بین نمی‌رود.
/// </summary>
public sealed class PdfToImageService
{
    private const int Bound = 2500;            // حداکثرِ طولِ طرفِ رندر؛ برای اسکن کافی است
    private const int MaxPages = 50;           // جلوگیری از بارِ ناخواسته
    private const long MaxPageBytes = 6L * 1024 * 1024;

    public IReadOnlyList<PdfPage> Convert(byte[] pdf, string? baseName)
    {
        var results = new List<PdfPage>();
        if (pdf is not { Length: > 0 }) return results;
        string safeBase = Sanitize(string.IsNullOrWhiteSpace(baseName) ? "page" : baseName);

        try
        {
            using var doc = DocLib.Instance.GetDocReader(pdf, new PageDimensions(Bound, Bound));
            int count = Math.Min(doc.GetPageCount(), MaxPages);
            for (int i = 0; i < count; i++)
            {
                try
                {
                    using var page = doc.GetPageReader(i);
                    int width = page.GetPageWidth();
                    int height = page.GetPageHeight();
                    if (width <= 0 || height <= 0) continue;

                    byte[] raw = page.GetImage(new NaiveTransparencyRemover());
                    if (raw.Length < width * height * 4) continue;
                    if (LooksBlank(raw, width, height)) continue;   // صفحهٔ خالی ساخته نمی‌شود

                    using var bitmap = ToBitmap(raw, width, height);
                    if (bitmap is null) continue;

                    using var image = SKImage.FromBitmap(bitmap);
                    using var data = image.Encode(SKEncodedImageFormat.Jpeg, 88);
                    if (data is null) continue;
                    byte[] bytes = data.ToArray();
                    if (bytes.Length == 0 || bytes.Length > MaxPageBytes) continue;

                    results.Add(new PdfPage($"{safeBase}-{i + 1}.jpg", bytes));
                }
                catch { /* صفحهٔ خراب ⇒ همان صفحه رد می‌شود و بقیه ادامه می‌یابد */ }
            }
        }
        catch { /* PDF خراب یا رمزگذاری‌شده ⇒ لیست خالی و نگه‌داشتنِ خودِ PDF */ }

        return results;
    }

    // دادهٔ pdfium به‌ترتیبِ B,G,R,A می‌آید که با Bgra8888 یکی است.
    private static SKBitmap? ToBitmap(byte[] bgra, int width, int height)
    {
        try
        {
            var info = new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Opaque);
            var bitmap = new SKBitmap(info);
            Marshal.Copy(bgra, 0, bitmap.GetPixels(), width * height * 4);
            return bitmap;
        }
        catch { return null; }
    }

    // صفحهٔ خالی: نمونه‌گیریِ شبکه‌ای — اگر هیچ پیکسلِ تیره‌ای نباشد، صفحه سفید است.
    private static bool LooksBlank(byte[] bgra, int width, int height)
    {
        int stepX = Math.Max(1, width / 24);
        int stepY = Math.Max(1, height / 24);
        int dark = 0, total = 0;
        for (int y = 0; y < height; y += stepY)
            for (int x = 0; x < width; x += stepX)
            {
                int i = (y * width + x) * 4;
                int lum = (bgra[i] + bgra[i + 1] + bgra[i + 2]) / 3;
                total++;
                if (lum < 235) dark++;
            }
        return total > 0 && dark == 0;
    }

    private static string Sanitize(string name)
    {
        foreach (char c in Path.GetInvalidFileNameChars())
            name = name.Replace(c, '_');
        name = name.Trim();
        return name.Length > 60 ? name[..60] : name;
    }
}
