using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Html.Dom;

namespace CareerVault.Api.Services.JobExtraction;

// Reads job details from Workday career sites
// (e.g. https://{tenant}.wd5.myworkdayjobs.com/en-US/{site}/job/{posting}).
//
// Workday pages are built by JavaScript, so the downloaded HTML has little
// more than a title, a JSON-LD block and a flattened description. Workday
// also has a public job-detail API at
//   https://{same host}/wday/cxs/{tenant}/{site}/job/{posting}
// which returns the job as JSON, with the description as formatted HTML.
// This extractor builds that address ONLY from the already-validated page
// URL (same host, checked path parts) and requests it through
// IPageFetcher.FetchJsonAsync, so every SSRF protection applies. Nothing
// from the page's content is ever used as an address.
//
// Fields the API doesn't have are left empty here; the JSON-LD and page
// metadata extractors that run afterwards fill what they can from the HTML.
public sealed partial class WorkdayJobPostingExtractor(IPageFetcher fetcher) : IAsyncJobPostingExtractor
{
    // A Workday address, worked out from a job link.
    public sealed record WorkdayJobAddress(string Tenant, string Site, string JobPath, Uri DetailApiUrl);

    public async Task<ExtractedJob?> ExtractAsync(
        IHtmlDocument document,
        Uri pageUrl,
        CancellationToken cancellationToken)
    {
        // "pageUrl" is the final URL after redirects, so a link that left
        // Workday is treated as a normal page.
        if (TryGetJobAddress(pageUrl) is not { } address)
            return null;

        var fromApi = await ReadDetailApiAsync(address, cancellationToken);

        // The page's own title, in case the API had none.
        var job = (fromApi ?? new ExtractedJob()).WithFallback(new ExtractedJob
        {
            JobTitle = JsonLdJobPostingExtractor.CleanLine(
                document.QuerySelector("meta[property='og:title']")?.GetAttribute("content")),
        });

        // Workday has no structured pay field; pay is sometimes written in
        // the description ("Base Pay Range: $95,000 USD - $120,000 USD").
        // Without the API, the page's own (flattened) description is used.
        if (job.Pay is null)
        {
            var description = job.JobDescription
                ?? document.QuerySelector("meta[property='og:description']")?.GetAttribute("content");
            job = job with { Pay = CompensationTextParser.Find(description) };
        }

        // Workday often leaves the company name empty. In order: the API's
        // name (above), then the page's own JSON-LD or metadata (read by the
        // same extractors that run later), and only then the link itself.
        if (string.IsNullOrWhiteSpace(job.CompanyName))
        {
            var fromPage = new JsonLdJobPostingExtractor().Extract(document, pageUrl)?.CompanyName
                ?? new PageMetadataExtractor().Extract(document, pageUrl)?.CompanyName;
            job = job with { CompanyName = fromPage ?? GuessCompanyFromAddress(address) };
        }

        return job.IsEmpty ? null : job;
    }

    // ---------- Company name from the link ----------

