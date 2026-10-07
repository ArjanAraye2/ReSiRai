namespace ReSiRai.Api.Models
{
    // Data sent by the Frontend when an existing Study is edited.
    // PatientID is intentionally absent: a Study cannot be moved to another
    // patient through ordinary editing; patient transfer is handled by Merge.
    public class UpdateRadiologyStudyRequest
    {
        public DateTime StudyDate { get; set; }

        // Foreign key to tblStudyTypes. The Backend verifies that the selected
        // type exists and is active before updating the Study.
        public int StudyTypeID { get; set; }

        public string? BodyPart { get; set; }
        public string? Description { get; set; }

        /// <summary>متنِ تشخیصِ مراجعه (پیش‌تر Report نامیده می‌شد).</summary>
        public string? Diagnosis { get; set; }

        /// <summary>
        /// زمانِ پایانِ کار؛ null یعنی هنوز ثبت نشده یا از فرم پاک شده است.
        /// </summary>
        public DateTime? WorkEndDate { get; set; }

        // FDI numbers selected in the odontogram. Empty means no teeth selected.
        public List<int> ToothNumbers { get; set; } = new();

        /// <summary>1 = open, 2 = completed, 3 = waiting.</summary>
        public byte Status { get; set; } = 2;

        /// <summary>What the patient is waiting for, when Status is 3.</summary>
        public int? WaitStageID { get; set; }

        /// <summary>
        /// The doctor who owns the study. Their specialty decides which waiting
        /// stages are offered.
        /// </summary>
        public int? DoctorStaffID { get; set; }

        /// <summary>Required when Status is 3, so a reminder always has a date.</summary>
        public DateTime? FollowUpDate { get; set; }

        public string? FollowUpNote { get; set; }

        /// <summary>
        /// The free text of the «سایر» visit type. The client sends null for any
        /// other type, so switching away from «سایر» clears the old text.
        /// </summary>
        public string? StudyTypeNote { get; set; }
    }
}
