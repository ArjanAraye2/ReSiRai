using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ReSiRai.Api.Data;
using ReSiRai.Api.Services;

namespace ReSiRai.Api.Controllers
{
    // «تنظیمات مطب» — فقط نامِ مطب، شماره‌های تلفن و نشانی قابلِ ویرایش‌اند.
    // اطلاعاتِ پروفایل (نام/شمارهٔ شخصی) از ثبت‌نام/مدیریتِ پرسنل می‌آید و این‌جا
    // فقط خوانده می‌شود. عکسِ پروفایل تنها فیلدِ قابلِ تغییرِ پروفایل است و روی
    // داشبورد نمایش داده می‌شود.
    [ApiController]
    [Route("api/profile")]
    [Authorize]
    public sealed class ProfileController : ControllerBase
    {
        private readonly ReSiRaiDbContext _db;
        private readonly RadiologyStorageService _storage;
        public ProfileController(ReSiRaiDbContext db, RadiologyStorageService storage)
        {
            _db = db;
            _storage = storage;
        }

        public sealed class ClinicUpdate
        {
            public string? ClinicName { get; set; }
            public string? Phone { get; set; }
            public string? Address { get; set; }
        }

        public sealed class MobileUpdate
        {
            public string? Mobile { get; set; }
        }

        private int CurrentStaffID => int.TryParse(User.FindFirst("StaffID")?.Value, out int id) ? id : 0;
        private bool IsSuper => string.Equals(User.FindFirst("IsSuperAdmin")?.Value, "true", StringComparison.OrdinalIgnoreCase);

        /// <summary>مطبِ همین کاربر: اتصالِ مستقیم، وگرنه تنها مطبِ فعال (نصبِ تک‌مطب).</summary>
        private async Task<int?> ResolveClinicIDAsync(CancellationToken ct)
        {
            int staffID = CurrentStaffID;
            if (staffID <= 0) return null;
            int? linked = await _db.ClinicStaff.AsNoTracking()
                .Where(x => x.StaffID == staffID)
                .Select(x => (int?)x.ClinicID)
                .FirstOrDefaultAsync(ct);
            if (linked.HasValue) return linked;
            var active = await _db.Clinics.AsNoTracking()
                .Where(c => c.IsActive)
                .Select(c => c.ClinicID)
                .Take(2)
                .ToListAsync(ct);
            return active.Count == 1 ? active[0] : null;
        }

        [HttpGet]
        public async Task<IActionResult> Get(CancellationToken ct)
        {
            if (IsSuper)
                return Ok(new { success = true, profile = (object?)null, clinic = (object?)null });

            int staffID = CurrentStaffID;
            var staff = await _db.Staff.AsNoTracking().FirstOrDefaultAsync(s => s.StaffID == staffID, ct);
            if (staff == null)
                return Ok(new { success = true, profile = (object?)null, clinic = (object?)null });

            string? specialtyName = staff.SpecialtyID.HasValue
                ? await _db.Specialties.AsNoTracking()
                    .Where(s => s.SpecialtyID == staff.SpecialtyID)
                    .Select(s => s.SpecialtyName)
                    .FirstOrDefaultAsync(ct)
                : null;

            int? clinicID = await ResolveClinicIDAsync(ct);
            var clinic = clinicID.HasValue
                ? await _db.Clinics.AsNoTracking()
                    .Where(c => c.ClinicID == clinicID.Value)
                    .Select(c => new { c.ClinicID, c.ClinicName, c.Phone, c.Address })
                    .FirstOrDefaultAsync(ct)
                : null;

            return Ok(new
            {
                success = true,
                profile = new
                {
                    staff.StaffID,
                    staff.FirstName,
                    staff.LastName,
                    staff.NationalCode,
                    staff.Mobile,
                    staff.StaffType,
                    specialtyName,
                    staff.PhotoRelativePath
                },
                clinic
            });
        }

        /// <summary>
        /// فقط تنظیماتِ مطب: نام، شمارهٔ تلفن و نشانی. پروفایل (نام/موبایلِ شخصی)
        /// از این مسیر قابلِ تغییر نیست.
        /// </summary>
        [HttpPut("clinic")]
        public async Task<IActionResult> UpdateClinic(ClinicUpdate request, CancellationToken ct)
        {
            if (IsSuper) return Forbid();
            int? clinicID = await ResolveClinicIDAsync(ct);
            if (!clinicID.HasValue)
                return BadRequest(new { success = false, message = "مطبی برای این حساب پیدا نشد." });

            var clinic = await _db.Clinics.FirstOrDefaultAsync(c => c.ClinicID == clinicID.Value, ct);
            if (clinic == null) return NotFound(new { success = false, message = "مطب پیدا نشد." });

            string name = (request.ClinicName ?? string.Empty).Trim();
            if (name.Length == 0)
                return BadRequest(new { success = false, message = "نام مطب را وارد کنید." });
            if (name.Length > 200)
                return BadRequest(new { success = false, message = "نام مطب نمی‌تواند بیشتر از ۲۰۰ نویسه باشد." });

            string phone = (request.Phone ?? string.Empty).Trim();
            if (phone.Length > 30)
                return BadRequest(new { success = false, message = "شماره تلفن مطب معتبر نیست." });
            string address = (request.Address ?? string.Empty).Trim();
            if (address.Length > 500)
                return BadRequest(new { success = false, message = "نشانی مطب نمی‌تواند بیشتر از ۵۰۰ نویسه باشد." });

            clinic.ClinicName = name;
            clinic.Phone = string.IsNullOrWhiteSpace(phone) ? null : phone;
            clinic.Address = string.IsNullOrWhiteSpace(address) ? null : address;
            await _db.SaveChangesAsync(ct);

            return Ok(new
            {
                success = true,
                message = "تنظیمات مطب ذخیره شد.",
                clinic = new { clinic.ClinicID, clinic.ClinicName, clinic.Phone, clinic.Address }
            });
        }

