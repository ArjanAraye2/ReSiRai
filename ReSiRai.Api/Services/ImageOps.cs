using SkiaSharp;

namespace ReSiRai.Api.Services;

/// <summary>
/// عملیاتِ تصویریِ مشترک — جای عملیاتِ System.Drawing که فقط رویِ ویندوز کار میکرد.
/// SkiaSharp روی همهٔ سیستمها (ویندوزِ مطب و لینوکسِ سرور) یکسان کار میکند.
/// همهٔ متدها خطا را میبلعند و ورودیِ اصلی را برمیگردانند: پردازشِ تصویر هرگز
/// نباید گلوگاهِ ثبت شود.
/// </summary>
public static class ImageOps
{
    /// <summary>کوچک‌نماییِ متناسب تا «طولانیترین ضلع»acia از maxSide رد نشود؛ اگر کوچک است، دست نمیخورد.</summary>
    public static (string Mime, byte[] Bytes) Resize(string mime, byte[] bytes, int maxSide, long maxBytes, int quality = 82)
    {
        if (bytes is not { Length: > 0 }) return (mime, bytes);
        try
        {
            using var source = SKBitmap.Decode(bytes);
            if (source is null) return (mime, bytes);
            int longest = Math.Max(source.Width, source.Height);
            if (longest <= maxSide && bytes.Length <= maxBytes) return (mime, bytes);

            double scale = Math.Min(1d, (double)maxSide / longest);
            var target = new SKImageInfo(
                Math.Max(1, (int)Math.Round(source.Width * scale)),
                Math.Max(1, (int)Math.Round(source.Height * scale)),
                source.ColorType, SKAlphaType.Opaque);
            using var resized = source.Resize(target, SKSamplingOptions.Default);
            using var image = SKImage.FromBitmap(resized);
            using var data = image.Encode(SKEncodedImageFormat.Jpeg, quality);
            var result = data?.ToArray() ?? Array.Empty<byte>();
            if (result.Length == 0) return (mime, bytes);

            Console.WriteLine(
                $"[ReSiRai AI] image {bytes.Length / 1024}KB {source.Width}x{source.Height} -> {result.Length / 1024}KB {target.Width}x{target.Height}");
            return ("image/jpeg", result);
        }
        catch (Exception e)
        {
            // هر خطایی در پردازش ⇒ همان نسخهٔ اصلی ارسال می‌شود؛ تحلیل مهم‌تر است.
            Console.WriteLine($"[ReSiRai AI] resize skipped: {e.Message}");
            return (mime, bytes);
        }
    }

    /// <summary>چرخشِ JPEG به تعدادِ درجه (90/180/270) — برایِ برگهٔ وارونه یا نistin.</summary>
    public static byte[] RotateJpeg(byte[] jpeg, int degrees)
    {
        if (jpeg is not { Length: > 0 } || degrees is not (90 or 180 or 270)) return jpeg;
        try
        {
            using var source = SKBitmap.Decode(jpeg);
            if (source is null) return jpeg;
            bool swap = degrees is 90 or 270;
            var info = new SKImageInfo(swap ? source.Height : source.Width, swap ? source.Width : source.Height,
                source.ColorType, SKAlphaType.Opaque);
            using var rotated = new SKBitmap(info);
            using (var canvas = new SKCanvas(rotated))
            {
                canvas.Clear(SKColors.White);
                canvas.Translate(info.Width / 2f, info.Height / 2f);
                canvas.RotateDegrees(degrees);
                canvas.Translate(-source.Width / 2f, -source.Height / 2f);
                canvas.DrawBitmap(source, 0, 0);
                canvas.Flush();
            }
            using var image = SKImage.FromBitmap(rotated);
            using var data = image.Encode(SKEncodedImageFormat.Jpeg, 90);
            var result = data?.ToArray() ?? Array.Empty<byte>();
            return result.Length == 0 ? jpeg : result;
        }
        catch { return jpeg; }
    }

