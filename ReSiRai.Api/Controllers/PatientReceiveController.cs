using System.Net;
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
    // Receiving an image from the patient's own phone - without installing
    // anything on it.
    //
    // The secretary opens the patient's record and gets a QR. The patient
    // scans it with the plain camera, pastes the radiology SMS into the page,
    // and ReSiRai runs the same matcher and importer the paired phone uses.
    //
    // Only the token knows which patient this is, so the patient never has to
    // search for their own record - and if the pasted text clearly belongs to
    // somebody else, nothing is imported: it waits for the secretary.
    // ============================================================
    [ApiController]
    public class PatientReceiveController : ControllerBase
    {
        private readonly ReSiRaiDbContext _db;
        private readonly SmsInboxService _inbox;
        private readonly IWebHostEnvironment _environment;
        private readonly IConfiguration _configuration;
        private readonly AppEventLogger _events;
        private readonly RadiologyStorageService _storage;

        public PatientReceiveController(
            ReSiRaiDbContext db,
            SmsInboxService inbox,
            IWebHostEnvironment environment,
            IConfiguration configuration,
            AppEventLogger events,
            RadiologyStorageService storage)
        {
            _db = db;
            _inbox = inbox;
            _environment = environment;
            _configuration = configuration;
            _events = events;
            _storage = storage;
        }

        public sealed record ReceiveRequest(string? Text);
        public sealed record CreateRequest(int? ExpiresInDays, int? StudyID);

        // ------------------------------------------------------------
        // Issuing the QR (staff only - protected by the login fallback)
        // ------------------------------------------------------------
        [HttpPost("/api/patients/{patientID:int}/receive-link")]
        public async Task<IActionResult> Create(int patientID, CreateRequest request, CancellationToken cancellationToken)
        {
            var patient = await _db.Patients.AsNoTracking()
                .FirstOrDefaultAsync(x => x.PatientID == patientID, cancellationToken);
            if (patient == null) return NotFound(new { success = false, message = "بیمار پیدا نشد." });

            // اگر از داخل Study ساخته شده باشد، تصویر به همان Study می‌رود.
            int? studyID = null;
            if (request.StudyID.HasValue)
            {
                bool belongs = await _db.RadiologyStudies.AsNoTracking()
                    .AnyAsync(x => x.StudyID == request.StudyID.Value && x.PatientID == patientID, cancellationToken);
                if (!belongs)
                    return BadRequest(new { success = false, message = "این مراجعه متعلق به این بیمار نیست." });
                studyID = request.StudyID;
            }

            var token = new PatientReceiveToken
            {
                PatientID = patient.PatientID,
                StudyID = studyID,
                Token = NewToken(),
                CreatedDate = DateTime.Now,
                ExpiresDate = request.ExpiresInDays is > 0
                    ? DateTime.Now.AddDays(request.ExpiresInDays.Value)
                    : DateTime.Now.AddDays(1)   // a receive link is short lived by default
            };
            _db.PatientReceiveTokens.Add(token);
            await _db.SaveChangesAsync(cancellationToken);

            string url = $"{PublicUrl.BaseUrl(Request.HttpContext, _configuration)}/r/{token.Token}";
            return Ok(new
            {
                success = true,
                token.ReceiveID,
                token.Token,
                token.StudyID,
                url,
                patientName = $"{patient.FirstName} {patient.LastName}".Trim()
            });
        }

        [HttpGet("/api/patients/{patientID:int}/receive-links")]
        public async Task<IActionResult> List(int patientID, CancellationToken cancellationToken)
        {
            var items = await _db.PatientReceiveTokens.AsNoTracking()
                .Where(x => x.PatientID == patientID)
                .OrderByDescending(x => x.CreatedDate)
                .Select(x => new
                {
                    x.ReceiveID, x.CreatedDate, x.ExpiresDate, x.LastUsedAt, x.UseCount,
                    url = "/r/" + x.Token
                })
                .Take(10)
                .ToListAsync(cancellationToken);
            return Ok(new { success = true, items });
        }

        // ------------------------------------------------------------
        // The page the patient opens (public)
        // ------------------------------------------------------------
        [AllowAnonymous]
        [HttpGet("/r/{token}")]
        public async Task<IActionResult> Page(string token, CancellationToken cancellationToken)
        {
            var record = await ResolveAsync(token, cancellationToken);
            if (record == null) return Content(ExpiredPage(), "text/html; charset=utf-8");

            string html = await System.IO.File.ReadAllTextAsync(
                Path.Combine(_environment.ContentRootPath, "wwwroot", "receive.html"), cancellationToken);

            html = html
                .Replace("{{TOKEN}}", WebUtility.HtmlEncode(token))
                .Replace("{{API}}", WebUtility.HtmlEncode($"/api/receive/{token}"))
                .Replace("{{INFO}}", WebUtility.HtmlEncode($"/api/receive/{token}"));
            Response.Headers.CacheControl = "no-store";
            return Content(html, "text/html; charset=utf-8");
        }

        /// <summary>First name only - enough for the patient to check the page is theirs.</summary>
        [AllowAnonymous]
        [HttpGet("/api/receive/{token}")]
        public async Task<IActionResult> Info(string token, CancellationToken cancellationToken)
        {
            var record = await ResolveAsync(token, cancellationToken);
            if (record == null)
                return NotFound(new { success = false, message = "این لینک دیگر معتبر نیست." });
            return Ok(new { success = true, firstName = record.FirstName, canCapture = record.Token.StudyID.HasValue });
        }

        // ------------------------------------------------------------
        // The pasted SMS (public - the token is the credential)
        // ------------------------------------------------------------
        [AllowAnonymous]
        [HttpPost("/api/receive/{token}")]
        public async Task<IActionResult> Receive(string token, ReceiveRequest request, CancellationToken cancellationToken)
        {
            var record = await ResolveAsync(token, cancellationToken);
            if (record == null)
                return NotFound(new { success = false, message = "این لینک دیگر معتبر نیست." });

            string text = (request.Text ?? string.Empty).Trim();
            if (text.Length < 5)
                return BadRequest(new { success = false, message = "متن پیامک را کامل کپی کنید و بچسبانید." });

            var links = _inbox.ExtractLinks(text);
            var match = await _inbox.MatchAsync(text, senderMobile: null, cancellationToken);

            // The QR names the patient. If the text clearly points at a
            // different record, nothing is imported on our own.
            if (match.PatientID.HasValue && match.PatientID.Value != record.PatientID)
            {
                var other = await _db.Patients.AsNoTracking()
                    .FirstOrDefaultAsync(x => x.PatientID == match.PatientID.Value, cancellationToken);
                await SaveRowAsync(text, links, match, status: 0, patientID: record.PatientID,
                    imported: 0,
                    note: $"متن پیامک متعلق به «{other?.FirstName} {other?.LastName}» است نه این بیمار؛ بررسی کنید.",
                    cancellationToken);
                await TouchAsync(record, cancellationToken);
                return Ok(new
                {
                    success = true,
                    outcome = "wrong-patient",
                    message = "این پیامک متعلق به بیمار دیگری است و وارد پرونده نشد. لطفاً با مطب تماس بگیرید."
                });
            }

            if (links.Count == 0)
            {
                await SaveRowAsync(text, links, match, status: 0, patientID: record.PatientID,
                    imported: 0, note: "لینکی در متن پیامک پیدا نشد.", cancellationToken);
                await TouchAsync(record, cancellationToken);
                return Ok(new
                {
                    success = true,
                    outcome = "no-link",
                    message = "لینکی در این متن نبود. لطفاً کل پیامک را کامل کپی کنید (شامل آدرس‌های http)."
                });
            }

            int imported = 0, fetched = 0;
            int? studyID = null;
            foreach (string link in links)
            {
                var files = await _inbox.FetchSharedImagesAsync(link, cancellationToken);
                fetched += files.Count;
                // اگر توکن از داخل یک Study ساخته شده باشد، تصویر به همان Study می‌رود.
                var result = await _inbox.ImportToPatientAsync(record.PatientID, files, record.Token.StudyID, cancellationToken);
                imported += result.Imported;
                studyID ??= result.StudyID;
            }

            string note = fetched == 0
                ? "لینک پیدا شد ولی تصویری قابل دریافت نبود."
                : imported == 0
                    ? (studyID.HasValue
                        ? $"هر {fetched} تصویر قبلاً در پرونده بود و در مراجعهٔ شمارهٔ {studyID} نمایش داده می‌شود."
                        : $"هر {fetched} تصویر دریافتی قبلاً در پروندهٔ همین بیمار بود (تکراری).")
                    : studyID.HasValue
                        ? $"{imported} تصویر دریافت و در مراجعهٔ شمارهٔ {studyID} ثبت شد."
                        : $"{imported} تصویر دریافت شد؛ برای این بیمار مراجعه ثبت نشده است.";

            await SaveRowAsync(text, links, match, status: 1, patientID: record.PatientID,
                imported, note, cancellationToken);
            await TouchAsync(record, cancellationToken);

            return Ok(new
            {
                success = true,
                outcome = imported > 0 ? "imported" : (fetched > 0 ? "duplicate" : "empty"),
                fetched,
                imported,
                studyID,
                message = note
            });
        }

        // ------------------------------------------------------------
        // A photo taken with the patient's own phone camera (public -
        // the same short-lived token is the credential).
        // ------------------------------------------------------------
        [AllowAnonymous]
        [HttpPost("/api/receive/{token}/image")]
        [RequestSizeLimit(30_000_000)]
        public async Task<IActionResult> UploadFromCamera(string token, IFormFile? file, CancellationToken cancellationToken)
        {
            var record = await ResolveAsync(token, cancellationToken);
            if (record == null)
                return NotFound(new { success = false, message = "این لینک دیگر معتبر نیست." });

            if (!record.Token.StudyID.HasValue)
                return BadRequest(new { success = false, message = "این لینک به یک مراجعه وصل نیست؛ از مطب لینک تازه بگیرید." });

            // یک لینکِ یک‌روزه نباید به ابزارِ آپلودِ بی‌نهایت تبدیل شود.
            if (record.Token.UseCount >= 50)
                return BadRequest(new { success = false, message = "این لینک به سقفِ استفاده رسیده است؛ از مطب لینک تازه بگیرید." });

            int studyID = record.Token.StudyID.Value;
            bool belongs = await _db.RadiologyStudies.AsNoTracking()
                .AnyAsync(x => x.StudyID == studyID && x.PatientID == record.PatientID, cancellationToken);
            if (!belongs)
                return BadRequest(new { success = false, message = "این مراجعه دیگر معتبر نیست؛ از مطب لینک تازه بگیرید." });

            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, message = "عکسی انتخاب نشده است." });
            if (file.Length > 25 * 1024 * 1024)
                return BadRequest(new { success = false, message = "حجم عکس بیشتر از ۲۵ مگابایت است؛ عکس کوچک‌تری بگیرید." });

            byte[] bytes;
            await using (var buffer = new MemoryStream())
            {
                await file.CopyToAsync(buffer, cancellationToken);
                bytes = buffer.ToArray();
            }

            var kind = DetectCameraImage(bytes);
            if (kind == null)
                return BadRequest(new { success = false, message = "فقط عکسِ JPEG یا PNG قابل ارسال است." });

            var photo = new SmsInboxService.FetchedImage(
                bytes, "camera" + kind.Value.Extension, kind.Value.ContentType, null);
            var result = await _inbox.ImportToPatientAsync(record.PatientID, new[] { photo }, studyID, cancellationToken);
            await TouchAsync(record, cancellationToken);

            if (result.Imported == 0)
            {
                await _events.LogAsync("PatientReceivePhoto", "duplicate",
                    $"patient={record.PatientID}; study={studyID}; bytes={bytes.Length}", userName: "receive-token");
                return Ok(new
                {
                    success = true,
                    outcome = "duplicate",
                    studyID,
                    message = "این عکس قبلاً برای همین بیمار ثبت شده بود."
                });
            }

            await _events.LogAsync("PatientReceivePhoto", "ok",
                $"patient={record.PatientID}; study={studyID}; bytes={bytes.Length}", userName: "receive-token");
            return Ok(new
            {
                success = true,
                outcome = "imported",
                studyID,
                message = "عکس با موفقیت به این مراجعه اضافه شد."
            });
        }

        // ------------------------------------------------------------
        // The patient's own portrait, taken with the same phone camera.
        // It belongs to the patient record, so it does not need a Study.
        // ------------------------------------------------------------
        [AllowAnonymous]
        [HttpPost("/api/receive/{token}/patient-photo")]
        [RequestSizeLimit(30_000_000)]
        public async Task<IActionResult> UploadPatientPhoto(string token, IFormFile? file, CancellationToken cancellationToken)
        {
            var record = await ResolveAsync(token, cancellationToken);
            if (record == null)
                return NotFound(new { success = false, message = "این لینک دیگر معتبر نیست." });

            if (record.Token.UseCount >= 50)
                return BadRequest(new { success = false, message = "این لینک به سقفِ استفاده رسیده است؛ از مطب لینک تازه بگیرید." });
            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, message = "عکسی انتخاب نشده است." });
            if (file.Length > 10 * 1024 * 1024)
                return BadRequest(new { success = false, message = "حجم عکس چهره بیشتر از ۱۰ مگابایت است؛ عکس کوچک‌تری بگیرید." });

            byte[] bytes;
            await using (var buffer = new MemoryStream())
            {
                await file.CopyToAsync(buffer, cancellationToken);
                bytes = buffer.ToArray();
            }

            var kind = DetectCameraImage(bytes);
            if (kind == null)
                return BadRequest(new { success = false, message = "فقط عکسِ JPEG یا PNG قابل ارسال است." });

            var patient = await _db.Patients
                .FirstOrDefaultAsync(x => x.PatientID == record.PatientID, cancellationToken);
            if (patient == null)
                return NotFound(new { success = false, message = "بیمار پیدا نشد." });

            string relativePath = Path.Combine(
                "Patients", patient.PatientID.ToString(), "Profile",
                $"patient-{Guid.NewGuid():N}{kind.Value.Extension}");
            string root = _storage.GetRootPath();
            string fullPath = Path.Combine(root, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
            await System.IO.File.WriteAllBytesAsync(fullPath, bytes, cancellationToken);

            if (!string.IsNullOrWhiteSpace(patient.PhotoRelativePath))
            {
                string oldPath = Path.Combine(root, patient.PhotoRelativePath);
                try { if (System.IO.File.Exists(oldPath)) System.IO.File.Delete(oldPath); } catch { }
            }

            patient.PhotoRelativePath = relativePath;
            patient.ModifiedDate = DateTime.Now;
            await _db.SaveChangesAsync(cancellationToken);
            await TouchAsync(record, cancellationToken);
            await _events.LogAsync("PatientReceivePatientPhoto", "ok",
                $"patient={patient.PatientID}; bytes={bytes.Length}", userName: "receive-token");

            return Ok(new { success = true, message = "عکس بیمار ثبت شد." });
        }

        // ------------------------------------------------------------
        // helpers
        // ------------------------------------------------------------
        private sealed record Resolved(PatientReceiveToken Token, int PatientID, string FirstName);

        private async Task<Resolved?> ResolveAsync(string token, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(token) || token.Length > 64) return null;
            var row = await _db.PatientReceiveTokens.AsNoTracking()
                .FirstOrDefaultAsync(x => x.Token == token, cancellationToken);
            if (row == null) return null;
            if (row.ExpiresDate.HasValue && row.ExpiresDate.Value < DateTime.Now) return null;

            string firstName = await _db.Patients.AsNoTracking()
                .Where(x => x.PatientID == row.PatientID)
                .Select(x => x.FirstName)
                .FirstOrDefaultAsync(cancellationToken) ?? string.Empty;
            return new Resolved(row, row.PatientID, firstName);
        }

        /// <summary>Keeps the result in the same inbox the secretary already works through.</summary>
        private async Task SaveRowAsync(
            string text,
            IReadOnlyList<string> links,
            SmsInboxService.MatchResult match,
            byte status,
            int patientID,
            int imported,
            string? note,
            CancellationToken cancellationToken)
        {
            _db.InboxMessages.Add(new InboxMessage
            {
                DeviceID = null,
                SenderMobile = null,
                Body = text.Length > 2000 ? text[..2000] : text,
                Links = links.Count == 0 ? null : string.Join("\n", links),
                ReceivedDate = DateTime.Now,
                PatientID = patientID,
                MatchMethod = match.Method,
                Status = status,
                ImportedCount = imported,
                Note = note,
                Source = 2,   // 1 = paired phone, 2 = patient's browser
                CreatedDate = DateTime.Now
            });
            await _db.SaveChangesAsync(cancellationToken);
        }

        private async Task TouchAsync(Resolved record, CancellationToken cancellationToken)
        {
            var row = await _db.PatientReceiveTokens
                .FirstOrDefaultAsync(x => x.ReceiveID == record.Token.ReceiveID, cancellationToken);
            if (row == null) return;
            row.LastUsedAt = DateTime.Now;
            row.UseCount++;
            await _db.SaveChangesAsync(cancellationToken);
        }

        private static string NewToken()
        {
            Span<byte> bytes = stackalloc byte[18];
            RandomNumberGenerator.Fill(bytes);
            return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        }

        /// <summary>Only formats the storage layer accepts (JPG/PNG), detected from bytes.</summary>
        private static (string Extension, string ContentType)? DetectCameraImage(byte[] bytes)
        {
            if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
                return (".jpg", "image/jpeg");
            if (bytes.Length >= 8 &&
                bytes[0] == 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71 &&
                bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10)
                return (".png", "image/png");
            return null;
        }

        private string ExpiredPage() =>
            "<!DOCTYPE html><html lang=\"fa\" dir=\"rtl\"><head><meta charset=\"utf-8\" />" +
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />" +
            "<title>لینک نامعتبر</title><style>body{font-family:Vazirmatn,system-ui,sans-serif;" +
            "background:#f2f7f9;color:#0d3f4f;display:flex;align-items:center;justify-content:center;" +
            "min-height:100vh;margin:0;padding:20px}.box{background:#fff;border:1px solid #d8e7ec;" +
            "border-radius:16px;padding:28px;max-width:420px;text-align:center}" +
            "h1{font-size:19px;margin:0 0 10px}p{font-size:14px;line-height:1.9;color:#55707e;margin:0}" +
            "</style></head><body><div class=\"box\"><h1>این لینک دیگر معتبر نیست</h1>" +
            "<p>لینک منقضی شده است. لطفاً از مطب بخواهید لینک جدید بدهد.</p></div></body></html>";
    }
}
