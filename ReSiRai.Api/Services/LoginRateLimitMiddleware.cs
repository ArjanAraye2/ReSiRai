using System.Globalization;

namespace ReSiRai.Api.Services;

// Endpoint metadata ensures alternate casing and trailing slashes cannot bypass
// the IP limit. Malformed login bodies also count, before MVC model binding.
[AttributeUsage(AttributeTargets.Method)]
public sealed class LoginRateLimitedAttribute : Attribute { }

public sealed class LoginRateLimitMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, LoginAttemptLimiter limiter, AppEventLogger events)
    {
        if (context.GetEndpoint()?.Metadata.GetMetadata<LoginRateLimitedAttribute>() is null)
        {
            await next(context);
            return;
        }
        // Do not trust client-supplied X-Forwarded-For. If a reverse proxy is
        // deployed later, configure trusted proxies in ForwardedHeaders first.
        var address = context.Connection.RemoteIpAddress;
        if (address?.IsIPv4MappedToIPv6 == true) address = address.MapToIPv4();
        var ip = address?.ToString() ?? "unknown";
        var result = limiter.TryIpAttempt(ip);
        if (!result.IsBlocked)
        {
            await next(context);
            return;
        }
        // Log the transition once, so blocked traffic does not flood the DB log.
        if (result.IsNewBlock)
            await events.LogAsync("LoginRateLimitExceeded", outcome: "fail", detail: $"توقف ۱۵ دقیقه‌ای ورود — بیش از ۳۰ درخواست در ۱۰ دقیقه از IP: {ip}");
        context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        context.Response.Headers.RetryAfter = result.RetryAfterSeconds.ToString(CultureInfo.InvariantCulture);
        await context.Response.WriteAsJsonAsync(new { success = false, message = LoginAttemptLimiter.Message, retryAfterSeconds = result.RetryAfterSeconds }, context.RequestAborted);
    }
}
