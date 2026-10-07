using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ReSiRai.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class PatientsController : ControllerBase
    {
        private readonly ReSiRaiDbContext _context;
        private readonly RadiologyStorageService _storageService;
        private readonly StudyAccessService _studyAccess;

        public PatientsController(ReSiRaiDbContext context, RadiologyStorageService storageService, StudyAccessService studyAccess)
        {
            _context = context;
            _storageService = storageService;
            _studyAccess = studyAccess;
        }

        // Patient identity/basic information is shared among authenticated ReSiRai users.
        // StudyAccessService is deliberately NOT applied to Patient discovery.
        [HttpGet]
        public async Task<IActionResult> GetPatients(string? search = null, bool includeInactive = false, bool openOnly = false, bool dueOnly = false,
            int offset = 0, string? sortBy = null, string? sortDir = null)
        {
            // Statistics describe the complete patient population, while the list below
            // still respects the current search/include-inactive filters.
            var totalPatients = await _context.Patients.AsNoTracking().CountAsync();
            var activePatients = await _context.Patients.AsNoTracking().CountAsync(p => p.IsActive);
            var inactivePatients = totalPatients - activePatients;
            var patientsWithStudies = await _context.RadiologyStudies.AsNoTracking()
                .Select(s => s.PatientID).Distinct().CountAsync();

            var query = _context.Patients.AsNoTracking().AsQueryable();
            if (!includeInactive) query = query.Where(p => p.IsActive);

            // "Open only": a patient still has work outstanding (status is not
            // completed). "Due only": a planned follow-up has reached its date.
            // Both are used by the reminder filter in the patient list.
            if (openOnly)
                query = query.Where(p => _context.RadiologyStudies.Any(s => s.PatientID == p.PatientID && s.Status != 2));
            if (dueOnly)
                query = query.Where(p => _context.RadiologyStudies.Any(s =>
                    s.PatientID == p.PatientID && s.Status == 3 && s.FollowUpDate != null && s.FollowUpDate <= DateTime.Today));

            if (!string.IsNullOrWhiteSpace(search))
            {
                // جستجوی فارسی باید نرم باشد: ارقام فارسی/عربی، ی/ي و ک/ك و
                // فاصلهٔ نیم‌فاصله همه معادل گرفته می‌شوند تا منشی با هر تایپی بیمار را بیابد.
                string text = NormalizeSearch(search);
                query = query.Where(p =>
                    p.NationalCode.Contains(text) ||
                    p.FirstName.Replace("ي", "ی").Replace("ك", "ک").Replace("\u200c", " ").Contains(text) ||
                    p.LastName.Replace("ي", "ی").Replace("ك", "ک").Replace("\u200c", " ").Contains(text) ||
                    (p.Mobile != null && p.Mobile.Contains(text)) ||
                    (p.Mobile2 != null && p.Mobile2.Contains(text)) ||
                    (p.FileNumber != null && p.FileNumber.Contains(text)));
            }

            // سورت کلیکی: فهرست ستون‌های مجاز، جهت صعودی/نزولی. مقدار پیش‌فرض
            // همان نام‌خانوادگیِ قبلی است تا رفتار فعلی تغییر نکند.
            bool descending = string.Equals(sortDir, "desc", StringComparison.OrdinalIgnoreCase);
            IOrderedQueryable<Patient> ordered = (sortBy ?? "").Trim().ToLowerInvariant() switch
            {
                "lastvisit" => descending
                    ? query.OrderByDescending(p => _context.RadiologyStudies.Where(s => s.PatientID == p.PatientID).Select(s => (DateTime?)s.StudyDate).Max() ?? DateTime.MinValue)
                    : query.OrderBy(p => _context.RadiologyStudies.Where(s => s.PatientID == p.PatientID).Select(s => (DateTime?)s.StudyDate).Max() ?? DateTime.MinValue),
                "studies" => descending
                    ? query.OrderByDescending(p => _context.RadiologyStudies.Count(s => s.PatientID == p.PatientID))
                    : query.OrderBy(p => _context.RadiologyStudies.Count(s => s.PatientID == p.PatientID)),
                "mobile" => descending ? query.OrderByDescending(p => p.Mobile) : query.OrderBy(p => p.Mobile),
                "nationalcode" => descending ? query.OrderByDescending(p => p.NationalCode) : query.OrderBy(p => p.NationalCode),
                "firstname" => descending ? query.OrderByDescending(p => p.FirstName) : query.OrderBy(p => p.FirstName),
                _ => descending
                    ? query.OrderByDescending(p => p.LastName).ThenByDescending(p => p.FirstName)
                    : query.OrderBy(p => p.LastName).ThenBy(p => p.FirstName)
            };

            // صفحابندی: تعداد کلِ نتیجهٔ فیلترشده برمی‌گردد تا UI بداند بازگشت
            // «بیشتر» چه‌قدر باقی است؛ سقفِ هر صفحه ۱۰۰ است.
            const int pageSize = 100;
            offset = Math.Max(0, offset);
            int totalCount = await ordered.CountAsync();

            var patients = await ordered
                .Skip(offset)
                .Take(pageSize)
                .Select(p => new
                {
                    p.PatientID, p.NationalCode, p.FirstName, p.LastName,
                    p.BirthDate, p.Gender, p.Mobile, p.IsActive,
                    p.CreatedDate, p.ModifiedDate,
                    // Design D patient list summary. These correlated aggregates are
                    // translated by EF Core and avoid one query per patient.
                    StudyCount = _context.RadiologyStudies.Count(s => s.PatientID == p.PatientID),
                    // Open (1) and pending follow-up (3) count as "not finished", so
                    // the list can show how much work is still outstanding.
                    OpenStudyCount = _context.RadiologyStudies.Count(s => s.PatientID == p.PatientID && s.Status != 2),
                    CompletedStudyCount = _context.RadiologyStudies.Count(s => s.PatientID == p.PatientID && s.Status == 2),
                    // A follow-up that has come due, used by the reminder filter.
                    DueFollowUpCount = _context.RadiologyStudies.Count(s => s.PatientID == p.PatientID && s.Status == 3 && s.FollowUpDate != null && s.FollowUpDate <= DateTime.Today),
                    NextFollowUpDate = _context.RadiologyStudies
                        .Where(s => s.PatientID == p.PatientID && s.Status == 3 && s.FollowUpDate != null)
                        .Select(s => (DateTime?)s.FollowUpDate)
                        .Min(),
                    LastStudyDate = _context.RadiologyStudies
                        .Where(s => s.PatientID == p.PatientID)
                        .Select(s => (DateTime?)s.StudyDate)
                        .Max(),
                    BaseInsuranceName = _context.InsuranceTypes.AsNoTracking()
                        .Where(t => t.InsuranceTypeID == p.BaseInsuranceTypeID)
                        .Select(t => t.InsuranceTypeName).FirstOrDefault()
                })
                .ToListAsync();

            // statistics for the header, including how many patients still have work.
            int patientsWithOpenStudies = await _context.RadiologyStudies.AsNoTracking()
                .Where(s => s.Status != 2)
                .Select(s => s.PatientID).Distinct().CountAsync();

            return Ok(new
            {
                success = true,
                count = patients.Count,
                totalCount,
                offset,
                pageSize,
                hasMore = offset + patients.Count < totalCount,
                statistics = new { totalPatients, activePatients, inactivePatients, patientsWithStudies, patientsWithOpenStudies },
                patients
            });
        }

        [HttpGet("{nationalCode}")]
        public async Task<IActionResult> GetPatient(string nationalCode)
        {
            var patient = await _context.Patients.AsNoTracking()
                .FirstOrDefaultAsync(p => p.NationalCode == nationalCode);

            return patient == null
                ? NotFound(new { success = false, message = "Patient not found." })
                : Ok(patient);
        }

        // A normal authenticated user may register a Patient before the first Study is created.
        [HttpPost]
        public async Task<IActionResult> CreatePatient(Patient patient)
        {
            patient.NationalCode = patient.NationalCode.Trim();
            if (!IranianNationalCodeValidator.IsValid(patient.NationalCode))
                return BadRequest(new
                {
                    success = false,
                    message = "کد ملی واردشده معتبر نیست. لطفاً کد ملی ۱۰ رقمی صحیح را وارد کنید.",
                    messageEn = "The entered National Code is invalid. Please enter a valid 10-digit Iranian National Code."
                });

            if (await _context.Patients.AnyAsync(p => p.NationalCode == patient.NationalCode))
                return Conflict(new
                {
                    success = false,
                    duplicate = true,
                    existing = await _context.Patients.AsNoTracking()
                        .Where(p => p.NationalCode == patient.NationalCode)
                        .Select(p => new { p.PatientID, p.NationalCode, p.FirstName, p.LastName, p.BirthDate, p.Gender, p.Mobile, p.Address, p.Description })
                        .FirstOrDefaultAsync(),
                    message = "این بیمار از قبل در سامانه ثبت شده است؛ از پروندهٔ موجود استفاده کنید.",
                    messageEn = "A patient with this NationalCode already exists."
                });

            var insuranceError = await ValidateInsuranceAsync(patient.BaseInsuranceTypeID, patient.Supp1InsuranceTypeID, patient.Supp2InsuranceTypeID);
            if (insuranceError != null) return BadRequest(new { success = false, message = insuranceError });

            patient.PatientID = 0;
            patient.CreatedDate = DateTime.Now;
            patient.ModifiedDate = null;
            patient.IsActive = true;
            _context.Patients.Add(patient);
            await _context.SaveChangesAsync();

            return Ok(new { success = true, patient });
        }

        [HttpPut("{patientID:int}")]
        public async Task<IActionResult> UpdatePatient(int patientID, UpdatePatientRequest request)
        {
            if (patientID <= 0)
                return BadRequest(new { success = false, message = "PatientID must be greater than zero." });

            string newCode = request.NationalCode.Trim();
            if (!IranianNationalCodeValidator.IsValid(newCode))
                return BadRequest(new
                {
                    success = false,
                    message = "کد ملی واردشده معتبر نیست. لطفاً کد ملی ۱۰ رقمی صحیح را وارد کنید.",
                    messageEn = "The entered National Code is invalid. Please enter a valid 10-digit Iranian National Code."
                });

            var patient = await _context.Patients.FirstOrDefaultAsync(p => p.PatientID == patientID);
            if (patient == null)
                return NotFound(new { success = false, message = "Patient not found." });

            bool codeChanged = !string.Equals(patient.NationalCode, newCode, StringComparison.Ordinal);
            if (codeChanged && await _context.Patients.AnyAsync(p => p.PatientID != patientID && p.NationalCode == newCode))
                return Conflict(new { success = false, message = "The new NationalCode already belongs to another patient. Use the Merge operation if these records represent the same patient." });

            var insuranceError = await ValidateInsuranceAsync(request.BaseInsuranceTypeID, request.Supp1InsuranceTypeID, request.Supp2InsuranceTypeID);
            if (insuranceError != null) return BadRequest(new { success = false, message = insuranceError });

            var moved = new List<(string OldRelativePath, string NewRelativePath)>();
            await using var transaction = await _context.Database.BeginTransactionAsync();

            try
            {
                if (codeChanged)
                {
                    var images = await _context.RadiologyImages
                        .Where(i => i.PatientID == patientID)
                        .OrderBy(i => i.SerialNumber)
                        .ToListAsync();

                    foreach (var image in images)
                    {
                        string oldPath = image.RelativePath;
                        string newPath = _storageService.MoveImageToPatient(oldPath, newCode, image.CreatedDate, image.SerialNumber);
                        moved.Add((oldPath, newPath));
                        image.FileName = Path.GetFileName(newPath);
                        image.RelativePath = newPath;
                    }
                }

                patient.NationalCode = newCode;
                patient.FirstName = request.FirstName.Trim();
                patient.LastName = request.LastName.Trim();
                patient.BirthDate = request.BirthDate;
                patient.Gender = request.Gender;
                patient.Mobile = request.Mobile;
                patient.Address = request.Address;
                patient.Description = request.Description;
                patient.BloodType = request.BloodType;
                patient.Mobile2 = request.Mobile2;
                patient.EmergencyContactName = request.EmergencyContactName;
                patient.EmergencyContactRelation = request.EmergencyContactRelation;
                patient.EmergencyContactPhone = request.EmergencyContactPhone;
                patient.BaseInsuranceTypeID = request.BaseInsuranceTypeID;
                patient.BaseInsuranceNo = request.BaseInsuranceNo;
                patient.Supp1InsuranceTypeID = request.Supp1InsuranceTypeID;
                patient.Supp1InsuranceNo = request.Supp1InsuranceNo;
                patient.Supp2InsuranceTypeID = request.Supp2InsuranceTypeID;
                patient.Supp2InsuranceNo = request.Supp2InsuranceNo;
                patient.FileNumber = request.FileNumber;
                patient.ContactPreference = request.ContactPreference;
                patient.ModifiedDate = DateTime.Now;

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                return Ok(new { success = true, patient, nationalCodeChanged = codeChanged, renamedImages = moved.Count });
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                RollBackMovedFiles(moved);
                return StatusCode(500, new
                {
                    success = false,
                    message = "Patient update failed. Database changes were rolled back and the system attempted to restore moved image files.",
                    error = ex.Message
                });
            }
        }

        [HttpPut("{patientID:int}/deactivate")]
        public async Task<IActionResult> DeactivatePatient(int patientID)
        {
            var patient = await _context.Patients.FirstOrDefaultAsync(p => p.PatientID == patientID);
            if (patient == null) return NotFound(new { success = false, message = "Patient not found." });
            if (!patient.IsActive) return Ok(new { success = true, message = "Patient is already inactive.", patientID });

            patient.IsActive = false;
            patient.ModifiedDate = DateTime.Now;
            await _context.SaveChangesAsync();
            return Ok(new { success = true, patient.PatientID, patient.NationalCode, patient.IsActive, patient.ModifiedDate });
        }

        [HttpPut("{patientID:int}/activate")]
        public async Task<IActionResult> ActivatePatient(int patientID)
        {
            if (patientID <= 0)
                return BadRequest(new { success = false, message = "PatientID must be greater than zero." });

            var patient = await _context.Patients.FirstOrDefaultAsync(p => p.PatientID == patientID);
            if (patient == null) return NotFound(new { success = false, message = "Patient not found." });

            if (!patient.IsActive)
            {
                patient.IsActive = true;
                patient.ModifiedDate = DateTime.Now;
                await _context.SaveChangesAsync();
            }

            return Ok(new { success = true, patient.PatientID, patient.NationalCode, patient.IsActive, patient.ModifiedDate, message = "Patient activated successfully." });
        }

        [HttpGet("{patientID:int}/details")]
        public async Task<IActionResult> GetPatientDetails(int patientID)
        {
            Console.WriteLine($"[ReSiRai PatientDetails] START PatientID={patientID}");
            if (patientID <= 0)
                return BadRequest(new { success = false, message = "PatientID must be greater than zero." });

            // Keep the Patient Details endpoint deliberately simple and bounded.
            // Patient identity is shared. Studies are already access-filtered here.
            // Image totals are derived from the already-loaded Study image counts,
            // so opening a patient never needs a second RadiologyImages count query.
            var patient = await _context.Patients.AsNoTracking()
                .FirstOrDefaultAsync(p => p.PatientID == patientID);
            if (patient == null)
                return NotFound(new { success = false, message = "Patient not found." });

            var accessibleStudies = _studyAccess.ApplyAccess(
                _context.RadiologyStudies.AsNoTracking().Where(s => s.PatientID == patientID), User);

            Console.WriteLine($"[ReSiRai PatientDetails] PATIENT loaded PatientID={patientID}");

            var studies = await (
                from s in accessibleStudies
                join st in _context.StudyTypes.AsNoTracking() on s.StudyTypeID equals st.StudyTypeID
                orderby s.StudyDate descending, s.StudyID descending
                select new
                {
                    s.StudyID, s.PatientID, s.StudyDate, s.StudyTypeID,
                    StudyTypeName = st.StudyTypeName,
                    s.StudyTypeNote,
                    s.BodyPart, s.Description, s.Diagnosis, s.WorkEndDate, s.CreatedDate, s.ModifiedDate,
                    s.DoctorStaffID,
                    DoctorName = _context.Staff.AsNoTracking()
                        .Where(st => st.StaffID == s.DoctorStaffID)
                        .Select(st => st.FirstName + " " + st.LastName).FirstOrDefault(),
                    s.Status, s.FollowUpDate, s.FollowUpNote, s.WaitStageID,
                    WaitStageName = _context.WaitStages.AsNoTracking()
                        .Where(w => w.WaitStageID == s.WaitStageID)
                        .Select(w => w.Name).FirstOrDefault()
                }).ToListAsync();

            Console.WriteLine($"[ReSiRai PatientDetails] STUDIES loaded Count={studies.Count}");
            var studyIDs = studies.Select(s => s.StudyID).ToList();

            // نمای مشتق: بارداری/شیردهی در سطحِ مراجعه ثبت می‌شود (فاکتور HIST.PREG).
            // پروندهٔ بیمار فقط «آخرین وضعیتِ قابل‌دیدنِ همین کاربر» را به‌عنوان نما
            // با تاریخ ثبتش نشان می‌دهد؛ منبعِ حقیقت همان مقدارِ مراجعه است و اینجا
            // چیزی مستقل ذخیره نمی‌شود. کوئری از accessibleStudies می‌آید، پس هرگز
            // مقدارِ مراجعهٔ پزشکِ دیگری به این نما راه نمی‌یابد.
            // بیمارِ مرد (Gender=1): این نما بی‌معنی است و سمتِ سرور خاموش می‌ماند تا
            // سطرِ «بارداری/شیردهی» — با کلاینتِ کهنه یا بدونِ جنسیت در کلاینت — دیده نشود.
            var pregnancy = await (
                from v in _context.StudyFactorValues.AsNoTracking()
                join f in _context.ClinicalFactors.AsNoTracking() on v.FactorID equals f.FactorID
                join s in accessibleStudies on v.StudyID equals s.StudyID
                where f.FactorCode == "HIST.PREG" && patient.Gender != 1
                orderby v.ObservedAt descending
                select new { v.ValueNumber, v.ValueText, v.ObservedAt, s.StudyDate }
            ).FirstOrDefaultAsync();
            // «کارت سابقه» سند است: هنگامِ ثبتِ مراجعه اسکن می‌شود، در گریدِ تصاویر
            // دیده نمی‌شود و جزءِ شمارشِ تصاویر هم نیست.
            const string cardImageTypeName = "کارت سابقه";
            var imageCounts = studyIDs.Count == 0
                ? new Dictionary<int, int>()
                : await _context.RadiologyStudyImages.AsNoTracking()
                    .Where(x => studyIDs.Contains(x.StudyID))
                    .GroupBy(x => x.StudyID)
                    .Select(g => new { StudyID = g.Key, Count = g.Count() })
                    .ToDictionaryAsync(x => x.StudyID, x => x.Count);

            var documentCounts = studyIDs.Count == 0
                ? new Dictionary<int, int>()
                : await (from link in _context.RadiologyStudyImages.AsNoTracking()
                         join img in _context.RadiologyImages.AsNoTracking() on link.ImageID equals img.ImageID
                         join t in _context.ImageTypes.AsNoTracking() on img.ImageTypeID equals t.ImageTypeID
                         where studyIDs.Contains(link.StudyID) && t.ImageTypeName == cardImageTypeName
                         group link by link.StudyID into g
                         select new { StudyID = g.Key, Count = g.Count() })
                    .ToDictionaryAsync(x => x.StudyID, x => x.Count);

            Console.WriteLine($"[ReSiRai PatientDetails] IMAGE COUNTS loaded Count={imageCounts.Count}");

            // «حذف مراجعه» فقط برای مراجعهٔ خالی مجاز است؛ تعداد اقدام‌ها و پرداخت‌ها
            // را همین‌جا می‌گیریم تا رابط کاربری دکمهٔ حذف را نشان ندهد.
            var actionCounts = studyIDs.Count == 0
                ? new Dictionary<int, int>()
                : await _context.StudyActions.AsNoTracking()
                    .Where(x => studyIDs.Contains(x.StudyID))
                    .GroupBy(x => x.StudyID)
                    .Select(g => new { StudyID = g.Key, Count = g.Count() })
                    .ToDictionaryAsync(x => x.StudyID, x => x.Count);

            var paymentCounts = studyIDs.Count == 0
                ? new Dictionary<int, int>()
                : await _context.StudyPayments.AsNoTracking()
                    .Where(x => studyIDs.Contains(x.StudyID))
                    .GroupBy(x => x.StudyID)
                    .Select(g => new { StudyID = g.Key, Count = g.Count() })
                    .ToDictionaryAsync(x => x.StudyID, x => x.Count);

            var studyList = studies.Select(s => new
            {
                s.StudyID, s.PatientID, s.StudyDate, s.StudyTypeID, s.StudyTypeName,
                s.BodyPart, s.Description, s.Diagnosis, s.WorkEndDate, s.CreatedDate, s.ModifiedDate,
                s.Status, s.FollowUpDate, s.FollowUpNote, s.WaitStageID, s.WaitStageName,
                imageCount = (imageCounts.TryGetValue(s.StudyID, out int count) ? count : 0)
                             - (documentCounts.TryGetValue(s.StudyID, out int docCount) ? docCount : 0),
                documentCount = documentCounts.TryGetValue(s.StudyID, out int onlyDoc) ? onlyDoc : 0,
                actionCount = actionCounts.TryGetValue(s.StudyID, out int ac) ? ac : 0,
                paymentCount = paymentCounts.TryGetValue(s.StudyID, out int pc) ? pc : 0
            }).ToList();

            int totalImageCount = studyList.Sum(s => s.imageCount);

            Console.WriteLine($"[ReSiRai PatientDetails] RETURN PatientID={patientID} Studies={studyList.Count} Images={totalImageCount}");

            // Diagnostic headers make the endpoint stage visible in the browser's
            // Network tab without relying on Console.WriteLine/Visual Studio Output.
            Response.Headers["X-ReSiRai-PatientDetails"] = "completed";
            Response.Headers["X-ReSiRai-PatientID"] = patientID.ToString();
            Response.Headers["X-ReSiRai-StudyCount"] = studyList.Count.ToString();

            return Ok(new
            {
                success = true,
                patient = new
                {
                    patient.PatientID, patient.NationalCode, patient.FirstName, patient.LastName,
                    patient.BirthDate, patient.Gender, patient.Mobile, patient.Address,
                    patient.Description, patient.CreatedDate, patient.ModifiedDate, patient.IsActive,
                    patient.BloodType, patient.Mobile2,
                    patient.EmergencyContactName, patient.EmergencyContactRelation, patient.EmergencyContactPhone,
                    patient.BaseInsuranceTypeID, patient.BaseInsuranceNo,
                    patient.Supp1InsuranceTypeID, patient.Supp1InsuranceNo,
                    patient.Supp2InsuranceTypeID, patient.Supp2InsuranceNo,
                    patient.FileNumber, patient.ContactPreference,
                    PregnancyStatus = pregnancy == null || pregnancy.ValueNumber == null
                        ? null
                        : pregnancy.ValueNumber.Value switch
                        {
                            1 => "باردار",
                            2 => "شیرده",
                            _ => null
                        },
                    PregnancyObservedAt = pregnancy?.ObservedAt,
                    PregnancyStudyDate = pregnancy?.StudyDate,
                    BaseInsuranceName = _context.InsuranceTypes.AsNoTracking()
                        .Where(t => t.InsuranceTypeID == patient.BaseInsuranceTypeID).Select(t => t.InsuranceTypeName).FirstOrDefault(),
                    Supp1InsuranceName = _context.InsuranceTypes.AsNoTracking()
                        .Where(t => t.InsuranceTypeID == patient.Supp1InsuranceTypeID).Select(t => t.InsuranceTypeName).FirstOrDefault(),
                    Supp2InsuranceName = _context.InsuranceTypes.AsNoTracking()
                        .Where(t => t.InsuranceTypeID == patient.Supp2InsuranceTypeID).Select(t => t.InsuranceTypeName).FirstOrDefault()
                },
                studyCount = studyList.Count,
                totalImageCount,
                studies = studyList
            });
        }

        // Merge is a Patient-level data-correction operation.
        // It is intentionally independent of Study authorization: Study ownership/scope fields
        // (ClinicID and DoctorStaffID) are preserved when the duplicate Patient is merged.
        [HttpPost("merge")]
        public async Task<IActionResult> MergePatients(MergePatientRequest request)
        {
            if (request.SourcePatientID <= 0 || request.TargetPatientID <= 0 || request.SourcePatientID == request.TargetPatientID)
                return BadRequest(new { success = false, message = "SourcePatientID and TargetPatientID must be valid and different." });

            var source = await _context.Patients.FirstOrDefaultAsync(p => p.PatientID == request.SourcePatientID);
            var target = await _context.Patients.FirstOrDefaultAsync(p => p.PatientID == request.TargetPatientID);
            if (source == null) return NotFound(new { success = false, message = "Source patient not found." });
            if (target == null) return NotFound(new { success = false, message = "Target patient not found." });

            var studies = await _context.RadiologyStudies.Where(s => s.PatientID == source.PatientID).ToListAsync();
            var images = await _context.RadiologyImages.Where(i => i.PatientID == source.PatientID).OrderBy(i => i.SerialNumber).ToListAsync();

            int nextSerial = (await _context.RadiologyImages.Where(i => i.PatientID == target.PatientID)
                .Select(i => (int?)i.SerialNumber).MaxAsync() ?? 0) + 1;
            var targetSerials = (await _context.RadiologyImages.Where(i => i.PatientID == target.PatientID)
                .Select(i => i.SerialNumber).ToListAsync()).ToHashSet();
            var moved = new List<(string OldRelativePath, string NewRelativePath)>();

            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                foreach (var image in images)
                {
                    int serial = image.SerialNumber;
                    if (serial <= 0 || targetSerials.Contains(serial)) serial = nextSerial++;
                    while (targetSerials.Contains(serial)) serial = nextSerial++;
                    targetSerials.Add(serial);

                    string oldPath = image.RelativePath;
                    string newPath = _storageService.MoveImageToPatient(oldPath, target.NationalCode, image.CreatedDate, serial);
                    moved.Add((oldPath, newPath));
                    image.PatientID = target.PatientID;
                    image.SerialNumber = serial;
                    image.FileName = Path.GetFileName(newPath);
                    image.RelativePath = newPath;
                }

                foreach (var study in studies)
                {
                    study.PatientID = target.PatientID;
                    study.ModifiedDate = DateTime.Now;
                }

                _context.Patients.Remove(source);
                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                return Ok(new
                {
                    success = true,
                    sourcePatientID = request.SourcePatientID,
                    targetPatientID = request.TargetPatientID,
                    transferredStudies = studies.Count,
                    transferredImages = images.Count,
                    sourceNationalCode = source.NationalCode,
                    targetNationalCode = target.NationalCode,
                    message = "Patients merged successfully. Studies, images and Study-image links were preserved."
                });
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                RollBackMovedFiles(moved);
                return StatusCode(500, new
                {
                    success = false,
                    message = "Patient merge failed. Database changes were rolled back and the system attempted to restore moved files.",
                    error = ex.Message
                });
            }
        }

        private void RollBackMovedFiles(List<(string OldRelativePath, string NewRelativePath)> moved)
        {
            for (int i = moved.Count - 1; i >= 0; i--)
            {
                try
                {
                    string oldPath = _storageService.GetPhysicalPath(moved[i].OldRelativePath);
                    string newPath = _storageService.GetPhysicalPath(moved[i].NewRelativePath);
                    if (System.IO.File.Exists(newPath) && !System.IO.File.Exists(oldPath))
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(oldPath)!);
                        System.IO.File.Move(newPath, oldPath);
                        _storageService.DeletePatientFolderIfEmpty(Path.GetDirectoryName(moved[i].NewRelativePath));
                    }
                }
                catch { }
            }
        }

        [HttpDelete("{patientID:int}")]
        public async Task<IActionResult> DeletePatient(int patientID)
        {
            if (patientID <= 0)
                return BadRequest(new { success = false, message = "PatientID is invalid." });

            var patient = await _context.Patients.FirstOrDefaultAsync(p => p.PatientID == patientID);
            if (patient == null)
                return NotFound(new { success = false, message = "Patient not found." });

            if (await _context.RadiologyStudies.AsNoTracking().AnyAsync(s => s.PatientID == patientID))
                return Conflict(new { success = false, message = "بیماری که دارای مطالعه است قابل حذف نیست." });

            // Images normally belong to a Study, but this second guard also protects
            // legacy/orphan rows from causing an FK failure during patient deletion.
            if (await _context.RadiologyImages.AsNoTracking().AnyAsync(i => i.PatientID == patientID))
                return Conflict(new { success = false, message = "بیمار دارای تصویر ثبت‌شده است و قابل حذف نیست." });

            string? photoRelativePath = patient.PhotoRelativePath;
            _context.Patients.Remove(patient);
            await _context.SaveChangesAsync();

            if (!string.IsNullOrWhiteSpace(photoRelativePath))
            {
                var photoPath = Path.Combine(_storageService.GetRootPath(), photoRelativePath);
                if (System.IO.File.Exists(photoPath)) System.IO.File.Delete(photoPath);
            }

            return Ok(new { success = true, patientID, message = "Patient deleted successfully." });
        }

        // Saves/replaces the optional Patient profile photo.
        // capture="environment" on the frontend lets mobile devices open their camera.
        [HttpPost("{patientID:int}/photo")]
        public async Task<IActionResult> UploadPatientPhoto(int patientID, IFormFile file)
        {
            if (patientID <= 0) return BadRequest(new { success = false, message = "PatientID is invalid." });
            if (file == null || file.Length == 0 || string.IsNullOrWhiteSpace(file.ContentType) || !file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { success = false, message = "لطفاً یک فایل تصویری معتبر انتخاب کنید." });

            var patient = await _context.Patients.FirstOrDefaultAsync(p => p.PatientID == patientID);
            if (patient == null) return NotFound(new { success = false, message = "Patient not found." });

            var extension = Path.GetExtension(file.FileName);
            if (string.IsNullOrWhiteSpace(extension) || extension.Length > 10) extension = ".jpg";
            var relativePath = Path.Combine("Patients", patientID.ToString(), "Profile", $"patient-{Guid.NewGuid():N}{extension.ToLowerInvariant()}");
            // The storage root is configured through RadiologyStorage:RootPath.
            var root = _storageService.GetRootPath();
            var fullPath = Path.Combine(root, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
            await using (var stream = System.IO.File.Create(fullPath))
                await file.CopyToAsync(stream);

            if (!string.IsNullOrWhiteSpace(patient.PhotoRelativePath))
            {
                var oldPath = Path.Combine(root, patient.PhotoRelativePath);
                if (System.IO.File.Exists(oldPath)) System.IO.File.Delete(oldPath);
            }

            patient.PhotoRelativePath = relativePath;
            patient.ModifiedDate = DateTime.Now;
            await _context.SaveChangesAsync();
            return Ok(new { success = true, patient.PatientID, patient.PhotoRelativePath });
        }

        [HttpGet("{patientID:int}/photo")]
        public async Task<IActionResult> GetPatientPhoto(int patientID)
        {
            var path = await _context.Patients.AsNoTracking()
                .Where(p => p.PatientID == patientID)
                .Select(p => p.PhotoRelativePath)
                .FirstOrDefaultAsync();
            if (string.IsNullOrWhiteSpace(path)) return NotFound();
            var fullPath = Path.Combine(_storageService.GetRootPath(), path);
            if (!System.IO.File.Exists(fullPath)) return NotFound();
            return PhysicalFile(fullPath, "image/jpeg");
        }

        // جستجوی نرمِ فارسی: ارقام فارسی/عربی به لاتین، ی/ي و ک/ك یکسان، نیم‌فاصله به فاصله.
        private static string NormalizeSearch(string value)
        {
            var sb = new System.Text.StringBuilder((value ?? string.Empty).Trim().Length);
            foreach (char ch in (value ?? string.Empty).Trim())
            {
                char c = ch switch
                {
                    '۰' or '٠' => '0', '۱' or '١' => '1', '۲' or '٢' => '2', '۳' or '٣' => '3',
                    '۴' or '٤' => '4', '۵' or '٥' => '5', '۶' or '٦' => '6', '۷' or '٧' => '7',
                    '۸' or '٨' => '8', '۹' or '٩' => '9',
                    'ي' => 'ی', 'ك' => 'ک', '\u200c' => ' ',
                    _ => ch
                };
                sb.Append(c);
            }
            return sb.ToString();
        }

        // چهار قانون بیمه: پایه باید پایه باشد، تکمیلی باید تکمیلی باشد،
        // دو تکمیلی یکسان نباشند و هر نوع فعال باشد.
        private async Task<string?> ValidateInsuranceAsync(int? baseID, int? supp1ID, int? supp2ID)
        {
            if (supp1ID.HasValue && supp2ID.HasValue && supp1ID.Value == supp2ID.Value)
                return "بیمهٔ تکمیلی ۱ و ۲ نباید یکسان باشند.";

            var ids = new List<int>();
            if (baseID.HasValue) ids.Add(baseID.Value);
            if (supp1ID.HasValue) ids.Add(supp1ID.Value);
            if (supp2ID.HasValue) ids.Add(supp2ID.Value);
            if (ids.Count == 0) return null;

            var types = await _context.InsuranceTypes.AsNoTracking()
                .Where(t => ids.Contains(t.InsuranceTypeID))
                .Select(t => new { t.InsuranceTypeID, t.IsSupplementary, t.IsActive })
                .ToListAsync();

            if (types.Count != ids.Distinct().Count())
                return "نوع بیمهٔ انتخاب‌شده معتبر نیست.";
            if (types.Any(t => !t.IsActive))
                return "نوع بیمهٔ انتخاب‌شده غیرفعال است.";
            if (baseID.HasValue && types.First(t => t.InsuranceTypeID == baseID.Value).IsSupplementary)
                return "بیمهٔ پایه باید از نوع پایه باشد.";
            if (supp1ID.HasValue && !types.First(t => t.InsuranceTypeID == supp1ID.Value).IsSupplementary)
                return "بیمهٔ تکمیلی ۱ باید از نوع تکمیلی باشد.";
            if (supp2ID.HasValue && !types.First(t => t.InsuranceTypeID == supp2ID.Value).IsSupplementary)
                return "بیمهٔ تکمیلی ۲ باید از نوع تکمیلی باشد.";
            return null;
        }

    }
}
