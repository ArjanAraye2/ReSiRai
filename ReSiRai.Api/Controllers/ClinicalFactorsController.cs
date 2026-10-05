using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ReSiRai.Api.Controllers
{
    // Clinical decision factors ("sharayet-e feli"): what the patient's condition
    // is, as numbers the AI consultation can reason over.
    //
    // Reading is open to any signed-in user because the visit form needs the factor
    // definitions and the recorded values. Recording values is normal staff work;
    // changing the dictionary itself stays in the factor admin (later phase).
    //
    // Every value row says where its number came from (manual, lab-report
    // extraction, device, computed) so an AI input is always auditable.
    [ApiController]
    [Route("api/factors")]
    public class ClinicalFactorsController : ControllerBase
    {
        private readonly ReSiRaiDbContext _db;
        private readonly StudyAccessService _studyAccess;
        public ClinicalFactorsController(ReSiRaiDbContext db, StudyAccessService studyAccess)
        {
            _db = db;
            _studyAccess = studyAccess;
        }

        public sealed class FactorValueItem
        {
            public int FactorID { get; set; }
            public decimal? ValueNumber { get; set; }
            public string? ValueText { get; set; }
            public bool? ValueBit { get; set; }
            public DateTime? ValueDate { get; set; }
            /// <summary>When the measurement was taken; defaults to now.</summary>
            public DateTime? ObservedAt { get; set; }
            /// <summary>1 = manual, 2 = lab-report extraction, 3 = device, 4 = computed.</summary>
            public byte Source { get; set; } = 1;
            public long? ExtractionID { get; set; }
            public decimal? Confidence { get; set; }
            /// <summary>Reference range printed on the lab sheet, exactly as printed.</summary>
            public string? RefText { get; set; }
            /// <summary>Unit printed on the lab sheet.</summary>
            public string? UnitText { get; set; }
        }

        public sealed class SaveValuesRequest
        {
            public int StudyID { get; set; }
            public List<FactorValueItem> Items { get; set; } = new();
        }

        /// <summary>
        /// The factor set of one specialty: shared dictionary rows joined with the
        /// specialty binding (required / always shown / order). The visit form builds
        /// its sections from this one call. Callers may pass a visit instead of a
        /// specialty; the specialty is then taken from the visit's doctor, falling
        /// back to internal medicine when the doctor has none.
        /// </summary>
        [HttpGet("definitions")]
        public async Task<IActionResult> Definitions([FromQuery] int? specialtyID = null,
            [FromQuery] int? studyID = null, [FromQuery] string? category = null)
        {
            if (!specialtyID.HasValue && studyID.HasValue)
            {
                var staffID = await _db.RadiologyStudies.AsNoTracking()
                    .Where(x => x.StudyID == studyID.Value)
                    .Select(x => x.DoctorStaffID)
                    .FirstOrDefaultAsync();
                specialtyID = await _db.Staff.AsNoTracking()
                    .Where(x => x.StaffID == staffID)
                    .Select(x => x.SpecialtyID)
                    .FirstOrDefaultAsync();
            }

            // بیمارِ مرد: فاکتورِ «بارداری/شیردهی» (HIST.PREG) بی‌معنی است و همین‌جا،
            // رویِ سرور، از فهرست حذف می‌شود. فیلترِ کلاینتی (factors-ui.js) فقط
            // برایِ حالتِ پیش‌نویسِ بدونِ StudyID می‌ماند؛ این‌جا جنسیتِ واقعیِ همان
            // بیمار از دیتابیس خوانده می‌شود، پس با کلاینتِ کهنه یا نبودِ
            // window.selectedPatient هم دیده نخواهد شد. جنسیتِ ناشناخته دست نمی‌خورد.
            byte? patientGender = null;
            if (studyID.HasValue)
            {
                var patientID = await _db.RadiologyStudies.AsNoTracking()
                    .Where(x => x.StudyID == studyID.Value)
                    .Select(x => (int?)x.PatientID)
                    .FirstOrDefaultAsync();
                if (patientID.HasValue)
                    patientGender = await _db.Patients.AsNoTracking()
                        .Where(x => x.PatientID == patientID.Value)
                        .Select(x => (byte?)x.Gender)
                        .FirstOrDefaultAsync();
            }
            if (!specialtyID.HasValue)
            {
                // Phase 1 starts from internal medicine; a doctor without a specialty
                // therefore sees the internal-medicine factor set.
                specialtyID = await _db.Specialties.AsNoTracking()
                    .Where(x => x.SpecialtyName == "بیماری‌های داخلی")
                    .Select(x => x.SpecialtyID)
                    .FirstOrDefaultAsync();
            }

            var query =
                from f in _db.ClinicalFactors.AsNoTracking()
                join s in _db.SpecialtyFactorSets.AsNoTracking() on f.FactorID equals s.FactorID
                where s.SpecialtyID == specialtyID && f.IsActive
                select new { f, s };

            if (!string.IsNullOrWhiteSpace(category))
                query = query.Where(x => x.f.Category == category);

            var rows = await query
                .OrderByDescending(x => x.s.IsCommon).ThenBy(x => x.s.SortOrder).ThenBy(x => x.f.FactorID)
                .Select(x => new
                {
                    x.f.FactorID, x.f.FactorCode, x.f.NameFa, x.f.NameEn, x.f.ShortCode,
                    x.f.Category, x.f.DataType, x.f.UnitUCUM,
                    x.f.LoincCode, x.f.LoincStatus,
                    x.f.RefLow, x.f.RefHigh, x.f.RefText, x.f.RefSource, x.f.RefPopulation,
                    x.f.AbnormalDirection, x.f.OptionsJson,
                    x.s.IsRequired, x.s.IsCommon, x.s.SortOrder
                })
                .ToListAsync();

            if (patientGender == 1)
                rows.RemoveAll(x => x.FactorCode == "HIST.PREG");

            return Ok(new { success = true, count = rows.Count, factors = rows });
        }

        public sealed class AddFactorRequest
        {
            public string? NameFa { get; set; }
            public string NameEn { get; set; } = string.Empty;
            public string? ShortCode { get; set; }
            public string? UnitUCUM { get; set; }
            public decimal? RefLow { get; set; }
            public decimal? RefHigh { get; set; }
            public string? RefText { get; set; }
            /// <summary>1 = number, 4 = text; unknown printed tests default to number.</summary>
            public byte DataType { get; set; } = 1;
            public int? StudyID { get; set; }
        }

        /// <summary>
        /// Adds a test the lab printed but the dictionary did not know yet, so no
        /// printed result is ever thrown away for being unknown. The row starts as
        /// "pending specialist review" with no LOINC code (a code is never guessed)
        /// and is bound to the visit's specialty so the panel shows it at once.
        /// </summary>
        [HttpPost("definitions")]
        public async Task<IActionResult> AddDefinition(AddFactorRequest request, CancellationToken cancellationToken)
        {
            static string Clamp(string? s, int max)
            {
                string t = (s ?? string.Empty).Trim();
                return t.Length <= max ? t : t[..max];
            }
            string nameEn = Clamp(request.NameEn, 200);
            string nameFa = string.IsNullOrWhiteSpace(request.NameFa) ? nameEn : Clamp(request.NameFa, 200);
            if (nameEn.Length == 0 && nameFa.Length == 0)
                return BadRequest(new { success = false, message = "نام تست لازم است." });
            if (nameEn.Length == 0) nameEn = nameFa;

            // The same printed test must never create two dictionary rows.
            string enLower = nameEn.ToLowerInvariant();
            string faKey = nameFa.ToLowerInvariant();
            var factor = await _db.ClinicalFactors
                .FirstOrDefaultAsync(x => x.IsActive &&
                    (x.NameEn.ToLower() == enLower || x.NameFa.ToLower() == faKey), cancellationToken);
            bool created = false;
            if (factor is null)
            {
                factor = new ClinicalFactor
                {
                    FactorCode = await UniqueFactorCode(nameEn, cancellationToken),
                    NameFa = nameFa,
                    NameEn = nameEn,
                    ShortCode = string.IsNullOrWhiteSpace(request.ShortCode) ? null : Clamp(request.ShortCode, 20),
                    Category = "Lab",
                    DataType = request.DataType == 0 ? (byte)1 : request.DataType,
                    UnitUCUM = string.IsNullOrWhiteSpace(request.UnitUCUM) ? null : Clamp(request.UnitUCUM, 30),
                    LoincCode = null,
                    LoincStatus = 0,
                    RefLow = request.RefLow,
                    RefHigh = request.RefHigh,
                    RefText = string.IsNullOrWhiteSpace(request.RefText) ? null : Clamp(request.RefText, 500),
                    RefSource = "برگه آزمایش چاپ‌شده (ثبت هنگام استخراج)",
                    RefPopulation = null,
                    AbnormalDirection = request.RefLow.HasValue || request.RefHigh.HasValue ? (byte)3 : null,
                    IsActive = true,
                    CreatedDate = DateTime.Now
                };
                _db.ClinicalFactors.Add(factor);
                try
                {
                    await _db.SaveChangesAsync(cancellationToken);
                    created = true;
                }
                catch (DbUpdateException e)
                {
                    // Never crash on a dictionary row: tell the doctor what the
                    // database said and leave the review screen usable.
                    _db.Entry(factor).State = EntityState.Detached;
                    return BadRequest(new
                    {
                        success = false,
                        message = "ذخیرهٔ فاکتورِ جدید ناموفق بود: " + (e.InnerException?.Message ?? e.Message)
                    });
                }
            }

            // Bind it to the visit's specialty (or internal medicine) so the factor
            // set of that specialty can serve it to the panel right away.
            int specialtyID = 0;
            if (request.StudyID.HasValue)
            {
                var staffID = await _db.RadiologyStudies.AsNoTracking()
                    .Where(x => x.StudyID == request.StudyID.Value)
                    .Select(x => x.DoctorStaffID)
                    .FirstOrDefaultAsync(cancellationToken);
                specialtyID = (await _db.Staff.AsNoTracking()
                    .Where(x => x.StaffID == staffID)
                    .Select(x => x.SpecialtyID)
                    .FirstOrDefaultAsync(cancellationToken)) ?? 0;
            }
            if (specialtyID == 0)
            {
                specialtyID = await _db.Specialties.AsNoTracking()
                    .Where(x => x.SpecialtyName == "بیماری‌های داخلی")
                    .Select(x => x.SpecialtyID)
                    .FirstOrDefaultAsync(cancellationToken);
            }
            bool bound = false;
            if (specialtyID != 0 && !await _db.SpecialtyFactorSets.AsNoTracking()
                .AnyAsync(x => x.SpecialtyID == specialtyID && x.FactorID == factor.FactorID, cancellationToken))
            {
                int maxOrder = await _db.SpecialtyFactorSets.AsNoTracking()
                    .Where(x => x.SpecialtyID == specialtyID)
                    .MaxAsync(x => (int?)x.SortOrder, cancellationToken) ?? 0;
                _db.SpecialtyFactorSets.Add(new SpecialtyFactorSet
                {
                    SpecialtyID = specialtyID,
                    FactorID = factor.FactorID,
                    IsRequired = false,
                    IsCommon = false,
                    SortOrder = maxOrder + 1
                });
                await _db.SaveChangesAsync(cancellationToken);
                bound = true;
            }

            return Ok(new
            {
                success = true,
                created,
                bound,
                factor = new
                {
                    factorID = factor.FactorID,
                    factorCode = factor.FactorCode,
                    nameFa = factor.NameFa,
                    nameEn = factor.NameEn,
                    shortCode = factor.ShortCode,
                    unitUCUM = factor.UnitUCUM,
                    refLow = factor.RefLow,
                    refHigh = factor.RefHigh,
                    refText = factor.RefText,
                    dataType = factor.DataType,
                    loincStatus = factor.LoincStatus
                }
            });
        }

        /// <summary>Builds a readable, unique internal code for a new dictionary row.</summary>
        private async Task<string> UniqueFactorCode(string nameEn, CancellationToken cancellationToken)
        {
            var sb = new System.Text.StringBuilder();
            foreach (char c in nameEn.ToLowerInvariant())
                if (c < 128 && char.IsLetterOrDigit(c)) sb.Append(c);
            string slug = sb.Length >= 2 ? sb.ToString()[..Math.Min(sb.Length, 24)] : "test";
            string code = $"LAB.CUSTOM.{slug}";
            for (int i = 2; await _db.ClinicalFactors.AsNoTracking()
                .AnyAsync(x => x.FactorCode == code, cancellationToken); i++)
                code = $"LAB.CUSTOM.{slug}-{i}";
            return code;
        }

        /// <summary>
        /// All recorded values of one visit, with the factor identity attached, plus
        /// the earlier values of the same factors so the form can draw a trend.
        /// </summary>
        [HttpGet("values")]
        public async Task<IActionResult> Values([FromQuery] int studyID)
        {
            // دسترسی مراجعه‌محور: دانشِ هر پزشک فقط از مراجعاتِ خودش می‌آید.
            // بدونِ این گارد، دکتر ب می‌توانست مقادیر ثبت‌شده توسط دکتر الف را ببیند.
            if (!await _studyAccess.CanAccessStudyAsync(studyID, User))
                return Forbid();

            var rows = await (
                from v in _db.StudyFactorValues.AsNoTracking()
                join f in _db.ClinicalFactors.AsNoTracking() on v.FactorID equals f.FactorID
                where v.StudyID == studyID
                orderby v.ObservedAt descending
                select new
                {
                    v.FactorValueID, v.StudyID, v.FactorID,
                    v.ValueNumber, v.ValueText, v.ValueBit, v.ValueDate,
                    v.ObservedAt, v.Source, v.ExtractionID, v.Confidence,
                    f.FactorCode, f.NameFa, f.NameEn, f.DataType, f.UnitUCUM,
                    f.RefLow, f.RefHigh, f.RefText, f.AbnormalDirection, f.Category,
                    // The printed range/unit of this observation - the dictionary's
                    // values above are only the fallback.
                    ValueRefText = v.RefText, ValueUnitText = v.UnitText
                }).ToListAsync();

            // Earlier values of the same factors from this patient's other visits,
            // newest first - the raw material of the trend line. Scoped to the visits
            // this user may access, so the history never crosses doctor boundaries.
            int patientID = await _db.RadiologyStudies.AsNoTracking()
                .Where(x => x.StudyID == studyID)
                .Select(x => x.PatientID)
                .FirstOrDefaultAsync();
            var factorIds = rows.Select(x => x.FactorID).Distinct().ToList();
            var accessibleStudies = _studyAccess.ApplyAccess(_db.RadiologyStudies.AsNoTracking(), User).Select(s => s.StudyID);
            var history = await (
                from v in _db.StudyFactorValues.AsNoTracking()
                join s in _db.RadiologyStudies.AsNoTracking() on v.StudyID equals s.StudyID
                where factorIds.Contains(v.FactorID) && v.StudyID != studyID && s.PatientID == patientID
                    && accessibleStudies.Contains(v.StudyID)
                orderby v.ObservedAt descending
                select new { v.FactorID, v.StudyID, v.ValueNumber, v.ValueText, v.ValueBit, v.ValueDate, v.ObservedAt, v.Source, v.UnitText, v.RefText }
            ).Take(60).ToListAsync();

            return Ok(new { success = true, count = rows.Count, values = rows, history });
        }

        /// <summary>
        /// Every recorded value of one factor for the patient of a visit, oldest
        /// first — one continuous series across all their visits. This is the single
        /// source of the history panel and its line chart; each point carries its own
        /// date, unit and printed reference range, because those may differ between
        /// labs and must never be compared blindly.
        /// </summary>
        [HttpGet("history")]
        public async Task<IActionResult> History([FromQuery] int? studyID, [FromQuery] int? patientID, [FromQuery] int factorID)
        {
            if (factorID <= 0)
                return BadRequest(new { success = false, message = "فاکتور لازم است." });

            var factor = await _db.ClinicalFactors.AsNoTracking()
                .Where(x => x.FactorID == factorID)
                .Select(x => new
                {
                    x.FactorID, x.FactorCode, x.NameFa, x.NameEn, x.ShortCode,
                    x.DataType, x.UnitUCUM, x.RefLow, x.RefHigh, x.RefText,
                    x.RefSource, x.RefPopulation, x.AbnormalDirection, x.Category
                })
                .FirstOrDefaultAsync();
            if (factor == null)
                return NotFound(new { success = false, message = "فاکتور پیدا نشد." });

            // A saved visit resolves its patient; the new-visit draft passes the
            // selected patient directly because the visit row does not exist yet.
            int resolvedPatientID = patientID ?? 0;
            if (resolvedPatientID <= 0 && studyID.HasValue && studyID.Value > 0)
            {
                resolvedPatientID = await _db.RadiologyStudies.AsNoTracking()
                    .Where(x => x.StudyID == studyID.Value)
                    .Select(x => x.PatientID)
                    .FirstOrDefaultAsync();
            }
            if (resolvedPatientID <= 0)
                return NotFound(new { success = false, message = "مراجعه یا بیمار پیدا نشد." });

            // فقط مراجعاتی که این کاربر مجاز به دیدن است؛ سابقهٔ پزشکان دیگر افشا نمی‌شود.
            var accessibleStudyIDs = _studyAccess.ApplyAccess(_db.RadiologyStudies.AsNoTracking(), User).Select(s => s.StudyID);
            var points = await (
                from v in _db.StudyFactorValues.AsNoTracking()
                join s in _db.RadiologyStudies.AsNoTracking() on v.StudyID equals s.StudyID
                where v.FactorID == factorID && s.PatientID == resolvedPatientID
                    && accessibleStudyIDs.Contains(v.StudyID)
                orderby v.ObservedAt
                select new
                {
                    v.FactorValueID, v.StudyID, StudyDate = s.StudyDate,
                    v.ObservedAt, v.ValueNumber, v.ValueText, v.ValueBit, v.ValueDate,
                    v.UnitText, v.RefText, v.Source, v.ExtractionID, v.Confidence
                }).ToListAsync();

            return Ok(new { success = true, patientID = resolvedPatientID, factor, count = points.Count, points });
        }

        /// <summary>
        /// The patient's factor ledger as a matrix: rows are the measured factors,
        /// columns are the measurement dates, and the crossing cell carries the
        /// latest value of that day plus its unit. This is what the tabular factor
        /// report prints; factors never measured are simply absent.
        /// </summary>
        [HttpGet("matrix")]
        public async Task<IActionResult> Matrix([FromQuery] int patientID)
        {
            if (patientID <= 0)
                return BadRequest(new { success = false, message = "بیمار لازم است." });

            bool patientExists = await _db.Patients.AsNoTracking().AnyAsync(x => x.PatientID == patientID);
            if (!patientExists) return NotFound(new { success = false, message = "بیمار پیدا نشد." });

            // ماتریس روند نیز فقط از مراجعاتِ قابل‌دسترسیِ همین کاربر ساخته می‌شود.
            var accessibleStudyIDs = _studyAccess.ApplyAccess(_db.RadiologyStudies.AsNoTracking(), User).Select(s => s.StudyID);
            var raw = await (
                from v in _db.StudyFactorValues.AsNoTracking()
                join s in _db.RadiologyStudies.AsNoTracking() on v.StudyID equals s.StudyID
                join f in _db.ClinicalFactors.AsNoTracking() on v.FactorID equals f.FactorID
                where s.PatientID == patientID && accessibleStudyIDs.Contains(v.StudyID)
                select new
                {
                    f.FactorID, f.NameFa, f.NameEn, f.ShortCode, f.Category, f.DataType,
                    f.UnitUCUM, f.RefLow, f.RefHigh, f.AbnormalDirection,
                    v.ValueNumber, v.ValueText, v.ValueBit, v.ValueDate, v.ObservedAt,
                    v.UnitText, v.Source
                }).ToListAsync();

            // One cell per factor per day: the latest observation of that day wins.
            var day = raw.GroupBy(x => (x.FactorID, x.ObservedAt.Date));
            var dates = raw.Select(x => x.ObservedAt.Date).Distinct().OrderBy(d => d).ToList();

            var factors = raw
                .GroupBy(x => new { x.FactorID, x.NameFa, x.NameEn, x.ShortCode, x.Category, x.DataType, x.UnitUCUM, x.RefLow, x.RefHigh, x.AbnormalDirection })
                .Select(g =>
                {
                    var cells = new List<object>();
                    foreach (var d in dates)
                    {
                        var cell = day.FirstOrDefault(k => k.Key.FactorID == g.Key.FactorID && k.Key.Date == d);
                        if (cell == null) { cells.Add(new { date = d.ToString("yyyy-MM-dd"), value = (object?)null }); continue; }
                        var latest = cell.OrderByDescending(x => x.ObservedAt).First();
                        object? value = latest.DataType == 2 || latest.DataType == 4
                            ? latest.ValueText
                            : (object?)latest.ValueNumber;
                        cells.Add(new
                        {
                            date = d.ToString("yyyy-MM-dd"),
                            value,
                            valueText = latest.ValueText,
                            valueNumber = latest.ValueNumber,
                            unit = string.IsNullOrWhiteSpace(latest.UnitText) ? latest.UnitUCUM : latest.UnitText,
                            source = latest.Source
                        });
                    }
                    return new
                    {
                        g.Key.FactorID, g.Key.NameFa, g.Key.NameEn, g.Key.ShortCode, g.Key.Category,
                        g.Key.DataType, g.Key.UnitUCUM, g.Key.RefLow, g.Key.RefHigh, g.Key.AbnormalDirection,
                        cells
                    };
                })
                .OrderBy(x => x.Category).ThenBy(x => x.NameFa)
                .ToList();

            return Ok(new
            {
                success = true,
                patientID,
                dates = dates.Select(d => d.ToString("yyyy-MM-dd")).ToList(),
                factors
            });
        }

        /// <summary>
        /// Record or update values in one visit. A row that matches the visit, the
        /// factor and the measurement time is updated instead of duplicated, so the
        /// review screen can keep editing what it shows.
        /// </summary>
        [HttpPost("values")]
        public async Task<IActionResult> Save(SaveValuesRequest request)
        {
            if (request.StudyID <= 0) return BadRequest(new { success = false, message = "مراجعه مشخص نیست." });
            // فقط پزشکی که مراجعه در محدودهٔ دسترسی‌اش است می‌تواند مقدار ثبت کند.
            if (!await _studyAccess.CanAccessStudyAsync(request.StudyID, User)) return Forbid();
            if (request.Items == null || request.Items.Count == 0)
                return BadRequest(new { success = false, message = "هیچ مقداری برای ثبت ارسال نشده است." });

            bool studyExists = await _db.RadiologyStudies.AsNoTracking().AnyAsync(x => x.StudyID == request.StudyID);
            if (!studyExists) return NotFound(new { success = false, message = "مراجعه پیدا نشد." });

            var factorIds = request.Items.Select(x => x.FactorID).Distinct().ToList();
            var factors = await _db.ClinicalFactors.AsNoTracking()
                .Where(x => factorIds.Contains(x.FactorID) && x.IsActive)
                .ToListAsync();
            if (factors.Count != factorIds.Count)
                return BadRequest(new { success = false, message = "یکی از فاکتورها ناشناخته یا غیرفعال است." });

            foreach (var item in request.Items)
            {
                var factor = factors.First(x => x.FactorID == item.FactorID);
                var error = ValidateValue(factor, item);
                if (error != null) return BadRequest(new { success = false, message = error });

                var observedAt = item.ObservedAt ?? DateTime.Now;
                var row = await _db.StudyFactorValues.FirstOrDefaultAsync(x =>
                    x.StudyID == request.StudyID && x.FactorID == item.FactorID && x.ObservedAt == observedAt);

                if (row == null)
                {
                    row = new StudyFactorValue
                    {
                        StudyID = request.StudyID,
                        FactorID = item.FactorID,
                        ObservedAt = observedAt,
                        CreatedDate = DateTime.Now
                    };
                    _db.StudyFactorValues.Add(row);
                }

                row.ValueNumber = factor.DataType == 1 || factor.DataType == 2 ? item.ValueNumber : null;
                row.ValueText = Clean(item.ValueText);
                row.ValueBit = item.ValueBit;
                row.ValueDate = item.ValueDate;
                row.Source = item.Source;
                row.ExtractionID = item.ExtractionID;
                row.Confidence = item.Confidence;
                // What the paper printed outranks the dictionary's default range.
                row.RefText = CleanMax(item.RefText, 500);
                row.UnitText = Clean(item.UnitText);
            }

            await _db.SaveChangesAsync();
            bool computed = await ComputeDerivedAsync(request.StudyID);
            return Ok(new { success = true, saved = request.Items.Count, computed });
        }

        /// <summary>
        /// BMI and eGFR are facts of arithmetic, not of opinion: whenever height
        /// and weight (or creatinine, age and sex) are known, the derived numbers
        /// are stored with Source = 4 (computed) so the panel, the chart and the
        /// AI always carry them. A number a human typed by hand is never touched.
        /// </summary>
        private async Task<bool> ComputeDerivedAsync(int studyID)
        {
            var study = await _db.RadiologyStudies.AsNoTracking()
                .FirstOrDefaultAsync(x => x.StudyID == studyID);
            if (study is null) return false;
            var patient = await _db.Patients.AsNoTracking()
                .FirstOrDefaultAsync(x => x.PatientID == study.PatientID);

            var codes = new[] { "ANTH.HEIGHT", "ANTH.WEIGHT", "ANTH.BMI", "LAB.CREAT", "LAB.EGFR" };
            var factors = await _db.ClinicalFactors.AsNoTracking()
                .Where(x => codes.Contains(x.FactorCode))
                .ToListAsync();
            int Fid(string code) => factors.FirstOrDefault(x => x.FactorCode == code)?.FactorID ?? 0;

            // The latest known measurement of this patient, from any visit.
            decimal? Latest(string code)
            {
                int id = Fid(code);
                if (id == 0) return null;
                return (
                    from v in _db.StudyFactorValues.AsNoTracking()
                    join s in _db.RadiologyStudies.AsNoTracking() on v.StudyID equals s.StudyID
                    where v.FactorID == id && s.PatientID == study.PatientID && v.ValueNumber != null
                    orderby v.ObservedAt descending
                    select v.ValueNumber
                ).FirstOrDefault();
            }

            bool done = false;
            var now = DateTime.Now;

            decimal? heightCm = Latest("ANTH.HEIGHT");
            decimal? weightKg = Latest("ANTH.WEIGHT");
            if (heightCm is > 50m and < 260m && weightKg is > 10m and < 400m && Fid("ANTH.BMI") != 0)
            {
                decimal h = heightCm.Value / 100m;
                if (await UpsertComputedAsync(studyID, Fid("ANTH.BMI"),
                    Math.Round(weightKg.Value / (h * h), 1), now)) done = true;
            }

            // CKD-EPI 2021 (race-free): 142 x (Scr/k)^a x (Scr/k)^-1.2 x 0.9938^age
            // x 1.012 if female; k = 0.7/0.9, a = -0.241/-0.302. Scr in mg/dL.
            decimal? creat = Latest("LAB.CREAT");
            if (creat is > 0.1m and < 15m && patient?.BirthDate != null && Fid("LAB.EGFR") != 0)
            {
                double age = Math.Floor((DateTime.Now - patient!.BirthDate!.Value).TotalDays / 365.25);
                bool female = patient.Gender == 2;
                double scr = (double)creat.Value;
                double k = female ? 0.7 : 0.9;
                double a = female ? -0.241 : -0.302;
                double egfr = 142.0
                    * Math.Pow(Math.Min(scr / k, 1.0), a)
                    * Math.Pow(Math.Max(scr / k, 1.0), -1.200)
                    * Math.Pow(0.9938, age)
                    * (female ? 1.012 : 1.0);
                if (egfr > 0 && egfr < 300 && await UpsertComputedAsync(studyID, Fid("LAB.EGFR"),
                    Math.Round((decimal)egfr, 1), now)) done = true;
            }

            if (done) await _db.SaveChangesAsync();
            return done;
        }

        /// <summary>Writes one derived value; returns true when something changed.</summary>
        private async Task<bool> UpsertComputedAsync(int studyID, int factorID, decimal value, DateTime now)
        {
            var row = await _db.StudyFactorValues.FirstOrDefaultAsync(x =>
                x.StudyID == studyID && x.FactorID == factorID && x.Source == 4);
            if (row != null && row.ValueNumber == value) return false;
            if (row == null)
            {
                row = new StudyFactorValue
                {
                    StudyID = studyID,
                    FactorID = factorID,
                    ObservedAt = now,
                    CreatedDate = now
                };
                _db.StudyFactorValues.Add(row);
            }
            row.ValueNumber = value;
            row.Source = 4;
            return true;
        }

        /// <summary>Remove one recorded value (used when a review step rejects an extraction).</summary>
        [HttpDelete("values/{id:long}")]
        public async Task<IActionResult> DeleteValue(long id)
        {
            var row = await _db.StudyFactorValues.FirstOrDefaultAsync(x => x.FactorValueID == id);
            if (row == null) return NotFound(new { success = false, message = "مقدار مورد نظر پیدا نشد." });

            _db.StudyFactorValues.Remove(row);
            await _db.SaveChangesAsync();
            return Ok(new { success = true });
        }

        private static string? ValidateValue(ClinicalFactor factor, FactorValueItem item)
        {
            var label = factor.NameFa;
            switch (factor.DataType)
            {
                case 1: // number
                    if (!item.ValueNumber.HasValue)
                        return $"مقدار «{label}» باید عدد باشد.";
                    break;
                case 2: // enum: stored as the option's numeric value
                    if (!item.ValueNumber.HasValue)
                        return $"گزینه‌ای برای «{label}» انتخاب نشده است.";
                    break;
                case 3: // boolean
                    if (!item.ValueBit.HasValue)
                        return $"وضعیت «{label}» مشخص نیست.";
                    break;
                case 4: // text
                    if (string.IsNullOrWhiteSpace(item.ValueText))
                        return $"متن «{label}» خالی است.";
                    break;
                case 5: // date
                    if (!item.ValueDate.HasValue)
                        return $"تاریخ «{label}» وارد نشده است.";
                    break;
            }

            if (factor.DataType != 4 && !string.IsNullOrWhiteSpace(item.ValueText) && item.ValueText.Length > 500)
                return $"متن «{label}» بیش از حد مجاز است.";
            return null;
        }

        private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

        /// <summary>Cleaned and cut to the column's width; no silent truncation errors.</summary>
        private static string? CleanMax(string? value, int max)
        {
            string? clean = Clean(value);
            return clean == null || clean.Length <= max ? clean : clean[..max];
        }
    }
}
