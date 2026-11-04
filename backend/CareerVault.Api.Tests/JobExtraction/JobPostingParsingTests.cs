using AngleSharp.Html.Parser;
using CareerVault.Api.Services.JobExtraction;
using Microsoft.Extensions.Logging.Abstractions;

namespace CareerVault.Api.Tests.JobExtraction;

public class JobPostingParsingTests
{
    private static readonly Uri PageUrl = new("https://jobs.example.com/1");

    private static ExtractedJob? ExtractJsonLd(string html) =>
        new JsonLdJobPostingExtractor().Extract(new HtmlParser().ParseDocument(html), PageUrl);

    private static ExtractedJob? ExtractMetadata(string html) =>
        new PageMetadataExtractor().Extract(new HtmlParser().ParseDocument(html), PageUrl);

    private static string Page(string jsonLd) =>
        $"<html><head><script type=\"application/ld+json\">{jsonLd}</script></head><body></body></html>";

    // ---------- JSON-LD JobPosting ----------

    [Fact]
    public void Reads_a_full_JobPosting()
    {
        var job = ExtractJsonLd(Page("""
            {
              "@context": "https://schema.org",
              "@type": "JobPosting",
              "title": "Software Engineer Intern",
              "hiringOrganization": { "@type": "Organization", "name": "Acme &amp; Co" },
              "jobLocation": [
                { "@type": "Place", "address": { "addressLocality": "Chicago", "addressRegion": "IL", "addressCountry": "US" } },
                { "@type": "Place", "address": { "addressLocality": "Austin", "addressRegion": "TX" } }
              ],
              "baseSalary": {
                "@type": "MonetaryAmount", "currency": "USD",
                "value": { "@type": "QuantitativeValue", "minValue": 120000, "maxValue": 140000, "unitText": "YEAR" }
              },
              "description": "<p>About the role.</p><p>You will build things.</p><ul><li>C#</li><li>React</li></ul>"
            }
            """));

        Assert.NotNull(job);
        Assert.Equal("Software Engineer Intern", job.JobTitle);
        Assert.Equal("Acme & Co", job.CompanyName);
        Assert.Equal("Chicago, IL; Austin, TX", job.Location);
        Assert.Equal("$120,000–$140,000/yr", job.Pay);
        Assert.Equal("About the role.\n\nYou will build things.\n\n• C#\n• React", job.JobDescription);
        Assert.Null(job.Recruiter);
    }

    [Fact]
    public void Finds_a_JobPosting_inside_a_graph_with_other_types()
    {
        var job = ExtractJsonLd(Page("""
            {
              "@context": "https://schema.org",
              "@graph": [
                { "@type": "Organization", "name": "Not the job" },
                { "@type": ["JobPosting"], "title": "Data Analyst", "hiringOrganization": "Globex" }
              ]
            }
            """));

        Assert.Equal("Data Analyst", job?.JobTitle);
        Assert.Equal("Globex", job?.CompanyName);
    }

    [Fact]
    public void Accepts_a_full_schema_org_type_url()
    {
        var job = ExtractJsonLd(Page("""{ "@type": "https://schema.org/JobPosting", "title": "Nurse" }"""));
        Assert.Equal("Nurse", job?.JobTitle);
    }

    [Fact]
    public void Reads_remote_jobs_hourly_pay_and_an_application_contact()
    {
        var job = ExtractJsonLd(Page("""
            {
              "@type": "JobPosting",
              "title": "Support Agent",
              "jobLocationType": "TELECOMMUTE",
              "baseSalary": { "currency": "USD", "value": { "value": 45.5, "unitText": "HOUR" } },
              "applicationContact": { "@type": "ContactPoint", "name": "Sam Lee" }
            }
            """));

        Assert.Equal("Remote", job?.Location);
        Assert.Equal("$45.50/hr", job?.Pay);
        Assert.Equal("Sam Lee", job?.Recruiter);
    }

    [Fact]
    public void Decodes_a_description_that_was_escaped_twice()
    {
        var job = ExtractJsonLd(Page("""
            { "@type": "JobPosting", "description": "&lt;p&gt;First&lt;/p&gt;&lt;p&gt;Second&lt;/p&gt;" }
            """));

        Assert.Equal("First\n\nSecond", job?.JobDescription);
    }

    [Fact]
    public void Leaves_missing_fields_empty_instead_of_guessing()
    {
        var job = ExtractJsonLd(Page("""{ "@type": "JobPosting", "title": "Welder" }"""));

        Assert.Equal("Welder", job?.JobTitle);
        Assert.Null(job?.CompanyName);
        Assert.Null(job?.Location);
        Assert.Null(job?.Pay);
        Assert.Null(job?.JobDescription);
        Assert.Null(job?.Recruiter);
    }

    [Fact]
    public void Skips_broken_json_and_uses_the_next_block()
    {
        var html = """
            <script type="application/ld+json">{ this is not json </script>
            <script type="application/ld+json">{ "@type": "JobPosting", "title": "Chef" }</script>
            """;

        Assert.Equal("Chef", ExtractJsonLd(html)?.JobTitle);
    }

