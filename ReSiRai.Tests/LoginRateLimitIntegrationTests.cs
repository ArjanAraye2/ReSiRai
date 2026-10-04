using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ReSiRai.Api.Controllers;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Xunit;

namespace ReSiRai.Tests;

public sealed class LoginRateLimitIntegrationTests
{
    [Fact]
    public async Task AccountLimitCoversBothAliasesAndRejectsCorrectPasswordUntilExpiry()
    {
        using var db = CreateDatabase();
        var clock = new LoginAttemptLimiterTests.TestClock();
        var limiter = new LoginAttemptLimiter(clock);
        var controller = CreateController(db, limiter);
        for (int i = 0; i < 4; i++)
        {
            var failed = Assert.IsType<UnauthorizedObjectResult>(await Login(controller, i % 2 == 0 ? "09123456789" : "1234567890", "wrong"));
            Assert.Equal(i + 1, JsonSerializer.SerializeToElement(failed.Value).GetProperty("failedAttempts").GetInt32());
        }
        var blocked = Assert.IsType<ObjectResult>(await Login(controller, "1234567890", "wrong"));
        Assert.Equal(429, blocked.StatusCode);
        Assert.Equal("900", controller.Response.Headers.RetryAfter.ToString());
        Assert.Equal(LoginAttemptLimiter.Message, JsonSerializer.SerializeToElement(blocked.Value).GetProperty("message").GetString());
        Assert.Equal(5, JsonSerializer.SerializeToElement(blocked.Value).GetProperty("failedAttempts").GetInt32());
        var stillBlocked = Assert.IsType<ObjectResult>(await Login(controller, "09123456789", "correct-password"));
        Assert.Equal(429, stillBlocked.StatusCode);
        Assert.Equal(5, JsonSerializer.SerializeToElement(stillBlocked.Value).GetProperty("failedAttempts").GetInt32());
        Assert.Single(db.AppEvents.Where(x => x.Kind == "LoginRateLimitExceeded"));
        clock.Advance(TimeSpan.FromMinutes(15));
        Assert.IsType<OkObjectResult>(await Login(controller, "09123456789", "correct-password"));
        Assert.False(limiter.CheckAccount(LoginAttemptLimiter.AccountKey(1, "1234567890")).IsBlocked);
        var restarted = Assert.IsType<UnauthorizedObjectResult>(await Login(controller, "1234567890", "wrong"));
        Assert.Equal(1, JsonSerializer.SerializeToElement(restarted.Value).GetProperty("failedAttempts").GetInt32());
    }

    [Fact]
    public async Task SuccessfulLoginClearsEarlierFailures()
    {
        using var db = CreateDatabase();
        var controller = CreateController(db, new LoginAttemptLimiter(new LoginAttemptLimiterTests.TestClock()));
        for (int i = 0; i < 4; i++) Assert.IsType<UnauthorizedObjectResult>(await Login(controller, "1234567890", "wrong"));
        Assert.IsType<OkObjectResult>(await Login(controller, "09123456789", "correct-password"));
        for (int i = 0; i < 4; i++) Assert.IsType<UnauthorizedObjectResult>(await Login(controller, "1234567890", "wrong"));
    }

    [Fact]
    public async Task SuperAdminAndUnknownIdentifiersAlsoHaveAccountLimit()
    {
        using var db = CreateDatabase();
        var controller = CreateController(db, new LoginAttemptLimiter(new LoginAttemptLimiterTests.TestClock()));
        foreach (var name in new[] { "ADMIN", "missing" })
        {
            for (int i = 0; i < 4; i++) Assert.IsType<UnauthorizedObjectResult>(await Login(controller, name, "wrong"));
            Assert.Equal(429, Assert.IsType<ObjectResult>(await Login(controller, name, "wrong")).StatusCode);
        }
        Assert.Equal(429, Assert.IsType<ObjectResult>(await Login(controller, "admin", "correct-password")).StatusCode);
    }

