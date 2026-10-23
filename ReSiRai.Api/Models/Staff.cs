using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ReSiRai.Api.Models
{
    [Table("tblStaff")]
    public class Staff
    {
        [Key]
        public int StaffID { get; set; }

        [Required, MaxLength(10)]
        public string NationalCode { get; set; } = string.Empty;

        [Required, MaxLength(100)]
        public string FirstName { get; set; } = string.Empty;

        [Required, MaxLength(100)]
        public string LastName { get; set; } = string.Empty;

        // 1 = Employee, 2 = Doctor
        public byte StaffType { get; set; }
        public int? SpecialtyID { get; set; }

        // Referring doctors receive the image link by SMS, so a staff record
        // needs a reachable number. Optional: legacy rows have none.
        [MaxLength(30)]
        public string? Mobile { get; set; }

        // عکسِ پروفایل (اختیاری) — روی داشبورد نمایش داده می‌شود.
        [MaxLength(500)]
        public string? PhotoRelativePath { get; set; }

        public DateTime StartDate { get; set; }
        public DateTime? EndDate { get; set; }
    }
}
