using ReSiRai.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ReSiRai.Api.Data
{
    // EF Core gateway for the ReSiRai database.
    public class ReSiRaiDbContext : DbContext
    {
        public ReSiRaiDbContext(DbContextOptions<ReSiRaiDbContext> options) : base(options) { }

        public DbSet<Patient> Patients { get; set; }
        public DbSet<RadiologyStudy> RadiologyStudies { get; set; }
        public DbSet<RadiologyImage> RadiologyImages { get; set; }
        public DbSet<RadiologyStudyImage> RadiologyStudyImages { get; set; }
        public DbSet<RadiologyStudyTooth> RadiologyStudyTeeth { get; set; }
        public DbSet<StudyType> StudyTypes { get; set; }
        public DbSet<StudyTypeSpecialty> StudyTypeSpecialties { get; set; }
        public DbSet<Staff> Staff { get; set; }
        public DbSet<Clinic> Clinics { get; set; }
        public DbSet<ClinicStaff> ClinicStaff { get; set; }
        public DbSet<Specialty> Specialties { get; set; }
        public DbSet<ImageType> ImageTypes { get; set; }
        public DbSet<User> Users { get; set; }
        public DbSet<UserDoctor> UserDoctors { get; set; }
        public DbSet<StudyAction> StudyActions { get; set; }
        public DbSet<StudyPayment> StudyPayments { get; set; }
        public DbSet<PosSetting> PosSettings { get; set; }
        public DbSet<PatientMessage> PatientMessages { get; set; }
        public DbSet<Appointment> Appointments { get; set; }
        public DbSet<WaitStage> WaitStages { get; set; }
        public DbSet<StudyShareLink> StudyShareLinks { get; set; }
        public DbSet<PairedDevice> PairedDevices { get; set; }
        public DbSet<InboxMessage> InboxMessages { get; set; }
        public DbSet<PatientReceiveToken> PatientReceiveTokens { get; set; }
        public DbSet<AIImageAnalysis> AIImageAnalyses { get; set; }
        public DbSet<AppEvent> AppEvents { get; set; }
        public DbSet<ClinicalFactor> ClinicalFactors { get; set; }
        public DbSet<SpecialtyFactorSet> SpecialtyFactorSets { get; set; }
        public DbSet<StudyFactorValue> StudyFactorValues { get; set; }
        public DbSet<LabReportExtraction> LabReportExtractions { get; set; }
        public DbSet<InsuranceType> InsuranceTypes { get; set; }
        public DbSet<StudySection> StudySections { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<RadiologyStudy>().HasOne<Patient>().WithMany().HasForeignKey(x => x.PatientID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<RadiologyStudy>().HasOne<StudyType>().WithMany().HasForeignKey(x => x.StudyTypeID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<RadiologyImage>().HasOne<Patient>().WithMany().HasForeignKey(x => x.PatientID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<RadiologyImage>().HasOne<ImageType>().WithMany().HasForeignKey(x => x.ImageTypeID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<RadiologyImage>().HasIndex(x => new { x.PatientID, x.SerialNumber }).IsUnique();

            modelBuilder.Entity<RadiologyStudyImage>().HasKey(x => new { x.StudyID, x.ImageID });
            modelBuilder.Entity<RadiologyStudyImage>().HasOne<RadiologyStudy>().WithMany().HasForeignKey(x => x.StudyID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<RadiologyStudyImage>().HasOne<RadiologyImage>().WithMany().HasForeignKey(x => x.ImageID).OnDelete(DeleteBehavior.NoAction);

            modelBuilder.Entity<RadiologyStudyTooth>().HasKey(x => new { x.StudyID, x.ToothNumber });
            modelBuilder.Entity<RadiologyStudyTooth>().HasOne<RadiologyStudy>().WithMany().HasForeignKey(x => x.StudyID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<StudyAction>().HasOne<RadiologyStudy>().WithMany().HasForeignKey(x => x.StudyID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<StudyPayment>().HasOne<RadiologyStudy>().WithMany().HasForeignKey(x => x.StudyID).OnDelete(DeleteBehavior.NoAction);

            // One stored AI result per image per kind; deleting the picture deletes
            // its results, because a result without its image cannot be verified.
            modelBuilder.Entity<AIImageAnalysis>().HasIndex(x => new { x.ImageID, x.Kind }).IsUnique();
            modelBuilder.Entity<AIImageAnalysis>().HasOne<RadiologyImage>().WithMany().HasForeignKey(x => x.ImageID).OnDelete(DeleteBehavior.Cascade);

            // Clinic membership is a many-to-many relationship represented by tblClinicStaff.
            modelBuilder.Entity<ClinicStaff>().HasKey(x => new { x.ClinicID, x.StaffID });
            modelBuilder.Entity<ClinicStaff>().HasOne<Clinic>().WithMany().HasForeignKey(x => x.ClinicID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<ClinicStaff>().HasOne<Staff>().WithMany().HasForeignKey(x => x.StaffID).OnDelete(DeleteBehavior.NoAction);

            // Specialty is optional for employees and is used for doctors.
            modelBuilder.Entity<Staff>().HasOne<Specialty>().WithMany().HasForeignKey(x => x.SpecialtyID).OnDelete(DeleteBehavior.NoAction);

            // Every ReSiRai User belongs to exactly one Staff record.
            modelBuilder.Entity<User>().HasOne<Staff>().WithMany().HasForeignKey(x => x.StaffID).OnDelete(DeleteBehavior.NoAction);

            // Employee access to doctors is clinic-specific. Keeping the same
            // composite key as SQL prevents duplicate assignments.
            modelBuilder.Entity<UserDoctor>().HasKey(x => new { x.UserID, x.ClinicID, x.DoctorStaffID });
            modelBuilder.Entity<UserDoctor>().HasOne<User>().WithMany().HasForeignKey(x => x.UserID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<UserDoctor>().HasOne<Staff>().WithMany().HasForeignKey(x => x.DoctorStaffID).OnDelete(DeleteBehavior.NoAction);

            // A specialty lists factors from the one shared dictionary; the composite
            // key matches SQL and keeps a factor from being bound twice.
            modelBuilder.Entity<SpecialtyFactorSet>().HasKey(x => new { x.SpecialtyID, x.FactorID });
            modelBuilder.Entity<SpecialtyFactorSet>().HasOne<ClinicalFactor>().WithMany().HasForeignKey(x => x.FactorID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<SpecialtyFactorSet>().HasOne<Specialty>().WithMany().HasForeignKey(x => x.SpecialtyID).OnDelete(DeleteBehavior.NoAction);

            // Factor values belong to a visit and stay over time (trend); the source
            // column says whether a number was typed, extracted from a lab report or
            // computed. Deleting rules follow SQL (no action) to stay consistent.
            modelBuilder.Entity<StudyFactorValue>().HasOne<RadiologyStudy>().WithMany().HasForeignKey(x => x.StudyID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<StudyFactorValue>().HasOne<ClinicalFactor>().WithMany().HasForeignKey(x => x.FactorID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<StudyFactorValue>().HasIndex(x => new { x.StudyID, x.FactorID, x.ObservedAt });

            // One lab-report extraction batch belongs to one visit; the raw model
            // output is kept as the audit trail of every extracted number.
            modelBuilder.Entity<LabReportExtraction>().HasOne<RadiologyStudy>().WithMany().HasForeignKey(x => x.StudyID).OnDelete(DeleteBehavior.NoAction);

            // Patient insurance points at the shared insurance dictionary; a type
            // in use is deactivated, never deleted, so these links stay valid.
            modelBuilder.Entity<Patient>().HasOne<InsuranceType>().WithMany()
                .HasForeignKey(x => x.BaseInsuranceTypeID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<Patient>().HasOne<InsuranceType>().WithMany()
                .HasForeignKey(x => x.Supp1InsuranceTypeID).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<Patient>().HasOne<InsuranceType>().WithMany()
                .HasForeignKey(x => x.Supp2InsuranceTypeID).OnDelete(DeleteBehavior.NoAction);

            // Visit type <-> specialty: a type belongs to the specialties that
            // offer it. Composite key matches SQL and the two ON DELETE CASCADE
            // rules keep the link table free of orphans.
            modelBuilder.Entity<StudyTypeSpecialty>().HasKey(x => new { x.StudyTypeID, x.SpecialtyID });
            modelBuilder.Entity<StudyTypeSpecialty>().HasOne<StudyType>().WithMany()
                .HasForeignKey(x => x.StudyTypeID).OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<StudyTypeSpecialty>().HasOne<Specialty>().WithMany()
                .HasForeignKey(x => x.SpecialtyID).OnDelete(DeleteBehavior.Cascade);

            // Tick-based visit sections: one row per (visit, section). The delete rule
            // follows SQL (cascade) - a deleted visit takes its recorded sections with
            // it - and the unique index is the "recording again replaces" contract of
            // the upsert in StudySectionsController.
            modelBuilder.Entity<StudySection>().HasOne<RadiologyStudy>().WithMany()
                .HasForeignKey(x => x.StudyID).OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<StudySection>().HasIndex(x => new { x.StudyID, x.SectionCode }).IsUnique();
            modelBuilder.Entity<StudySection>().Property(x => x.RecordedAt)
                .HasDefaultValueSql("SYSDATETIME()");
        }
    }
}
