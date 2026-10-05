using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ReSiRai.Api.Models;

/// <summary>
/// One recorded section of one visit (شکایت و آنامنز، علائم حیاتی، …) exactly as
/// the tick-first paper prototype keeps them: chips, checklists and numbers of one
/// section travel together as one JSON payload.
///
/// A section is stored at most once per visit — UX_tblStudySections_Study_Section
/// on (StudyID, SectionCode) is what turns "confirm &amp; record" on an already
/// recorded section into an update (ModifiedDate) instead of a second row.
///
/// DataJson is free-form and owned by the web client; the server never reads its
/// keys. Its shape is documented in Controllers/StudySectionsController.cs.
/// </summary>
[Table("tblStudySections")]
public class StudySection
{
    [Key]
    public long StudySectionID { get; set; }

    public int StudyID { get; set; }

    /// <summary>Stable machine code of the section (anamnesis, vitals, bp, …).</summary>
    [MaxLength(60)]
    public string SectionCode { get; set; } = string.Empty;

    /// <summary>Title shown in the accordion (may be renamed without touching the code).</summary>
    [MaxLength(150)]
    public string Title { get; set; } = string.Empty;

    /// <summary>Free-form section payload written by the client.</summary>
    public string DataJson { get; set; } = "{}";

    /// <summary>When the section was first recorded.</summary>
    public DateTime RecordedAt { get; set; }

    /// <summary>Set when a recorded section was confirmed again (edit in place).</summary>
    public DateTime? ModifiedDate { get; set; }
}
