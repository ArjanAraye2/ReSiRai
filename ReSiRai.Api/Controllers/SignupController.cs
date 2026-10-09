using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;

namespace ReSiRai.Api.Controllers;

// ثبت‌نامِ عمومیِ پزشک همزمان با خریدِ اکانت (درگاهِ شاپرک/SEP).
//
// جریان:
//   ۱) POST signup/otp/request  → کد به موبایل می‌رود (کاوه‌نگار) و موقتاً ثبت می‌شود.
//   ۲) POST signup/otp/verify   → کد درست بود → ثبتِ اطلاعاتِ پزشکِ آینده (بدون ایجاد حساب).
//   ۳) POST signup/payment/start → توکنِ پرداخت از SEP گرفته و شناسهٔ ثبت‌نام موقت را می‌بندد.
//   ۴) callback از درگاه برمی‌گردد → استعلامِ تأیید از خودِ درگاه (نه فقط کال‌کک مرورگر)؛
//      در یک تراکنش: tblSignupPayments + tblStaff (پزشک، پزشکی عمومی) + tblUsers (کدِ ملی، رمزِ انتخابی).
//      دو بارِ خواندنِ callback دوباره حساب نمی‌سازد (idempotent با RefNum).
//   ۵) پیامکِ خوش‌آمد + نامِ کاربر (= کدِ ملی) به موبایل می‌رود.
//
// بدون پرداختِ تأییدشده هیچ حسابی ساخته نمی‌شود. هیچ endpointٔ مدیریتی اینجا نیست.
[ApiController]
[Route("api/signup")]
public class SignupController : ControllerBase
{
    private readonly ReSiRaiDbContext _db;
    private readonly IPasswordHasher<User> _hasher;
    private readonly ICommunicationService _sms;
    private readonly IConfiguration _config;
    private readonly ILogger<SignupController> _log;

    public SignupController(ReSiRaiDbContext db, IPasswordHasher<User> hasher, ICommunicationService sms, IConfiguration config, ILogger<SignupController> log)
    {
        _db = db; _hasher = hasher; _sms = sms; _config = config; _log = log;
    }

    private static string NormalizeMobile(string? mobile)
    {
        var m = new string((mobile ?? "").Where(char.IsDigit).ToArray());
        if (m.StartsWith("00989") && m.Length >= 14) m = "0" + m.Substring(4);
        else if (m.StartsWith("989") && m.Length == 12) m = "0" + m.Substring(2);
        else if (m.StartsWith("9") && m.Length == 10) m = "0" + m;
        return m;
    }

    private IActionResult Redirect(string status)
    {
        var resultBase = _config["Payments:PublicBaseUrl"];
        if (string.IsNullOrWhiteSpace(resultBase))
            resultBase = $"{Request.Scheme}://{Request.Host}";
        return RedirectPermanent(resultBase.TrimEnd('/') + "/signup.html?status=" + Uri.EscapeDataString(status));
    }

    // ==== ۱) درخواستِ کد تأیید ==================================================
    public sealed class OtpRequestRequest { public string Mobile { get; set; } = ""; }

