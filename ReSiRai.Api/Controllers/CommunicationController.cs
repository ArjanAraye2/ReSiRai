using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ReSiRai.Api.Controllers
{
    [ApiController]
    [Route("api/communications")]
    [Authorize]
    public sealed class CommunicationController : ControllerBase
    {
        private readonly ICommunicationService _communication;
        private readonly ReSiRaiDbContext _context;
        private readonly IHttpClientFactory _httpClientFactory;

        public CommunicationController(ICommunicationService communication, ReSiRaiDbContext context, IHttpClientFactory httpClientFactory)
        {
            _communication = communication;
            _context = context;
            _httpClientFactory = httpClientFactory;
        }

        /// <summary>
        /// آی‌پی عمومی همین سرور: همان عددی که کاوه‌نگار هنگام ارسال پیامک می‌بیند.
        /// اگر این عدد از محدودهٔ ثبت‌شده در «تنظیمات آی‌پی مجاز» بیرون رود،
        /// ارسال با خطای «IP سرویس مبدا با تنظیمات مطابقت ندارد» متوقف می‌شود؛
        /// نمایش همین‌جا کنار لینک‌های اجرا باعث می‌شود مشکل سریع دیده شود.
        /// </summary>
        [HttpGet("public-ip")]
        public async Task<IActionResult> PublicIp()
        {
            if (!IsSuperAdmin()) return Forbid();
            try
            {
                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(8);
                var json = await client.GetStringAsync("https://api.ipify.org?format=json");
                using var doc = JsonDocument.Parse(json);
                var ip = doc.RootElement.TryGetProperty("ip", out var p) ? p.GetString() : null;
                if (string.IsNullOrWhiteSpace(ip)) throw new InvalidOperationException("ip missing");
                return Ok(new { success = true, ip });
            }
            catch
            {
                // بدون اینترنت هم صفحه باید کار کند؛ فقط دلیل را می‌گوییم.
                return Ok(new { success = false, ip = string.Empty,
                    message = "دریافت آی‌پی عمومی ممکن نشد؛ اینترنت سرور را بررسی کنید." });
            }
        }

        [HttpGet("settings")]
        public IActionResult GetSettings()
        {
            if (!IsSuperAdmin()) return Forbid();
            var settings = _communication.GetSettings();
            settings.SmsApiKey = string.IsNullOrEmpty(settings.SmsApiKey) ? string.Empty : "••••••••";
            return Ok(new { success = true, settings });
        }

        /// <summary>
        /// شمارهٔ مطب برای نمایش به منشی (روش «فوروارد به گوشی مطب»).
        /// عمداً فقط همین یک فیلد برمی‌گردد تا کلید API در اختیار کاربر عادی قرار نگیرد.
        /// </summary>
        [HttpGet("clinic-mobile")]
        public IActionResult ClinicMobile()
        {
            var settings = _communication.GetSettings();
            return Ok(new { success = true, mobile = settings.ClinicMobile ?? string.Empty });
        }

        [HttpPut("settings")]
        public async Task<IActionResult> SaveSettings(CommunicationChannelSettings settings)
        {
            if (!IsSuperAdmin()) return Forbid();
            var current = _communication.GetSettings();
            if (settings.SmsApiKey == "••••••••") settings.SmsApiKey = current.SmsApiKey;
            try
            {
                await _communication.SaveSettingsAsync(settings);
            }
            catch (InvalidOperationException ex)
            {
                // The service already phrased this for the user (for example a
                // missing write permission), so pass it straight through instead
                // of letting it surface as a raw 500.
                return BadRequest(new { success = false, message = ex.Message });
            }
            return Ok(new { success = true, message = "تنظیمات ذخیره شد." });
        }

        public sealed class RecoveryMobileRequest { public string NationalCode { get; set; } = string.Empty; public string Mobile { get; set; } = string.Empty; }

        [HttpPut("recovery-mobile")]
        public async Task<IActionResult> SaveRecoveryMobile(RecoveryMobileRequest request)
        {
            if (!IsSuperAdmin()) return Forbid();
            var nationalCode = (request.NationalCode ?? string.Empty).Trim();
            var user = await _context.Users.FirstOrDefaultAsync(x => x.UserName == nationalCode);
            if (user == null) return NotFound(new { success = false, message = "کاربر پیدا نشد." });
            user.RecoveryMobile = request.Mobile?.Trim();
            await _context.SaveChangesAsync();
            return Ok(new { success = true });
        }

        [HttpPost("sms/test")]
        public async Task<IActionResult> TestSms([FromBody] SendSmsRequest request)
        {
            if (!IsSuperAdmin()) return Forbid();
            var result = await _communication.SendSmsAsync(request.Mobile, string.IsNullOrWhiteSpace(request.Message) ? "تست اتصال ReSiRai" : request.Message);
            return result.Success ? Ok(new { success = true, message = result.Message }) : BadRequest(new { success = false, message = result.Message });
        }

        [HttpPost("sms/send")]
        public async Task<IActionResult> SendSms([FromBody] SendSmsRequest request)
        {
            if (request.PatientID.HasValue)
            {
                var patient = await _context.Patients.AsNoTracking().FirstOrDefaultAsync(x => x.PatientID == request.PatientID.Value);
                if (patient == null) return NotFound(new { success = false, message = "بیمار پیدا نشد." });
                if (string.IsNullOrWhiteSpace(request.Mobile)) request.Mobile = patient.Mobile ?? string.Empty;
            }
            var result = await _communication.SendSmsAsync(request.Mobile, request.Message);
            return result.Success ? Ok(new { success = true, message = result.Message }) : BadRequest(new { success = false, message = result.Message });
        }

        [HttpPost("sep/test")]
        public async Task<IActionResult> TestSepGateway()
        {
            if (!IsSuperAdmin()) return Forbid();
            var settings = _communication.GetSettings();
            var terminal = string.IsNullOrWhiteSpace(settings.SepTerminalId)
                ? string.Empty
                : settings.SepTerminalId.Trim();

            var result = new Dictionary<string, object> { ["terminal"] = terminal };

            if (string.IsNullOrEmpty(terminal))
            {
                result["ok"] = false;
                result["detail"] = "شناسه ترمینال سپ ثبت نشده است.";
            }
            else
            {
                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(15);
                var resNum = "RSITEST-" + Guid.NewGuid().ToString("N")[..8].ToUpper();
                var payload = new
                {
                    action = "token",
                    TerminalId = int.Parse(terminal),
                    Amount = 1000,          // آزمایشی — فقط برای ساخت توکن، پولی جابجا نمی‌شود
                    ResNum = resNum,
                    RedirectUrl = $"{Request.Scheme}://{Request.Host}/api/communications/sep/callback",
                    CellNumber = "",
                };
                try
                {
                    var response = await client.PostAsJsonAsync("https://sep.shaparak.ir/onlinepg/onlinepg", payload);
                    var json = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
                    result["status"] = json.GetProperty("status").GetInt32();
                    if (json.TryGetProperty("errorDesc", out var ed))
                        result["detail"] = ed.GetString() ?? "نامشخص";
                    else if (json.TryGetProperty("token", out var tk))
                    {
                        result["ok"] = true;
                        result["detail"] = "اتصال موفق — درگاه توکن را صادر کرد.";
                        result["token_head"] = tk.GetString()![..Math.Min(24, tk.GetString()!.Length)] + "…";
                        result["res_num"] = resNum;
                    }
                    else
                    {
                        result["detail"] = "پاسخ نامشخص از درگاه.";
                    }
                }
                catch (Exception ex)
                {
                    result["ok"] = false;
                    result["detail"] = "خطا در اتصال به درگاه: " + ex.Message;
                }
            }

            return Ok(result);
        }

        private bool IsSuperAdmin() => string.Equals(User.FindFirst("IsSuperAdmin")?.Value, "true", StringComparison.OrdinalIgnoreCase);
    }
}
