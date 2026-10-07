using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ReSiRai.Api.Models
{
    [Table("tblRadiologyStudies")]
    public class RadiologyStudy
    {
        [Key]
        public int StudyID { get; set; }

        public int PatientID { get; set; }

        // These two fields are nullable only for legacy Studies created before
        // Clinic/Doctor support was introduced. New Studies will later require them.
        public int? ClinicID { get; set; }
        public int? DoctorStaffID { get; set; }

        public DateTime StudyDate { get; set; }

        // StudyType is now a lookup value stored in tblStudyTypes.
        // The old free-text StudyType column has been removed from SQL Server.
        public int StudyTypeID { get; set; }

        [MaxLength(100)]
        public string? BodyPart { get; set; }

        [MaxLength(1000)]
        public string? Description { get; set; }

        // متنِ «تشخیص»ِ این مراجعه (پیش‌تر با نامِ Report بود؛ نامِ ستون در
        // Database/20261011_StudyDiagnosisWorkEnd.sql به Diagnosis تغییر کرد).
        // برایِ نمایشِ در کارتِ مراجعه، چاپِ اطلاعات و لینکِ اشتراک استفاده می‌شود.
        public string? Diagnosis { get; set; }
        public DateTime CreatedDate { get; set; }
        public DateTime? ModifiedDate { get; set; }

        /// <summary>
        /// 1 = open, 2 = completed, 3 = waiting.
        ///
        /// Studies used to carry no state, so the list could not show which
        /// patients still had work outstanding. "Waiting" covers whatever holds the
        /// patient up; WaitStageID says exactly what.
        /// </summary>
        public byte Status { get; set; } = 2;

        /// <summary>
        /// What the patient is waiting for, for example "آماده شدن عکس" in a
        /// radiology clinic or "آماده شدن پروتز" in a prosthodontics clinic.
        /// Only meaningful when Status is 3.
        /// </summary>
        public int? WaitStageID { get; set; }

        /// <summary>When the user wants to be reminded, used for status 3.</summary>
        public DateTime? FollowUpDate { get; set; }

        [MaxLength(500)]
        public string? FollowUpNote { get; set; }

        /// <summary>
        /// Free text of the «سایر» visit type ("دیگر چه؟"). The type itself lives
        /// in tblStudyTypes, so the text is stored on the visit: only «سایر» has
        /// one, and it explains what the catch-all row cannot.
        /// </summary>
        [MaxLength(500)]
        public string? StudyTypeNote { get; set; }

        /// <summary>
        /// زمانِ پایانِ کار رویِ همین مراجعه (اختیاری). مدتِ کار از همین‌جا
        /// محاسبه می‌شود: WorkEndDate − StudyDate. با دکمهٔ «پایانِ کار» در
        /// نوارِ ابزارِ مراجعه ثبت و بعداً از راهِ ویرایش قابلِ اصلاح است.
        /// </summary>
        public DateTime? WorkEndDate { get; set; }

        // UI/API helper only. Tooth selections are physically stored in
        // tblRadiologyStudyTeeth, not in tblRadiologyStudies.
        [NotMapped]
        public List<int> ToothNumbers { get; set; } = new();
    }
}
