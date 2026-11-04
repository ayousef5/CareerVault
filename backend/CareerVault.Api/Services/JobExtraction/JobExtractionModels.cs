using AngleSharp.Html.Dom;

namespace CareerVault.Api.Services.JobExtraction;

// Limits for fetching job posting pages. The defaults are used unless
// tests (or configuration) pass different values.
public sealed class JobExtractionOptions
{
    // How many redirects to follow before giving up.
    public int MaxRedirects { get; init; } = 5;

    // The largest page we'll download (3 MB).
    public long MaxResponseBytes { get; init; } = 3 * 1024 * 1024;

    // How long the whole fetch (including redirects) may take.
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(10);
}

// The job details found on a page. Every field is optional: anything that
// couldn't be found is null. Nothing is ever guessed or made up.
public sealed record ExtractedJob
{
    public string? CompanyName { get; init; }
    public string? JobTitle { get; init; }
    public string? Location { get; init; }
    public string? Pay { get; init; }
    public string? JobDescription { get; init; }
    public string? Recruiter { get; init; }

    public bool IsEmpty =>
        CompanyName is null && JobTitle is null && Location is null
        && Pay is null && JobDescription is null && Recruiter is null;

    // Fills this job's missing fields from another (lower-priority) result.
    public ExtractedJob WithFallback(ExtractedJob? other)
    {
        if (other is null)
            return this;

        return new ExtractedJob
        {
            CompanyName = CompanyName ?? other.CompanyName,
            JobTitle = JobTitle ?? other.JobTitle,
            Location = Location ?? other.Location,
            Pay = Pay ?? other.Pay,
            JobDescription = JobDescription ?? other.JobDescription,
            Recruiter = Recruiter ?? other.Recruiter,
        };
    }
}

// Reads job details from a parsed page. Extractors run in order and earlier
// ones win; a site-specific extractor (e.g. for Greenhouse) can be added to
// the front of the list later without changing anything else.
public interface IJobPostingExtractor
{
    ExtractedJob? Extract(IHtmlDocument document, Uri pageUrl);
}

// An extractor that needs one more request than the page itself (for
// example Workday, whose page is built by JavaScript but which has a public
// job-detail JSON API). It must make that request through IPageFetcher, so
// every safety check applies. These run before the other extractors.
public interface IAsyncJobPostingExtractor
{
    Task<ExtractedJob?> ExtractAsync(IHtmlDocument document, Uri pageUrl, CancellationToken cancellationToken);
}

// Why an extraction didn't succeed. The endpoint turns these into
// HTTP status codes and friendly messages.
public enum JobExtractionError
{
    None,
    // Not a usable http(s) URL.
    InvalidUrl,
    // Points at a private, local or otherwise blocked address.
    BlockedUrl,
    // The site couldn't be reached or returned an error.
    PageUnavailable,
    // The site refused automated access (HTTP 401/403/429).
    BlockedBySite,
    // The site didn't answer in time.
    Timeout,
    // The response wasn't an HTML page.
    NotHtml,
    // The page was larger than the download limit.
    TooLarge,
    // The page loaded, but no job details were found on it.
    NoJobDataFound,
}

// The outcome of fetching a page (or a JSON document: its text is in Html too).
public sealed record PageFetchResult(
    JobExtractionError Error,
    string? Html = null,
    Uri? FinalUrl = null,
    int? StatusCode = null)
{
    public static PageFetchResult Failed(JobExtractionError error, int? statusCode = null) =>
        new(error, StatusCode: statusCode);
}

// The outcome of extracting a job from a URL.
public sealed record JobExtractionResult(
    JobExtractionError Error,
    ExtractedJob? Job = null,
    Uri? Url = null);
