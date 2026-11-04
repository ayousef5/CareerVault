namespace CareerVault.Api.DTOs;

// The job details found at a URL. Fields that couldn't be found are null.
// Nothing is saved: the frontend shows these for the user to review.
public class ExtractedJobResponse
{
    // The link the user gave (kept as the job's App Link).
    public string Url { get; set; } = string.Empty;

    public string? CompanyName { get; set; }
    public string? JobTitle { get; set; }
    public string? Location { get; set; }
    public string? Pay { get; set; }
    public string? JobDescription { get; set; }
    public string? Recruiter { get; set; }
}
