using System.Security.Claims;
using System.Text.Json;
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
/// نگهبانِ «بخش‌هایِ مراجعه»: ثبتِ دوبارهٔ یک بخش باید همان ردیف را جایگزین کند
/// (پشتِ ایندکسِ یکتایِ StudyID+SectionCode) و شکلِ DataJson — چیپ‌ها، ردیف‌هایِ
/// تکرارپذیر و پیوندها — باید دست‌نخورده برگردد. اگر یکی از این‌ها بیفتد،
/// مراجعه هم ردیفِ تکراری می‌سازد هم دادهٔ تیک‌محور را گم می‌کند.
/// </summary>
public class StudySectionsControllerTests
{
    private static ReSiRaiDbContext CreateDatabase() =>
        new(new DbContextOptionsBuilder<ReSiRaiDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static ClaimsPrincipal SuperAdmin() =>
        new(new ClaimsIdentity(new[] { new Claim("IsSuperAdmin", "true") }, "test-auth"));

    private static StudySectionsController CreateController(ReSiRaiDbContext db, ClaimsPrincipal? user = null)
    {
        var controller = new StudySectionsController(db, new StudyAccessService(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = user ?? SuperAdmin() }
            }
        };
        return controller;
    }

    private static int CreateStudy(ReSiRaiDbContext db, int? doctorStaffID = null)
    {
        var study = new RadiologyStudy
        {
            PatientID = 1,
            StudyDate = new DateTime(2026, 10, 7, 9, 30, 0),
            StudyTypeID = 1,
            DoctorStaffID = doctorStaffID,
            CreatedDate = DateTime.Now
        };
        db.RadiologyStudies.Add(study);
        db.SaveChanges();
        return study.StudyID;
    }

    private static StudySectionsController.SaveSectionRequest Request(string code, string title, string dataJson)
    {
        // The document must outlive the request: the controller reads GetRawText().
        var doc = JsonDocument.Parse(dataJson);
        return new StudySectionsController.SaveSectionRequest
        {
            SectionCode = code,
            Title = title,
            Data = doc.RootElement
        };
    }

    private static JsonElement Result(object? value) => JsonSerializer.SerializeToElement(value);

    [Fact]
    public async Task RecordingTheSameSectionAgainReplacesItInsteadOfDuplicating()
    {
        using var db = CreateDatabase();
        var studyID = CreateStudy(db);
        var controller = CreateController(db);

        var first = Assert.IsType<OkObjectResult>(await controller.Upsert(studyID,
            Request("bp", "ارزیابیِ فشارخون", """{"v":1,"rows":[{"numbers":{"sys":130,"dia":85}}]}""")));
        Assert.True(Result(first.Value).GetProperty("created").GetBoolean());

        var second = Assert.IsType<OkObjectResult>(await controller.Upsert(studyID,
            Request("bp", "ارزیابیِ فشارخون", """{"v":1,"rows":[{"numbers":{"sys":118,"dia":76}}]}""")));
        var secondJson = Result(second.Value);
        Assert.False(secondJson.GetProperty("created").GetBoolean());
        Assert.Equal(JsonValueKind.String, secondJson.GetProperty("section").GetProperty("modifiedDate").ValueKind);

        // یک بخش = یک ردیف؛ ثبتِ مجدد هرگز ردیفِ دوم نمی‌سازد.
        Assert.Equal(1, db.StudySections.Count(x => x.StudyID == studyID));
        Assert.Contains("118", db.StudySections.Single(x => x.SectionCode == "bp").DataJson);

        // ویرایشِ ثبت‌شده هم باید از همان ردیفِ واحد خوانده شود.
        var list = Assert.IsType<OkObjectResult>(await controller.Get(studyID));
        var listJson = Result(list.Value);
        Assert.Equal(1, listJson.GetProperty("count").GetInt32());
        Assert.Equal(118,
            listJson.GetProperty("sections")[0].GetProperty("data").GetProperty("rows")[0]
                .GetProperty("numbers").GetProperty("sys").GetInt32());
    }

