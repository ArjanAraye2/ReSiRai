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
/// نگهبانِ دو فیلدِ تازهٔ مراجعه (توافقِ ۱۴۰۵/۰۷/۱۶، فازِ پزشکِ عمومی):
/// «تشخیص» (ستونِ پیش‌تر Report) و «پایانِ کار» (WorkEndDate).
/// قراردادها: پایانِ کار نمی‌تواند پیش از تاریخِ مراجعه باشد، متنِ تشخیص
/// سقفِ ۱۰۰۰ نویسه دارد، و «پایانِ کار» با یک فراخوانی رویِ مراجعه ثبت می‌شود
/// بدونِ اینکه بقیهٔ فیلد‌ها را لازم داشته باشد.
/// </summary>
public class RadiologyStudiesControllerTests
{
    private static ReSiRaiDbContext CreateDatabase() =>
        new(new DbContextOptionsBuilder<ReSiRaiDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static ClaimsPrincipal SuperAdmin() =>
        new(new ClaimsIdentity(new[] { new Claim("IsSuperAdmin", "true") }, "test-auth"));

    private static RadiologyStudiesController CreateController(ReSiRaiDbContext db, ClaimsPrincipal? user = null)
    {
        var controller = new RadiologyStudiesController(db, new StudyAccessService(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = user ?? SuperAdmin() }
            }
        };
        return controller;
    }

    private static int AddPatient(ReSiRaiDbContext db)
    {
        var row = new Patient
        {
            NationalCode = Guid.NewGuid().ToString("N")[..10],
            FirstName = "بیمار",
            LastName = "آزمایشی",
            IsActive = true,
            CreatedDate = DateTime.Now
        };
        db.Patients.Add(row);
        db.SaveChanges();
        return row.PatientID;
    }

    private static int AddStudyType(ReSiRaiDbContext db)
    {
        var row = new StudyType { StudyTypeName = "ویزیت عمومی", IsActive = true };
        db.StudyTypes.Add(row);
        db.SaveChanges();
        return row.StudyTypeID;
    }

    private static RadiologyStudy AddStudy(ReSiRaiDbContext db, DateTime studyDate)
    {
        var row = new RadiologyStudy
        {
            PatientID = AddPatient(db),
            StudyTypeID = AddStudyType(db),
            StudyDate = studyDate,
            CreatedDate = DateTime.Now,
            Status = 1
        };
        db.RadiologyStudies.Add(row);
        db.SaveChanges();
        return row;
    }

    private static UpdateRadiologyStudyRequest RequestFor(RadiologyStudy study, DateTime workEnd) => new()
    {
        StudyDate = study.StudyDate,
        StudyTypeID = study.StudyTypeID,
        WorkEndDate = workEnd,
        Status = 1
    };

    [Fact]
    public async Task Update_WorkEndBeforeStart_IsRejected()
    {
        var db = CreateDatabase();
        var study = AddStudy(db, new DateTime(2026, 10, 8, 10, 0, 0));
        var controller = CreateController(db);

        var result = await controller.UpdateStudy(study.StudyID, RequestFor(study, new DateTime(2026, 10, 8, 9, 0, 0)));

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        var payload = JsonSerializer.SerializeToElement(bad.Value);
        Assert.False(payload.GetProperty("success").GetBoolean());
        Assert.Contains("پایانِ کار", payload.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Update_DiagnosisLongerThanLimit_IsRejected()
    {
        var db = CreateDatabase();
        var study = AddStudy(db, new DateTime(2026, 10, 8, 10, 0, 0));
        var controller = CreateController(db);
        var request = RequestFor(study, study.StudyDate.AddHours(2));
        request.Diagnosis = new string('ن', 1001);

        var result = await controller.UpdateStudy(study.StudyID, request);

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        var payload = JsonSerializer.SerializeToElement(bad.Value);
        Assert.Contains("تشخیص", payload.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Create_WorkEndBeforeStart_IsRejected()
    {
        var db = CreateDatabase();
        var controller = CreateController(db);
        var study = new RadiologyStudy
        {
            PatientID = AddPatient(db),
            StudyTypeID = AddStudyType(db),
            StudyDate = new DateTime(2026, 10, 8, 10, 0, 0),
            WorkEndDate = new DateTime(2026, 10, 8, 8, 0, 0),
            Status = 1
        };

        var result = await controller.CreateStudy(study);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, await db.RadiologyStudies.CountAsync());
    }

    [Fact]
    public async Task WorkEnd_StampesNow_OnTheStudy()
    {
        var db = CreateDatabase();
        var study = AddStudy(db, DateTime.Now.AddMinutes(-20));
        var controller = CreateController(db);

        var result = await controller.WorkEndStudy(study.StudyID);

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = JsonSerializer.SerializeToElement(ok.Value);
        Assert.True(payload.GetProperty("success").GetBoolean());
        Assert.False(string.IsNullOrEmpty(payload.GetProperty("workEndDate").GetString()));

        var saved = await db.RadiologyStudies.AsNoTracking().FirstAsync(x => x.StudyID == study.StudyID);
        Assert.NotNull(saved.WorkEndDate);
        Assert.True(saved.WorkEndDate >= study.StudyDate);
    }

    [Fact]
    public async Task WorkEnd_IsHiddenFromAUserWithoutAccess()
    {
        var db = CreateDatabase();
        var study = AddStudy(db, DateTime.Now.AddMinutes(-5));
        // کارمندی که در tblUserDoctors هیچ پزشکی به او متصل نیست.
        var employee = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("UserID", "77"),
            new Claim("StaffID", "77"),
            new Claim("StaffType", "1")
        }, "test-auth"));
        var controller = CreateController(db, employee);

        var result = await controller.WorkEndStudy(study.StudyID);

        Assert.IsType<NotFoundObjectResult>(result);
        var saved = await db.RadiologyStudies.AsNoTracking().FirstAsync(x => x.StudyID == study.StudyID);
        Assert.Null(saved.WorkEndDate);
    }
}
