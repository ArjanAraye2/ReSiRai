using Microsoft.EntityFrameworkCore;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;

namespace ReSiRai.Api.Services;

/// <summary>
/// ReSiRai به پزشک خدمات می‌دهد؛ واحدِ کار «پزشک» است و هر پزشک مطبِ خودش.
/// ClinicID در اسکیمای مراجعه اجباری است، پس برای هر پزشکِ بدونِ مطب یک مطبِ
/// فعال به نامِ خودش ساخته و به او وصل می‌شود. عملیات idempotent است: اگر پزشک
/// از قبل مطب داشته باشد هیچ چیز ساخته نمی‌شود.
/// </summary>
public static class ClinicProvisioning
{
    public static async Task<Clinic?> EnsureForDoctorAsync(ReSiRaiDbContext db, int staffID, CancellationToken ct = default)
    {
        if (staffID <= 0) return null;
        var staff = await db.Staff.AsNoTracking().FirstOrDefaultAsync(s => s.StaffID == staffID, ct);
        return staff == null ? null : await EnsureForDoctorAsync(db, staff, ct);
    }

    public static async Task<Clinic?> EnsureForDoctorAsync(ReSiRaiDbContext db, Staff staff, CancellationToken ct = default)
    {
        // فقط پزشک (StaffType=2) مطبِ مستقل می‌گیرد؛ کارمند/منشی به مطبِ پزشک وصل می‌شود.
        if (staff == null || staff.StaffType != 2 || staff.StaffID <= 0) return null;

        int? existingClinicID = await db.ClinicStaff.AsNoTracking()
            .Where(x => x.StaffID == staff.StaffID)
            .Select(x => (int?)x.ClinicID)
            .FirstOrDefaultAsync(ct);
        if (existingClinicID.HasValue)
            return await db.Clinics.AsNoTracking().FirstOrDefaultAsync(c => c.ClinicID == existingClinicID.Value, ct);

        string fullName = ($"{staff.FirstName} {staff.LastName}").Trim();
        var clinic = new Clinic
        {
            ClinicName = string.IsNullOrWhiteSpace(fullName) ? "مطب" : $"مطب دکتر {fullName}",
            IsActive = true
        };
        db.Clinics.Add(clinic);
        await db.SaveChangesAsync(ct);
        db.ClinicStaff.Add(new ClinicStaff { ClinicID = clinic.ClinicID, StaffID = staff.StaffID });
        await db.SaveChangesAsync(ct);
        return clinic;
    }
}