    [Fact]
    public async Task MiddlewareOnlyLimitsMarkedEndpointAndUsesConnectionIp()
    {
        using var db = CreateDatabase();
        var clock = new LoginAttemptLimiterTests.TestClock();
        var limiter = new LoginAttemptLimiter(clock);
        var events = new AppEventLogger(db);
        int calls = 0;
        var middleware = new LoginRateLimitMiddleware(_ => { calls++; return Task.CompletedTask; });
        var endpoint = new Endpoint(_ => Task.CompletedTask, new EndpointMetadataCollection(new LoginRateLimitedAttribute()), "login");
        for (int i = 0; i < 31; i++)
        {
            var context = new DefaultHttpContext();
            context.RequestServices = new ServiceCollection().AddOptions().BuildServiceProvider();
            context.Connection.RemoteIpAddress = IPAddress.Parse(i % 2 == 0 ? "192.0.2.1" : "::ffff:192.0.2.1");
            context.Request.Headers["X-Forwarded-For"] = $"192.0.2.{i + 2}";
            context.Response.Body = new MemoryStream();
            context.SetEndpoint(endpoint);
            await middleware.InvokeAsync(context, limiter, events);
            if (i == 30)
            {
                Assert.Equal(429, context.Response.StatusCode);
                Assert.Equal("900", context.Response.Headers.RetryAfter.ToString());
                context.Response.Body.Position = 0;
                var json = await JsonDocument.ParseAsync(context.Response.Body);
                Assert.Equal(LoginAttemptLimiter.Message, json.RootElement.GetProperty("message").GetString());
            }
        }
        Assert.Equal(30, calls);
        Assert.Single(db.AppEvents.Where(x => x.Kind == "LoginRateLimitExceeded"));
        var unmarked = new DefaultHttpContext();
        unmarked.Connection.RemoteIpAddress = IPAddress.Parse("192.0.2.1");
        await middleware.InvokeAsync(unmarked, limiter, events);
        Assert.Equal(31, calls);
    }

    private static Task<IActionResult> Login(AuthController controller, string name, string password) =>
        controller.Login(new AuthController.LoginRequest { UserName = name, Password = password });

    private static ReSiRaiDbContext CreateDatabase()
    {
        var db = new ReSiRaiDbContext(new DbContextOptionsBuilder<ReSiRaiDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var user = new User { UserID = 1, StaffID = 1, UserName = "1234567890", IsActive = true };
        user.PasswordHash = new PasswordHasher<User>().HashPassword(user, "correct-password");
        db.Staff.Add(new Staff { StaffID = 1, NationalCode = "1234567890", Mobile = "09123456789", FirstName = "Test", LastName = "User" });
        db.Users.Add(user);
        db.SaveChanges();
        return db;
    }

    private static AuthController CreateController(ReSiRaiDbContext db, LoginAttemptLimiter limiter)
    {
        var hasher = new PasswordHasher<User>();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["SuperAdmin:UserName"] = "admin",
            ["SuperAdmin:PasswordHash"] = hasher.HashPassword(new User(), "correct-password")
        }).Build();
        var services = new ServiceCollection().AddSingleton<IAuthenticationService, FakeAuthentication>().BuildServiceProvider();
        return new AuthController(db, hasher, configuration, new NoCommunication(), new AppEventLogger(db), limiter)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { RequestServices = services } }
        };
    }

    private sealed class NoCommunication : ICommunicationService
    {
        public CommunicationChannelSettings GetSettings() => throw new NotSupportedException();
        public Task SaveSettingsAsync(CommunicationChannelSettings settings) => throw new NotSupportedException();
        public Task<(bool Success, string Message)> SendSmsAsync(string mobile, string message) => throw new NotSupportedException();
    }

    private sealed class FakeAuthentication : IAuthenticationService
    {
        public Task<AuthenticateResult> AuthenticateAsync(HttpContext context, string? scheme) => Task.FromResult(AuthenticateResult.NoResult());
        public Task ChallengeAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => Task.CompletedTask;
        public Task ForbidAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => Task.CompletedTask;
        public Task SignInAsync(HttpContext context, string? scheme, System.Security.Claims.ClaimsPrincipal principal, AuthenticationProperties? properties) => Task.CompletedTask;
        public Task SignOutAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => Task.CompletedTask;
    }
}
