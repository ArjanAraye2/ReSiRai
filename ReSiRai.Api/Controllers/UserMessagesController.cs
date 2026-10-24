using System.Security.Claims;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ReSiRai.Api.Controllers
{
    // ============================================================
    // مرکز پیام — فقط کاربر ↔ مدیریت.
    //
    // قاعدهٔ سخت: یک کاربرِ عادی هرگز پیامِ کاربرِ دیگری را نمی‌بیند و
    // نمی‌تواند به کسی جز مدیریت پیام بدهد. مدیریت همهٔ گفتگوها را می‌بیند
    // و به هر کاربر پاسخ می‌دهد. شناسهٔ مدیریت ۰ است (حساب SuperAdmin در
    // tblUsers ردیف ندارد).
    // ============================================================
    [ApiController]
    [Route("api/messages")]
    public sealed class UserMessagesController : ControllerBase
    {
        private const int AdminUserID = 0;

        private readonly ReSiRaiDbContext _db;
        private readonly AppEventLogger _events;

        public UserMessagesController(ReSiRaiDbContext db, AppEventLogger events)
        {
            _db = db;
            _events = events;
        }

        public sealed record SendRequest(int? ToUserID, string? Body, long? ReplyToMessageID);

        private bool IsAdmin =>
            string.Equals(User.FindFirstValue("IsSuperAdmin"), "true", StringComparison.OrdinalIgnoreCase);

        private int Me =>
            int.TryParse(User.FindFirstValue("UserID"), out int id) ? id : -1;

        // ------------------------------------------------------------
        // فهرست گفتگوها (کاربر: فقط گفتگو با مدیریت؛ مدیر: همهٔ کاربران)
        // ------------------------------------------------------------
        [HttpGet("threads")]
        public async Task<IActionResult> Threads(CancellationToken cancellationToken)
        {
            int me = Me;
            if (me < 0) return Unauthorized();

            if (IsAdmin)
            {
                var messages = await _db.UserMessages.AsNoTracking()
                    .Where(m => m.SenderUserID == AdminUserID || m.RecipientUserID == AdminUserID)
                    .ToListAsync(cancellationToken);

                var groups = messages
                    .Where(m => m.SenderUserID != m.RecipientUserID)
                    .GroupBy(m => m.SenderUserID == AdminUserID ? m.RecipientUserID : m.SenderUserID)
                    .Where(g => g.Key > 0)
                    .Select(g => new
                    {
                        UserID = g.Key,
                        Last = g.OrderByDescending(m => m.MessageID).First(),
                        Unread = g.Count(m => m.RecipientUserID == AdminUserID && m.ReadAt == null)
                    })
                    .OrderByDescending(x => x.Unread)
                    .ThenByDescending(x => x.Last.MessageID)
                    .ToList();

                var ids = groups.Select(g => g.UserID).ToList();
                var users = await (from u in _db.Users.AsNoTracking()
                                   join s in _db.Staff.AsNoTracking() on u.StaffID equals s.StaffID
                                   where ids.Contains(u.UserID)
                                   select new { u.UserID, s.FirstName, s.LastName, s.NationalCode, s.StaffType })
                    .ToListAsync(cancellationToken);
                var byID = users.ToDictionary(x => x.UserID);

                var conversations = groups.Select(g =>
                {
                    byID.TryGetValue(g.UserID, out var u);
                    string label = u == null ? $"کاربر #{g.UserID}" : $"{u.FirstName} {u.LastName}".Trim();
                    if (string.IsNullOrWhiteSpace(label)) label = u?.NationalCode ?? $"کاربر #{g.UserID}";
                    return new
                    {
                        userID = g.UserID,
                        label,
                        role = u?.StaffType == 2 ? "doctor" : "staff",
                        roleLabel = u?.StaffType == 2 ? "پزشک" : "کارمند",
                        nationalCode = u?.NationalCode ?? "",
                        lastMessage = g.Last.Body,
                        lastDate = g.Last.CreatedDate,
                        lastFromAdmin = g.Last.SenderUserID == AdminUserID,
                        unread = g.Unread
                    };
                }).ToList();

                int unreadTotal = await _db.UserMessages.AsNoTracking()
                    .CountAsync(m => m.RecipientUserID == AdminUserID && m.ReadAt == null, cancellationToken);
                return Ok(new { success = true, isAdmin = true, me, unread = unreadTotal, conversations });
            }
            else
            {
                var mine = await _db.UserMessages.AsNoTracking()
                    .Where(m => (m.SenderUserID == me && m.RecipientUserID == AdminUserID)
                             || (m.SenderUserID == AdminUserID && m.RecipientUserID == me))
                    .OrderByDescending(m => m.MessageID)
                    .ToListAsync(cancellationToken);

                var conversations = new List<object>();
                if (mine.Count > 0)
                {
                    var last = mine[0];
                    conversations.Add(new
                    {
                        userID = AdminUserID,
                        label = "مدیریت رسیرای",
                        role = "admin",
                        roleLabel = "مدیریت",
                        nationalCode = "",
                        lastMessage = last.Body,
                        lastDate = last.CreatedDate,
                        lastFromAdmin = last.SenderUserID == AdminUserID,
                        unread = mine.Count(m => m.RecipientUserID == me && m.SenderUserID == AdminUserID && m.ReadAt == null)
                    });
                }

                int unreadTotal = await _db.UserMessages.AsNoTracking()
                    .CountAsync(m => m.RecipientUserID == me && m.SenderUserID == AdminUserID && m.ReadAt == null, cancellationToken);
                return Ok(new { success = true, isAdmin = false, me, unread = unreadTotal, conversations });
            }
        }

        // ------------------------------------------------------------
        // یک گفتگو + علامت‌زدنِ پیام‌های دریافتی به‌عنوان خوانده‌شده
        // ------------------------------------------------------------
        [HttpGet("thread")]
        public async Task<IActionResult> Thread([FromQuery] int? withUserID, CancellationToken cancellationToken)
        {
            int me = Me;
            if (me < 0) return Unauthorized();

            int target = IsAdmin ? (withUserID ?? 0) : AdminUserID;
            if (IsAdmin && target <= 0)
                return BadRequest(new { success = false, message = "ابتدا یک کاربر را انتخاب کنید." });

            string userLabel = "";
            if (IsAdmin)
            {
                var user = await (from u in _db.Users.AsNoTracking()
                                  join s in _db.Staff.AsNoTracking() on u.StaffID equals s.StaffID
                                  where u.UserID == target && u.IsActive
                                  select new { s.FirstName, s.LastName, s.NationalCode })
                    .FirstOrDefaultAsync(cancellationToken);
                if (user == null)
                    return NotFound(new { success = false, message = "کاربر پیدا نشد." });
                userLabel = $"{user.FirstName} {user.LastName}".Trim();
                if (string.IsNullOrWhiteSpace(userLabel)) userLabel = user.NationalCode;
            }
            else
            {
                userLabel = User.FindFirstValue("FirstName") is string fn && !string.IsNullOrWhiteSpace(fn)
                    ? $"{fn} {User.FindFirstValue("LastName")}".Trim()
                    : User.Identity?.Name ?? "کاربر";
            }

            // خوانده‌شدنِ پیام‌های دریافتی (بدونِ تغییر در پیام‌های خودم).
            var incoming = await _db.UserMessages
                .Where(m => m.SenderUserID == target && m.RecipientUserID == me && m.ReadAt == null)
                .ToListAsync(cancellationToken);
            if (incoming.Count > 0)
            {
                foreach (var m in incoming) m.ReadAt = DateTime.Now;
                await _db.SaveChangesAsync(cancellationToken);
            }

            var messages = await _db.UserMessages.AsNoTracking()
                .Where(m => (m.SenderUserID == me && m.RecipientUserID == target)
                         || (m.SenderUserID == target && m.RecipientUserID == me))
                .OrderBy(m => m.MessageID)
                .ToListAsync(cancellationToken);

            var replyIDs = messages.Where(m => m.ReplyToMessageID.HasValue)
                .Select(m => m.ReplyToMessageID!.Value).Distinct().ToList();
            var replies = replyIDs.Count == 0
                ? new Dictionary<long, UserMessage>()
                : await _db.UserMessages.AsNoTracking()
                    .Where(m => replyIDs.Contains(m.MessageID))
                    .ToDictionaryAsync(m => m.MessageID, cancellationToken);

            var items = messages.Select(m =>
            {
                UserMessage? parent = null;
                if (m.ReplyToMessageID.HasValue) replies.TryGetValue(m.ReplyToMessageID.Value, out parent);
                return new
                {
                    messageID = m.MessageID,
                    body = m.Body,
                    createdDate = m.CreatedDate,
                    mine = m.SenderUserID == me,
                    senderLabel = m.SenderUserID == AdminUserID ? "مدیریت رسیرای" : userLabel,
                    read = m.ReadAt != null,
                    replyTo = parent == null ? null : new
                    {
                        messageID = parent.MessageID,
                        senderLabel = parent.SenderUserID == AdminUserID ? "مدیریت رسیرای" : userLabel,
                        body = parent.Body.Length > 160 ? parent.Body[..160] + "…" : parent.Body
                    }
                };
            }).ToList();

            int unread = await _db.UserMessages.AsNoTracking()
                .CountAsync(m => m.RecipientUserID == me && m.SenderUserID == target && m.ReadAt == null, cancellationToken);

            return Ok(new
            {
                success = true,
                isAdmin = IsAdmin,
                me,
                targetUserID = target,
                title = IsAdmin ? userLabel : "مدیریت رسیرای",
                roleLabel = IsAdmin ? "" : "مدیریت",
                unread,
                messages = items
            });
        }

        // ------------------------------------------------------------
        // ارسال پیام
        // ------------------------------------------------------------
        [HttpPost]
        public async Task<IActionResult> Send(SendRequest request, CancellationToken cancellationToken)
        {
            int me = Me;
            if (me < 0) return Unauthorized();

            string body = (request.Body ?? string.Empty).Trim();
            if (body.Length == 0)
                return BadRequest(new { success = false, message = "متن پیام را بنویسید." });
            if (body.Length > 2000)
                return BadRequest(new { success = false, message = "پیام حداکثر ۲۰۰۰ نویسه است." });

            int recipient;
            if (IsAdmin)
            {
                recipient = request.ToUserID ?? 0;
                if (recipient <= 0)
                    return BadRequest(new { success = false, message = "گیرنده را انتخاب کنید." });
                bool exists = await _db.Users.AsNoTracking()
                    .AnyAsync(x => x.UserID == recipient && x.IsActive, cancellationToken);
                if (!exists)
                    return BadRequest(new { success = false, message = "کاربر پیدا نشد یا غیرفعال است." });
            }
            else
            {
                // کاربرِ عادی فقط و فقط به مدیریت پیام می‌دهد.
                recipient = AdminUserID;
            }

            long? replyTo = null;
            if (request.ReplyToMessageID is > 0)
            {
                var parent = await _db.UserMessages.AsNoTracking()
                    .FirstOrDefaultAsync(m => m.MessageID == request.ReplyToMessageID.Value, cancellationToken);
                bool sameThread = parent != null &&
                    ((parent.SenderUserID == me && parent.RecipientUserID == recipient) ||
                     (parent.SenderUserID == recipient && parent.RecipientUserID == me));
                if (sameThread) replyTo = parent!.MessageID;
            }

            var message = new UserMessage
            {
                SenderUserID = me,
                RecipientUserID = recipient,
                Body = body,
                ReplyToMessageID = replyTo,
                CreatedDate = DateTime.Now
            };
            _db.UserMessages.Add(message);
            await _db.SaveChangesAsync(cancellationToken);

            // محتوای پیام لاگ نمی‌شود؛ فقط شناسه‌ها برای پیگیری.
            await _events.LogAsync("Message", "ok",
                $"from={me}; to={recipient}; id={message.MessageID}",
                userID: me, userName: User.Identity?.Name);

            return Ok(new { success = true, messageID = message.MessageID, createdDate = message.CreatedDate });
        }

        // ------------------------------------------------------------
        // شمارِ خوانده‌نشده‌ها (نشانِ منو)
        // ------------------------------------------------------------
        [HttpGet("unread")]
        public async Task<IActionResult> Unread(CancellationToken cancellationToken)
        {
            int me = Me;
            if (me < 0) return Unauthorized();
            int unread = IsAdmin
                ? await _db.UserMessages.AsNoTracking()
                    .CountAsync(m => m.RecipientUserID == AdminUserID && m.ReadAt == null, cancellationToken)
                : await _db.UserMessages.AsNoTracking()
                    .CountAsync(m => m.RecipientUserID == me && m.SenderUserID == AdminUserID && m.ReadAt == null, cancellationToken);
            return Ok(new { success = true, unread });
        }

        // ------------------------------------------------------------
        // جست‌وجوی کاربران برای شروعِ گفتگوی تازه (فقط مدیر)
        // ------------------------------------------------------------
        [HttpGet("contacts")]
        public async Task<IActionResult> Contacts([FromQuery] string? search, CancellationToken cancellationToken)
        {
            if (!IsAdmin) return Forbid();

            string term = (search ?? string.Empty).Trim();
            var query = from u in _db.Users.AsNoTracking()
                        join s in _db.Staff.AsNoTracking() on u.StaffID equals s.StaffID
                        where u.IsActive && u.UserID > 0
                        select new { u.UserID, s.FirstName, s.LastName, s.NationalCode, s.StaffType };

            if (term.Length > 0)
            {
                query = query.Where(x =>
                    (x.FirstName + " " + x.LastName).Contains(term) ||
                    x.NationalCode.Contains(term));
            }

            var rows = await query
                .OrderBy(x => x.LastName).ThenBy(x => x.FirstName)
                .Take(20)
                .ToListAsync(cancellationToken);

            var contacts = rows.Select(x => new
            {
                userID = x.UserID,
                label = string.IsNullOrWhiteSpace($"{x.FirstName} {x.LastName}".Trim())
                    ? x.NationalCode
                    : $"{x.FirstName} {x.LastName}".Trim(),
                nationalCode = x.NationalCode,
                roleLabel = x.StaffType == 2 ? "پزشک" : "کارمند"
            }).ToList();

            return Ok(new { success = true, contacts });
        }
    }
}
