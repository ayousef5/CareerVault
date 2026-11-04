using System.Net;
using AngleSharp.Html.Parser;
using CareerVault.Api.Services.JobExtraction;
using Microsoft.Extensions.Logging.Abstractions;

namespace CareerVault.Api.Tests.JobExtraction;

// Tests for Workday career sites, using saved HTML and JSON in Fixtures/.
// No test makes a live request.
public class WorkdayExtractorTests
{
    private const string JobUrl =
        "https://contoso.wd1.myworkdayjobs.com/en-US/Contoso_Careers/job/Platform-Engineer-Intern_R-12345";

    private static string Fixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "JobExtraction", "Fixtures", name));

    private static Task<ExtractedJob?> ExtractWorkday(FakePageFetcher fetcher, string html, string url = JobUrl) =>
        new WorkdayJobPostingExtractor(fetcher).ExtractAsync(new HtmlParser().ParseDocument(html), new Uri(url), default);

    // The real pipeline, in the same order as the app registers it.
    private static JobExtractionService CreateService(FakePageFetcher fetcher) =>
        new(fetcher,
            [new GreenhouseJobPostingExtractor(), new JsonLdJobPostingExtractor(), new PageMetadataExtractor()],
            NullLogger<JobExtractionService>.Instance,
            [new WorkdayJobPostingExtractor(fetcher)]);

    private const string FullDescription =
        "Build the platform.\n\n"
        + "What you will do\n\n"
        + "• Write services\n"
        + "• Review code\n\n"
        + "Base Pay Range: $95,000 USD - $120,000 USD";

    // ---------- Recognising Workday links ----------

    [Theory]
    [InlineData(
        "https://contoso.wd1.myworkdayjobs.com/en-US/Contoso_Careers/job/Platform-Engineer-Intern_R-12345",
        "https://contoso.wd1.myworkdayjobs.com/wday/cxs/contoso/Contoso_Careers/job/Platform-Engineer-Intern_R-12345")]
    // No locale.
    [InlineData(
        "https://contoso.wd1.myworkdayjobs.com/Contoso_Careers/job/Platform-Engineer-Intern_R-12345",
        "https://contoso.wd1.myworkdayjobs.com/wday/cxs/contoso/Contoso_Careers/job/Platform-Engineer-Intern_R-12345")]
    // Other locales.
    [InlineData(
        "https://contoso.wd5.myworkdayjobs.com/fr-CA/Contoso_Careers/job/Stagiaire_JR-0042",
        "https://contoso.wd5.myworkdayjobs.com/wday/cxs/contoso/Contoso_Careers/job/Stagiaire_JR-0042")]
    [InlineData(
        "https://contoso.wd3.myworkdayjobs.com/ja-JP/Contoso_Careers/job/Intern_JR1",
        "https://contoso.wd3.myworkdayjobs.com/wday/cxs/contoso/Contoso_Careers/job/Intern_JR1")]
    // A location path segment and different requisition id formats.
    [InlineData(
        "https://contoso.wd1.myworkdayjobs.com/Contoso_Careers/job/USA-WA-Seattle/Platform-Engineer-Intern_R-12345",
        "https://contoso.wd1.myworkdayjobs.com/wday/cxs/contoso/Contoso_Careers/job/USA-WA-Seattle/Platform-Engineer-Intern_R-12345")]
    [InlineData(
        "https://contoso.wd1.myworkdayjobs.com/en-US/Contoso_Careers/job/Remote-USA/Analyst_REQ_2026-0007",
        "https://contoso.wd1.myworkdayjobs.com/wday/cxs/contoso/Contoso_Careers/job/Remote-USA/Analyst_REQ_2026-0007")]
    // "details" links and a query string.
    [InlineData(
        "https://contoso.wd1.myworkdayjobs.com/en-US/Contoso_Careers/details/Analyst_JR-77?source=LinkedIn",
        "https://contoso.wd1.myworkdayjobs.com/wday/cxs/contoso/Contoso_Careers/job/Analyst_JR-77")]
    // Tenants are case-insensitive; names in other languages are encoded.
    [InlineData(
        "https://CONTOSO.wd1.myworkdayjobs.com/Contoso_Careers/job/Ingénieur_JR-9",
        "https://contoso.wd1.myworkdayjobs.com/wday/cxs/contoso/Contoso_Careers/job/Ing%C3%A9nieur_JR-9")]
    public void Builds_the_job_detail_API_address_from_the_job_link(string jobUrl, string expectedApiUrl)
    {
        var address = WorkdayJobPostingExtractor.TryGetJobAddress(new Uri(jobUrl));

        Assert.NotNull(address);
        Assert.Equal(expectedApiUrl, address.DetailApiUrl.AbsoluteUri);
    }

    [Theory]
    // Not Workday.
    [InlineData("https://jobs.example.com/en-US/Contoso_Careers/job/Intern_R-1")]
    [InlineData("https://myworkdayjobs.com.evil.example/Contoso_Careers/job/Intern_R-1")]
    [InlineData("https://contoso.wd1.myworkdayjobs.com.evil.example/Contoso_Careers/job/Intern_R-1")]
    [InlineData("https://evil.example/contoso.wd1.myworkdayjobs.com/Contoso_Careers/job/Intern_R-1")]
    [InlineData("https://wd1.myworkday.com/contoso/d/inst/1$1/Intern.htmld")]
    // Workday, but not a single job.
    [InlineData("https://contoso.wd1.myworkdayjobs.com/en-US/Contoso_Careers")]
    [InlineData("https://contoso.wd1.myworkdayjobs.com/en-US/Contoso_Careers/jobs")]
    [InlineData("https://contoso.wd1.myworkdayjobs.com/en-US/Contoso_Careers/job")]
    [InlineData("https://contoso.wd1.myworkdayjobs.com/Contoso_Careers/job/a/b/Intern_R-1")]
    // Path parts that could change the API address.
    [InlineData("https://contoso.wd1.myworkdayjobs.com/Contoso_Careers/job/Intern%2F..%2F..%2Fadmin")]
    [InlineData("https://contoso.wd1.myworkdayjobs.com/Contoso_Careers/job/Intern%3Fx%3D1")]
    [InlineData("https://contoso.wd1.myworkdayjobs.com/Contoso%5C/job/Intern_R-1")]
    public void Rejects_links_that_are_not_Workday_job_postings(string url)
    {
        Assert.Null(WorkdayJobPostingExtractor.TryGetJobAddress(new Uri(url)));
    }

    // ---------- Extracting the fields ----------

    [Fact]
    public async Task Reads_the_job_from_the_job_detail_API()
    {
        var fetcher = FakePageFetcher.WithHtmlAndJson(Fixture("workday-job-page.html"), Fixture("workday-job-detail.json"));

        var job = await ExtractWorkday(fetcher, Fixture("workday-job-page.html"));

        Assert.NotNull(job);
        Assert.Equal("Platform Engineer Intern", job.JobTitle);
        Assert.Equal("USA, WA, Seattle; USA, CA, San Francisco", job.Location);
        // The formatted description, with paragraphs and lists kept.
        Assert.Equal(FullDescription, job.JobDescription);
        // No structured pay: found in the description text.
        Assert.Equal("$95,000–$120,000", job.Pay);
        // Workday left the organisation name empty (and so does the page), so
        // the company comes from the link: tenant "contoso", confirmed by the
        // site name "Contoso_Careers". No recruiter is listed.
        Assert.Equal("Contoso", job.CompanyName);
        Assert.Null(job.Recruiter);

        // Exactly one extra request, to the address built from the link.
        Assert.Equal(
            ["https://contoso.wd1.myworkdayjobs.com/wday/cxs/contoso/Contoso_Careers/job/Platform-Engineer-Intern_R-12345"],
            fetcher.JsonRequests.Select(url => url.AbsoluteUri));
    }

    [Fact]
    public async Task Uses_the_company_name_when_Workday_provides_one()
    {
        var json = Fixture("workday-job-detail.json")
            .Replace("\"hiringOrganization\": { \"name\": \"\"", "\"hiringOrganization\": { \"name\": \"Contoso Ltd\"");
        var fetcher = FakePageFetcher.WithHtmlAndJson("", json);

        var job = await ExtractWorkday(fetcher, Fixture("workday-job-page.html"));

        Assert.Equal("Contoso Ltd", job?.CompanyName);
    }

    [Fact]
    public async Task Leaves_pay_empty_when_none_is_stated()
    {
        var json = Fixture("workday-job-detail.json")
            .Replace("<p>Base Pay Range: $95,000 USD - $120,000 USD</p>", "");
        var fetcher = FakePageFetcher.WithHtmlAndJson("", json);

        var job = await ExtractWorkday(fetcher, Fixture("workday-job-page.html"));

        Assert.Null(job?.Pay);
        Assert.Null(job?.Recruiter);
        Assert.Equal("Platform Engineer Intern", job?.JobTitle);
    }

    [Fact]
    public async Task Does_not_invent_pay_from_a_broken_range()
    {
        // Real Workday pages sometimes show a range with no minimum.
        var json = Fixture("workday-job-detail.json")
            .Replace("$95,000 USD - $120,000 USD", "$ USD - $154,500 USD");
        var fetcher = FakePageFetcher.WithHtmlAndJson("", json);

        Assert.Null((await ExtractWorkday(fetcher, Fixture("workday-job-page.html")))?.Pay);
    }

    [Fact]
    public async Task Uses_the_pages_title_when_the_API_has_none()
    {
        var json = Fixture("workday-job-detail.json").Replace("\"title\": \"Platform Engineer Intern\",", "");
        var fetcher = FakePageFetcher.WithHtmlAndJson("", json);

        var job = await ExtractWorkday(fetcher, Fixture("workday-job-page.html"));

        Assert.Equal("Platform Engineer Intern", job?.JobTitle);
        Assert.Equal(FullDescription, job?.JobDescription);
    }

    [Theory]
    [InlineData("{ this is not json")]
    [InlineData("[]")]
    [InlineData("{\"jobPostingInfo\": \"text\"}")]
    [InlineData("{\"jobPostingInfo\": {\"title\": 42, \"location\": [], \"jobDescription\": {}}}")]
    [InlineData("")]
    public async Task Ignores_unreadable_API_responses(string json)
    {
        var fetcher = FakePageFetcher.WithHtmlAndJson("", json);

        var job = await ExtractWorkday(fetcher, Fixture("workday-job-page.html"));

        // Only the page's own title is left; nothing else is guessed.
        Assert.Equal("Platform Engineer Intern", job?.JobTitle);
        Assert.Null(job?.JobDescription);
        Assert.Null(job?.Location);
    }

    [Fact]
    public async Task Ignores_data_that_came_back_from_a_different_host()
    {
        var fetcher = new FakePageFetcher(
            new PageFetchResult(JobExtractionError.None, ""),
            new PageFetchResult(JobExtractionError.None, Fixture("workday-job-detail.json"),
                FinalUrl: new Uri("https://elsewhere.example/job.json")));

        var job = await ExtractWorkday(fetcher, Fixture("workday-job-page.html"));

        Assert.Null(job?.JobDescription);
    }

    [Fact]
    public async Task Handles_broken_HTML_without_the_API()
    {
        var fetcher = new FakePageFetcher(PageFetchResult.Failed(JobExtractionError.PageUnavailable));

        var job = await ExtractWorkday(fetcher, "<html><head><meta property=\"og:title\" content=\"Chef\"><body><div");

        Assert.Equal("Chef", job?.JobTitle);
    }

    // ---------- Company name from the link ----------

    private static string? CompanyFromLink(string url) =>
        WorkdayJobPostingExtractor.GuessCompanyFromAddress(
            WorkdayJobPostingExtractor.TryGetJobAddress(new Uri(url))!);

    private const string CboeUrl =
        "https://cboe.wd1.myworkdayjobs.com/en-US/External_Career_CBOE/job/Quant---Data-Analytics-Intern_R-4708";

    [Theory]
    [InlineData(CboeUrl, "Cboe")]
    [InlineData("https://cboe.wd1.myworkdayjobs.com/External_Career_CBOE/job/Chicago/Quant-Intern_R-1", "Cboe")]
    [InlineData("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Intern_JR1", "Nvidia")]
    [InlineData("https://acme.wd1.myworkdayjobs.com/acme-careers/job/Intern_R-1", "Acme")]
    [InlineData("https://bankofamerica.wd1.myworkdayjobs.com/Bank_of_America_Careers/job/Intern_R-1", "Bank of America")]
    public void Names_the_company_when_the_site_name_confirms_the_tenant(string url, string expected)
    {
        Assert.Equal(expected, CompanyFromLink(url));
    }

    [Theory]
    // A tenant the site name doesn't confirm: not guessed.
    [InlineData("https://acme.wd1.myworkdayjobs.com/External/job/Intern_R-1")]
    [InlineData("https://acme.wd1.myworkdayjobs.com/Careers/job/Intern_R-1")]
    [InlineData("https://acmecorp.wd1.myworkdayjobs.com/Globex_Careers/job/Intern_R-1")]
    [InlineData("https://jpmc.wd5.myworkdayjobs.com/en-US/JPMorgan_Chase/job/Intern_R-1")]
    // Only generic Workday words in the site name.
    [InlineData("https://abc.wd1.myworkdayjobs.com/External_Career/job/Intern_R-1")]
    [InlineData("https://abc.wd1.myworkdayjobs.com/en-US/Early_Career_Jobs/job/Intern_R-1")]
    // "Workday" itself is never returned as a company.
    [InlineData("https://workday.wd5.myworkdayjobs.com/en-US/Workday_Early_Career/job/Intern_JR-1")]
    // Never the job title or requisition id, even if they contain the tenant.
    [InlineData("https://acme.wd1.myworkdayjobs.com/External/job/Acme-Intern_ACME-1")]
    public void Leaves_the_company_blank_rather_than_guessing(string url)
    {
        Assert.Null(CompanyFromLink(url));
    }

    [Fact]
    public async Task Uses_the_link_only_when_the_API_and_page_have_no_company()
    {
        var fetcher = FakePageFetcher.WithHtmlAndJson("", Fixture("workday-job-detail.json"));

        var job = await ExtractWorkday(fetcher, Fixture("workday-job-page.html"), CboeUrl);

        Assert.Equal("Cboe", job?.CompanyName);
    }

    [Fact]
    public async Task The_APIs_company_name_wins_over_the_link()
    {
        var json = Fixture("workday-job-detail.json")
            .Replace("\"hiringOrganization\": { \"name\": \"\"", "\"hiringOrganization\": { \"name\": \"Cboe Global Markets\"");
        var fetcher = FakePageFetcher.WithHtmlAndJson("", json);

        var job = await ExtractWorkday(fetcher, Fixture("workday-job-page.html"), CboeUrl);

        Assert.Equal("Cboe Global Markets", job?.CompanyName);
    }

    [Theory]
    // JSON-LD names the organisation.
    [InlineData("\"hiringOrganization\":{\"name\":\"Cboe Exchange, Inc.\"", "Cboe Exchange, Inc.")]
    // An og:site_name tag.
    [InlineData("<meta property=\"og:site_name\" content=\"Cboe Careers Hub\">", "Cboe Careers Hub")]
    public async Task The_pages_company_name_wins_over_the_link(string pageChange, string expected)
    {
        var html = Fixture("workday-job-page.html");
        html = pageChange.StartsWith('<')
            ? html.Replace("<meta property=\"og:type\" content=\"website\">", pageChange)
            : html.Replace("\"hiringOrganization\":{\"name\":\"\"", pageChange);
        Assert.Contains(expected, html);

        // The API names no company.
        var fetcher = FakePageFetcher.WithHtmlAndJson("", Fixture("workday-job-detail.json"));

        var job = await ExtractWorkday(fetcher, html, CboeUrl);

        Assert.Equal(expected, job?.CompanyName);
    }

    [Fact]
    public async Task Company_from_the_link_survives_the_whole_pipeline_and_needs_no_request()
    {
        var fetcher = FakePageFetcher.WithHtmlAndJson(Fixture("workday-job-page.html"), Fixture("workday-job-detail.json"));

        var result = await CreateService(fetcher).ExtractAsync(CboeUrl, default);

        Assert.Equal("Cboe", result.Job?.CompanyName);
        // Still just the page and the one job-detail request.
        Assert.Equal(1, fetcher.Calls);
        Assert.Single(fetcher.JsonRequests);
    }

    // ---------- In the whole pipeline ----------

    [Fact]
    public async Task Workday_results_come_first_and_the_HTML_extractors_fill_the_gaps()
    {
        var fetcher = FakePageFetcher.WithHtmlAndJson(Fixture("workday-job-page.html"), Fixture("workday-job-detail.json"));

        var result = await CreateService(fetcher).ExtractAsync(JobUrl, default);

        Assert.Equal(JobExtractionError.None, result.Error);
        Assert.Equal("Platform Engineer Intern", result.Job?.JobTitle);
        // The API's location wins over JSON-LD's (which would add "Remote").
        Assert.Equal("USA, WA, Seattle; USA, CA, San Francisco", result.Job?.Location);
        // The formatted description wins over JSON-LD's flattened one.
        Assert.Equal(FullDescription, result.Job?.JobDescription);
        Assert.Equal("$95,000–$120,000", result.Job?.Pay);
        // From the link, as nothing else names the company.
        Assert.Equal("Contoso", result.Job?.CompanyName);
        Assert.Equal(1, fetcher.Calls);
        Assert.Single(fetcher.JsonRequests);
    }

    [Fact]
    public async Task Falls_back_to_the_HTML_when_the_API_is_unavailable()
    {
        // The API fails (the default for this fake): JSON-LD in the page
        // still gives the title, location and the flattened description.
        var fetcher = FakePageFetcher.WithHtml(Fixture("workday-job-page.html"));

        var result = await CreateService(fetcher).ExtractAsync(JobUrl, default);

        Assert.Equal(JobExtractionError.None, result.Error);
        Assert.Equal("Platform Engineer Intern", result.Job?.JobTitle);
        Assert.Equal("Remote; USA, WA, Seattle", result.Job?.Location);
        Assert.StartsWith("Build the platform.", result.Job?.JobDescription);
        Assert.Equal("$95,000–$120,000", result.Job?.Pay);
        Assert.Single(fetcher.JsonRequests);
    }

    [Fact]
    public async Task Other_sites_never_trigger_a_Workday_request()
    {
        var fetcher = FakePageFetcher.WithHtmlAndJson(Fixture("workday-job-page.html"), Fixture("workday-job-detail.json"));

        var result = await CreateService(fetcher).ExtractAsync("https://jobs.example.com/Contoso_Careers/job/Intern_R-1", default);

        Assert.Equal("Platform Engineer Intern", result.Job?.JobTitle);
        Assert.Empty(fetcher.JsonRequests);
    }

    [Fact]
    public async Task Greenhouse_links_still_use_the_Greenhouse_extractor()
    {
        var fetcher = FakePageFetcher.WithHtml(Fixture("greenhouse-job-post.html"));

        var result = await CreateService(fetcher).ExtractAsync("https://job-boards.greenhouse.io/acme/jobs/123", default);

        Assert.Equal("Acme Robotics", result.Job?.CompanyName);
        Assert.Equal("$70,000–$85,000/yr", result.Job?.Pay);
        Assert.Empty(fetcher.JsonRequests);
    }

    [Fact]
    public async Task A_Workday_link_that_redirects_elsewhere_makes_no_Workday_request()
    {
        var fetcher = new FakePageFetcher(
            new PageFetchResult(JobExtractionError.None, Fixture("workday-job-page.html"),
                FinalUrl: new Uri("https://jobs.example.com/moved")),
            new PageFetchResult(JobExtractionError.None, Fixture("workday-job-detail.json")));

        var result = await CreateService(fetcher).ExtractAsync(JobUrl, default);

        Assert.Empty(fetcher.JsonRequests);
        Assert.Equal("Platform Engineer Intern", result.Job?.JobTitle);
    }

    // ---------- Security ----------

    [Theory]
    [InlineData("http://contoso.wd1.myworkdayjobs.com.internal/Contoso_Careers/job/Intern_R-1", JobExtractionError.BlockedUrl)]
    [InlineData("https://contoso.wd1.myworkdayjobs.com:8443/Contoso_Careers/job/Intern_R-1", JobExtractionError.BlockedUrl)]
    [InlineData("https://user:pass@contoso.wd1.myworkdayjobs.com/Contoso_Careers/job/Intern_R-1", JobExtractionError.BlockedUrl)]
    [InlineData("ftp://contoso.wd1.myworkdayjobs.com/Contoso_Careers/job/Intern_R-1", JobExtractionError.InvalidUrl)]
    public async Task Unsafe_links_are_rejected_before_any_request(string url, JobExtractionError expected)
    {
        var fetcher = FakePageFetcher.WithHtmlAndJson(Fixture("workday-job-page.html"), Fixture("workday-job-detail.json"));

        var result = await CreateService(fetcher).ExtractAsync(url, default);

        Assert.Equal(expected, result.Error);
        Assert.Equal(0, fetcher.Calls);
        Assert.Empty(fetcher.JsonRequests);
    }

    [Fact]
    public async Task No_API_request_is_made_when_the_page_itself_could_not_be_fetched()
    {
        var fetcher = new FakePageFetcher(
            PageFetchResult.Failed(JobExtractionError.BlockedBySite, 403),
            new PageFetchResult(JobExtractionError.None, Fixture("workday-job-detail.json")));

        var result = await CreateService(fetcher).ExtractAsync(JobUrl, default);

        Assert.Equal(JobExtractionError.BlockedBySite, result.Error);
        Assert.Empty(fetcher.JsonRequests);
    }
}

