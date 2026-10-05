/*
 20261007_StudySections.sql - tick-based visit sections (general-practice visit)

 Purpose:
   One row per (visit, section): the paper prototype (docs/design/gp-visit-proto.html)
   keeps a visit as a list of sections - complaint/anamnesis, vitals, general exam,
   blood pressure, sugar, lifestyle, screening, the three linked sections and the
   optional extras. Each section is tick-first: chips, checklists and numbers are
   saved as one JSON payload through a single "confirm & record" click.

   DataJson is free-form JSON owned by the section itself (the server never reads
   its keys). The shape the web client writes is documented in
   ReSiRai.Api/Controllers/StudySectionsController.cs.

   One row per section (not one row per click) is what makes "recording again
   replaces" possible: UX_tblStudySections_Study_Section is unique, so an edit
   updates the same row (ModifiedDate is stamped) instead of stacking duplicates.

 Tables:
   tblStudySections   recorded sections of one visit

 Usage:
   sqlcmd -S <server> -d ReSiRai -W -f 65001 -i 20261007_StudySections.sql
*/
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.tblStudySections', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblStudySections(
        StudySectionID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblStudySections PRIMARY KEY,
        StudyID INT NOT NULL,
        SectionCode NVARCHAR(60) NOT NULL,        -- stable machine code (anamnesis, vitals, bp, ...)
        Title NVARCHAR(150) NOT NULL,             -- display title, may follow a localized rename
        DataJson NVARCHAR(MAX) NOT NULL,          -- free-form section payload, owned by the client
        RecordedAt DATETIME2(0) NOT NULL CONSTRAINT DF_tblStudySections_RecordedAt DEFAULT(SYSDATETIME()),
        ModifiedDate DATETIME2(0) NULL,           -- NULL until the section is edited once
        CONSTRAINT FK_tblStudySections_Studies FOREIGN KEY(StudyID)
            REFERENCES dbo.tblRadiologyStudies(StudyID) ON DELETE CASCADE
    );
    -- A section is recorded at most once per visit; this index is the upsert contract.
    CREATE UNIQUE INDEX UX_tblStudySections_Study_Section ON dbo.tblStudySections(StudyID, SectionCode);
END;
GO

PRINT N'20261007_StudySections: tblStudySections created.';
GO
