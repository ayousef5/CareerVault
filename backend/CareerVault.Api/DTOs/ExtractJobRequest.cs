namespace CareerVault.Api.DTOs;

// The body of POST /api/jobs/extract.
public class ExtractJobRequest
{
    // The job posting link to read.
    public string? Url { get; set; }
}
