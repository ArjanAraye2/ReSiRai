using System.ComponentModel.DataAnnotations;

namespace ReSiRai.Api.Models
{
    public sealed class CommunicationChannelSettings
    {
        public string SmsProvider { get; set; } = "Kavenegar";
        public string SmsApiUrl { get; set; } = "https://api.kavenegar.com/v1";
        public string SmsApiKey { get; set; } = string.Empty;
        public string SmsSender { get; set; } = string.Empty;
        public string SmsOtpTemplate { get; set; } = string.Empty;
        public bool SmsEnabled { get; set; }

        // شمارهٔ مطب: بیمار پیامک رادیولوژیست را به همین شماره فوروارد می‌کند.
        // فقط برای نمایش به منشی است؛ ارسال از همان مسیر پیامک انجام می‌شود.
        public string ClinicMobile { get; set; } = string.Empty;

        public string SepTerminalId { get; set; } = string.Empty;
        public bool SepEnabled { get; set; }

        public bool PushEnabled { get; set; }
        public bool EmailEnabled { get; set; }
        public bool WhatsAppEnabled { get; set; }
        public bool TelegramEnabled { get; set; }
    }

    public sealed class SendSmsRequest
    {
        public int? PatientID { get; set; }
        [Required, MaxLength(100)]
        public string Mobile { get; set; } = string.Empty;
        [Required, MaxLength(2000)]
        public string Message { get; set; } = string.Empty;
    }
}