    [HttpPost("otp/request")]
    [AllowAnonymous]
    public async Task<IActionResult> RequestOtp(OtpRequestRequest request, CancellationToken ct)
    {
        var mobile = NormalizeMobile(request.Mobile);
        if (string.IsNullOrWhiteSpace(mobile) || mobile.Length < 10)
            return BadRequest(new { success = false, message = "شماره موبایل معتبر نیست." });

        // جلوگیری از ارسالِ زیاد: بیش از ۵ درخواست در ۱۰ دقیقه از یک شماره
        var tenMinAgo = DateTime.UtcNow.AddMinutes(-10);
        var recent = await _db.SignupOtps.AsNoTracking()
            .Where(x => x.Mobile == mobile && x.RequestedAt >= tenMinAgo)
            .CountAsync(ct);
        if (recent >= 5) return StatusCode(429, new { success = false, message = "کد زیاد درخواست شده؛ کمی بعد دوباره تلاش کنید." });

        var code = Random.Shared.Next(100000, 999999).ToString();
        _db.SignupOtps.Add(new SignupOtp { Mobile = mobile, Code = code, RequestedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddMinutes(5), Used = false });
        await _db.SaveChangesAsync(ct);

        try
        {
            await _sms.SendSmsAsync(mobile, $"کد ثبت نام رسیرای: {code}\nاعتبار: ۵ دقیقه");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "ارسال کد ثبت‌نام شکست خورد: {Mobile}", mobile);
            return StatusCode(503, new { success = false, message = "ارسال پیامک ممکن نشد؛ کمی بعد تلاش کنید." });
        }
        return Ok(new { success = true, message = "کد ارسال شد." });
    }

    // ==== ۲) تأیید کد + ثبت موقت اطلاعات پزشک ===================================
    public sealed class VerifyRequest { public string Mobile { get; set; } = ""; public string Code { get; set; } = ""; }

    // گامِ اول: فقط کد تأیید — یک ردیفِ موقت با توکنِ گام دوم می‌سازد.
    [HttpPost("otp/verify")]
    [AllowAnonymous]
    public async Task<IActionResult> Verify(VerifyRequest request, CancellationToken ct)
    {
        var mobile = NormalizeMobile(request.Mobile);
        var otp = await _db.SignupOtps
            .Where(x => x.Mobile == mobile && !x.Used && x.ExpiresAt >= DateTime.UtcNow)
            .OrderByDescending(x => x.RequestedAt)
            .FirstOrDefaultAsync(ct);
        if (otp == null || otp.Code != request.Code?.Trim())
            return BadRequest(new { success = false, message = "کد نادرست یا منقضی است." });

        otp.Used = true;

        // کد تأیید شد → ردیفِ موقتِ این موبایل
        var pending = await _db.SignupPendings.FirstOrDefaultAsync(x => x.Mobile == mobile && x.NationalCode == "0000000000", ct);
        var confirmToken = Guid.NewGuid().ToString("N");
        if (pending == null)
        {
            pending = new SignupPending { Mobile = mobile, NationalCode = "0000000000", FirstName = "-", LastName = "-", PasswordHash = "-", SpecialtyID = 0, CreatedAt = DateTime.UtcNow };
            _db.SignupPendings.Add(pending);
        }
        pending.ConfirmToken = confirmToken;
        await _db.SaveChangesAsync(ct);

        var token = Convert.ToBase64String(BitConverter.GetBytes(pending.SignupPendingID))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        return Ok(new { success = true, signupToken = token, signature = confirmToken });
    }

    // گامِ دوم: مشخصات ( با توکنِ گام اول) — تا پرداخت هیچ حسابی ساخته نمی‌شود.
    public sealed class DetailsRequest
    {
        public string SignupToken { get; set; } = "";
        public string Signature { get; set; } = "";
        public string FirstName { get; set; } = "";
        public string LastName { get; set; } = "";
        public string NationalCode { get; set; } = "";
        public string Password { get; set; } = "";
        public string StoragePreference { get; set; } = "Server";
        public int? SpecialtyID { get; set; }
    }

    [HttpPost("details")]
    [AllowAnonymous]
    public async Task<IActionResult> SaveDetails(DetailsRequest request, CancellationToken ct)
    {
        var pendingID = DecodeSignupToken(request.SignupToken);
        if (pendingID <= 0 || string.IsNullOrWhiteSpace(request.Signature))
            return BadRequest(new { success = false, message = "درخواست یافت نشد؛ از اول شروع کنید." });

        var pending = await _db.SignupPendings.FirstOrDefaultAsync(x => x.SignupPendingID == pendingID, ct);
        if (pending == null || pending.ConfirmToken != request.Signature)
            return BadRequest(new { success = false, message = "درخواست یافت نشد؛ از اول شروع کنید." });

        var nc = (request.NationalCode ?? "").Trim();
        if (nc.Length != 10 || !IranianNationalCodeValidator.IsValid(nc))
            return BadRequest(new { success = false, message = "کد ملی معتبر نیست." });
        var firstName = (request.FirstName ?? "").Trim();
        var lastName = (request.LastName ?? "").Trim();
        if (firstName.Length == 0 || lastName.Length == 0)
            return BadRequest(new { success = false, message = "نام و نام خانوادگی لازم است." });
        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 8)
            return BadRequest(new { success = false, message = "رمز باید دست‌کم ۸ نویسه باشد." });
        if (await _db.Staff.AnyAsync(x => x.NationalCode == nc, ct))
            return BadRequest(new { success = false, message = "این کد ملی قبلاً در رسیرای ثبت شده؛ از «بازیابی رمز» استفاده کنید." });

        // رشته: انتخابِ کاربر یا پیش‌فرض «پزشکی عمومی»
        int specialtyID = request.SpecialtyID ?? 0;
        if (specialtyID <= 0)
            specialtyID = await _db.Specialties.AsNoTracking()
                .Where(x => x.IsActive && x.SpecialtyName!.Contains("پزشکی عمومی"))
                .Select(x => (int?)x.SpecialtyID)
                .FirstOrDefaultAsync(ct) ?? 0;
        else
        {
            var ok = await _db.Specialties.AnyAsync(x => x.SpecialtyID == specialtyID && x.IsActive, ct);
            if (!ok) return BadRequest(new { success = false, message = "رشتهٔ انتخابی معتبر نیست." });
        }

        // ردیف‌های قدیمیِ همان کد ملی را بریز (mosaul فقط آخرین معتبر است)
        var olds = await _db.SignupPendings.Where(x => x.NationalCode == nc && x.SignupPendingID != pendingID).ToListAsync(ct);
        _db.SignupPendings.RemoveRange(olds);

        pending.FirstName = firstName;
        pending.LastName = lastName;
        pending.NationalCode = nc;
        pending.PasswordHash = _hasher.HashPassword(new User { UserName = nc }, request.Password);
        pending.SpecialtyID = specialtyID;
        pending.StoragePreference = request.StoragePreference == "Local" ? "Local" : "Server";
        await _db.SaveChangesAsync(ct);
        return Ok(new { success = true });
    }

    // ==== ۳) شروع پرداخت (درگاه SEP؛ الگوی arjanpeyman) =========================
    public sealed class PayStartRequest { public string SignupToken { get; set; } = ""; }

    [HttpPost("payment/start")]
    [AllowAnonymous]
    public async Task<IActionResult> PayStart(PayStartRequest request, CancellationToken ct)
    {
        var pendingID = DecodeSignupToken(request.SignupToken);
        if (pendingID <= 0) return BadRequest(new { success = false, message = "درخواست ثبت‌نام یافت نشد." });
        var pending = await _db.SignupPendings.AsNoTracking().FirstOrDefaultAsync(x => x.SignupPendingID == pendingID, ct);
        if (pending == null || string.IsNullOrWhiteSpace(pending.ConfirmToken) || pending.NationalCode == "0000000000")
            return BadRequest(new { success = false, message = "اول اطلاعات را کامل کنید." });

        if (await _db.Staff.AsNoTracking().AnyAsync(x => x.NationalCode == pending.NationalCode, ct))
            return BadRequest(new { success = false, message = "این کد ملی قبلاً ثبت شده است." });

        var terminal = _config["Payments:Sep:TerminalId"];
        var amount = int.TryParse(_config["Payments:Sep:Amount"], out int a) ? a : 0;
        var apiBase = _config["Payments:Sep:ApiBase"];
        var payHost = _config["Payments:Sep:PayHost"];
        var callbackBase = _config["Payments:PublicBaseUrl"];
        if (string.IsNullOrWhiteSpace(terminal) || amount <= 0 || string.IsNullOrWhiteSpace(apiBase) || string.IsNullOrWhiteSpace(payHost) || string.IsNullOrWhiteSpace(callbackBase))
            return StatusCode(503, new { success = false, message = "درگاه پرداخت تنظیم نشده است." });

        var resNum = $"RSR-{pending.SignupPendingID}-{Guid.NewGuid().ToString("N")[..8].ToUpperInvariant()}";
        var redirectUrl = callbackBase.TrimEnd('/') + "/api/signup/payment/callback";

        var payload = new Dictionary<string, object?>
        {
            ["action"] = "token",
            ["TerminalId"] = terminal,
            ["Amount"] = amount,
            ["ResNum"] = resNum,
            ["RedirectUrl"] = redirectUrl,
            ["CellNumber"] = pending.Mobile.StartsWith("0") ? pending.Mobile : "0" + pending.Mobile,
        };

        var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        HttpResponseMessage resp;
        Dictionary<string, System.Text.Json.JsonElement> result;
        try
        {
            resp = await http.PostAsync(apiBase.TrimEnd('/') + "/onlinepg/onlinepg",
                new StringContent(System.Text.Json.JsonSerializer.Serialize(payload), System.Text.Encoding.UTF8, "application/json"), ct);
            var text = await resp.Content.ReadAsStringAsync(ct);
            result = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, System.Text.Json.JsonElement>>(text) ?? new();
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "درخواست توکن SEP شکست خورد");
            return StatusCode(503, new { success = false, message = "اتصال به درگاه ممکن نشد؛ کمی بعد تلاش کنید." });
        }

        System.Text.Json.JsonElement statusEl = default, tokenEl = default;
        bool statusOk = result.TryGetValue("status", out statusEl)
                        && statusEl.ValueKind == System.Text.Json.JsonValueKind.Number
                        && statusEl.GetInt32() == 1;
        bool tokenOk = statusOk && result.TryGetValue("token", out tokenEl)
                       && tokenEl.ValueKind == System.Text.Json.JsonValueKind.String;
        if (!tokenOk) { _log.LogError("SEP status!=1: {Result}", result); return StatusCode(502, new { success = false, message = "درگاه درخواست را نپذیرفت." }); }
        var token = tokenEl.GetString()!;
        _db.SignupPayments.Add(new SignupPayment { SignupPendingID = pendingID, ResNum = resNum, SepToken = token, Amount = amount, CreatedAt = DateTime.UtcNow });
        await _db.SaveChangesAsync(ct);

        return Ok(new { success = true, payUrl = payHost.TrimEnd('/') + "/OnlinePG/SendToken?token=" + Uri.EscapeDataString(token) });
    }


