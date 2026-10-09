namespace ReSiRai.Api.Data;

/// <summary>
/// Pragmatic flag set once at startup before any DbContext is created (see
/// Program.cs) so OnModelCreating can emit dialect-specific pieces — e.g. the
/// default timestamp function: PostgreSQL uses now(), SQL Server uses
/// SYSDATETIME(). Purely DB-level; application behavior never depends on it.
/// </summary>
public static class DbRuntime
{
    public static bool IsPostgres { get; set; }
}
