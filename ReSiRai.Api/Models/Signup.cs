using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ReSiRai.Api.Models
{
    // کد تأییدِ شماره موبایل برای ثبت‌نامِ عمومی.
    [Table("tblSignupOtps")]
    public class SignupOtp
    {
        [Key]
        public long SignupOtpID { get; set; }

        [Required, MaxLength(20)]
        public string Mobile { get; set; } = string.Empty;

        [Required, MaxLength(6)]
        public string Code { get; set; } = string.Empty;

        public DateTime RequestedAt { get; set; }
        public DateTime ExpiresAt { get; set; }
        public bool Used { get; set; }
    }

    // اطلاعاتِ پزشکی که کدش تأیید شده ولی هنوز پرداختِ موفق ندارد.
    [Table("tblSignupPendings")]
    public class SignupPending
    {
        [Key]
        public int SignupPendingID { get; set; }

        [Required, MaxLength(20)]
        public string Mobile { get; set; } = string.Empty;

        [Required, MaxLength(100)]
        public string FirstName { get; set; } = string.Empty;

        [Required, MaxLength(100)]
        public string LastName { get; set; } = string.Empty;

        [Required, MaxLength(10)]
        public string NationalCode { get; set; } = string.Empty;

        [Required, MaxLength(500)]
        public string PasswordHash { get; set; } = string.Empty;

        public int SpecialtyID { get; set; }
        public DateTime CreatedAt { get; set; }

        // توکنِ گام دوم (فقط یک بار به کاربرِ همان موبایل برمی‌گردد)
        [MaxLength(64)]
        public string ConfirmToken { get; set; } = string.Empty;

        // «تصاویر روی سرور» یا «روی کامپیوترِ خودم» (ترجیح؛ مسیر نهایی در نسخهٔ نصب‌شده ثبت می‌شود)
        [MaxLength(16)]
        public string StoragePreference { get; set; } = "Server";
    }

    // یک تلاشِ پرداخت: شناسهٔ ثبت‌نام، شناسه‌های درگاه و نتیجه.
    [Table("tblSignupPayments")]
    public class SignupPayment
    {
        [Key]
        public long SignupPaymentID { get; set; }

        public int SignupPendingID { get; set; }

        [Required, MaxLength(64)]
        public string ResNum { get; set; } = string.Empty;

        [MaxLength(128)]
        public string SepToken { get; set; } = string.Empty;

        [MaxLength(64)]
        public string RefNum { get; set; } = string.Empty;

        public int Amount { get; set; }

        public DateTime CreatedAt { get; set; }
        public DateTime? CompletedAt { get; set; }
        public DateTime? SuccessProcessedAt { get; set; }

        [MaxLength(64)]
        public string? FailureReason { get; set; }
    }
}
