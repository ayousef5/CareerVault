using CareerVault.Api.DTOs;

namespace CareerVault.Api.Validation;

// Rules for deciding whether a job has real, user-entered information.
public static class JobValidation
{
    // The status every new job starts with. On its own it doesn't count as
    // information the user entered.
    public const string DefaultStatus = "Not Applied";

    // The message sent back when a request has nothing worth saving.
    public const string EmptyJobMessage =
        "Enter at least one detail (for example a company or role) before saving a job.";

    // True when at least one field has something the user typed or chose.
    // A job with only a company (or only a role, a link, a date...) is valid.
    // Blank text and the default "Not Applied" status don't count.
    public static bool HasMeaningfulContent(CreateJobRequest request)
    {
        return HasText(request.CompanyName)
            || HasText(request.JobTitle)
            || HasText(request.Location)
            || HasText(request.JobUrl)
            || request.DateApplied is not null
            || HasText(request.Notes)
            || HasText(request.JobDescription)
            || HasText(request.Pay)
            || HasText(request.Recruiter)
            || (HasText(request.Status)
                && !string.Equals(
                    request.Status.Trim(),
                    DefaultStatus,
                    StringComparison.OrdinalIgnoreCase));
    }

    private static bool HasText(string? value) => !string.IsNullOrWhiteSpace(value);
}
