using ReSiRai.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ReSiRai.Api.Controllers
{
    [ApiController]
    [Route("api/studytypes")]
    public class StudyTypesController : ControllerBase
    {
        private readonly ReSiRaiDbContext _context;

        public StudyTypesController(ReSiRaiDbContext context)
        {
            _context = context;
        }

        // Returns active Study types for dropdown/combobox controls.
        // The database remains the single source of truth for these values.
        //
        // ?specialtyID= narrows the list to what that specialty actually offers:
        //     the specialty's own types ∪ the shared rows ∪ «سایر»
        // (docs/design/visit-types.md). The shared rows and «سایر» are linked to
        // every specialty, so one join carries the whole rule. Without the
        // parameter the response is unchanged - every active type - which keeps
        // older callers working.
        //
        // Two graceful cases, both returning the full list instead of an almost
        // empty one:
        //   - the specialty is unknown or has no links at all (fresh install,
        //     seed not run yet);
        //   - ... while a type that nobody linked (one just added in the admin
        //     screen) is always shown, so it can never silently vanish.
        [HttpGet]
        public async Task<IActionResult> GetActiveStudyTypes([FromQuery] int? specialtyID = null)
        {
            var query = _context.StudyTypes.AsNoTracking().Where(x => x.IsActive);

            bool filtered = false;
            if (specialtyID.HasValue && specialtyID.Value > 0)
            {
                int sid = specialtyID.Value;
                filtered = await _context.StudyTypeSpecialties.AnyAsync(x => x.SpecialtyID == sid);
                if (filtered)
                {
                    query = query.Where(x =>
                        _context.StudyTypeSpecialties.Any(l => l.StudyTypeID == x.StudyTypeID && l.SpecialtyID == sid)
                        || !_context.StudyTypeSpecialties.Any(l => l.StudyTypeID == x.StudyTypeID));
                }
            }

            var items = await query
                .OrderBy(x => x.StudyTypeName)
                .Select(x => new
                {
                    x.StudyTypeID,
                    x.StudyTypeName
                })
                .ToListAsync();

            return Ok(new
            {
                success = true,
                count = items.Count,
                specialtyID = filtered ? specialtyID : null,
                studyTypes = items
            });
        }
    }
}
