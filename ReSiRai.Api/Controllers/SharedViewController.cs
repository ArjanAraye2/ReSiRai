using System.Security.Cryptography;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ReSiRai.Api.Controllers
{
    // ============================================================
    // The public side of a share link: page, metadata and images.
    //
    // Everything here is reachable without a login, because the patient is at
    // home. The token is the only credential, so:
    //   - it is checked on every call, including expiry,
    //   - an image is served only when it belongs to the Study the token names,
    //   - views are counted so the clinic can see whether the link was used.
    // The page also emits Open Graph tags, which is what makes the phone's
    // messaging app draw the title card under the SMS.
    // ============================================================
    [ApiController]
    public class SharedViewController : ControllerBase
    {
        private readonly ReSiRaiDbContext _db;
        private readonly RadiologyStorageService _storage;
        private readonly IWebHostEnvironment _environment;

        public SharedViewController(ReSiRaiDbContext db, RadiologyStorageService storage, IWebHostEnvironment environment)
        {
            _db = db;
            _storage = storage;
            _environment = environment;
        }

        private sealed record Resolved(StudyShareLink Link, int StudyID, int PatientID);

        /// <summary>Token -> link, or null when unknown/expired/revoked.</summary>
        private async Task<Resolved?> ResolveAsync(string token)
        {
            if (string.IsNullOrWhiteSpace(token) || token.Length > 64) return null;
            var link = await _db.StudyShareLinks.AsNoTracking()
                .FirstOrDefaultAsync(x => x.Token == token);
            if (link == null) return null;
            if (link.ExpiresDate.HasValue && link.ExpiresDate.Value < DateTime.Now) return null;

            var study = await _db.RadiologyStudies.AsNoTracking()
                .FirstOrDefaultAsync(x => x.StudyID == link.StudyID);
            if (study == null) return null;
            return new Resolved(link, study.StudyID, study.PatientID);
        }

        // ------------------------------------------------------------
        // GET /s/{token} - the page itself, with the preview tags filled in.
        // ------------------------------------------------------------
        [AllowAnonymous]
        [HttpGet("/s/{token}")]
        public async Task<IActionResult> Page(string token)
        {
            var resolved = await ResolveAsync(token);
            if (resolved == null) return Content(ExpiredPage(), "text/html; charset=utf-8");

            // Count the visit; the patient opening it is the signal we care about.
            await _db.Database.ExecuteSqlRawAsync(
                "UPDATE tblStudyShareLinks SET ViewCount = ViewCount + 1, LastViewedAt = {0} WHERE ShareID = {1}",
                DateTime.Now, resolved.Link.ShareID);

            string patientName = await _db.Patients.AsNoTracking()
                .Where(x => x.PatientID == resolved.PatientID)
                .Select(x => (x.FirstName + " " + x.LastName).Trim())
                .FirstOrDefaultAsync() ?? string.Empty;
            string studyType = await _db.StudyTypes.AsNoTracking()
                .Where(x => x.StudyTypeID == _db.RadiologyStudies
                    .Where(s => s.StudyID == resolved.StudyID)
                    .Select(s => s.StudyTypeID).FirstOrDefault())
                .Select(x => x.StudyTypeName)
                .FirstOrDefaultAsync() ?? "رادیولوژی";

            string html = await ReadShareTemplateAsync();
            string url = $"{Request.Scheme}://{Request.Host}/s/{token}";

            // The preview shows the site and the patient, never the picture
            // itself: an X-ray would otherwise be cached by the phone app.
            string cover = $"{Request.Scheme}://{Request.Host}/images/login-reference-right.jpg";
            string title = string.IsNullOrWhiteSpace(patientName)
                ? "تصاویر رادیولوژی شما آماده است"
                : $"تصاویر رادیولوژی {patientName}";
            string description = $"{studyType} — لینک مشاهدهٔ تصاویر، بدون نیاز به ورود به سیستم.";

            html = html
                .Replace("{{TITLE}}", HtmlEncode(title))
                .Replace("{{DESCRIPTION}}", HtmlEncode(description))
                .Replace("{{IMAGE}}", HtmlEncode(cover))
                .Replace("{{CANONICAL}}", HtmlEncode(url));

            return Content(html, "text/html; charset=utf-8");
        }

        // ------------------------------------------------------------
        // GET /api/shared/{token} - everything the viewer page needs.
        // ------------------------------------------------------------
        [AllowAnonymous]
        [HttpGet("/api/shared/{token}")]
        public async Task<IActionResult> Metadata(string token, CancellationToken cancellationToken)
        {
            var resolved = await ResolveAsync(token);
            if (resolved == null)
                return NotFound(new { success = false, message = "این لینک دیگر معتبر نیست." });

            var patient = await _db.Patients.AsNoTracking()
                .FirstOrDefaultAsync(x => x.PatientID == resolved.PatientID, cancellationToken);
            var study = await _db.RadiologyStudies.AsNoTracking()
                .FirstOrDefaultAsync(x => x.StudyID == resolved.StudyID, cancellationToken);
            string studyType = await _db.StudyTypes.AsNoTracking()
                .Where(x => x.StudyTypeID == study!.StudyTypeID)
                .Select(x => x.StudyTypeName)
                .FirstOrDefaultAsync(cancellationToken) ?? "";

            var images = await (
                from link in _db.RadiologyStudyImages.AsNoTracking()
                join image in _db.RadiologyImages.AsNoTracking() on link.ImageID equals image.ImageID
                join type in _db.ImageTypes.AsNoTracking() on image.ImageTypeID equals type.ImageTypeID into types
                from type in types.DefaultIfEmpty()
                where link.StudyID == resolved.StudyID
                orderby image.FileName
                select new
                {
                    image.ImageID,
                    image.FileName,
                    image.ContentType,
                    image.CreatedDate,
                    ImageTypeName = type == null ? null : type.ImageTypeName
                }).ToListAsync(cancellationToken);

            return Ok(new
            {
                success = true,
                patientName = $"{patient!.FirstName} {patient.LastName}".Trim(),
                studyType,
                studyDate = study!.StudyDate,
                bodyPart = study.BodyPart,
                diagnosis = study.Diagnosis,
                images = images.Select(x => new
                {
                    x.ImageID,
                    x.ImageTypeName,
                    x.CreatedDate,
                    isPdf = string.Equals(x.ContentType, "application/pdf", StringComparison.OrdinalIgnoreCase),
                    url = $"/api/shared/{token}/image/{x.ImageID}"
                })
            });
        }

        // ------------------------------------------------------------
        // GET /api/shared/{token}/image/{imageID} - one file, still checked
        // against the Study the token belongs to.
        // ------------------------------------------------------------
        [AllowAnonymous]
        [HttpGet("/api/shared/{token}/image/{imageID:long}")]
        public async Task<IActionResult> Image(string token, long imageID, CancellationToken cancellationToken)
        {
            var resolved = await ResolveAsync(token);
            if (resolved == null) return NotFound();

            bool belongs = await _db.RadiologyStudyImages.AsNoTracking()
                .AnyAsync(x => x.StudyID == resolved.StudyID && x.ImageID == imageID, cancellationToken);
            if (!belongs) return NotFound();

            var image = await _db.RadiologyImages.AsNoTracking()
                .FirstOrDefaultAsync(x => x.ImageID == imageID, cancellationToken);
            if (image == null) return NotFound();

            string path = _storage.GetPhysicalPath(image.RelativePath);
            if (!System.IO.File.Exists(path)) return NotFound();
            return PhysicalFile(path, image.ContentType, image.FileName, enableRangeProcessing: true);
        }

        private async Task<string> ReadShareTemplateAsync()
        {
            string path = Path.Combine(_environment.ContentRootPath, "wwwroot", "share.html");
            return await System.IO.File.ReadAllTextAsync(path);
        }

        private static string HtmlEncode(string value) =>
            System.Net.WebUtility.HtmlEncode(value ?? string.Empty);

        private string ExpiredPage() =>
            "<!DOCTYPE html><html lang=\"fa\" dir=\"rtl\"><head><meta charset=\"utf-8\" />" +
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />" +
            "<title>لینک نامعتبر</title><style>" +
            "body{font-family:Vazirmatn,system-ui,sans-serif;background:#f2f7f9;color:#0d3f4f;" +
            "display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}" +
            ".box{background:#fff;border:1px solid #d8e7ec;border-radius:16px;padding:28px;max-width:420px;" +
            "text-align:center;box-shadow:0 12px 32px rgba(10,53,64,.08)}" +
            "h1{font-size:19px;margin:0 0 10px}p{font-size:14px;line-height:1.9;color:#55707e;margin:0}" +
            "</style></head><body><div class=\"box\"><h1>این لینک دیگر معتبر نیست</h1>" +
            "<p>لینک منقضی یا لغو شده است. لطفاً با مطب تماس بگیرید تا لینک جدید برایتان ارسال شود.</p>" +
            "</div></body></html>";
    }
}
