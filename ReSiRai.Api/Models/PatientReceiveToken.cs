using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ReSiRai.Api.Models
{
    /// <summary>
    /// A one-patient QR secret: the secretary shows it, the patient scans it
    /// with the plain camera, and the browser posts the SMS text back.
    ///
    /// No app is installed on the patient's phone - which is the whole point,
    /// since a patient may carry an iPhone - and the patient never sees any
    /// other record than their own.
    /// </summary>
    [Table("tblReceiveTokens")]
    public class PatientReceiveToken
    {
        [Key]
        public int ReceiveID { get; set; }

        public int PatientID { get; set; }

        // وقتی توکن از داخل یک Study ساخته شده باشد، تصاویر به همان Study
        // می‌روند؛ در غیر این صورت تصویر به آخرین Study بیمار وصل می‌شود.
        public int? StudyID { get; set; }

        // 1 = عکسِ رادیولوژی با دوربین گوشی، 2 = دریافتِ لینک/پیامک،
        // 3 = عکسِ چهرهٔ بیمار. توکن‌های قدیمی (پیش از این ستون) پیامک‌اند.
        public short Purpose { get; set; } = 2;

        [Required]
        [MaxLength(64)]
        public string Token { get; set; } = string.Empty;

        public int? CreatedBy { get; set; }

        public DateTime CreatedDate { get; set; }

        public DateTime? ExpiresDate { get; set; }

        public DateTime? LastUsedAt { get; set; }

        public int UseCount { get; set; }
    }
}