// The JSON request goes through the same safe fetcher as pages do.
public class SafePageFetcherJsonTests
{
    private static readonly FakeHostResolver Resolver = new(new()
    {
        ["contoso.wd1.myworkdayjobs.com"] = ["93.184.216.34"],
        ["inside.example.com"] = ["10.0.0.7"],
    });

    private static readonly Uri ApiUrl =
        new("https://contoso.wd1.myworkdayjobs.com/wday/cxs/contoso/Contoso_Careers/job/Intern_R-1");

    private static SafePageFetcher CreateFetcher(FakeHttpHandler handler) =>
        new(new HttpClient(handler), Resolver,
            new JobExtractionOptions { MaxResponseBytes = 1_000, Timeout = TimeSpan.FromMilliseconds(300) },
            NullLogger<SafePageFetcher>.Instance);

    private static HttpResponseMessage Json(string json, string contentType = "application/json") => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, System.Text.Encoding.UTF8, contentType),
    };

    [Fact]
    public async Task Fetches_JSON_and_asks_for_it()
    {
        string? accept = null;
        var handler = new FakeHttpHandler((request, _) =>
        {
            accept = request.Headers.Accept.ToString();
            return Task.FromResult(Json("{\"ok\":true}"));
        });

        var result = await CreateFetcher(handler).FetchJsonAsync(ApiUrl, default);

        Assert.Equal(JobExtractionError.None, result.Error);
        Assert.Equal("{\"ok\":true}", result.Html);
        Assert.Equal("application/json", accept);
    }

    [Fact]
    public async Task Rejects_responses_that_are_not_JSON()
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(FakeHttpHandler.Html("<p>login</p>")));

        Assert.Equal(JobExtractionError.NotHtml, (await CreateFetcher(handler).FetchJsonAsync(ApiUrl, default)).Error);
    }

    [Fact]
    public async Task Rejects_JSON_without_a_content_type()
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent("{}"u8.ToArray()),
        }));

        Assert.Equal(JobExtractionError.NotHtml, (await CreateFetcher(handler).FetchJsonAsync(ApiUrl, default)).Error);
    }

    [Fact]
    public async Task Refuses_to_follow_a_JSON_redirect_to_a_private_address()
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(FakeHttpHandler.Redirect("https://inside.example.com/secret")));

        var result = await CreateFetcher(handler).FetchJsonAsync(ApiUrl, default);

        Assert.Equal(JobExtractionError.BlockedUrl, result.Error);
        Assert.Single(handler.RequestedUrls);
    }

    [Fact]
    public async Task Applies_the_size_limit_to_JSON()
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(Json(new string('x', 5_000))));

        Assert.Equal(JobExtractionError.TooLarge, (await CreateFetcher(handler).FetchJsonAsync(ApiUrl, default)).Error);
    }

    [Fact]
    public async Task Applies_the_timeout_to_JSON()
    {
        var handler = new FakeHttpHandler(async (_, token) =>
        {
            await Task.Delay(Timeout.Infinite, token);
            return Json("{}");
        });

        Assert.Equal(JobExtractionError.Timeout, (await CreateFetcher(handler).FetchJsonAsync(ApiUrl, default)).Error);
    }

    [Fact]
    public async Task Never_sends_a_JSON_request_to_a_blocked_address()
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(Json("{}")));

        var result = await CreateFetcher(handler).FetchJsonAsync(new Uri("https://inside.example.com/api"), default);

        Assert.Equal(JobExtractionError.BlockedUrl, result.Error);
        Assert.Empty(handler.RequestedUrls);
    }
}