    [Fact]
    public void Returns_nothing_when_there_is_no_JobPosting()
    {
        Assert.Null(ExtractJsonLd(Page("""{ "@type": "Organization", "name": "Acme" }""")));
        Assert.Null(ExtractJsonLd("<html><body><h1>Hello</h1></body></html>"));
    }

    // ---------- Page metadata fallback ----------

    [Fact]
    public void Reads_the_heading_site_name_and_description_block()
    {
        var description = string.Join(" ", Enumerable.Repeat("You will design and ship features.", 5));
        var job = ExtractMetadata($"""
            <html><head>
              <title>Careers | Acme</title>
              <meta property="og:site_name" content="Acme Corp">
              <meta name="description" content="Short preview only.">
            </head><body>
              <h1> Backend   Engineer </h1>
              <div class="job-description"><p>{description}</p><script>document.write('injected')</script></div>
            </body></html>
            """);

        Assert.Equal("Backend Engineer", job?.JobTitle);
        Assert.Equal("Acme Corp", job?.CompanyName);
        Assert.Equal(description, job?.JobDescription);
        // Scripts are never run or included, and the short meta preview isn't used.
        Assert.DoesNotContain("injected", job?.JobDescription);
        Assert.Null(job?.Location);
        Assert.Null(job?.Pay);
    }

    [Fact]
    public void Does_not_use_the_short_meta_description_as_the_full_description()
    {
        var job = ExtractMetadata("""
            <html><head><meta name="description" content="A short teaser."><meta property="og:title" content="Analyst"></head>
            <body><p>Hi</p></body></html>
            """);

        Assert.Equal("Analyst", job?.JobTitle);
        Assert.Null(job?.JobDescription);
    }

    // ---------- HTML to text ----------

    [Fact]
    public void Converts_html_to_readable_text()
    {
        var text = HtmlTextConverter.FromHtml("""
            <h2>Duties</h2>
            <p>Line one<br>Line two &amp; more</p>
            <ol><li>First</li><li>Second</li></ol>
            <style>.x{color:red}</style><script>alert(1)</script>
            """);

        Assert.Equal("Duties\n\nLine one\nLine two & more\n\n1. First\n2. Second", text);
    }

    [Fact]
    public void Keeps_line_breaks_in_plain_text_descriptions()
    {
        Assert.Equal("Para one.\n\nPara two.", HtmlTextConverter.FromHtml("Para one.\r\n\r\n\r\n   Para two.  "));
        Assert.Null(HtmlTextConverter.FromHtml("   "));
    }

    // ---------- The whole service ----------

    private static JobExtractionService CreateService(IPageFetcher fetcher) =>
        new(fetcher, [new JsonLdJobPostingExtractor(), new PageMetadataExtractor()],
            NullLogger<JobExtractionService>.Instance);

    [Fact]
    public async Task Structured_data_wins_and_page_metadata_only_fills_gaps()
    {
        var html = """
            <html><head>
              <meta property="og:site_name" content="Acme Careers Site">
              <script type="application/ld+json">{ "@type": "JobPosting", "title": "From JSON-LD" }</script>
            </head><body><h1>From the heading</h1></body></html>
            """;

        var result = await CreateService(FakePageFetcher.WithHtml(html))
            .ExtractAsync("https://jobs.example.com/1", default);

        Assert.Equal(JobExtractionError.None, result.Error);
        Assert.Equal("From JSON-LD", result.Job?.JobTitle);
        // Company wasn't in the JobPosting, so the page's site name fills it.
        Assert.Equal("Acme Careers Site", result.Job?.CompanyName);
        // Nothing found for these: left empty.
        Assert.Null(result.Job?.Pay);
        Assert.Null(result.Job?.Recruiter);
    }

    [Fact]
    public async Task Reports_when_a_page_has_no_job_details()
    {
        var result = await CreateService(FakePageFetcher.WithHtml("<html><body><p>Hi</p></body></html>"))
            .ExtractAsync("https://jobs.example.com/empty", default);

        Assert.Equal(JobExtractionError.NoJobDataFound, result.Error);
        Assert.Null(result.Job);
    }

    [Fact]
    public async Task Passes_on_fetch_errors()
    {
        var fetcher = new FakePageFetcher(PageFetchResult.Failed(JobExtractionError.BlockedBySite, 403));

        var result = await CreateService(fetcher).ExtractAsync("https://jobs.example.com/1", default);

        Assert.Equal(JobExtractionError.BlockedBySite, result.Error);
    }

    [Theory]
    [InlineData("javascript:alert(1)", JobExtractionError.InvalidUrl)]
    [InlineData("http://127.0.0.1/", JobExtractionError.BlockedUrl)]
    [InlineData("http://localhost/", JobExtractionError.BlockedUrl)]
    public async Task Never_fetches_an_invalid_or_blocked_url(string url, JobExtractionError expected)
    {
        var fetcher = FakePageFetcher.WithHtml("<h1>should not be read</h1>");

        var result = await CreateService(fetcher).ExtractAsync(url, default);

        Assert.Equal(expected, result.Error);
        Assert.Equal(0, fetcher.Calls);
    }
}
