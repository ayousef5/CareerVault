using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Dom;

namespace CareerVault.Api.Services.JobExtraction;

// Reads job details from Greenhouse job-board pages
// (e.g. https://job-boards.greenhouse.io/{company}/jobs/{id}).
//
// Greenhouse pages have no JSON-LD, but they include the job as data for
// their own JavaScript ("window.__remixContext") and show it in HTML with
// stable class names (job__title, job__location, job__description,
// pay-range). This extractor reads the data first and the HTML second;
// if neither has pay, the description text is searched for it.
// It only parses the page SafePageFetcher already downloaded: it makes no
// requests of its own, and no page script is ever run.
public sealed partial class GreenhouseJobPostingExtractor : IJobPostingExtractor
{
    // Greenhouse's own job-board hosts (US and EU). Company career sites
    // that embed Greenhouse aren't recognised; the generic extractors still
    // run for them.
    private static readonly HashSet<string> GreenhouseHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "job-boards.greenhouse.io",
        "job-boards.eu.greenhouse.io",
        "boards.greenhouse.io",
        "boards.eu.greenhouse.io",
    };

    private const string DataScriptPrefix = "window.__remixContext =";

    // "pageUrl" is the final URL after redirects, so a Greenhouse link that
    // redirects elsewhere is treated as a normal page.
    public static bool IsGreenhousePage(Uri pageUrl) => GreenhouseHosts.Contains(pageUrl.Host);

    public ExtractedJob? Extract(IHtmlDocument document, Uri pageUrl)
    {
        if (!IsGreenhousePage(pageUrl))
            return null;

        var fromData = ReadEmbeddedJobPost(document);
        var fromHtml = ReadHtml(document);

        var job = (fromData ?? new ExtractedJob()).WithFallback(fromHtml);

        // Some postings only state their pay in the description text
        // ("Compensation Range: $40.00 per hour"). Only used when neither the
        // data nor the pay boxes had a value, so it never replaces them.
        if (job.Pay is null)
            job = job with { Pay = CompensationTextParser.Find(job.JobDescription) };

        return job.IsEmpty ? null : job;
    }

    // ---------- The embedded job data ----------

    private static ExtractedJob? ReadEmbeddedJobPost(IHtmlDocument document)
    {
        var script = document.QuerySelectorAll("script")
            .Select(element => element.TextContent.TrimStart())
            .FirstOrDefault(text => text.StartsWith(DataScriptPrefix, StringComparison.Ordinal));
        if (script is null)
            return null;

        try
        {
            // The JSON object is followed by more script code, so read just
            // the first complete JSON value.
            var json = script[DataScriptPrefix.Length..];
            var reader = new Utf8JsonReader(
                System.Text.Encoding.UTF8.GetBytes(json),
                new JsonReaderOptions { MaxDepth = 128, CommentHandling = JsonCommentHandling.Skip });

            using var data = JsonDocument.ParseValue(ref reader);
            return FindJobPost(data.RootElement) is { } jobPost ? ReadJobPost(jobPost) : null;
        }
        catch (JsonException)
        {
            // Unreadable data: the HTML fallback still runs.
            return null;
        }
    }

    // The job is at state.loaderData.<route>.jobPost; the route name varies,
    // so look at every route.
    private static JsonElement? FindJobPost(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("state", out var state)
            || state.ValueKind != JsonValueKind.Object
            || !state.TryGetProperty("loaderData", out var loaderData)
            || loaderData.ValueKind != JsonValueKind.Object)
            return null;

        foreach (var route in loaderData.EnumerateObject())
        {
            if (route.Value.ValueKind == JsonValueKind.Object
                && route.Value.TryGetProperty("jobPost", out var jobPost)
                && jobPost.ValueKind == JsonValueKind.Object)
                return jobPost;
        }
        return null;
    }

    private static ExtractedJob ReadJobPost(JsonElement jobPost)
    {
        // Greenhouse keeps the description in three parts.
        var descriptionHtml = string.Join("\n", new[] { "introduction", "content", "conclusion" }
            .Select(part => GetString(jobPost, part))
            .Where(part => !string.IsNullOrWhiteSpace(part)));

        return new ExtractedJob
        {
            JobTitle = JsonLdJobPostingExtractor.CleanLine(GetString(jobPost, "title")),
            CompanyName = JsonLdJobPostingExtractor.CleanLine(GetString(jobPost, "company_name")),
            Location = JsonLdJobPostingExtractor.CleanLine(GetString(jobPost, "job_post_location")),
            Pay = FormatPayRanges(ReadPayRanges(jobPost)),
            JobDescription = HtmlTextConverter.FromHtml(descriptionHtml),
            // Greenhouse job posts don't list a recruiter, so this is left
            // empty rather than guessed from the description.
            Recruiter = null,
        };
    }

    private static IEnumerable<PayRange> ReadPayRanges(JsonElement jobPost)
    {
        if (!jobPost.TryGetProperty("pay_ranges", out var ranges) || ranges.ValueKind != JsonValueKind.Array)
            yield break;

        foreach (var range in ranges.EnumerateArray())
        {
            if (range.ValueKind == JsonValueKind.Object)
            {
                yield return new PayRange(
                    GetString(range, "title"),
                    GetString(range, "min"),
                    GetString(range, "max"),
                    GetString(range, "currency_type"));
            }
        }
    }

    private static string? GetString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    // ---------- The visible HTML ----------

    private static ExtractedJob ReadHtml(IHtmlDocument document)
    {
        var description = document.QuerySelector(".job__description");

        return new ExtractedJob
        {
            JobTitle = JsonLdJobPostingExtractor.CleanLine(
                document.QuerySelector(".job__title h1")?.TextContent),
            CompanyName = ReadCompanyFromTitle(document.Title),
            Location = JsonLdJobPostingExtractor.CleanLine(
                document.QuerySelector(".job__location")?.TextContent),
            Pay = FormatPayRanges(document.QuerySelectorAll(".pay-range").Select(ReadPayRange)),
            JobDescription = description is null ? null : HtmlTextConverter.FromNode(description),
        };
    }

    // Greenhouse titles pages "Job Application for {role} at {company}".
    private static string? ReadCompanyFromTitle(string? title)
    {
        if (title is null)
            return null;

        var match = ApplicationTitle().Match(title.Trim());
        return match.Success ? JsonLdJobPostingExtractor.CleanLine(match.Groups["company"].Value) : null;
    }

    // One pay box: a heading such as "Chicago Annual Pay Range" and the
    // amounts in <bdi> tags: "$75,000", "$80,000", "USD".
    private static PayRange ReadPayRange(IElement element)
    {
        var parts = element.QuerySelectorAll("bdi")
            .Select(bdi => bdi.TextContent.Trim())
            .Where(text => text.Length > 0)
            .ToList();

        var amounts = parts.Where(part => part.Any(char.IsDigit)).ToList();
        var currency = parts.FirstOrDefault(part => CurrencyCode().IsMatch(part));

        return new PayRange(
            element.QuerySelector(".body--medium")?.TextContent,
            amounts.ElementAtOrDefault(0),
            amounts.ElementAtOrDefault(1),
            currency);
    }

    // ---------- Pay formatting ----------

    private sealed record PayRange(string? Title, string? Min, string? Max, string? Currency);

    // e.g. "$75,000–$80,000/yr". With several ranges (often one per
    // location), each is labelled with its heading.
    private static string? FormatPayRanges(IEnumerable<PayRange> ranges)
    {
        var formatted = ranges
            .Select(range => (range.Title, Amount: FormatAmount(range)))
            .Where(range => range.Amount is not null)
            .ToList();

        return formatted.Count switch
        {
            0 => null,
            1 => formatted[0].Amount,
            _ => string.Join("; ", formatted.Select(range =>
                string.IsNullOrWhiteSpace(range.Title)
                    ? range.Amount
                    : $"{TitleCase(range.Title)}: {range.Amount}")),
        };
    }

    private static string? FormatAmount(PayRange range)
    {
        var min = JsonLdJobPostingExtractor.CleanLine(range.Min);
        var max = JsonLdJobPostingExtractor.CleanLine(range.Max);
        if (min is null && max is null)
            return null;

        var amount = min is not null && max is not null && min != max
            ? $"{AddCurrency(min, range.Currency)}–{AddCurrency(max, range.Currency)}"
            : AddCurrency((min ?? max)!, range.Currency);

        return amount + UnitFromTitle(range.Title);
    }

    // "75,000" + "EUR" → "EUR 75,000"; "$75,000" already shows its currency.
    private static string AddCurrency(string amount, string? currency) =>
        !char.IsDigit(amount[0]) || string.IsNullOrWhiteSpace(currency)
            ? amount
            : $"{currency.Trim().ToUpperInvariant()} {amount}";

    // The pay period, from words in the heading ("Annual", "Hourly"...).
    private static string UnitFromTitle(string? title)
    {
        var text = title?.ToLowerInvariant() ?? "";
        if (text.Contains("hour")) return "/hr";
        if (text.Contains("annual") || text.Contains("year") || text.Contains("salary")) return "/yr";
        if (text.Contains("month")) return "/mo";
        if (text.Contains("week")) return "/wk";
        return "";
    }

    private static string TitleCase(string text) =>
        CultureInfo.InvariantCulture.TextInfo.ToTitleCase(
            JsonLdJobPostingExtractor.CleanLine(text)!.ToLowerInvariant());

    // "Job Application for X at Company": the company is after the LAST
    // " at ", so roles like "Engineer at Scale" still work.
    [GeneratedRegex(@"^Job Application for .+ at (?<company>.+?)$", RegexOptions.IgnoreCase)]
    private static partial Regex ApplicationTitle();

    [GeneratedRegex(@"^[A-Za-z]{3}$")]
    private static partial Regex CurrencyCode();
}
