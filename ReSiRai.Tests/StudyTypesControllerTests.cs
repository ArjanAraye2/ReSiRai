using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ReSiRai.Api.Controllers;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using Xunit;

namespace ReSiRai.Tests;

/// <summary>
/// نگهبانِ فیلترِ «نوعِ مراجعه» (docs/design/visit-types.md):
/// فهرستِ فرم باید برایِ یک تخصص = نوع‌هایِ همان تخصص ∪ مشترک‌ها ∪ «سایر» باشد،
/// بدونِ پارامتر رفتارِ قبلی (همهٔ نوع‌هایِ فعال) دست‌نخورده بماند، و هیچ
/// تخصصِ بدونِ ردیفِ ربط — یا نوعِ تازه‌افزوده‌شده در پنلِ مدیریت — بی‌صدا
/// از فهرست حذف نشود. اگر یکی از این‌ها بیفتد یا فرم خالی می شود یا مراجعهٔ
/// قدیمی نامرئی.
/// </summary>
public class StudyTypesControllerTests
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

    private static int AddType(ReSiRaiDbContext db, string name, bool active = true)
    {
        var row = new StudyType { StudyTypeName = name, IsActive = active };
        db.StudyTypes.Add(row);
        db.SaveChanges();
        return row.StudyTypeID;
    }

    private static void Link(ReSiRaiDbContext db, int studyTypeID, int specialtyID)
    {
        db.StudyTypeSpecialties.Add(new StudyTypeSpecialty { StudyTypeID = studyTypeID, SpecialtyID = specialtyID });
        db.SaveChanges();
    }

    private static StudyTypesController CreateController(ReSiRaiDbContext db) => new(db);

    private static async Task<JsonElement> List(ReSiRaiDbContext db, int? specialtyID)
    {
        var controller = CreateController(db);
        var ok = Assert.IsType<OkObjectResult>(await controller.GetActiveStudyTypes(specialtyID));
        return JsonSerializer.SerializeToElement(ok.Value);
    }

    private static string[] Names(JsonElement payload)
    {
        var items = payload.GetProperty("studyTypes").EnumerateArray().ToList();
        return items.Select(x => x.GetProperty("StudyTypeName").GetString() ?? "").ToArray();
    }

    [Fact]
    public async Task FilteredListIsThatSpecialtyUnionSharedAndOther()
    {
        using var db = CreateDatabase();
        int cardio = AddSpecialty(db, "بیماری‌های قلب و عروق");
        int eye = AddSpecialty(db, "چشم");

        int visit = AddType(db, "ویزیت قلب");
        int chestPain = AddType(db, "درد سینه");
        int cataract = AddType(db, "آب مروارید");     // مالِ تخصصِ دیگر
        int shared = AddType(db, "پیگیری");            // مشترک: بدونِ ردیفِ ربط
        int other = AddType(db, "سایر");
        int inactive = AddType(db, "نوعِ غیرفعال", active: false);

        Link(db, visit, cardio);
        Link(db, chestPain, cardio);
        Link(db, cataract, eye);
        Link(db, other, cardio);
        Link(db, other, eye);
        Link(db, inactive, cardio);

        var payload = await List(db, cardio);
        var names = Names(payload);

        Assert.Contains("ویزیت قلب", names);
        Assert.Contains("درد سینه", names);
        Assert.Contains("پیگیری", names);   // مشترک‌ها بدونِ ربطِ صریح هم می‌آیند
        Assert.Contains("سایر", names);
        Assert.DoesNotContain("آب مروارید", names); // تخصصِ دیگر راه ندارد
        Assert.DoesNotContain("نوعِ غیرفعال", names);
        Assert.Equal(cardio, payload.GetProperty("specialtyID").GetInt32());
        Assert.Equal(payload.GetProperty("count").GetInt32(), names.Length);
    }

    [Fact]
    public async Task WithoutSpecialtyTheOldBehaviourIsUnchanged()
    {
        using var db = CreateDatabase();
        int cardio = AddSpecialty(db, "بیماری‌های قلب و عروق");
        AddType(db, "ویزیت قلب");
        AddType(db, "آب مروارید");
        AddType(db, "نوعِ غیرفعال", active: false);

        var payload = await List(db, null);
        var names = Names(payload);

        Assert.Equal(new[] { "آب مروارید", "ویزیت قلب" }, names.OrderBy(x => x, StringComparer.Ordinal).ToArray());
        Assert.Equal(JsonValueKind.Null, payload.GetProperty("specialtyID").ValueKind);

        // پارامترِ صفر یا ناموجود همان مسیرِ بدونِ فیلتر است (کلاینتِ کهنه نمی‌شکند).
        var zero = await List(db, 0);
        Assert.Equal(JsonValueKind.Null, zero.GetProperty("specialtyID").ValueKind);
        Assert.Equal(names, Names(zero));
    }

    [Fact]
    public async Task SpecialtyWithoutAnyLinkFallsBackToTheFullList()
    {
        using var db = CreateDatabase();
        int fresh = AddSpecialty(db, "تخصصِ بدونِ ربط");  // مهاجرت هنوز اجرا نشده
        int unknown = 9999;
        AddType(db, "ویزیت قلب");
        AddType(db, "سایر");

        foreach (var specialtyID in new[] { fresh, unknown })
        {
            var payload = await List(db, specialtyID);
            Assert.Equal(2, payload.GetProperty("count").GetInt32());
            Assert.Equal(JsonValueKind.Null, payload.GetProperty("specialtyID").ValueKind);
        }
    }

    [Fact]
    public async Task TypeNobodyLinkedIsStillOfferedSoItCannotVanish()
    {
        using var db = CreateDatabase();
        int cardio = AddSpecialty(db, "بیماری‌های قلب و عروق");
        int linked = AddType(db, "ویزیت قلب");
        Link(db, linked, cardio);
        // نوعِ تازه در پنلِ مدیریت: هنوز ردیفِ ربط ندارد ولی باید دیده شود.
        AddType(db, "نوعِ تازه");

        var payload = await List(db, cardio);
        var names = Names(payload);

        Assert.Contains("ویزیت قلب", names);
        Assert.Contains("نوعِ تازه", names);
        Assert.Equal(cardio, payload.GetProperty("specialtyID").GetInt32());
    }
}
