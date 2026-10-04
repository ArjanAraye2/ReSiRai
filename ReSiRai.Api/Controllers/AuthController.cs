using System.Collections.Concurrent;
using System.Security.Claims;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ReSiRai.Api.Controllers
{
    [ApiController]
    [Route("api/auth")]
    public class AuthController : ControllerBase
    {
        private readonly ReSiRaiDbContext _context;
        private readonly IPasswordHasher<User> _passwordHasher;
        private readonly IConfiguration _configuration;
        private readonly ICommunicationService _communication;
        private readonly AppEventLogger _events;
        private readonly LoginAttemptLimiter _loginLimiter;
        private static readonly ConcurrentDictionary<string, ResetCode> ResetCodes = new(StringComparer.OrdinalIgnoreCase);
        public AuthController(ReSiRaiDbContext context, IPasswordHasher<User> passwordHasher, IConfiguration configuration, ICommunicationService communication, AppEventLogger events, LoginAttemptLimiter loginLimiter) { _context = context; _passwordHasher = passwordHasher; _configuration = configuration; _communication = communication; _events = events; _loginLimiter = loginLimiter; }

        public sealed class LoginRequest { public string UserName { get; set; } = string.Empty; public string Password { get; set; } = string.Empty; public bool RememberMe { get; set; } }

        [AllowAnonymous]
        [HttpPost("login")]
        [LoginRateLimited]
        public async Task<IActionResult> Login(LoginRequest request)
        {
            string userName = (request.UserName ?? string.Empty).Trim();
            if (userName.Length == 0 || string.IsNullOrEmpty(request.Password)) return BadRequest(new { success = false, message = "UserName and Password are required." });

            if (string.Equals(userName, _configuration["SuperAdmin:UserName"], StringComparison.OrdinalIgnoreCase))
            {
                var key = LoginAttemptLimiter.AccountKey(null, userName, superAdmin: true);
                using var lease = await _loginLimiter.AcquireAccountAsync(key, HttpContext.RequestAborted);
                var limit = _loginLimiter.CheckAccount(key);
                if (limit.IsBlocked) return await LoginLimitedAsync(limit, userName);
                string? superHash = _configuration["SuperAdmin:PasswordHash"];
                if (!string.IsNullOrWhiteSpace(superHash))
                {
                    var superUser = new User { UserName = userName };
                    var result = _passwordHasher.VerifyHashedPassword(superUser, superHash, request.Password);
                    if (result != PasswordVerificationResult.Failed)
                    {
                        var identity = new LoginIdentity(0, userName, 0, "مدیر", "سیستم", 0, true, true);
                        await SignInAsync(identity, request.RememberMe);
                        _loginLimiter.RecordSuccess(key);
                        await _events.LogAsync("login", detail: "ورود موفق — مدیر سیستم", userName: userName);
                        return Ok(new { success = true, user = identity });
                    }
                }
                await _events.LogAsync("login", outcome: "fail", detail: "ورود ناموفق — مدیر سیستم", userName: userName);
                return await LoginFailedAsync(key, userName);
            }

            // For every normal account, the login name is the staff member's Iranian National Code.
            // The configured SuperAdmin account above is the only exception.
            var user = await _context.Users.AsNoTracking()
                .Join(_context.Staff.AsNoTracking(),
                    account => account.StaffID,
                    staffMember => staffMember.StaffID,
                    (account, staffMember) => new { Account = account, Staff = staffMember })
                .Where(x => x.Staff.NationalCode == userName || x.Staff.Mobile == userName)
                .Select(x => x.Account)
                .FirstOrDefaultAsync();
            // Mobile and national-code login resolve to the same account ID.
            var accountKey = LoginAttemptLimiter.AccountKey(user?.UserID, userName);
            using var accountLease = await _loginLimiter.AcquireAccountAsync(accountKey, HttpContext.RequestAborted);
            var accountLimit = _loginLimiter.CheckAccount(accountKey);
            if (accountLimit.IsBlocked) return await LoginLimitedAsync(accountLimit, userName, user?.UserID);
            if (user == null || !user.IsActive || (user.StartDate.HasValue && user.StartDate.Value.Date > DateTime.Today) || (user.EndDate.HasValue && user.EndDate.Value.Date < DateTime.Today) || string.IsNullOrWhiteSpace(user.PasswordHash))
            {
                await _events.LogAsync("login", outcome: "fail", detail: "ورود ناموفق — حساب یافت نشد یا غیرفعال است", userID: user?.UserID, userName: userName);
                return await LoginFailedAsync(accountKey, userName, user?.UserID);
            }
            var verification = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
            if (verification == PasswordVerificationResult.Failed)
            {
                await _events.LogAsync("login", outcome: "fail", detail: "ورود ناموفق — رمز عبور اشتباه است", userID: user.UserID, userName: userName);
                return await LoginFailedAsync(accountKey, userName, user.UserID);
            }
            var staff = await _context.Staff.AsNoTracking().FirstOrDefaultAsync(x => x.StaffID == user.StaffID);
            if (staff == null)
            {
                await _events.LogAsync("login", outcome: "fail", detail: "ورود ناموفق — پرسنل مرتبط با حساب نیست", userID: user.UserID, userName: userName);
                return await LoginFailedAsync(accountKey, userName, user.UserID);
            }
            var normalIdentity = new LoginIdentity(user.UserID, staff.NationalCode, staff.StaffID, staff.FirstName, staff.LastName, staff.StaffType, false, user.ViewReports);
            await SignInAsync(normalIdentity, request.RememberMe);
            _loginLimiter.RecordSuccess(accountKey);
            await _events.LogAsync("login", detail: "ورود موفق", userID: user.UserID, userName: staff.NationalCode);
            return Ok(new { success = true, user = normalIdentity });
        }

        private async Task<IActionResult> LoginFailedAsync(string key, string userName, int? userID = null)
        {
            var limit = _loginLimiter.RecordFailure(key);
            if (limit.IsBlocked) return await LoginLimitedAsync(limit, userName, userID);
            return Unauthorized(new { success = false, message = "Invalid username or password.", failedAttempts = limit.FailedAttempts });
        }

        private async Task<IActionResult> LoginLimitedAsync(LoginAttemptLimiter.LimitResult limit, string userName, int? userID = null)
        {
            if (limit.IsNewBlock)
                await _events.LogAsync("LoginRateLimitExceeded", outcome: "fail", detail: "توقف ۱۵ دقیقه‌ای ورود — ۵ ورود ناموفق برای حساب در ۱۰ دقیقه", userID: userID, userName: userName);
            Response.Headers.RetryAfter = limit.RetryAfterSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return StatusCode(StatusCodes.Status429TooManyRequests, new { success = false, message = LoginAttemptLimiter.Message, retryAfterSeconds = limit.RetryAfterSeconds, failedAttempts = limit.FailedAttempts });
        }

        public sealed class ForgotPasswordRequest { public string NationalCode { get; set; } = string.Empty; }
        public sealed class VerifyResetRequest { public string NationalCode { get; set; } = string.Empty; public string Code { get; set; } = string.Empty; public string NewPassword { get; set; } = string.Empty; }

        [AllowAnonymous]
        [HttpPost("forgot-password")]
        public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest request)
        {
            var nationalCode = (request.NationalCode ?? string.Empty).Trim();
            var generic = new { success = true, message = "اگر حسابی با این مشخصات و شماره بازیابی معتبر وجود داشته باشد، کد بازیابی ارسال می‌شود." };
            if (nationalCode.Length == 0) return Ok(generic);
            var user = await _context.Users.FirstOrDefaultAsync(x => x.UserName == nationalCode && x.IsActive);
            if (user == null || string.IsNullOrWhiteSpace(user.RecoveryMobile)) return Ok(generic);
            var code = Random.Shared.Next(100000, 999999).ToString();
            ResetCodes[nationalCode] = new ResetCode(code, DateTimeOffset.UtcNow.AddMinutes(5), 0);
            var result = await _communication.SendSmsAsync(user.RecoveryMobile, $"کد بازیابی رمز عبور ReSiRai: {code}\nاعتبار: ۵ دقیقه");
            if (!result.Success) ResetCodes.TryRemove(nationalCode, out _);
            return Ok(generic);
        }

        [AllowAnonymous]
        [HttpPost("reset-password")]
        public async Task<IActionResult> ResetPassword(VerifyResetRequest request)
        {
            var nationalCode = (request.NationalCode ?? string.Empty).Trim();
            if (!ResetCodes.TryGetValue(nationalCode, out var reset) || reset.ExpiresAt < DateTimeOffset.UtcNow || reset.Attempts >= 5 || reset.Code != (request.Code ?? string.Empty).Trim())
            {
                if (ResetCodes.TryGetValue(nationalCode, out var current)) ResetCodes[nationalCode] = current with { Attempts = current.Attempts + 1 };
                return BadRequest(new { success = false, message = "کد بازیابی معتبر نیست یا منقضی شده است." });
            }
            if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 8) return BadRequest(new { success = false, message = "رمز عبور جدید باید حداقل ۸ نویسه باشد." });
            var user = await _context.Users.FirstOrDefaultAsync(x => x.UserName == nationalCode && x.IsActive);
            if (user == null) return BadRequest(new { success = false, message = "عملیات بازیابی انجام نشد." });
            user.PasswordHash = _passwordHasher.HashPassword(user, request.NewPassword);
            await _context.SaveChangesAsync();
            ResetCodes.TryRemove(nationalCode, out _);
            return Ok(new { success = true, message = "رمز عبور با موفقیت تغییر کرد." });
        }

        // Used by the browser on page reload. The password is never needed again;
        // the server validates the protected HttpOnly cookie.
        // بدونِ [Authorize]: مهمان‌بودن خطا نیست و 200 با success=false برمی‌گردد
        // تا صفحهٔ ورود با پیامِ «Failed to load resource: 401» کثیف نشود.
        [HttpGet("me")]
        public IActionResult Me()
        {
            if (User.Identity?.IsAuthenticated != true)
                return Ok(new { success = false, authenticated = false });
            return Ok(new { success = true, user = IdentityFromClaims() });
        }

        [Authorize]
        [HttpPost("logout")]
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Ok(new { success = true });
        }

        private async Task SignInAsync(LoginIdentity identity, bool rememberMe = false)
        {
            var claims = new List<Claim>
            {
                new(ClaimTypes.Name, identity.UserName),
                new("UserID", identity.UserID.ToString()),
                new("StaffID", identity.StaffID.ToString()),
                new("StaffType", identity.StaffType.ToString()),
                new("FirstName", identity.FirstName),
                new("LastName", identity.LastName),
                new("IsSuperAdmin", identity.IsSuperAdmin ? "true" : "false"),
                new("ViewReports", identity.ViewReports ? "true" : "false")
            };
            var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
            await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, new AuthenticationProperties { IsPersistent = rememberMe, AllowRefresh = true, ExpiresUtc = rememberMe ? DateTimeOffset.UtcNow.AddDays(30) : null });
        }

        private LoginIdentity IdentityFromClaims()
        {
            int.TryParse(User.FindFirstValue("UserID"), out int userID);
            int.TryParse(User.FindFirstValue("StaffID"), out int staffID);
            byte.TryParse(User.FindFirstValue("StaffType"), out byte staffType);
            return new LoginIdentity(userID, User.Identity?.Name ?? string.Empty, staffID, User.FindFirstValue("FirstName") ?? string.Empty, User.FindFirstValue("LastName") ?? string.Empty, staffType, string.Equals(User.FindFirstValue("IsSuperAdmin"), "true", StringComparison.OrdinalIgnoreCase), string.Equals(User.FindFirstValue("ViewReports"), "true", StringComparison.OrdinalIgnoreCase));
        }

        public sealed record LoginIdentity(int UserID, string UserName, int StaffID, string FirstName, string LastName, byte StaffType, bool IsSuperAdmin, bool ViewReports);
        private sealed record ResetCode(string Code, DateTimeOffset ExpiresAt, int Attempts);
    }
}
