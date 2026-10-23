using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using ReSiRai.Api.Security;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ReSiRai.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class StaffController : ControllerBase
    {
        private readonly ReSiRaiDbContext _context;

        public StaffController(ReSiRaiDbContext context)
        {
            _context = context;
        }

        // Returns Staff/person records. The optional search covers National Code and name.
        [HttpGet]
        public async Task<IActionResult> GetStaff(string? search = null)
        {
            var query = _context.Staff.AsNoTracking().AsQueryable();

            if (!string.IsNullOrWhiteSpace(search))
            {
                string text = search.Trim();
                query = query.Where(s =>
                    s.NationalCode.Contains(text) ||
                    s.FirstName.Contains(text) ||
                    s.LastName.Contains(text));
            }

            var staff = await query
                .OrderBy(s => s.LastName)
                .ThenBy(s => s.FirstName)
                .Take(100)
                .ToListAsync();

            return Ok(new { success = true, count = staff.Count, staff });
        }

        // Lookup used by the Staff form. Only active specialties can be assigned to a doctor.
        // Read-only lookup is available to authenticated operational forms.
        // Creating/editing/deactivating specialty definitions remains a SuperAdmin responsibility.
        [HttpGet("specialties")]
        public async Task<IActionResult> GetActiveSpecialties()
        {
            var specialties = await _context.Specialties
                .AsNoTracking()
                .Where(s => s.IsActive)
                .OrderBy(s => s.SpecialtyName)
                .Select(s => new
                {
                    s.SpecialtyID,
                    s.SpecialtyName
                })
                .ToListAsync();

            return Ok(new { success = true, count = specialties.Count, specialties });
        }

        // Doctors with their specialty, used by the study form to suggest the right
        // waiting stage (a radiology doctor waits for an image, a prosthodontics
        // doctor waits for a prosthesis).
        [HttpGet("doctors")]
        public async Task<IActionResult> GetDoctors()
        {
            var doctors = await _context.Staff.AsNoTracking()
                .Where(s => s.StaffType == 2 && (s.EndDate == null || s.EndDate >= DateTime.Today))
                .OrderBy(s => s.LastName).ThenBy(s => s.FirstName)
                .Select(s => new
                {
                    s.StaffID, s.FirstName, s.LastName, s.SpecialtyID,
                    SpecialtyName = _context.Specialties.AsNoTracking()
                        .Where(d => d.SpecialtyID == s.SpecialtyID)
                        .Select(d => d.SpecialtyName).FirstOrDefault()
                })
                .ToListAsync();

            return Ok(new { success = true, count = doctors.Count, doctors });
        }

        [HttpGet("{staffID:int}")]
        public async Task<IActionResult> GetStaffById(int staffID)
        {
            var staff = await _context.Staff.AsNoTracking()
                .FirstOrDefaultAsync(s => s.StaffID == staffID);

            return staff == null
                ? NotFound(new { success = false, message = "شخص موردنظر پیدا نشد.", messageEn = "Staff/person not found." })
                : Ok(new { success = true, staff });
        }

        [HttpPost]
        public async Task<IActionResult> CreateStaff(Staff request)
        {
            request.NationalCode = request.NationalCode.Trim();
            request.FirstName = request.FirstName.Trim();
            request.LastName = request.LastName.Trim();

            var validationError = await ValidateStaffAsync(request, null);
            if (validationError != null)
                return validationError;

            request.StaffID = 0;
            _context.Staff.Add(request);
            await _context.SaveChangesAsync();
            // پزشک تازه: مطبِ خودش به‌طورِ خودکار ساخته و وصل می‌شود.
            if (request.StaffType == 2)
                await ClinicProvisioning.EnsureForDoctorAsync(_context, request);

            return Ok(new { success = true, staff = request });
        }

        [HttpPut("{staffID:int}")]
        public async Task<IActionResult> UpdateStaff(int staffID, Staff request)
        {
            if (staffID <= 0)
                return BadRequest(new { success = false, message = "شناسه شخص معتبر نیست.", messageEn = "StaffID must be greater than zero." });

            var staff = await _context.Staff.FirstOrDefaultAsync(s => s.StaffID == staffID);
            if (staff == null)
                return NotFound(new { success = false, message = "شخص موردنظر پیدا نشد.", messageEn = "Staff/person not found." });

            request.NationalCode = request.NationalCode.Trim();
            request.FirstName = request.FirstName.Trim();
            request.LastName = request.LastName.Trim();

            var validationError = await ValidateStaffAsync(request, staffID);
            if (validationError != null)
                return validationError;

            staff.NationalCode = request.NationalCode;
            staff.FirstName = request.FirstName;
            staff.LastName = request.LastName;
            staff.StaffType = request.StaffType;
            staff.SpecialtyID = request.SpecialtyID;
            staff.StartDate = request.StartDate;
            staff.EndDate = request.EndDate;

            await _context.SaveChangesAsync();
            return Ok(new { success = true, staff });
        }

        private async Task<IActionResult?> ValidateStaffAsync(Staff request, int? currentStaffID)
        {
            if (!IranianNationalCodeValidator.IsValid(request.NationalCode))
                return BadRequest(new
                {
                    success = false,
                    message = "کد ملی واردشده معتبر نیست. لطفاً کد ملی ۱۰ رقمی صحیح را وارد کنید.",
                    messageEn = "The entered National Code is invalid. Please enter a valid 10-digit Iranian National Code."
                });

            bool duplicateNationalCode = await _context.Staff.AnyAsync(s =>
                s.NationalCode == request.NationalCode &&
                (!currentStaffID.HasValue || s.StaffID != currentStaffID.Value));

            if (duplicateNationalCode)
                return Conflict(new
                {
                    success = false,
                    message = "شخص دیگری با این کد ملی قبلاً ثبت شده است.",
                    messageEn = "Another person with this National Code already exists."
                });

            if (string.IsNullOrWhiteSpace(request.FirstName) || string.IsNullOrWhiteSpace(request.LastName))
                return BadRequest(new
                {
                    success = false,
                    message = "نام و نام خانوادگی الزامی است.",
                    messageEn = "First name and last name are required."
                });

            if (request.StaffType != 1 && request.StaffType != 2)
                return BadRequest(new
                {
                    success = false,
                    message = "نوع شخص معتبر نیست.",
                    messageEn = "StaffType must be 1 (Employee) or 2 (Doctor)."
                });

            if (request.EndDate.HasValue && request.EndDate.Value.Date < request.StartDate.Date)
                return BadRequest(new
                {
                    success = false,
                    message = "تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد.",
                    messageEn = "EndDate cannot be earlier than StartDate."
                });

            // A doctor must have a valid, active teeth specialty.
            if (request.StaffType == 2)
            {
                if (!request.SpecialtyID.HasValue)
                    return BadRequest(new
                    {
                        success = false,
                        message = "انتخاب تخصص برای دندانپزشک الزامی است.",
                        messageEn = "A specialty is required for a doctor."
                    });

                bool specialtyExists = await _context.Specialties.AsNoTracking()
                    .AnyAsync(s => s.SpecialtyID == request.SpecialtyID.Value && s.IsActive);

                if (!specialtyExists)
                    return BadRequest(new
                    {
                        success = false,
                        message = "تخصص انتخاب‌شده معتبر یا فعال نیست.",
                        messageEn = "The selected teeth specialty is invalid or inactive."
                    });
            }
            else if (request.SpecialtyID.HasValue)
            {
                return BadRequest(new
                {
                    success = false,
                    message = "تخصص دندانپزشکی فقط برای دندانپزشک قابل ثبت است.",
                    messageEn = "Teeth specialty can only be assigned to a doctor."
                });
            }

            return null;
        }
    }
}