// ==== فهرستِ رشتهها برای صفحه ثبت‌نام (خوانشی؛ بدونِ مدیریت) ==========
[HttpGet("/api/specialties/public")]
[AllowAnonymous]
public async Task<IActionResult> SpecialtiesPublic(CancellationToken ct)
{
    var list = await _db.Specialties.AsNoTracking()
        .Where(x => x.IsActive)
        .OrderBy(x => x.SpecialtyName)
        .Select(x => new { x.SpecialtyID, x.SpecialtyName })
        .ToListAsync(ct);
    return Ok(new { success = true, specialties = list });
}

    // ==== ۴) کال‌کک درگاه — تأیید با استعلامِ گردشِ برگشت ======================
    [HttpGet("payment/callback")]
    [HttpPost("payment/callback")]
    [AllowAnonymous]
    [ApiExplorerSettings(IgnoreApi = true)]
    public async Task<IActionResult> Callback(CancellationToken ct)
    {
        string? state = Request.HasFormContentType ? (string?)Request.Form["State"].ToString() : null
            ?? Request.Query["State"].ToString();
        string? refNum = Request.HasFormContentType ? (string?)Request.Form["RefNum"].ToString() : null
            ?? Request.Query["RefNum"].ToString();
        string? resNum = Request.HasFormContentType ? (string?)Request.Form["ResNum"].ToString() : null
            ?? Request.Query["ResNum"].ToString();

        if (string.IsNullOrWhiteSpace(refNum) || string.IsNullOrWhiteSpace(resNum))
        {
            _log.LogWarning("SEP callback بدونِ پارامتر: {Q}", Request.QueryString);
            return Redirect("missing_params");
        }
        if (state != "OK")
        {
            _log.LogWarning("SEP نپذیرفت: State={State} ResNum={Res}", state, resNum);
            return Redirect("failed");
        }

        var pay = await _db.SignupPayments.FirstOrDefaultAsync(x => x.ResNum == resNum, ct);
        if (pay == null) { _log.LogError("پرداخت‌کی یافت نشد: {Res}", resNum); return Redirect("unknown_record"); }
        if (pay.CompletedAt.HasValue) return Redirect("already_done");

        // استعلامِ تأیید مستقیم از درگاه — کال‌کک بالاتر از مرورگر نیست
        var terminal = _config["Payments:Sep:TerminalId"];
        var verifyUrl = _config["Payments:Sep:ApiBase"]?.TrimEnd('/') + "/verifyTxnRandomSessionkey/ipg/VerifyTransaction";
        int verifiedAmount = 0;
        bool verifyOk = false;
        try
        {
            var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            var resp = await http.PostAsync(verifyUrl,
                new StringContent(System.Text.Json.JsonSerializer.Serialize(new { RefNum = refNum, TerminalNumber = int.Parse(terminal!) }), System.Text.Encoding.UTF8, "application/json"), ct);
            var text = await resp.Content.ReadAsStringAsync(ct);
            using var doc = System.Text.Json.JsonDocument.Parse(text);
            System.Text.Json.JsonElement successEl = default, detailEl = default, amountEl = default;
            if (doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object
                && doc.RootElement.TryGetProperty("Success", out successEl)
                && successEl.ValueKind == System.Text.Json.JsonValueKind.True
                && doc.RootElement.TryGetProperty("TransactionDetail", out detailEl)
                && detailEl.TryGetProperty("OrginalAmount", out amountEl))
            {
                verifyOk = true;
                int.TryParse(amountEl.ToString(), out verifiedAmount);
            }
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "استعلام تأیید SEP شکست خورد: {Ref}", refNum);
        }
        if (!verifyOk) { pay.FailureReason = "verify_failed"; await _db.SaveChangesAsync(ct); return Redirect("verify_failed"); }
        if (verifiedAmount != pay.Amount) { pay.FailureReason = "amount_mismatch"; await _db.SaveChangesAsync(ct); return Redirect("amount_mismatch"); }

        // در یک تراکنش: پرداختِ تأیید + پرسنل + کاربر
        pay.RefNum = refNum;
        pay.CompletedAt = DateTime.UtcNow;
        try
        {
            using var tx = await _db.Database.BeginTransactionAsync(ct);
            var pending = await _db.SignupPendings.FirstAsync(x => x.SignupPendingID == pay.SignupPendingID, ct);

            var staff = new Staff
            {
                NationalCode = pending.NationalCode,
                FirstName = pending.FirstName,
                LastName = pending.LastName,
                StaffType = 2, // پزشک
                SpecialtyID = pending.SpecialtyID,
                StartDate = DateTime.UtcNow
            };
            _db.Staff.Add(staff);
            await _db.SaveChangesAsync(ct);

            var user = new User
            {
                StaffID = staff.StaffID,
                UserName = pending.NationalCode,
                IsActive = true,
                StartDate = DateTime.UtcNow,
                PasswordHash = pending.PasswordHash
            };
            _db.Users.Add(user);

            pay.SuccessProcessedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);

            // پیامک خوش‌آمد (خارجِ تراکنش؛ شکستش حساب را خراب نمی‌کند)
            try
            {
                await _sms.SendSmsAsync(pending.Mobile, $"خوش آمدید {pending.FirstName} {pending.LastName}!\nنام کاربری رسیرای: {pending.NationalCode}\nرمز: همان رمزی که انتخاب کردید");
            }
            catch (Exception ex) { _log.LogWarning(ex, "پیامک خوش‌آمد نرفت: {Mobile}", pending.Mobile); }

            return Redirect("success");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "ساخت حساب پس از پرداخت شکست خورد: {Res}", resNum);
            pay.FailureReason = "account_creation_failed"; // جاب برای بازپرداخت/تلاش دوباره
            await _db.SaveChangesAsync(ct);
            return Redirect("error");
        }
    }

    private static int DecodeSignupToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return 0;
        try
        {
            var padded = token.Replace('-', '+').Replace('_', '/');
            padded += new string('=', (4 - padded.Length % 4) % 4);
            var bytes = Convert.FromBase64String(padded);
            return BitConverter.ToInt32(bytes, 0);
        }
        catch { return 0; }
    }
}
