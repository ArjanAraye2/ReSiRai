using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ReSiRai.Api.Controllers;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Xunit;

namespace ReSiRai.Tests;

/// <summary>
/// نگهبانِ «بارداری/شیردهی فقط برای زن» سمتِ سرور:
/// فهرستِ فاکتورها (definitions) نباید برایِ بیمارِ مرد فاکتورِ HIST.PREG را
/// بفرستد — فیلترِ کلاینتی با JSِ کهنه یا نبودِ window.selectedPatient بی‌اثر
/// می‌شود، ولی جنسیتِ واقعیِ بیمار همیشه از دیتابیس می‌آید. جنسیتِ ناشناخته و
/// فراخوانیِ بدونِ StudyID (پیش‌نویسِ مراجعه) باید همان رفتارِ قبلی را داشته
/// باشند تا فرمِ زن هیچ‌وقت فاکتورش را از دست ندهد.
/// </summary>
public class ClinicalFactorsControllerTests
{
    private static ReSiRaiDbContext CreateDatabase() =>
        new(new DbContextOptionsBuilder<ReSiRaiDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static int AddSpecialty(ReSiRaiDbContext db, string name)
    {
        var row = new Specialty { SpecialtyName = name, IsActive = true };
        db.Specialties.Add(row);
        db.SaveChanges();
        return row.SpecialtyID;
    }

    private static int AddFactor(ReSiRaiDbContext db, string code, string nameFa)
    {
        var row = new ClinicalFactor
        {
            FactorCode = code,
            NameFa = nameFa,
            NameEn = code,
            Category = "History",
            DataType = 2,
            RefSource = "",
            IsActive = true
        };
        db.ClinicalFactors.Add(row);
        db.SaveChanges();
        return row.FactorID;
    }

    private static void Link(ReSiRaiDbContext db, int factorID, int specialtyID)
    {
        db.SpecialtyFactorSets.Add(new SpecialtyFactorSet { FactorID = factorID, SpecialtyID = specialtyID });
        db.SaveChanges();
    }

    private static int AddPatient(ReSiRaiDbContext db, byte? gender)
    {
        var row = new Patient
        {
            NationalCode = Guid.NewGuid().ToString("N")[..10],
            FirstName = "بیمار",
            LastName = "آزمایشی",
            Gender = gender,
            IsActive = true,
            CreatedDate = DateTime.Now
        };
        db.Patients.Add(row);
        db.SaveChanges();
        return row.PatientID;
    }

    private static int AddStudy(ReSiRaiDbContext db, int patientID)
    {
        var row = new RadiologyStudy
        {
            PatientID = patientID,
            StudyDate = DateTime.Now,
            CreatedDate = DateTime.Now
        };
        db.RadiologyStudies.Add(row);
        db.SaveChanges();
        return row.StudyID;
    }

    private static ClinicalFactorsController CreateController(ReSiRaiDbContext db) =>
        new(db, null!);

    private static async Task<JsonElement> Definitions(ReSiRaiDbContext db, int? specialtyID, int? studyID = null)
    {
        var controller = CreateController(db);
        var ok = Assert.IsType<OkObjectResult>(await controller.Definitions(specialtyID, studyID));
        return JsonSerializer.SerializeToElement(ok.Value);
    }

    private static string[] Codes(JsonElement payload)
    {
        var factors = payload.GetProperty("factors").EnumerateArray().ToList();
        return factors.Select(x => x.GetProperty("FactorCode").GetString() ?? "").ToArray();
    }

    /// <summary>مشترکِ همهٔ حالت‌ها: دو فاکتور، یکی «بارداری/شیردهی».</summary>
    private static (int specialtyID, int pregFactorID) SeedSet(ReSiRaiDbContext db)
    {
        int specialtyID = AddSpecialty(db, "بیماری‌های داخلی");
        int preg = AddFactor(db, "HIST.PREG", "بارداری/شیردهی");
        int other = AddFactor(db, "VITAL.SBP", "فشار خون سیستولیک");
        Link(db, preg, specialtyID);
        Link(db, other, specialtyID);
        return (specialtyID, preg);
    }

    [Fact]
    public async Task Definitions_MalePatient_DropsPregnancyFactor()
    {
        var db = CreateDatabase();
        var (specialtyID, _) = SeedSet(db);
        int studyID = AddStudy(db, AddPatient(db, gender: 1));

        var codes = Codes(await Definitions(db, specialtyID, studyID));

        Assert.DoesNotContain("HIST.PREG", codes);
        Assert.Contains("VITAL.SBP", codes);
    }

    [Fact]
    public async Task Definitions_FemalePatient_KeepsPregnancyFactor()
    {
        var db = CreateDatabase();
        var (specialtyID, _) = SeedSet(db);
        int studyID = AddStudy(db, AddPatient(db, gender: 2));

        var codes = Codes(await Definitions(db, specialtyID, studyID));

        Assert.Contains("HIST.PREG", codes);
    }

    [Fact]
    public async Task Definitions_UnknownGender_KeepsPregnancyFactor()
    {
        var db = CreateDatabase();
        var (specialtyID, _) = SeedSet(db);
        int studyID = AddStudy(db, AddPatient(db, gender: null));

        var codes = Codes(await Definitions(db, specialtyID, studyID));

        Assert.Contains("HIST.PREG", codes);
    }

    [Fact]
    public async Task Definitions_WithoutStudyID_KeepsPregnancyFactor()
    {
        // حالتِ پیش‌نویسِ مراجعهٔ جدید: StudyID نیست، پس جنسیتی هم برای فیلتر
        // نیست و رفتارِ قبلی (همهٔ فاکتورهای فعال) باید دست‌نخورده بماند.
        var db = CreateDatabase();
        var (specialtyID, _) = SeedSet(db);

        var codes = Codes(await Definitions(db, specialtyID));

        Assert.Contains("HIST.PREG", codes);
    }

    [Fact]
    public async Task Definitions_MalePatient_StudyIDWithoutSpecialty_UsesFallbackAndStillDrops()
    {
        // specialtyID داده نشده: تخصص از پزشکِ مراجعه می‌آید و پزشکی نیست، پس
        // مجموعهٔ داخلِ مدیریت (اینجا همان داخلی) انتخاب می‌شود؛ فیلترِ جنسیت
        // باز هم باید اعمال شود.
        var db = CreateDatabase();
        var (specialtyID, _) = SeedSet(db);
        int studyID = AddStudy(db, AddPatient(db, gender: 1));

        var codes = Codes(await Definitions(db, null, studyID));

        Assert.Contains("HIST.PREG", db.ClinicalFactors.AsNoTracking()
            .Select(x => x.FactorCode).ToList());
        Assert.DoesNotContain("HIST.PREG", codes);
    }
}