        /// <summary>
        /// فقط «موبایلِ شخصیِ پزشک» قابلِ ویرایش است (نام/کد ملی/تخصص از مدیریتِ
        /// پرسنل می‌آید). این شماره با شمارهٔ مطب فرق دارد.
        /// </summary>
        [HttpPut("mobile")]
        public async Task<IActionResult> UpdateMobile(MobileUpdate request, CancellationToken ct)
        {
            if (IsSuper) return Forbid();
            int staffID = CurrentStaffID;
            var staff = await _db.Staff.FirstOrDefaultAsync(s => s.StaffID == staffID, ct);
            if (staff == null) return NotFound(new { success = false, message = "پروفایل پیدا نشد." });

            string? mobile = NormalizeMobile(request.Mobile);
            if (!string.IsNullOrWhiteSpace(mobile) && mobile.Length < 10)
                return BadRequest(new { success = false, message = "شماره موبایل معتبر نیست." });

            staff.Mobile = string.IsNullOrWhiteSpace(mobile) ? null : mobile;
            await _db.SaveChangesAsync(ct);
            return Ok(new { success = true, message = "موبایلِ شخصی ذخیره شد.", mobile = staff.Mobile });
        }

        private static string? NormalizeMobile(string? value)
        {
            string digits = string.Concat((value ?? string.Empty).Where(char.IsDigit));
            if (digits.StartsWith("98") && digits.Length is 12 or 13) digits = "0" + digits[2..];
            else if (digits.Length == 10 && digits.StartsWith("9")) digits = "0" + digits;
            return string.IsNullOrWhiteSpace(digits) ? null : digits;
        }

        /// <summary>
        /// عکسِ پروفایل (اختیاری). همان الگویِ عکسِ بیمار: تصویر معتبر، ذخیره زیرِ
        /// مسیرِ ذخیره‌سازیِ سامانه، و حذفِ عکسِ قبلی. عکس روی داشبورد دیده می‌شود.
        /// </summary>
        [HttpPost("photo")]
        [RequestSizeLimit(10 * 1024 * 1024)]
        public async Task<IActionResult> UploadPhoto(IFormFile file, CancellationToken ct)
        {
            if (IsSuper) return Forbid();
            if (file == null || file.Length == 0
                || string.IsNullOrWhiteSpace(file.ContentType)
                || !file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { success = false, message = "لطفاً یک فایل تصویری معتبر انتخاب کنید." });
            if (file.Length > 8 * 1024 * 1024)
                return BadRequest(new { success = false, message = "حجم عکس نباید بیشتر از ۸ مگابایت باشد." });

            int staffID = CurrentStaffID;
            var staff = await _db.Staff.FirstOrDefaultAsync(s => s.StaffID == staffID, ct);
            if (staff == null) return NotFound(new { success = false, message = "پروفایل پیدا نشد." });

            string extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (extension is not (".jpg" or ".jpeg" or ".png" or ".webp")) extension = ".jpg";
            string relativePath = Path.Combine("Staff", staffID.ToString(), "Profile", $"staff-{Guid.NewGuid():N}{extension}");

            string root = _storage.GetRootPath();
            string fullPath = Path.Combine(root, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
            await using (var stream = System.IO.File.Create(fullPath))
                await file.CopyToAsync(stream, ct);

            if (!string.IsNullOrWhiteSpace(staff.PhotoRelativePath))
            {
                string oldPath = Path.Combine(root, staff.PhotoRelativePath);
                if (System.IO.File.Exists(oldPath)) System.IO.File.Delete(oldPath);
            }

            staff.PhotoRelativePath = relativePath;
            await _db.SaveChangesAsync(ct);

            return Ok(new
            {
                success = true,
                message = "عکس پروفایل ذخیره شد.",
                photoRelativePath = relativePath
            });
        }

        /// <summary>عکسِ پروفایلِ همین کاربر؛ نسخهٔ ?v= از کشِ مرورگر جلوگیری می‌کند.</summary>
        [HttpGet("photo")]
        public async Task<IActionResult> GetPhoto(CancellationToken ct)
        {
            if (IsSuper) return NotFound();
            int staffID = CurrentStaffID;
            string? relativePath = await _db.Staff.AsNoTracking()
                .Where(s => s.StaffID == staffID)
                .Select(s => s.PhotoRelativePath)
                .FirstOrDefaultAsync(ct);
            if (string.IsNullOrWhiteSpace(relativePath)) return NotFound();

            string fullPath = Path.Combine(_storage.GetRootPath(), relativePath);
            if (!System.IO.File.Exists(fullPath)) return NotFound();

            string contentType = Path.GetExtension(fullPath).ToLowerInvariant() switch
            {
                ".png" => "image/png",
                ".webp" => "image/webp",
                _ => "image/jpeg"
            };
            return PhysicalFile(fullPath, contentType);
        }
    }
}