    // Words Workday sites commonly add to their site name, which say nothing
    // about the employer.
    private static readonly HashSet<string> GenericSiteWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "external", "internal", "ext", "int", "career", "careers", "job", "jobs",
        "site", "sites", "portal", "page", "home", "search", "opportunities",
        "openings", "hiring", "recruiting", "talent", "global", "early", "university",
        "campus", "students", "student", "graduates", "interns", "internships",
        "experienced", "professional", "workday", "us", "usa", "en",
    };

    // Small words kept in lowercase inside a multi-word name ("Bank of America").
    private static readonly HashSet<string> SmallWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "of", "and", "the", "for", "&",
    };

    // A last-resort company name from the link, e.g.
    //   cboe.wd1.myworkdayjobs.com/External_Career_CBOE → "Cboe".
    // Conservative: the tenant (first part of the host) is only used when the
    // site name confirms it, because a tenant on its own is often an internal
    // code rather than the employer's name. Returns null rather than guess.
    // Uses only the already-validated link; no request is made.
    public static string? GuessCompanyFromAddress(WorkdayJobAddress address)
    {
        var tenant = address.Tenant;
        if (tenant.Length < 2 || !tenant.All(char.IsLetterOrDigit) || GenericSiteWords.Contains(tenant))
            return null;

        // "External_Career_CBOE" → ["CBOE"]; "NVIDIAExternalCareerSite" → ["NVIDIA"].
        var words = SiteWords().Split(CamelCaseBoundary().Replace(address.Site, " "))
            .Where(word => word.Length > 0 && !GenericSiteWords.Contains(word))
            .ToList();

        // The site name contains the tenant as one word: use the tenant.
        if (words.Any(word => word.Equals(tenant, StringComparison.OrdinalIgnoreCase)))
            return Capitalize(tenant);

        // The site name spells the tenant out in several words
        // ("bankofamerica" + "Bank_of_America_Careers"): use those words.
        if (words.Count > 1 && string.Concat(words).Equals(tenant, StringComparison.OrdinalIgnoreCase))
        {
            return string.Join(' ', words.Select((word, index) =>
                index > 0 && SmallWords.Contains(word) ? word.ToLowerInvariant() : Capitalize(word)));
        }

        return null;
    }

    // "cboe" or "CBOE" → "Cboe".
    private static string Capitalize(string word) =>
        char.ToUpperInvariant(word[0]) + word[1..].ToLowerInvariant();

    // ---------- Recognising Workday job links ----------

    // Works out the tenant, site and job path from a Workday job link, or
    // returns null if it isn't one. Accepted shapes (locale optional):
    //   /{locale}/{site}/job/{posting}
    //   /{locale}/{site}/job/{location}/{posting}
    //   /{locale}/{site}/details/{posting}
    public static WorkdayJobAddress? TryGetJobAddress(Uri pageUrl)
    {
        if (pageUrl.Scheme != Uri.UriSchemeHttps && pageUrl.Scheme != Uri.UriSchemeHttp)
            return null;

        var host = WorkdayHost().Match(pageUrl.IdnHost);
        if (!host.Success)
            return null;

        var segments = pageUrl.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(Uri.UnescapeDataString)
            .ToList();

        // An optional locale first, e.g. "en-US" or "fr".
        if (segments.Count > 0 && Locale().IsMatch(segments[0]))
            segments.RemoveAt(0);

        // {site}/job/{posting} or {site}/job/{location}/{posting}
        // (or "details" instead of "job").
        if (segments.Count is < 3 or > 4
            || !(segments[1].Equals("job", StringComparison.OrdinalIgnoreCase)
                 || segments[1].Equals("details", StringComparison.OrdinalIgnoreCase)))
            return null;

        var site = segments[0];
        var jobSegments = segments.Skip(2).ToList();
        if (!IsSafeSegment(site) || !jobSegments.All(IsSafeSegment))
            return null;

        var tenant = host.Groups["tenant"].Value.ToLowerInvariant();
        var jobPath = string.Join('/', jobSegments.Select(Uri.EscapeDataString));

        // Same scheme and host as the page, so it's checked exactly like it.
        var apiUrl = new UriBuilder(pageUrl.Scheme, pageUrl.IdnHost)
        {
            Path = $"/wday/cxs/{Uri.EscapeDataString(tenant)}/{Uri.EscapeDataString(site)}/job/{jobPath}",
        }.Uri;

        return new WorkdayJobAddress(tenant, site, jobPath, apiUrl);
    }

    // A path part we're willing to put into the API address: no slashes,
    // no "." or "..", nothing unusual, and not too long.
    private static bool IsSafeSegment(string segment) =>
        segment.Length is > 0 and <= 200
        && segment != "." && segment != ".."
        && SafeSegment().IsMatch(segment);

    // ---------- The job-detail API ----------

    private async Task<ExtractedJob?> ReadDetailApiAsync(WorkdayJobAddress address, CancellationToken cancellationToken)
    {
        var result = await fetcher.FetchJsonAsync(address.DetailApiUrl, cancellationToken);
        if (result.Error != JobExtractionError.None || result.Html is null)
            return null;

        // Only trust data that came from the same Workday host.
        if (result.FinalUrl is not null
            && !string.Equals(result.FinalUrl.IdnHost, address.DetailApiUrl.IdnHost, StringComparison.OrdinalIgnoreCase))
            return null;

        try
        {
            using var json = JsonDocument.Parse(result.Html, new JsonDocumentOptions { MaxDepth = 64 });
            return ReadJobDetail(json.RootElement);
        }
        catch (JsonException)
        {
            // Unreadable data: the HTML-based extractors still run.
            return null;
        }
    }

    // Reads { "jobPostingInfo": { ... }, "hiringOrganization": { "name": ... } }.
    private static ExtractedJob? ReadJobDetail(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("jobPostingInfo", out var info)
            || info.ValueKind != JsonValueKind.Object)
            return null;

        // Workday often leaves the organisation name empty; then the company
        // stays empty rather than being guessed (e.g. from the host name).
        var company = root.TryGetProperty("hiringOrganization", out var organization)
            ? GetString(organization, "name")
            : null;

        return new ExtractedJob
        {
            JobTitle = JsonLdJobPostingExtractor.CleanLine(GetString(info, "title")),
            CompanyName = JsonLdJobPostingExtractor.CleanLine(company),
            Location = ReadLocations(info),
            JobDescription = HtmlTextConverter.FromHtml(GetString(info, "jobDescription")),
            // Workday's job API has no structured pay or recruiter field.
            Pay = null,
            Recruiter = null,
        };
    }

    // The main location plus any additional ones, e.g. "USA, CA, Pleasanton".
    private static string? ReadLocations(JsonElement info)
    {
        var locations = new List<string>();

        void Add(string? location)
        {
            var cleaned = JsonLdJobPostingExtractor.CleanLine(location);
            if (cleaned is not null && !locations.Contains(cleaned))
                locations.Add(cleaned);
        }

        Add(GetString(info, "location"));
        if (info.TryGetProperty("jobRequisitionLocation", out var requisition) && requisition.ValueKind == JsonValueKind.Object)
            Add(GetString(requisition, "descriptor"));
        if (info.TryGetProperty("additionalLocations", out var more) && more.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in more.EnumerateArray())
                Add(item.ValueKind == JsonValueKind.String ? item.GetString() : null);
        }

        return locations.Count == 0 ? null : string.Join("; ", locations);
    }

    private static string? GetString(JsonElement element, string property) =>
        element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(property, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    // {tenant}.wd{N}.myworkdayjobs.com (or {tenant}.myworkdayjobs.com).
    [GeneratedRegex(@"^(?<tenant>[a-z0-9][a-z0-9-]{0,62})(?:\.wd\d{1,3})?\.myworkdayjobs\.com$", RegexOptions.IgnoreCase)]
    private static partial Regex WorkdayHost();

    // Separators in Workday site names: underscores, hyphens, spaces, dots.
    [GeneratedRegex(@"[_\-\s.]+")]
    private static partial Regex SiteWords();

    // Where a camel-cased site name changes word: "NVIDIAExternal" → "NVIDIA External".
    [GeneratedRegex(@"(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})")]
    private static partial Regex CamelCaseBoundary();

    // "en", "en-US", "fr-CA"...
    [GeneratedRegex(@"^[a-z]{2}(?:-[A-Za-z]{2})?$", RegexOptions.IgnoreCase)]
    private static partial Regex Locale();

    // Letters (any language), digits and - _ . ( ) only.
    [GeneratedRegex(@"^[\p{L}\p{N}\-_.()]+$")]
    private static partial Regex SafeSegment();
}
