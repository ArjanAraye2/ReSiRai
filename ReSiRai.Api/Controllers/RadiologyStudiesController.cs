using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ReSiRai.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class RadiologyStudiesController : ControllerBase
    {
        private readonly ReSiRaiDbContext _context;
        private readonly StudyAccessService _studyAccess;
        public RadiologyStudiesController(ReSiRaiDbContext context, StudyAccessService studyAccess) { _context = context; _studyAccess = studyAccess; }

        [HttpPost]
        public async Task<IActionResult> CreateStudy(RadiologyStudy study)
        {
            try
            {
                if (study.PatientID <= 0) return BadRequest(new { success=false, message="PatientID must be greater than zero." });
                if (!await _context.Patients.AnyAsync(p=>p.PatientID==study.PatientID)) return NotFound(new { success=false, message="Patient not found." });
                if (study.StudyTypeID <= 0) return BadRequest(new { success=false, message="StudyTypeID is required." });
                if (!await _context.StudyTypes.AnyAsync(t=>t.StudyTypeID==study.StudyTypeID && t.IsActive)) return BadRequest(new { success=false, message="Selected Study type does not exist or is inactive." });
                // «سایر» is a catch-all: its meaning lives in the note written next to it.
                study.StudyTypeNote = NormalizeOptionalText(study.StudyTypeNote);
                if (study.StudyTypeNote?.Length > 500) return BadRequest(new { success=false, message="StudyTypeNote cannot be longer than 500 characters." });

                // Ordinary users may create a Study only inside their permitted Doctor/Clinic scope.
                // Super Admin may also create legacy/test Studies without ownership while migration is unfinished.
                if (!StudyAccessService.IsSuperAdmin(User))
                {
                    if (!study.ClinicID.HasValue || !study.DoctorStaffID.HasValue)
                        return BadRequest(new { success=false, message="ClinicID and DoctorStaffID are required." });
                    if (!await CanCreateForDoctorAsync(study.ClinicID.Value, study.DoctorStaffID.Value))
                        return Forbid();
                }

                var teeth=NormalizeTeeth(study.ToothNumbers); if(teeth==null)return BadRequest(new{success=false,message="One or more FDI tooth numbers are invalid."});
                study.BodyPart=NormalizeOptionalText(study.BodyPart);study.Description=NormalizeOptionalText(study.Description);study.Report=NormalizeOptionalText(study.Report);
                if(study.BodyPart?.Length>100)return BadRequest(new{success=false,message="BodyPart cannot be longer than 100 characters."});
                if(study.Description?.Length>1000)return BadRequest(new{success=false,message="Description cannot be longer than 1000 characters."});
                // Study status: 1 open, 2 completed, 3 needs another study later.
                if (study.Status is < 1 or > 3) study.Status = 2;
                var statusError = ValidateFollowUp(study.Status, study.FollowUpDate, study.FollowUpNote);
                if (statusError != null) return BadRequest(new { success = false, message = statusError });
                study.FollowUpNote = NormalizeOptionalText(study.FollowUpNote);
                if (study.Status != 3) { study.FollowUpDate = null; study.WaitStageID = null; }
                if (study.WaitStageID.HasValue && !await _context.WaitStages.AnyAsync(w => w.WaitStageID == study.WaitStageID.Value && w.IsActive))
                    return BadRequest(new { success = false, message = "مرحله انتظار انتخاب‌شده معتبر نیست." });
                if(study.StudyDate==default)study.StudyDate=DateTime.Now;
                study.StudyID=0;study.CreatedDate=DateTime.Now;study.ModifiedDate=null;
                await using var transaction=await _context.Database.BeginTransactionAsync();
                _context.RadiologyStudies.Add(study);await _context.SaveChangesAsync();
                foreach(var tooth in teeth)_context.RadiologyStudyTeeth.Add(new RadiologyStudyTooth{StudyID=study.StudyID,ToothNumber=(byte)tooth,CreatedDate=DateTime.Now});
                await _context.SaveChangesAsync();await transaction.CommitAsync();
                return Ok(new{success=true,study,toothNumbers=teeth});
            }
            catch(Exception ex){return StatusCode(500,new{success=false,message="Study creation failed.",error=ex.Message});}
        }

        [HttpGet("{studyID:int}")]
        public async Task<IActionResult> GetStudy(int studyID)
        {
            if(studyID<=0)return BadRequest(new{success=false,message="StudyID must be greater than zero."});
            var study=await _studyAccess.ApplyAccess(_context.RadiologyStudies.AsNoTracking(),User).FirstOrDefaultAsync(s=>s.StudyID==studyID);
            // Do not disclose whether a Study exists when the current user has no access to it.
            if(study==null)return NotFound(new{success=false,message="Study not found."});
            var typeName=await _context.StudyTypes.AsNoTracking().Where(t=>t.StudyTypeID==study.StudyTypeID).Select(t=>t.StudyTypeName).FirstOrDefaultAsync();
            var teeth=await _context.RadiologyStudyTeeth.AsNoTracking().Where(x=>x.StudyID==studyID).OrderBy(x=>x.ToothNumber).Select(x=>(int)x.ToothNumber).ToListAsync();
            return Ok(new{success=true,study,studyTypeName=typeName,toothNumbers=teeth});
        }

        [HttpGet("patient/{patientID:int}")]
        public async Task<IActionResult> GetPatientStudies(int patientID)
        {
            if(patientID<=0)return BadRequest(new{success=false,message="PatientID must be greater than zero."});
            if(!await _context.Patients.AsNoTracking().AnyAsync(p=>p.PatientID==patientID))return NotFound(new{success=false,message="Patient not found."});
            var query=_context.RadiologyStudies.AsNoTracking().Where(s=>s.PatientID==patientID);
            var studies=await _studyAccess.ApplyAccess(query,User).OrderByDescending(s=>s.StudyDate).ThenByDescending(s=>s.StudyID).ToListAsync();
            var ids=studies.Select(s=>s.StudyID).ToList();
            var toothRows=await _context.RadiologyStudyTeeth.AsNoTracking().Where(x=>ids.Contains(x.StudyID)).ToListAsync();
            var typeIds=studies.Select(s=>s.StudyTypeID).Distinct().ToList();
            var types=await _context.StudyTypes.AsNoTracking().Where(t=>typeIds.Contains(t.StudyTypeID)).ToDictionaryAsync(t=>t.StudyTypeID,t=>t.StudyTypeName);
            var result=studies.Select(s=>new{s.StudyID,s.PatientID,s.ClinicID,s.DoctorStaffID,s.StudyDate,s.StudyTypeID,StudyTypeName=types.GetValueOrDefault(s.StudyTypeID),s.StudyTypeNote,s.BodyPart,s.Description,s.Report,s.CreatedDate,s.ModifiedDate,s.Status,s.FollowUpDate,s.FollowUpNote,s.WaitStageID,ToothNumbers=toothRows.Where(t=>t.StudyID==s.StudyID).Select(t=>(int)t.ToothNumber).OrderBy(n=>n).ToArray()}).ToList();
            return Ok(new{success=true,patientID,count=result.Count,studies=result});
        }

        [HttpPut("{studyID:int}")]
        public async Task<IActionResult> UpdateStudy(int studyID,UpdateRadiologyStudyRequest request)
        {
            try
            {
                if(studyID<=0)return BadRequest(new{success=false,message="StudyID must be greater than zero."});
                if(request==null)return BadRequest(new{success=false,message="Study information is required."});
                if(!await _studyAccess.CanAccessStudyAsync(studyID,User))return NotFound(new{success=false,message="Study not found."});
                var study=await _context.RadiologyStudies.FirstOrDefaultAsync(s=>s.StudyID==studyID);if(study==null)return NotFound(new{success=false,message="Study not found."});
                if(request.StudyTypeID<=0)return BadRequest(new{success=false,message="StudyTypeID is required."});
                // An existing Study may reference a type that was deactivated later.
                // It may keep that same type while other fields are edited, but users
                // cannot switch to another inactive/nonexistent type.
                bool typeAllowed=await _context.StudyTypes.AnyAsync(t=>t.StudyTypeID==request.StudyTypeID&&(t.IsActive||t.StudyTypeID==study.StudyTypeID));
                if(!typeAllowed)return BadRequest(new{success=false,message="Selected Study type does not exist or is inactive."});
                var teeth=NormalizeTeeth(request.ToothNumbers);if(teeth==null)return BadRequest(new{success=false,message="One or more FDI tooth numbers are invalid."});
                var body=NormalizeOptionalText(request.BodyPart);var desc=NormalizeOptionalText(request.Description);var report=NormalizeOptionalText(request.Report);
                // The note belongs to the «سایر» type; the client clears it by
                // sending null as soon as another type is chosen.
                var typeNote=NormalizeOptionalText(request.StudyTypeNote);
                if(typeNote?.Length>500)return BadRequest(new{success=false,message="StudyTypeNote cannot be longer than 500 characters."});
                if(body?.Length>100)return BadRequest(new{success=false,message="BodyPart cannot be longer than 100 characters."});if(desc?.Length>1000)return BadRequest(new{success=false,message="Description cannot be longer than 1000 characters."});if(request.StudyDate==default)return BadRequest(new{success=false,message="StudyDate is required."});
                await using var transaction=await _context.Database.BeginTransactionAsync();
                                // Study status: 1 open, 2 completed, 3 needs another study later.
                if (request.Status is < 1 or > 3) return BadRequest(new { success = false, message = "وضعیت مطالعه معتبر نیست." });
                var statusError = ValidateFollowUp(request.Status, request.FollowUpDate, request.FollowUpNote);
                if (statusError != null) return BadRequest(new { success = false, message = statusError });
                var followUpNote = NormalizeOptionalText(request.FollowUpNote);
                study.StudyDate=request.StudyDate;study.StudyTypeID=request.StudyTypeID;study.BodyPart=body;study.Description=desc;study.Report=report;study.StudyTypeNote=typeNote;
                study.Status=request.Status;
                // The doctor identifies the specialty, which drives waiting stages.
                if(request.DoctorStaffID.HasValue&&!await _context.Staff.AnyAsync(s=>s.StaffID==request.DoctorStaffID.Value&&s.StaffType==2))
                    return BadRequest(new{success=false,message="دندانپزشک انتخاب‌شده معتبر نیست."});
                study.DoctorStaffID=request.DoctorStaffID;
                // A follow-up date only makes sense for status 3, so it is cleared
                // when the Study is completed or simply open.
                study.FollowUpDate=request.Status==3?request.FollowUpDate:null;
                study.FollowUpNote=followUpNote;
                // A waiting stage only applies while the study is waiting.
                if(request.Status==3){
                    if(request.WaitStageID.HasValue&&!await _context.WaitStages.AnyAsync(w=>w.WaitStageID==request.WaitStageID.Value&&w.IsActive))
                        return BadRequest(new{success=false,message="مرحله انتظار انتخاب‌شده معتبر نیست."});
                    study.WaitStageID=request.WaitStageID;
                } else study.WaitStageID=null;
                study.ModifiedDate=DateTime.Now;
                var old=await _context.RadiologyStudyTeeth.Where(x=>x.StudyID==studyID).ToListAsync();_context.RadiologyStudyTeeth.RemoveRange(old);
                foreach(var tooth in teeth)_context.RadiologyStudyTeeth.Add(new RadiologyStudyTooth{StudyID=studyID,ToothNumber=(byte)tooth,CreatedDate=DateTime.Now});
                await _context.SaveChangesAsync();await transaction.CommitAsync();
                return Ok(new{success=true,study,toothNumbers=teeth,message="Study updated successfully."});
            }
            catch(Exception ex){return StatusCode(500,new{success=false,message="Study update failed.",error=ex.Message});}
        }

        /// <summary>
        /// Status 3 plans a future study, so it must carry a date; without one the
        /// reminder lists would show a follow-up that can never come due.
        /// </summary>
        private static string? ValidateFollowUp(byte status,DateTime? followUpDate,string? followUpNote)
        {
            if(status==3&&!followUpDate.HasValue)return "برای نیاز به مطالعه بعدی، تاریخ پیگیری را وارد کنید.";
            if(followUpDate.HasValue&&followUpDate.Value.Year<2000)return "تاریخ پیگیری معتبر نیست.";
            if(followUpNote?.Trim().Length>500)return "یادداشت پیگیری نمی‌تواند بیشتر از ۵۰۰ نویسه باشد.";
            return null;
        }

        private async Task<bool> CanCreateForDoctorAsync(int clinicID,int doctorStaffID)
        {
            int.TryParse(User.FindFirst("StaffID")?.Value,out int staffID);
            int.TryParse(User.FindFirst("StaffType")?.Value,out int staffType);
            int.TryParse(User.FindFirst("UserID")?.Value,out int userID);
            if(staffType==2)return staffID==doctorStaffID;
            if(staffType==1)return await _context.UserDoctors.AsNoTracking().AnyAsync(x=>x.UserID==userID&&x.ClinicID==clinicID&&x.DoctorStaffID==doctorStaffID);
            return false;
        }

        private static List<int>? NormalizeTeeth(IEnumerable<int>? values){var result=(values??Array.Empty<int>()).Distinct().OrderBy(x=>x).ToList();return result.All(IsValidFdi)?result:null;}
        private static bool IsValidFdi(int n)=>(n>=11&&n<=18)||(n>=21&&n<=28)||(n>=31&&n<=38)||(n>=41&&n<=48)||(n>=51&&n<=55)||(n>=61&&n<=65)||(n>=71&&n<=75)||(n>=81&&n<=85);
        private static string? NormalizeOptionalText(string? value)=>string.IsNullOrWhiteSpace(value)?null:value.Trim();
    }
}
