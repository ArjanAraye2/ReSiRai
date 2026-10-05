using System.ComponentModel.DataAnnotations.Schema;

namespace ReSiRai.Api.Models;

/// <summary>
/// Which visit types (عللِ مراجعه) one specialty offers. The rows marked as
/// مشترک in docs/design/visit-types.md belong to every specialty, so they are
/// simply linked to all of them; the visit form asks the server for one
/// specialty and gets "that specialty ∪ shared ∪ سایر".
///
/// Both foreign keys cascade: removing a lookup row must not leave orphan
/// links behind (SQL Server: 20261010_StudyTypeSpecialties.sql).
/// </summary>
[Table("tblStudyTypeSpecialties")]
public class StudyTypeSpecialty
{
    public int StudyTypeID { get; set; }

    public int SpecialtyID { get; set; }
}
