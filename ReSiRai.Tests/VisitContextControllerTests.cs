using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ReSiRai.Api.Controllers;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using Xunit;

namespace ReSiRai.Tests;

/// <summary>
/// نگهبانِ «زمینهٔ مراجعه»: کارتِ مراجعه بدونِ هیچ انتخابِ دستی باید بتواند مراجعه
/// بسازد، چون سرور برایِ کاربرِ عادی ثبت را بدونِ ClinicID و DoctorStaffID نمی‌پذیرد.
/// قوید: پزشک = خودش · کارمند = پزشکِ متصل در همان مطب · مدیر = باید انتخاب کند ·
/// مطب = مطبِ پرسنل یا تنها مطبِ فعال.
/// </summary>
public class VisitContextControllerTests
{
    private static ReSiRaiDbContext CreateDatabase() =>
        new(new DbContextOptionsBuilder<ReSiRaiDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static ClaimsPrincipal User(int userID, int staffID, byte staffType, bool superAdmin = false, int specialtyID = 0)
    {
        var claims = new List<Claim>
        {
            new("UserID", userID.ToString()),
            new("StaffID", staffID.ToString()),
            new("StaffType", staffType.ToString()),
            new("IsSuperAdmin", superAdmin ? "true" : "false")
        };
        if (specialtyID > 0) claims.Add(new Claim("SpecialtyID", specialtyID.ToString()));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "test-auth"));
    }

    private static VisitContextController CreateController(ReSiRaiDbContext db, ClaimsPrincipal user) =>
        new(db)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };

    private static async Task<JsonElement> Get(ReSiRaiDbContext db, ClaimsPrincipal user)
    {
        var controller = CreateController(db, user);
        var ok = Assert.IsType<OkObjectResult>(await controller.Get(default));
        return JsonSerializer.SerializeToElement(ok.Value);
    }

    private static int AddClinic(ReSiRaiDbContext db, bool active = true)
    {
        var row = new Clinic { ClinicName = "مطبِ مرکزی", IsActive = active };
        db.Clinics.Add(row);
        db.SaveChanges();
        return row.ClinicID;
    }

    private static int AddStaff(ReSiRaiDbContext db, byte staffType, int? specialtyID = null)
    {
        var row = new Staff
        {
            NationalCode = Guid.NewGuid().ToString("N")[..10],
            FirstName = "پزشک",
            LastName = "نمونه",
            StaffType = staffType,
            SpecialtyID = specialtyID,
            StartDate = DateTime.Now
        };
        db.Staff.Add(row);
        db.SaveChanges();
        return row.StaffID;
    }

    [Fact]
    public async Task Doctor_IsTheirOwnVisitDoctor()
    {
        var db = CreateDatabase();
        int clinicID = AddClinic(db);
        int staffID = AddStaff(db, staffType: 2, specialtyID: 11);
        db.ClinicStaff.Add(new ClinicStaff { ClinicID = clinicID, StaffID = staffID });
        db.SaveChanges();

        var payload = await Get(db, User(userID: 5, staffID: staffID, staffType: 2));

        Assert.True(payload.GetProperty("success").GetBoolean());
        Assert.Equal(clinicID, payload.GetProperty("clinicID").GetInt32());
        Assert.Equal(staffID, payload.GetProperty("doctorStaffID").GetInt32());
        Assert.Equal(11, payload.GetProperty("specialtyID").GetInt32());
        Assert.False(payload.GetProperty("canPickDoctor").GetBoolean());
    }

    [Fact]
    public async Task Employee_GetsTheSingleLinkedDoctor()
    {
        var db = CreateDatabase();
        int clinicID = AddClinic(db);
        int doctorID = AddStaff(db, staffType: 2, specialtyID: 10);
        int employeeID = AddStaff(db, staffType: 1);
        db.UserDoctors.Add(new UserDoctor { UserID = 7, ClinicID = clinicID, DoctorStaffID = doctorID });
        db.SaveChanges();

        var payload = await Get(db, User(userID: 7, staffID: employeeID, staffType: 1));

        Assert.Equal(clinicID, payload.GetProperty("clinicID").GetInt32());
        Assert.Equal(doctorID, payload.GetProperty("doctorStaffID").GetInt32());
        // رشته از claim نیامد، پس از خودِ پزشک آمده است.
        Assert.Equal(10, payload.GetProperty("specialtyID").GetInt32());
        Assert.False(payload.GetProperty("canPickDoctor").GetBoolean());
    }

    [Fact]
    public async Task Employee_WithTwoLinkedDoctors_MustPick()
    {
        var db = CreateDatabase();
        int clinicID = AddClinic(db);
        int first = AddStaff(db, staffType: 2);
        int second = AddStaff(db, staffType: 2);
        db.UserDoctors.Add(new UserDoctor { UserID = 9, ClinicID = clinicID, DoctorStaffID = first });
        db.UserDoctors.Add(new UserDoctor { UserID = 9, ClinicID = clinicID, DoctorStaffID = second });
        db.SaveChanges();

        var payload = await Get(db, User(userID: 9, staffID: 3, staffType: 1));

        Assert.True(payload.GetProperty("doctorStaffID").ValueKind == JsonValueKind.Null);
        Assert.True(payload.GetProperty("canPickDoctor").GetBoolean());
        Assert.Equal(clinicID, payload.GetProperty("clinicID").GetInt32());
    }

    [Fact]
    public async Task SuperAdmin_GetsTheOnlyClinic_AndMustPickADoctor()
    {
        var db = CreateDatabase();
        int clinicID = AddClinic(db);

        var payload = await Get(db, User(userID: 1, staffID: 0, staffType: 0, superAdmin: true));

        Assert.Equal(clinicID, payload.GetProperty("clinicID").GetInt32());
        Assert.True(payload.GetProperty("doctorStaffID").ValueKind == JsonValueKind.Null);
        Assert.True(payload.GetProperty("canPickDoctor").GetBoolean());
    }

    [Fact]
    public async Task NoActiveClinic_LeavesClinicEmpty_InsteadOfGuessing()
    {
        var db = CreateDatabase();
        AddClinic(db, active: false);

        var payload = await Get(db, User(userID: 1, staffID: 0, staffType: 0, superAdmin: true));

        Assert.True(payload.GetProperty("clinicID").ValueKind == JsonValueKind.Null);
    }
}
