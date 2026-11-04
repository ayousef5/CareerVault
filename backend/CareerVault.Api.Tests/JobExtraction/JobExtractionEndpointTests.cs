using System.Net;
using System.Net.Http.Json;
using CareerVault.Api.DTOs;
using CareerVault.Api.Services.JobExtraction;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace CareerVault.Api.Tests.JobExtraction;

// Tests POST /api/jobs/extract through real HTTP requests, with page
// fetching replaced by a fake so no real website is contacted.
public class JobExtractionEndpointTests : IClassFixture<CareerVaultApiFactory>
{
    private readonly CareerVaultApiFactory _factory;

    public JobExtractionEndpointTests(CareerVaultApiFactory factory)
    {
        _factory = factory;
    }

    // The API, with pages coming from the given fake fetcher.
    private WebApplicationFactory<Program> WithFetcher(IPageFetcher fetcher) =>
        _factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton(fetcher)));

    private const string JobPage = """
        <html><head><script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Platform Engineer",
          "hiringOrganization": { "name": "Initech" },
          "jobLocation": { "address": { "addressLocality": "Denver", "addressRegion": "CO" } },
          "description": "<p>Run the platform.</p>"
        }
        </script></head><body></body></html>
        """;

    [Fact]
    public async Task Requires_login()
    {
        var anonymous = WithFetcher(FakePageFetcher.WithHtml(JobPage)).CreateClient();

        var response = await anonymous.PostAsJsonAsync(
            "/api/jobs/extract", new ExtractJobRequest { Url = "https://jobs.example.com/1" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Returns_the_extracted_fields_and_does_not_save_a_job()
    {
        var api = WithFetcher(FakePageFetcher.WithHtml(JobPage));
        var client = await TestUsers.CreateLoggedInClientAsync(api);

        var response = await client.PostAsJsonAsync(
            "/api/jobs/extract", new ExtractJobRequest { Url = " https://jobs.example.com/1 " });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var job = await response.Content.ReadFromJsonAsync<ExtractedJobResponse>();
        Assert.Equal("https://jobs.example.com/1", job!.Url);
        Assert.Equal("Platform Engineer", job.JobTitle);
        Assert.Equal("Initech", job.CompanyName);
        Assert.Equal("Denver, CO", job.Location);
        Assert.Equal("Run the platform.", job.JobDescription);
        // Not on the page, so left empty.
        Assert.Null(job.Pay);
        Assert.Null(job.Recruiter);

        // Extraction only reads: nothing was added to the user's jobs.
        var jobs = await client.GetFromJsonAsync<List<JobResponse>>("/api/jobs");
        Assert.Empty(jobs!);
    }

    [Theory]
    [InlineData("not a url")]
    [InlineData("ftp://example.com/job")]
    [InlineData("")]
    public async Task Rejects_invalid_urls(string url)
    {
        var fetcher = FakePageFetcher.WithHtml(JobPage);
        var client = await TestUsers.CreateLoggedInClientAsync(WithFetcher(fetcher));

        var response = await client.PostAsJsonAsync("/api/jobs/extract", new ExtractJobRequest { Url = url });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, fetcher.Calls);
    }

    [Theory]
    [InlineData("http://localhost:80/admin")]
    [InlineData("http://169.254.169.254/latest/meta-data/")]
    [InlineData("http://192.168.0.1/")]
    public async Task Rejects_internal_addresses_without_fetching_them(string url)
    {
        var fetcher = FakePageFetcher.WithHtml(JobPage);
        var client = await TestUsers.CreateLoggedInClientAsync(WithFetcher(fetcher));

        var response = await client.PostAsJsonAsync("/api/jobs/extract", new ExtractJobRequest { Url = url });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ProblemDetails>();
        Assert.Equal("This link can't be used. Only public websites are supported.", problem!.Detail);
        Assert.Equal(0, fetcher.Calls);
    }

    [Theory]
    [InlineData(JobExtractionError.BlockedBySite, HttpStatusCode.BadGateway)]
    [InlineData(JobExtractionError.PageUnavailable, HttpStatusCode.BadGateway)]
    [InlineData(JobExtractionError.Timeout, HttpStatusCode.GatewayTimeout)]
    [InlineData(JobExtractionError.NotHtml, HttpStatusCode.UnprocessableEntity)]
    [InlineData(JobExtractionError.TooLarge, HttpStatusCode.UnprocessableEntity)]
    public async Task Explains_pages_that_cannot_be_read(JobExtractionError error, HttpStatusCode expected)
    {
        var client = await TestUsers.CreateLoggedInClientAsync(
            WithFetcher(new FakePageFetcher(PageFetchResult.Failed(error))));

        var response = await client.PostAsJsonAsync(
            "/api/jobs/extract", new ExtractJobRequest { Url = "https://jobs.example.com/1" });

        Assert.Equal(expected, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ProblemDetails>();
        Assert.False(string.IsNullOrWhiteSpace(problem!.Detail));
        // No internal details leak into the message.
        Assert.DoesNotContain("Exception", problem.Detail);
    }

    [Fact]
    public async Task Reports_a_page_without_job_details()
    {
        var client = await TestUsers.CreateLoggedInClientAsync(
            WithFetcher(FakePageFetcher.WithHtml("<html><body><p>Nothing here</p></body></html>")));

        var response = await client.PostAsJsonAsync(
            "/api/jobs/extract", new ExtractJobRequest { Url = "https://jobs.example.com/1" });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }
}
