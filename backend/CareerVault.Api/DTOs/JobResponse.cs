namespace CareerVault.Api.DTOs;

// Defines the information returned to the frontend.
public class JobResponse
{
    public int Id { get; set; }

    public string CompanyName { get; set; } = string.Empty;

    public string JobTitle { get; set; } = string.Empty;

    public string? Location { get; set; }

    public string? JobUrl { get; set; }

    public DateOnly? DateApplied { get; set; }

    public string Status { get; set; } = string.Empty;

    public string? Notes { get; set; }

    public string? JobDescription { get; set; }

    public string? Pay { get; set; }

    public string? Recruiter { get; set; }

    // The resume uploaded to this application (null if none).
    public int? ResumeVersionId { get; set; }
    public AttachedResumeResponse? Resume { get; set; }
}

// The resume file attached to a job, as shown in the grid and details.
// The file itself is read through GET /api/resume-versions/{VersionId}/file.
public class AttachedResumeResponse
{
    public int VersionId { get; set; }
    public string OriginalFileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public DateTimeOffset UploadedAt { get; set; }
}