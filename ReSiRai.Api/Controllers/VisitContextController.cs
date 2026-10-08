using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ReSiRai.Api.Data;

namespace ReSiRai.Api.Controllers
{
    // زمینهٔ مراجعه: مطب، پزشک و رشتهٔ کاربرِ واردشده.
    //
    // کارتِ مراجعه (ثبتِ بدونِ ناوبری) باید بدونِ هیچ انتخابِ دستی بتواند مراجعه را
    // بسازد، چون سرور برایِ کاربرِ عادی ثبت را بدونِ ClinicID و DoctorStaffID
    // نمی‌پذیرد. قواعد، همانِ چیزی است که با ورود مشخص است:
    //   - پزشک (StaffType=2)  ← خودِ او
    //   - کارمند  (StaffType=1) ← پزشکِ متصلِ او در همین مطب (tblUserDoctors)
    //   - مدیر/SuperAdmin     ← باید انتخاب کند (canPickDoctor)
    //   - مطب: مطبِ خودِ پرسنل، وگرنه تنها مطبِ فعال (اینجا یکی بیشتر نیست)
    [ApiController]
    [Route("api/visit-context")]
    [Authorize]
    public class VisitContextController : ControllerBase
    {
        private readonly ReSiRaiDbContext _db;
        public VisitContextController(ReSiRaiDbContext db) => _db = db;

        [HttpGet]
        public async Task<IActionResult> Get(CancellationToken cancellationToken)
        {
            int userID = int.TryParse(User.FindFirstValue("UserID"), out int u) ? u : 0;
            int staffID = int.TryParse(User.FindFirstValue("StaffID"), out int s) ? s : 0;
            byte staffType = byte.TryParse(User.FindFirstValue("StaffType"), out byte t) ? t : (byte)0;
            bool superAdmin = string.Equals(User.FindFirstValue("IsSuperAdmin"), "true", StringComparison.OrdinalIgnoreCase);
            int specialtyID = int.TryParse(User.FindFirstValue("SpecialtyID"), out int sp) ? sp : 0;

            // ---- مطب ----
            int? clinicID = staffID > 0
                ? await _db.ClinicStaff.AsNoTracking()
                    .Where(x => x.StaffID == staffID)
                    .Select(x => (int?)x.ClinicID)
                    .FirstOrDefaultAsync(cancellationToken)
                : null;
            if (!clinicID.HasValue)
                clinicID = await _db.Clinics.AsNoTracking()
                    .Where(x => x.IsActive)
                    .OrderBy(x => x.ClinicID)
                    .Select(x => (int?)x.ClinicID)
                    .FirstOrDefaultAsync(cancellationToken);

            // ---- پزشک ----
            int? doctorStaffID = null;
            if (!superAdmin && staffType == 2 && staffID > 0)
            {
                doctorStaffID = staffID;
            }
            else if (!superAdmin && staffType == 1 && userID > 0 && clinicID.HasValue)
            {
                var linked = await _db.UserDoctors.AsNoTracking()
                    .Where(x => x.UserID == userID && x.ClinicID == clinicID.Value)
                    .Select(x => (int?)x.DoctorStaffID)
                    .Distinct()
                    .ToListAsync(cancellationToken);
                // چند پزشکِ متصل یعنی باید انتخاب شود؛ کاربر بعداً انتخابش را به خاطر می‌سپارد.
                if (linked.Count == 1) doctorStaffID = linked[0];
            }

            // ---- رشته: اول claim، بعد تخصصِ خودِ پزشک ----
            if (specialtyID <= 0 && doctorStaffID.HasValue)
                specialtyID = await _db.Staff.AsNoTracking()
                    .Where(x => x.StaffID == doctorStaffID.Value)
                    .Select(x => x.SpecialtyID ?? 0)
                    .FirstOrDefaultAsync(cancellationToken);

            string? doctorName = doctorStaffID.HasValue
                ? await _db.Staff.AsNoTracking()
                    .Where(x => x.StaffID == doctorStaffID.Value)
                    .Select(x => x.FirstName + " " + x.LastName)
                    .FirstOrDefaultAsync(cancellationToken)
                : null;

            return Ok(new
            {
                success = true,
                clinicID,
                doctorStaffID,
                doctorName,
                specialtyID = specialtyID > 0 ? specialtyID : (int?)null,
                // بدونِ پزشکِ قابلِ استخراج، کارت باید سلکتِ پزشک را نشان دهد.
                canPickDoctor = superAdmin || !doctorStaffID.HasValue
            });
        }
    }
}
