using AngleSharp.Html.Parser;
using CareerVault.Api.Services.JobExtraction;
using Microsoft.Extensions.Logging.Abstractions;

namespace CareerVault.Api.Tests.JobExtraction;

// Tests for Greenhouse job-board pages, using saved HTML in Fixtures/.
// No test makes a live request.
public class GreenhouseExtractorTests
{
    private static readonly Uri GreenhouseUrl = new("https://job-boards.greenhouse.io/acme/jobs/123");

    private static string Fixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "JobExtraction", "Fixtures", name));

    private static ExtractedJob? ExtractGreenhouse(string html, Uri? url = null) =>
        new GreenhouseJobPostingExtractor().Extract(new HtmlParser().ParseDocument(html), url ?? GreenhouseUrl);

    // The real pipeline, in the same order as the app registers it.
    private static JobExtractionService CreateService(IPageFetcher fetcher) =>
        new(fetcher,
            [new GreenhouseJobPostingExtractor(), new JsonLdJobPostingExtractor(), new PageMetadataExtractor()],
            NullLogger<JobExtractionService>.Instance);

    // Replaces one bit of a fixture, failing loudly if it isn't there.
    private static string Without(string html, string part)
    {
        Assert.Contains(part, html);
        return html.Replace(part, "");
    }

    private const string FullDescription =
        "Join our robotics team for the summer.\n\n"
        + "WHAT YOU WILL DO\n\n"
        + "• Write C# services\n"
        + "• Test robots in the lab\n\n"
        + "You will present your work at the end of the internship.\n\n"
        + "ABOUT ACME\n\n"
        + "Acme builds friendly robots.";

    // ---------- Recognising Greenhouse pages ----------

    [Theory]
    [InlineData("https://job-boards.greenhouse.io/acme/jobs/1", true)]
    [InlineData("https://JOB-BOARDS.greenhouse.io/acme/jobs/1", true)]
    [InlineData("https://job-boards.eu.greenhouse.io/acme/jobs/1", true)]
    [InlineData("https://boards.greenhouse.io/acme/jobs/1", true)]
    [InlineData("https://greenhouse.io/acme/jobs/1", false)]
    [InlineData("https://job-boards.greenhouse.io.example.com/acme/jobs/1", false)]
    [InlineData("https://notgreenhouse.io/acme/jobs/1", false)]
    [InlineData("https://careers.acme.com/jobs?gh_jid=1", false)]
    public void Only_Greenhouse_job_board_hosts_are_treated_as_Greenhouse(string url, bool expected)
    {
        Assert.Equal(expected, GreenhouseJobPostingExtractor.IsGreenhousePage(new Uri(url)));
    }

    [Fact]
    public void Ignores_pages_from_other_sites_even_with_Greenhouse_markup()
    {
        Assert.Null(ExtractGreenhouse(Fixture("greenhouse-job-post.html"), new Uri("https://jobs.example.com/1")));
    }

    // ---------- Extracting the fields ----------

    [Fact]
    public void Reads_every_available_field_from_the_embedded_job_data()
    {
        var job = ExtractGreenhouse(Fixture("greenhouse-job-post.html"));

        Assert.NotNull(job);
        Assert.Equal("Robotics Software Intern", job.JobTitle);
        Assert.Equal("Acme Robotics", job.CompanyName);
        Assert.Equal("Austin, Texas, United States", job.Location);
        Assert.Equal("$70,000–$85,000/yr", job.Pay);
        // Introduction + content + conclusion, with paragraphs and lists kept.
        Assert.Equal(FullDescription, job.JobDescription);
        // Greenhouse posts don't name a recruiter; nothing is guessed.
        Assert.Null(job.Recruiter);
    }

    [Fact]
    public void Reads_the_visible_HTML_when_there_is_no_embedded_data()
    {
        var job = ExtractGreenhouse(Fixture("greenhouse-html-only.html"));

        Assert.NotNull(job);
        Assert.Equal("Data Analyst", job.JobTitle);
        Assert.Equal("Globex Corporation", job.CompanyName);
        Assert.Equal("Remote - United States", job.Location);
        // Several pay ranges are each labelled with their heading.
        Assert.Equal(
            "New York Annual Salary: $90,000–$110,000/yr; Remote Annual Salary: $80,000–$100,000/yr",
            job.Pay);
        Assert.NotNull(job.JobDescription);
        Assert.StartsWith("Turn data into decisions.\n\nRequirements:\n\n1. SQL\n2. Python", job.JobDescription);
        Assert.Null(job.Recruiter);
    }

    [Fact]
    public void The_visible_HTML_fills_fields_the_embedded_data_is_missing()
    {
        // Embedded data without a company or location: the page title and
        // the location line in the HTML fill them in.
        var html = Fixture("greenhouse-job-post.html")
            .Replace("\"company_name\":\"Acme Robotics\",", "")
            .Replace("\"job_post_location\":\"Austin, Texas, United States\",", "");

        var job = ExtractGreenhouse(html);

        Assert.Equal("Acme Robotics", job?.CompanyName);
        Assert.Equal("Austin, Texas, United States", job?.Location);
        Assert.Equal(FullDescription, job?.JobDescription);
    }

    [Fact]
    public void Leaves_pay_empty_when_the_posting_has_no_salary()
    {
        var html = Fixture("greenhouse-job-post.html");
        html = Without(html, ",\"pay_ranges\":[{\"title\":\"AUSTIN ANNUAL PAY RANGE\",\"min\":\"$70,000\",\"max\":\"$85,000\",\"currency_type\":\"USD\"}]");
        html = html.Replace("class=\"pay-range\"", "class=\"no-pay\"");

        var job = ExtractGreenhouse(html);

        Assert.Null(job?.Pay);
        Assert.Equal("Robotics Software Intern", job?.JobTitle);
    }

    [Fact]
    public void Leaves_the_location_empty_when_the_posting_has_none()
    {
        var html = Fixture("greenhouse-job-post.html");
        html = Without(html, "\"job_post_location\":\"Austin, Texas, United States\",");
        html = Without(html, "<div class=\"job__location\"><svg class=\"svg-icon\" viewBox=\"0 0 24 24\"><path d=\"M6 3.8\"></path></svg>Austin, Texas, United States</div>");

        var job = ExtractGreenhouse(html);

        Assert.Null(job?.Location);
        Assert.Equal("Acme Robotics", job?.CompanyName);
    }

    [Fact]
    public void Never_fills_in_a_recruiter_that_is_not_listed()
    {
        Assert.Null(ExtractGreenhouse(Fixture("greenhouse-job-post.html"))?.Recruiter);
        Assert.Null(ExtractGreenhouse(Fixture("greenhouse-html-only.html"))?.Recruiter);
    }

    [Fact]
    public void Finds_pay_written_only_in_the_description()
    {
        // No pay_ranges and no pay box: the description text is searched,
        // and unrelated amounts ($3 billion, a $1,000 bonus) are ignored.
        var job = ExtractGreenhouse(Fixture("greenhouse-pay-in-description.html"));

        Assert.Equal("$40.00/hr", job?.Pay);
        Assert.Equal("Initrode Markets", job?.CompanyName);
        Assert.Equal("Chicago, IL", job?.Location);
    }

    [Fact]
    public void Structured_pay_wins_over_pay_written_in_the_description()
    {
        // The description says one thing, the pay_ranges data another: the
        // data is more reliable, so it's kept.
        var html = Fixture("greenhouse-job-post.html").Replace(
            "Join our robotics team for the summer.",
            "Join our robotics team for the summer. Compensation: $99 per hour.");

        Assert.Equal("$70,000–$85,000/yr", ExtractGreenhouse(html)?.Pay);
    }

    [Fact]
    public void The_visible_pay_box_wins_over_pay_written_in_the_description()
    {
        var html = Fixture("greenhouse-html-only.html").Replace(
            "Turn data into decisions.",
            "Turn data into decisions. Salary: $1 per year.");

        Assert.StartsWith("New York Annual Salary: $90,000–$110,000/yr", ExtractGreenhouse(html)?.Pay);
    }

    [Fact]
    public async Task Pay_in_the_description_is_found_through_the_whole_pipeline()
    {
        var fetcher = FakePageFetcher.WithHtml(Fixture("greenhouse-pay-in-description.html"));

        var result = await CreateService(fetcher).ExtractAsync(GreenhouseUrl.ToString(), default);

        Assert.Equal("$40.00/hr", result.Job?.Pay);
        Assert.Equal(1, fetcher.Calls);
    }

    [Fact]
    public void Formats_hourly_pay_and_amounts_without_a_currency_symbol()
    {
        var html = Fixture("greenhouse-job-post.html").Replace(
            "{\"title\":\"AUSTIN ANNUAL PAY RANGE\",\"min\":\"$70,000\",\"max\":\"$85,000\",\"currency_type\":\"USD\"}",
            "{\"title\":\"Hourly rate\",\"min\":\"40\",\"max\":\"50\",\"currency_type\":\"eur\"}");

        Assert.Equal("EUR 40–EUR 50/hr", ExtractGreenhouse(html)?.Pay);
    }

    [Fact]
    public void Uses_the_last_at_in_the_page_title_for_the_company()
    {
        var html = "<html><head><title>Job Application for Engineer at Scale at Initech</title></head><body></body></html>";
        Assert.Equal("Initech", ExtractGreenhouse(html)?.CompanyName);
    }

    // ---------- Broken pages ----------

    [Fact]
    public void Handles_broken_HTML_and_unreadable_embedded_data()
    {
        var job = ExtractGreenhouse(Fixture("greenhouse-malformed.html"));

        Assert.NotNull(job);
        // The broken data ("Broken") is ignored; the HTML is used instead.
        Assert.Equal("Welder", job.JobTitle);
        Assert.Equal("Initech", job.CompanyName);
        Assert.Equal("Weld things.\n\nStay safe", job.JobDescription);
        Assert.Null(job.Pay);
    }

    [Theory]
    [InlineData("<script>window.__remixContext = \"not an object\";</script>")]
    [InlineData("<script>window.__remixContext = {\"state\": {\"loaderData\": []}};</script>")]
    [InlineData("<script>window.__remixContext = {\"state\": {\"loaderData\": {\"r\": {\"jobPost\": \"text\"}}}};</script>")]
    [InlineData("<script>window.__remixContext = {\"state\": {\"loaderData\": {\"r\": {\"jobPost\": {\"title\": 42, \"pay_ranges\": \"none\"}}}}};</script>")]
    [InlineData("<script>window.__remixContext = </script>")]
    public void Ignores_embedded_data_with_an_unexpected_shape(string script)
    {
        var job = ExtractGreenhouse($"<html><body><div class=\"job__title\"><h1>Chef</h1></div>{script}</body></html>");

        Assert.Equal("Chef", job?.JobTitle);
        Assert.Null(job?.Pay);
    }

    [Fact]
    public void Returns_nothing_for_a_Greenhouse_page_without_job_details()
    {
        Assert.Null(ExtractGreenhouse("<html><head><title>Acme jobs</title></head><body><p>Hi</p></body></html>"));
    }

    // ---------- In the whole pipeline ----------

    [Fact]
    public async Task Greenhouse_results_take_priority_in_the_pipeline()
    {
        var fetcher = FakePageFetcher.WithHtml(Fixture("greenhouse-job-post.html"));

        var result = await CreateService(fetcher).ExtractAsync(GreenhouseUrl.ToString(), default);

        Assert.Equal(JobExtractionError.None, result.Error);
        Assert.Equal("Acme Robotics", result.Job?.CompanyName);
        Assert.Equal("Austin, Texas, United States", result.Job?.Location);
        Assert.Equal("$70,000–$85,000/yr", result.Job?.Pay);
        Assert.Equal(FullDescription, result.Job?.JobDescription);
        // The page was fetched exactly once, through the safe fetcher.
        Assert.Equal(1, fetcher.Calls);
    }

    [Fact]
    public async Task Partial_Greenhouse_results_are_completed_by_the_other_extractors()
    {
        // A Greenhouse page that only shows a title, plus JSON-LD with the
        // company and pay. Greenhouse's title wins; JSON-LD fills the rest.
        var html = """
            <html><head>
              <script type="application/ld+json">
                { "@type": "JobPosting", "title": "JSON-LD title",
                  "hiringOrganization": { "name": "Hooli" },
                  "baseSalary": { "currency": "USD", "value": { "value": 60, "unitText": "HOUR" } } }
              </script>
            </head><body><div class="job__title"><h1>Greenhouse title</h1></div></body></html>
            """;

        var result = await CreateService(FakePageFetcher.WithHtml(html)).ExtractAsync(GreenhouseUrl.ToString(), default);

        Assert.Equal("Greenhouse title", result.Job?.JobTitle);
        Assert.Equal("Hooli", result.Job?.CompanyName);
        Assert.Equal("$60/hr", result.Job?.Pay);
    }

    [Fact]
    public async Task Other_sites_keep_using_the_existing_extractors()
    {
        // The same Greenhouse-style page on a non-Greenhouse host: only the
        // generic extractors run, so Greenhouse-only fields stay empty.
        var fetcher = FakePageFetcher.WithHtml(Fixture("greenhouse-job-post.html"));

        var result = await CreateService(fetcher).ExtractAsync("https://jobs.example.com/123", default);

        Assert.Equal(JobExtractionError.None, result.Error);
        Assert.Equal("Robotics Software Intern", result.Job?.JobTitle);
        Assert.Null(result.Job?.CompanyName);
        Assert.Null(result.Job?.Pay);
        Assert.Null(result.Job?.Location);
    }

    [Fact]
    public async Task A_Greenhouse_link_that_redirects_elsewhere_is_not_treated_as_Greenhouse()
    {
        // The extractor looks at the final URL after redirects.
        var fetcher = new FakePageFetcher(new PageFetchResult(
            JobExtractionError.None,
            Fixture("greenhouse-job-post.html"),
            FinalUrl: new Uri("https://jobs.example.com/moved")));

        var result = await CreateService(fetcher).ExtractAsync(GreenhouseUrl.ToString(), default);

        Assert.Null(result.Job?.Pay);
        Assert.Null(result.Job?.CompanyName);
    }

    // ---------- Security still applies ----------

    [Theory]
    [InlineData("http://job-boards.greenhouse.io.internal/acme/jobs/1", JobExtractionError.BlockedUrl)]
    [InlineData("https://job-boards.greenhouse.io:8443/acme/jobs/1", JobExtractionError.BlockedUrl)]
    [InlineData("https://user:pass@job-boards.greenhouse.io/acme/jobs/1", JobExtractionError.BlockedUrl)]
    [InlineData("ftp://job-boards.greenhouse.io/acme/jobs/1", JobExtractionError.InvalidUrl)]
    public async Task Greenhouse_looking_links_still_pass_every_URL_check_before_fetching(
        string url,
        JobExtractionError expected)
    {
        var fetcher = FakePageFetcher.WithHtml(Fixture("greenhouse-job-post.html"));

        var result = await CreateService(fetcher).ExtractAsync(url, default);

        Assert.Equal(expected, result.Error);
        Assert.Equal(0, fetcher.Calls);
    }

    [Fact]
    public async Task Fetch_errors_on_Greenhouse_are_reported_normally()
    {
        var fetcher = new FakePageFetcher(PageFetchResult.Failed(JobExtractionError.BlockedBySite, 403));

        var result = await CreateService(fetcher).ExtractAsync(GreenhouseUrl.ToString(), default);

        Assert.Equal(JobExtractionError.BlockedBySite, result.Error);
    }
}