    [Fact]
    public async Task DataJsonKeepsChipsChecklistsRowsAndLinks()
    {
        using var db = CreateDatabase();
        var studyID = CreateStudy(db);
        var controller = CreateController(db);

        const string payload = """
            {"v":1,"summary":"BMI 22.5",
             "chips":{"chief":"پیگیری"},
             "checks":{"base":["فشارخون","دیابت"]},
             "texts":{"chiefTxt":"خستگی"},
             "numbers":{"sys":120,"dia":80,"bmi":22.5},
             "rows":[{"at":"1405/07/15 09:30","numbers":{"sys":120},"chips":{"when":"صبح"},"source":"تکرارشده"}],
             "links":["CBC","ECG"]}
            """;

        var saved = Assert.IsType<OkObjectResult>(await controller.Upsert(studyID,
            Request("anamnesis", "شکایت و آنامنز", payload)));
        var data = Result(saved.Value).GetProperty("section").GetProperty("data");

        Assert.Equal("پیگیری", data.GetProperty("chips").GetProperty("chief").GetString());
        Assert.Equal(2, data.GetProperty("checks").GetProperty("base").GetArrayLength());
        Assert.Equal(22.5m, data.GetProperty("numbers").GetProperty("bmi").GetDecimal());
        Assert.Equal("تکرارشده", data.GetProperty("rows")[0].GetProperty("source").GetString());
        Assert.Equal("صبح", data.GetProperty("rows")[0].GetProperty("chips").GetProperty("when").GetString());
        Assert.Equal("ECG", data.GetProperty("links")[1].GetString());
    }

    [Fact]
    public async Task DeletingOneSectionLeavesTheOthersAlone()
    {
        using var db = CreateDatabase();
        var studyID = CreateStudy(db);
        var controller = CreateController(db);

        await controller.Upsert(studyID, Request("bp", "ارزیابیِ فشارخون", """{"v":1}"""));
        await controller.Upsert(studyID, Request("sugar", "ارزیابیِ قند", """{"v":1}"""));
        Assert.Equal(2, db.StudySections.Count(x => x.StudyID == studyID));

        var missing = await controller.Delete(studyID, "linkLab");
        Assert.IsType<NotFoundObjectResult>(missing);

        var deleted = Assert.IsType<OkObjectResult>(await controller.Delete(studyID, "bp"));
        Assert.True(Result(deleted.Value).GetProperty("success").GetBoolean());

        var row = db.StudySections.Single(x => x.StudyID == studyID);
        Assert.Equal("sugar", row.SectionCode);
    }

    [Fact]
    public async Task AnotherDoctorsSectionsAreNotVisible()
    {
        using var db = CreateDatabase();
        // مراجعهٔ متعلق به دکترِ ۷؛ کاربرِ دکترِ ۹۹ نباید چیزی ببیند یا بنویسد.
        var studyID = CreateStudy(db, doctorStaffID: 7);
        var otherDoctor = new ClaimsIdentity(new[]
        {
            new Claim("StaffID", "99"),
            new Claim("StaffType", "2"),
            new Claim("IsSuperAdmin", "false")
        }, "test-auth");
        var controller = CreateController(db, new ClaimsPrincipal(otherDoctor));

        Assert.IsType<NotFoundObjectResult>(await controller.Get(studyID));
        Assert.IsType<NotFoundObjectResult>(await controller.Upsert(studyID,
            Request("vitals", "علائمِ حیاتی", """{"v":1}""")));
        Assert.Empty(db.StudySections);
    }

    [Fact]
    public async Task DataThatIsNotAnObjectIsRejected()
    {
        using var db = CreateDatabase();
        var studyID = CreateStudy(db);
        var controller = CreateController(db);

        var bad = Assert.IsType<BadRequestObjectResult>(await controller.Upsert(studyID,
            Request("vitals", "علائمِ حیاتی", "[1,2,3]")));
        Assert.False(Result(bad.Value).GetProperty("success").GetBoolean());
        Assert.Empty(db.StudySections);
    }
}
