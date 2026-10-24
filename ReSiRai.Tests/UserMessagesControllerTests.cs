using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ReSiRai.Api.Controllers;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Xunit;

namespace ReSiRai.Tests;

/// <summary>
/// مرکز پیام: کاربر فقط با مدیریت حرف می‌زند؛ نه با کاربر دیگر.
/// مدیر همهٔ گفتگوها را می‌بیند ولی هر کاربر فقط رشتهٔ خودش را.
/// </summary>
public class UserMessagesControllerTests
{
    private static ReSiRaiDbContext CreateDatabase() =>
        new(new DbContextOptionsBuilder<ReSiRaiDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static UserMessagesController Controller(ReSiRaiDbContext db, int userID, bool admin)
    {
        var claims = new List<Claim>
        {
            new("UserID", userID.ToString()),
            new("IsSuperAdmin", admin ? "true" : "false"),
            new(ClaimTypes.Name, admin ? "admin" : "0012345678")
        };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));
        return new UserMessagesController(db, new AppEventLogger(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = user }
            }
        };
    }

    private static async Task<(int User1, int User2)> AddUsers(ReSiRaiDbContext db)
    {
        var staff1 = new Staff { NationalCode = "0012345678", FirstName = "سارا", LastName = "اول", StaffType = 1, StartDate = DateTime.Now.AddYears(-1) };
        var staff2 = new Staff { NationalCode = "0023456789", FirstName = "رضا", LastName = "دوم", StaffType = 2, StartDate = DateTime.Now.AddYears(-1) };
        db.Staff.AddRange(staff1, staff2);
        await db.SaveChangesAsync();
        var u1 = new User { StaffID = staff1.StaffID, UserName = staff1.NationalCode, IsActive = true };
        var u2 = new User { StaffID = staff2.StaffID, UserName = staff2.NationalCode, IsActive = true };
        db.Users.AddRange(u1, u2);
        await db.SaveChangesAsync();
        return (u1.UserID, u2.UserID);
    }

    [Fact]
    public async Task User_CanOnlySendToAdmin_EvenWhenAnotherUserIDIsPassed()
    {
        var db = CreateDatabase();
        var (u1, u2) = await AddUsers(db);
        var user = Controller(db, u1, admin: false);

        var result = await user.Send(new UserMessagesController.SendRequest(u2, "سلام", null), default);

        Assert.IsType<OkObjectResult>(result);
        var saved = Assert.Single(db.UserMessages);
        Assert.Equal(u1, saved.SenderUserID);
        Assert.Equal(0, saved.RecipientUserID);
    }

    [Fact]
    public async Task User_SeesOnlyOwnThreadWithAdmin()
    {
        var db = CreateDatabase();
        var (u1, u2) = await AddUsers(db);
        db.UserMessages.AddRange(
            new UserMessage { SenderUserID = u1, RecipientUserID = 0, Body = "پیام من", CreatedDate = DateTime.Now },
            new UserMessage { SenderUserID = u2, RecipientUserID = 0, Body = "پیام دیگری", CreatedDate = DateTime.Now });
        await db.SaveChangesAsync();

        var result = await Controller(db, u1, admin: false).Thread(null, default);

        var ok = Assert.IsType<OkObjectResult>(result);
        var json = System.Text.Json.JsonSerializer.SerializeToElement(ok.Value);
        var bodies = json.GetProperty("messages").EnumerateArray()
            .Select(m => m.GetProperty("body").GetString()).ToList();
        Assert.Contains("پیام من", bodies);
        Assert.DoesNotContain("پیام دیگری", bodies);
    }

    [Fact]
    public async Task Admin_SeesThreadsAndCanReply_UserUnreadBecomesRead()
    {
        var db = CreateDatabase();
        var (u1, _) = await AddUsers(db);
        var user = Controller(db, u1, admin: false);
        var admin = Controller(db, 0, admin: true);

        await user.Send(new UserMessagesController.SendRequest(null, "سؤال", null), default);

        var threads = Assert.IsType<OkObjectResult>(await admin.Threads(default));
        var threadsJson = System.Text.Json.JsonSerializer.SerializeToElement(threads.Value);
        Assert.True(threadsJson.GetProperty("isAdmin").GetBoolean());
        Assert.Single(threadsJson.GetProperty("conversations").EnumerateArray());

        var reply = await admin.Send(new UserMessagesController.SendRequest(u1, "پاسخ", null), default);
        Assert.IsType<OkObjectResult>(reply);

        var before = Assert.IsType<OkObjectResult>(await user.Unread(default));
        Assert.Equal(1, System.Text.Json.JsonSerializer.SerializeToElement(before.Value).GetProperty("unread").GetInt32());

        await user.Thread(null, default);
        var after = Assert.IsType<OkObjectResult>(await user.Unread(default));
        Assert.Equal(0, System.Text.Json.JsonSerializer.SerializeToElement(after.Value).GetProperty("unread").GetInt32());
    }

    [Fact]
    public async Task User_CannotSeeAdminContacts()
    {
        var db = CreateDatabase();
        var (u1, _) = await AddUsers(db);

        var result = await Controller(db, u1, admin: false).Contacts(null, default);

        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task Admin_CanSearchContacts()
    {
        var db = CreateDatabase();
        await AddUsers(db);
        var admin = Controller(db, 0, admin: true);

        var result = await admin.Contacts("سارا", default);

        var ok = Assert.IsType<OkObjectResult>(result);
        var json = System.Text.Json.JsonSerializer.SerializeToElement(ok.Value);
        Assert.Single(json.GetProperty("contacts").EnumerateArray());
    }
}
