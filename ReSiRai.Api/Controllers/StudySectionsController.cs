using System.Text.Json;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ReSiRai.Api.Controllers
{
    /// <summary>
    /// بخش‌هایِ مراجعه — the tick-first sections of one visit (شکایت و آنامنز،
    /// علائم حیاتی، معاینه، فشارخون، قند، سبک زندگی، غربالگری + سه بخشِ پیوندی و
    /// بخش‌هایِ افزودنی)، همان‌چیزی که docs/design/gp-visit-proto.html روی کاغذ
    /// نشان می‌دهد.
    ///
    /// Reading and recording are visit-scoped: the same StudyAccessService guard
    /// the visit form uses decides who may see or write a section, so a doctor's
    /// sections never leak into another doctor's visits (cookie auth comes from
    /// the global fallback policy in Program.cs, exactly like the other controllers).
    ///
    /// DataJson contract (free-form, owned by the web client — the server never
    /// reads its keys). The client writes one object per section:
    /// {
    ///   "v": 1,                        // schema version, bumped when the shape changes
    ///   "summary": "BMI 23.1",         // one-line badge text shown as "✓ ثبت شد — …"
    ///   "chips":   { "chief": "پیگیری" },      // single-choice chip groups: name -> value
    ///   "checks":  { "base": ["فشارخون","دیابت"] }, // multi-choice checklists: name -> values
    ///   "texts":   { "chiefTxt": "…" },         // free text / dictation fields
    ///   "numbers": { "sys": 120, "bmi": 23.1 }, // numeric + range fields (BMI kept as typed)
    ///   "rows":    [ { "at": "1405/07/15 09:30", "numbers": {…}, "chips": {…},
    ///                  "texts": {…}, "source": "تکرارشده" } ],   // repeatable sections only
    ///   "systems": [ { "name": "قلب", "state": "normal|abnormal", "detail": "…" } ],
    ///   "screen":  { "فشارخون": "انجام شده" },  // screening item -> state
    ///   "links":   ["CBC","ECG"]                // linked sections: selected item names
    /// }
    /// Empty keys are omitted rather than stored as "".
    /// </summary>
    [ApiController]
    [Route("api/studies/{studyID:int}/sections")]
    public class StudySectionsController : ControllerBase
    {
        private readonly ReSiRaiDbContext _db;
        private readonly StudyAccessService _access;

        public StudySectionsController(ReSiRaiDbContext db, StudyAccessService access)
        {
            _db = db;
            _access = access;
        }

        public sealed class SaveSectionRequest
        {
            /// <summary>Stable machine code (anamnesis, vitals, bp, sugar, …).</summary>
            public string? SectionCode { get; set; }
            /// <summary>Title shown in the accordion.</summary>
            public string? Title { get; set; }
            /// <summary>Free-form section payload (must be a JSON object).</summary>
            public JsonElement Data { get; set; }
        }

        /// <summary>All recorded sections of one visit, oldest first.</summary>
        [HttpGet]
        public async Task<IActionResult> Get(int studyID)
        {
            if (!await CanAccess(studyID))
                return NotFound(new { success = false, message = "مراجعه پیدا نشد." });

            var rows = await _db.StudySections.AsNoTracking()
                .Where(x => x.StudyID == studyID)
                .OrderBy(x => x.StudySectionID)
                .ToListAsync();

            return Ok(new
            {
                success = true,
                studyID,
                count = rows.Count,
                sections = rows.Select(Shape).ToList()
            });
        }

        /// <summary>
        /// Record one section. A section already recorded for this visit is
        /// replaced in place (ModifiedDate is stamped) — confirming again never
        /// creates a second row, which is what the unique index on
        /// (StudyID, SectionCode) is there for.
        /// </summary>
        [HttpPost]
        public async Task<IActionResult> Upsert(int studyID, SaveSectionRequest request)
        {
            if (!await CanAccess(studyID))
                return NotFound(new { success = false, message = "مراجعه پیدا نشد." });

            string? codeError = ValidateCode(request.SectionCode);
            if (codeError != null) return BadRequest(new { success = false, message = codeError });

            string title = (request.Title ?? string.Empty).Trim();
            if (title.Length == 0)
                return BadRequest(new { success = false, message = "عنوانِ بخش لازم است." });
            if (title.Length > 150) title = title[..150];

            if (request.Data.ValueKind != JsonValueKind.Object)
                return BadRequest(new { success = false, message = "دادهٔ بخش باید یک شیءِ JSON باشد." });
            string dataJson = request.Data.GetRawText();

            string code = request.SectionCode!.Trim();
            var row = await _db.StudySections
                .FirstOrDefaultAsync(x => x.StudyID == studyID && x.SectionCode == code);

            bool created = row == null;
            if (row == null)
            {
                row = new StudySection
                {
                    StudyID = studyID,
                    SectionCode = code,
                    Title = title,
                    DataJson = dataJson,
                    RecordedAt = DateTime.Now,
                    ModifiedDate = null
                };
                _db.StudySections.Add(row);
            }
            else
            {
                row.Title = title;
                row.DataJson = dataJson;
                row.ModifiedDate = DateTime.Now;
            }

            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException e)
            {
                // Two clicks racing on the same section must not produce two rows:
                // the unique index decides, and the caller is told what SQL said.
                _db.Entry(row).State = EntityState.Detached;
                return BadRequest(new
                {
                    success = false,
                    message = "ذخیرهٔ بخش ناموفق بود: " + (e.InnerException?.Message ?? e.Message)
                });
            }

            return Ok(new { success = true, created, section = Shape(row) });
        }

        /// <summary>Drop one recorded section (the tick was a mistake).</summary>
        [HttpDelete]
        public async Task<IActionResult> Delete(int studyID, [FromQuery] string? sectionCode)
        {
            if (!await CanAccess(studyID))
                return NotFound(new { success = false, message = "مراجعه پیدا نشد." });

            string code = (sectionCode ?? string.Empty).Trim();
            if (code.Length == 0)
                return BadRequest(new { success = false, message = "کدِ بخش لازم است." });

            var row = await _db.StudySections
                .FirstOrDefaultAsync(x => x.StudyID == studyID && x.SectionCode == code);
            if (row == null)
                return NotFound(new { success = false, message = "بخشِ مورد نظر پیدا نشد." });

            _db.StudySections.Remove(row);
            await _db.SaveChangesAsync();
            return Ok(new { success = true });
        }

        private Task<bool> CanAccess(int studyID) =>
            studyID > 0 ? _access.CanAccessStudyAsync(studyID, User) : Task.FromResult(false);

        private static string? ValidateCode(string? sectionCode)
        {
            string code = (sectionCode ?? string.Empty).Trim();
            if (code.Length == 0) return "کدِ بخش لازم است.";
            if (code.Length > 60) return "کدِ بخش نمی‌تواند بیش از ۶۰ نویسه باشد.";
            return null;
        }

        /// <summary>Row as the API sees it; a broken stored payload degrades to {}.</summary>
        private static object Shape(StudySection row) => new
        {
            studySectionID = row.StudySectionID,
            sectionCode = row.SectionCode,
            title = row.Title,
            data = ParseObject(row.DataJson),
            recordedAt = row.RecordedAt,
            modifiedDate = row.ModifiedDate
        };

        private static JsonElement ParseObject(string json)
        {
            string fallback = "{}";
            if (!string.IsNullOrWhiteSpace(json))
            {
                try
                {
                    using var doc = JsonDocument.Parse(json);
                    if (doc.RootElement.ValueKind == JsonValueKind.Object)
                        return doc.RootElement.Clone(); // detached from the document
                }
                catch (JsonException)
                {
                    // stored payload is not readable JSON -> serve {} instead of failing the list
                }
            }
            using var empty = JsonDocument.Parse(fallback);
            return empty.RootElement.Clone();
        }
    }
}
