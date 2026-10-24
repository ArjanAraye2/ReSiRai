using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ReSiRai.Api.Models
{
    /// <summary>
    /// پیامِ مرکز پیام. هر گفتگو فقط بین یک کاربرِ عادی و «مدیریت» است؛
    /// شناسهٔ مدیریت ۰ است (حسابِ SuperAdmin در tblUsers ردیف ندارد).
    /// </summary>
    [Table("tblUserMessages")]
    public class UserMessage
    {
        [Key]
        public long MessageID { get; set; }

        public int SenderUserID { get; set; }

        public int RecipientUserID { get; set; }

        [Required, MaxLength(2000)]
        public string Body { get; set; } = string.Empty;

        public long? ReplyToMessageID { get; set; }

        public DateTime CreatedDate { get; set; }

        public DateTime? ReadAt { get; set; }
    }
}
