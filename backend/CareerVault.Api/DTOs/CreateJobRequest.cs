namespace CareerVault.Api.DTOs;

public class CreateJobRequest
{
    public string CompanyName { get; set; } = string.Empty;
    public string JobTitle { get; set; } = string.Empty;
    public string? Location { get; set; }
    public string? JobUrl { get; set; }
    public DateOnly? DateApplied { get; set; }
    public string Status { get; set; } = "Not Applied";
    public string? Notes { get; set; }

    // Optional full text of the job posting.
    public string? JobDescription { get; set; }

    // Optional pay or salary info for the job.
    public string? Pay { get; set; }

    // Optional name or contact of the recruiter.
    public string? Recruiter { get; set; }

    // (There's no resume field: a resume is uploaded and removed through
    // PUT/DELETE /api/jobs/{id}/resume, so saving the job's other fields can
    // never change or remove its attachment.)
}