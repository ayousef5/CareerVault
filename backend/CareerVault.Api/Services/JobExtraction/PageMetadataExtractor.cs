using AngleSharp.Dom;
using AngleSharp.Html.Dom;

namespace CareerVault.Api.Services.JobExtraction;

// A general fallback for pages without JobPosting data: reads the page's
// metadata (Open Graph tags, <h1>, <title>) and looks for the main job
// description block. It only fills fields the page actually shows; it
// never guesses a company from a title or similar.
public sealed class PageMetadataExtractor : IJobPostingExtractor
{
    // Where job descriptions usually live, most specific first.
    private static readonly string[] DescriptionSelectors =
    [
        "[itemprop='description']",
        "#job-description",
        ".job-description",
        "[id*='job-description']",
        "[class*='job-description']",
        "[id*='jobDescription']",
        "[class*='jobDescription']",
        "article",
        "main",
    ];

    // Shorter blocks are usually a teaser or a label, not the description.
    private const int MinDescriptionLength = 100;

    public ExtractedJob? Extract(IHtmlDocument document, Uri pageUrl) => new()
    {
        JobTitle = JsonLdJobPostingExtractor.CleanLine(
            document.QuerySelector("h1")?.TextContent
            ?? Meta(document, "og:title")
            ?? Meta(document, "twitter:title")
            ?? document.Title),
        CompanyName = JsonLdJobPostingExtractor.CleanLine(
            Meta(document, "og:site_name") ?? Meta(document, "application-name")),
        JobDescription = FindDescription(document),
    };

    // A <meta property="..."> or <meta name="..."> value.
    private static string? Meta(IHtmlDocument document, string key) =>
        document.QuerySelector($"meta[property='{key}']")?.GetAttribute("content")
        ?? document.QuerySelector($"meta[name='{key}']")?.GetAttribute("content");

    private static string? FindDescription(IHtmlDocument document)
    {
        foreach (var selector in DescriptionSelectors)
        {
            foreach (var element in document.QuerySelectorAll(selector))
            {
                var text = HtmlTextConverter.FromNode(element);
                if (text is not null && text.Length >= MinDescriptionLength)
                    return text;
            }
        }

        // The short <meta name="description"> is only a preview of the
        // posting, so it isn't used as the full description.
        return null;
    }
}