    /// <summary>چرخشِ فایلِ ذخیره‌شده در raster (برایِ راستچین‌شدنِ تصویرِ پرونده.)</summary>
    public static void RotateFileJpeg(string path, int degrees)
    {
        if (degrees is not (90 or 180 or 270) || !File.Exists(path)) return;
        try
        {
            byte[] original = File.ReadAllBytes(path);
            byte[] rotated = RotateJpeg(original, degrees);
            if (rotated.Length > 0) File.WriteAllBytes(path, rotated);
        }
        catch { }
    }

    /// <summary>بزرگ‌نماییِ نوارِ باریک برایِ مدل: scale حداکثر 2.2 تا ارتفاعِ ۳۶۰ پیکسل.</summary>
    /// <remarks>اگر ارتفاعِ واردشده ≥ 300 یا عرض &lt; 800 باشد، ورودی دستنخورده برمیگردد — هم‌رفتارِ تاریخچه.</remarks>
    public static byte[]? Magnify(byte[] jpeg)
    {
        if (jpeg is not { Length: > 0 }) return jpeg;
        try
        {
            using var source = SKBitmap.Decode(jpeg);
            if (source is null) return jpeg;
            if (source.Height >= 300 || source.Width < 800) return jpeg;
            double scale = Math.Min(2.2, 360.0 / source.Height);
            var target = new SKImageInfo(
                (int)(source.Width * scale), (int)(source.Height * scale),
                source.ColorType, SKAlphaType.Opaque);
            using var scaled = source.Resize(target, SKSamplingOptions.Default);
            using var image = SKImage.FromBitmap(scaled);
            using var data = image.Encode(SKEncodedImageFormat.Jpeg, 88);
            var result = data?.ToArray() ?? Array.Empty<byte>();
            return result.Length == 0 ? jpeg : result;
        }
        catch { return jpeg; }
    }

    /// <summary>
    /// نوارِ ردیفهای گم‌شده، چسبیده و بهترتیب بالا به پایین؛ زمینهٔ سفید.
    /// bands همان جفت (بالایی، پایینی) با ۳۰ پیکسلِ حاشیه است و اینجا THERE ادغام میشود.
    /// </summary>
    public static byte[]? CropBands(byte[] image, IReadOnlyList<(int Top, int Bottom)> bands)
    {
        if (image is not { Length: > 0 } || bands is not { Count: > 0 }) return null;
        try
        {
            using var source = SKBitmap.Decode(image);
            if (source is null) return null;

            var sorted = bands.OrderBy(b => b.Top).ToList();
            var merged = new List<(int Top, int Bottom)>();
            foreach (var b in sorted)
            {
                int top = Math.Max(0, b.Top);
                int bottom = Math.Min(source.Height, b.Bottom);
                if (bottom - top <= 0) return null;
                if (merged.Count > 0 && top <= merged[^1].Bottom)
                    merged[^1] = (merged[^1].Top, Math.Max(merged[^1].Bottom, bottom));
                else merged.Add((top, bottom));
            }
            int stripHeight = merged.Sum(b => b.Bottom - b.Top);
            if (stripHeight <= 0 || stripHeight > source.Height) return null;

            var info = new SKImageInfo(source.Width, stripHeight, source.ColorType, SKAlphaType.Opaque);
            using var strip = new SKBitmap(info);
            using (var canvas = new SKCanvas(strip))
            {
                canvas.Clear(SKColors.White);
                int y = 0;
                foreach (var b in merged)
                {
                    var srcRect = new SKRect(0, b.Top, source.Width, b.Bottom);
                    var destRect = new SKRect(0, y, source.Width, y + b.Bottom - b.Top);
                    canvas.DrawBitmap(source, srcRect, destRect);
                    y += b.Bottom - b.Top;
                }
                canvas.Flush();
            }
            using var outImage = SKImage.FromBitmap(strip);
            using var data = outImage.Encode(SKEncodedImageFormat.Jpeg, 88);
            var result = data?.ToArray() ?? Array.Empty<byte>();
            return result.Length == 0 ? null : result;
        }
        catch { return null; }
    }
}
