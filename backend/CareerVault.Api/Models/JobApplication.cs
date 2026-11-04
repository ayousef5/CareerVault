namespace CareerVault.Api.Models;
using CareerVault.Api.Identity;
// Represents one job application in our database.
public class JobApplication
{
    public int Id { get; set; }

    // The ID of the user who owns this job application.
    public string UserId { get; set; } = string.Empty;
    // The user account that owns this job application.
    public ApplicationUser User { get; set; } = null!;
    public string CompanyName { get; set; } = string.Empty;

    public string JobTitle { get; set; } = string.Empty;

    public string? Location { get; set; }

    public string? JobUrl { get; set; }

    public DateOnly? DateApplied { get; set; }

    public string Status { get; set; } = "Not Applied";

    public string? Notes { get; set; }

    public string? JobDescription { get; set; }

    // Optional pay or salary info, e.g. "$120k - $140k" or "$45/hr".
    public string? Pay { get; set; }

    // Optional name or contact of the recruiter for this job.
    public string? Recruiter { get; set; }

    // The exact resume file (version) sent with this application, if any.
    // It points at a version, not a resume, so uploading a newer version
    // of the same resume never changes what older applications show.
    public int? ResumeVersionId { get; set; }
    public ResumeVersion? ResumeVersion { get; set; }

    // The job's position in the user's list. New jobs get the next number,
    // so jobs are shown in the order they were added. Editing never changes it.
    public int SortOrder { get; set; }
}