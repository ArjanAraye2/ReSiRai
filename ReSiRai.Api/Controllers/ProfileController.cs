using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;

namespace ReSiRai.Api.Controllers
{
    // «تنظیمات مطب» و «پروفایل من» — کارِ خودِ پزشک/پرسنل، نه مدیرِ سیستم.
    // مدیرِ سیستم (سوپرادمین) نه مطب دارد و نه پروفایلِ پرسنلی؛ برایش خالی برمی‌گردد.
    [ApiController]
    [Route("api/profile")]
    [Authorize]
    public sealed class ProfileController : ControllerBase
    {
        private readonly ReSiRaiDbContext _db;
        public ProfileController(ReSiRaiDbContext db) => _db = db;

        public sealed class ProfileUpdate
        {
            public string? FirstName { get; set; }
            public string? LastName { get; set; }
            public string? Mobile { get; set; }
        }

        public sealed class ClinicUpdate
        {
            public string? ClinicName { get; set; }
            public string? Phone { get; set; }
            public string? Address { get; set; }
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
                    specialtyName
                },
                clinic
            });
        }

        [HttpPut]
        public async Task<IActionResult> UpdateProfile(ProfileUpdate request, CancellationToken ct)
        {
            if (IsSuper) return Forbid();
            int staffID = CurrentStaffID;
            var staff = await _db.Staff.FirstOrDefaultAsync(s => s.StaffID == staffID, ct);
            if (staff == null) return NotFound(new { success = false, message = "پروفایل پیدا نشد." });

            string first = (request.FirstName ?? string.Empty).Trim();
            string last = (request.LastName ?? string.Empty).Trim();
            if (first.Length == 0 || last.Length == 0)
                return BadRequest(new { success = false, message = "نام و نام خانوادگی را وارد کنید." });
            if (first.Length > 100 || last.Length > 100)
                return BadRequest(new { success = false, message = "نام نمی‌تواند بیشتر از ۱۰۰ نویسه باشد." });

            string? mobile = NormalizeMobile(request.Mobile);
            if (!string.IsNullOrWhiteSpace(mobile) && mobile.Length < 10)
                return BadRequest(new { success = false, message = "شماره موبایل معتبر نیست." });

            staff.FirstName = first;
            staff.LastName = last;
            staff.Mobile = string.IsNullOrWhiteSpace(mobile) ? null : mobile;
            await _db.SaveChangesAsync(ct);

            // نامِ تازه باید همان لحظه در هدر دیده شود؛ کوکی با همان تنظیماتِ فعلی تازه می‌شود.
            await RefreshCookieAsync(staff, ct);

            return Ok(new
            {
                success = true,
                message = "پروفایل ذخیره شد.",
                firstName = staff.FirstName,
                lastName = staff.LastName,
                mobile = staff.Mobile
            });
        }

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

        private static string? NormalizeMobile(string? value)
        {
            string digits = string.Concat((value ?? string.Empty).Where(char.IsDigit));
            if (digits.StartsWith("98") && digits.Length is 12 or 13) digits = "0" + digits[2..];
            else if (digits.Length == 10 && digits.StartsWith("9")) digits = "0" + digits;
            return string.IsNullOrWhiteSpace(digits) ? null : digits;
        }

        /// <summary>کوکیِ ورود با نام/تخصصِ تازه دوباره صادر می‌شود (ویژگی‌های نشست حفظ می‌شوند).</summary>
        private async Task RefreshCookieAsync(Staff staff, CancellationToken ct)
        {
            var user = await _db.Users.AsNoTracking()
                .FirstOrDefaultAsync(u => u.StaffID == staff.StaffID && u.IsActive, ct);
            string? specialtyName = staff.SpecialtyID.HasValue
                ? await _db.Specialties.AsNoTracking()
                    .Where(s => s.SpecialtyID == staff.SpecialtyID)
                    .Select(s => s.SpecialtyName)
                    .FirstOrDefaultAsync(ct)
                : null;

            var claims = new List<Claim>
            {
                new(ClaimTypes.Name, user?.UserName ?? User.Identity?.Name ?? string.Empty),
                new("UserID", (user?.UserID ?? 0).ToString()),
                new("StaffID", staff.StaffID.ToString()),
                new("StaffType", staff.StaffType.ToString()),
                new("FirstName", staff.FirstName),
                new("LastName", staff.LastName),
                new("IsSuperAdmin", "false"),
                new("ViewReports", user?.ViewReports == true ? "true" : "false")
            };
            if (staff.SpecialtyID.HasValue)
                claims.Add(new("SpecialtyID", staff.SpecialtyID.Value.ToString()));
            if (!string.IsNullOrWhiteSpace(specialtyName))
                claims.Add(new("SpecialtyName", specialtyName));

            var auth = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            var properties = auth.Properties ?? new AuthenticationProperties { IsPersistent = true, AllowRefresh = true };
            await HttpContext.SignInAsync(
                CookieAuthenticationDefaults.AuthenticationScheme,
                new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)),
                properties);
        }
    }
}
