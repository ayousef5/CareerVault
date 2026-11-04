using System.Net;
using System.Net.Sockets;
using CareerVault.Api.Services.JobExtraction;
using Microsoft.Extensions.Logging.Abstractions;

namespace CareerVault.Api.Tests.JobExtraction;

public class SafePageFetcherTests
{
    // jobs.example and other.example are "public"; inside.example points
    // at a private address; mixed.example has one of each.
    private static readonly FakeHostResolver Resolver = new(new()
    {
        ["jobs.example.com"] = ["93.184.216.34"],
        ["other.example.com"] = ["93.184.216.35"],
        ["inside.example.com"] = ["10.0.0.7"],
        ["mixed.example.com"] = ["93.184.216.34", "192.168.1.20"],
    });

    private static readonly JobExtractionOptions SmallLimits = new()
    {
        MaxRedirects = 3,
        MaxResponseBytes = 1_000,
        Timeout = TimeSpan.FromMilliseconds(300),
    };

    private static SafePageFetcher CreateFetcher(FakeHttpHandler handler, JobExtractionOptions? options = null) =>
        new(new HttpClient(handler), Resolver, options ?? SmallLimits, NullLogger<SafePageFetcher>.Instance);

    private static Task<PageFetchResult> FetchAsync(SafePageFetcher fetcher, string url) =>
        fetcher.FetchAsync(new Uri(url), CancellationToken.None);

    [Fact]
    public async Task Fetches_an_html_page()
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(FakeHttpHandler.Html("<h1>Engineer</h1>")));

        var result = await FetchAsync(CreateFetcher(handler), "https://jobs.example.com/1");

        Assert.Equal(JobExtractionError.None, result.Error);
        Assert.Contains("Engineer", result.Html);
        Assert.Equal(new Uri("https://jobs.example.com/1"), result.FinalUrl);
    }

    [Theory]
    [InlineData("https://inside.example.com/")]
    [InlineData("https://mixed.example.com/")]
    public async Task Never_sends_a_request_to_a_host_with_a_private_address(string url)
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(FakeHttpHandler.Html("secret")));

        var result = await FetchAsync(CreateFetcher(handler), url);

        Assert.Equal(JobExtractionError.BlockedUrl, result.Error);
        Assert.Empty(handler.RequestedUrls);
    }

    [Theory]
    [InlineData("http://127.0.0.1/admin")]
    [InlineData("http://169.254.169.254/latest/meta-data/")]
    [InlineData("https://inside.example.com/")]
    [InlineData("http://localhost/")]
    [InlineData("https://jobs.example.com:8443/")]
    public async Task Refuses_to_follow_a_redirect_to_a_blocked_destination(string target)
    {
        var handler = new FakeHttpHandler((request, _) => Task.FromResult(
            request.RequestUri!.Host == "jobs.example.com" && request.RequestUri.Port == 443
                ? FakeHttpHandler.Redirect(target)
                : FakeHttpHandler.Html("internal data")));

        var result = await FetchAsync(CreateFetcher(handler), "https://jobs.example.com/start");

        Assert.Equal(JobExtractionError.BlockedUrl, result.Error);
        // Only the first request was sent; the redirect was never followed.
        Assert.Single(handler.RequestedUrls);
    }

    [Fact]
    public async Task Refuses_a_redirect_to_a_non_http_scheme()
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(FakeHttpHandler.Redirect("file:///etc/passwd")));

        var result = await FetchAsync(CreateFetcher(handler), "https://jobs.example.com/start");

        Assert.Equal(JobExtractionError.InvalidUrl, result.Error);
        Assert.Single(handler.RequestedUrls);
    }

    [Fact]
    public async Task Follows_safe_redirects_including_relative_ones()
    {
        var handler = new FakeHttpHandler((request, _) => Task.FromResult(request.RequestUri!.AbsolutePath switch
        {
            "/start" => FakeHttpHandler.Redirect("https://other.example.com/moved", HttpStatusCode.MovedPermanently),
            "/moved" => FakeHttpHandler.Redirect("/final", HttpStatusCode.TemporaryRedirect),
            _ => FakeHttpHandler.Html("<h1>Found it</h1>"),
        }));

        var result = await FetchAsync(CreateFetcher(handler), "https://jobs.example.com/start");

        Assert.Equal(JobExtractionError.None, result.Error);
        Assert.Equal(new Uri("https://other.example.com/final"), result.FinalUrl);
        Assert.Equal(3, handler.RequestedUrls.Count);
    }

    [Fact]
    public async Task Stops_after_too_many_redirects()
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(FakeHttpHandler.Redirect("https://jobs.example.com/loop")));

        var result = await FetchAsync(CreateFetcher(handler), "https://jobs.example.com/loop");

        Assert.Equal(JobExtractionError.PageUnavailable, result.Error);
        // The first request plus MaxRedirects (3) followed redirects.
        Assert.Equal(4, handler.RequestedUrls.Count);
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound, JobExtractionError.PageUnavailable)]
    [InlineData(HttpStatusCode.InternalServerError, JobExtractionError.PageUnavailable)]
    [InlineData(HttpStatusCode.Forbidden, JobExtractionError.BlockedBySite)]
    [InlineData(HttpStatusCode.Unauthorized, JobExtractionError.BlockedBySite)]
    [InlineData(HttpStatusCode.TooManyRequests, JobExtractionError.BlockedBySite)]
    public async Task Reports_inaccessible_pages(HttpStatusCode status, JobExtractionError expected)
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(new HttpResponseMessage(status)));

        var result = await FetchAsync(CreateFetcher(handler), "https://jobs.example.com/1");

        Assert.Equal(expected, result.Error);
        Assert.Equal((int)status, result.StatusCode);
    }

    [Fact]
    public async Task Rejects_responses_that_are_not_html()
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([0x25, 0x50, 0x44, 0x46])
            {
                Headers = { ContentType = new("application/pdf") },
            },
        }));

        var result = await FetchAsync(CreateFetcher(handler), "https://jobs.example.com/job.pdf");

        Assert.Equal(JobExtractionError.NotHtml, result.Error);
    }

    [Fact]
    public async Task Rejects_pages_over_the_size_limit_even_without_a_content_length()
    {
        // A stream with no known length, bigger than the 1,000-byte limit.
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamContent(new NonSeekableStream(new byte[5_000]))
            {
                Headers = { ContentType = new("text/html") },
            },
        }));

        var result = await FetchAsync(CreateFetcher(handler), "https://jobs.example.com/huge");

        Assert.Equal(JobExtractionError.TooLarge, result.Error);
    }

    [Fact]
    public async Task Rejects_pages_whose_content_length_is_over_the_limit()
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(FakeHttpHandler.Html(new string('x', 5_000))));

        var result = await FetchAsync(CreateFetcher(handler), "https://jobs.example.com/huge");

        Assert.Equal(JobExtractionError.TooLarge, result.Error);
    }

    [Fact]
    public async Task Gives_up_when_the_site_is_too_slow()
    {
        var handler = new FakeHttpHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return FakeHttpHandler.Html("too late");
        });

        var result = await FetchAsync(CreateFetcher(handler), "https://jobs.example.com/slow");

        Assert.Equal(JobExtractionError.Timeout, result.Error);
    }

    [Fact]
    public async Task Reports_an_unknown_host_as_unavailable()
    {
        var handler = new FakeHttpHandler((_, _) => Task.FromResult(FakeHttpHandler.Html("")));

        var result = await FetchAsync(CreateFetcher(handler), "https://no-such-host.example.com/");

        Assert.Equal(JobExtractionError.PageUnavailable, result.Error);
        Assert.Empty(handler.RequestedUrls);
    }

    [Fact]
    public async Task Reports_network_errors_as_unavailable()
    {
        var handler = new FakeHttpHandler((_, _) => throw new HttpRequestException("connection reset"));

        var result = await FetchAsync(CreateFetcher(handler), "https://jobs.example.com/1");

        Assert.Equal(JobExtractionError.PageUnavailable, result.Error);
    }

    [Fact]
    public async Task Passes_on_cancellation_by_the_caller()
    {
        var handler = new FakeHttpHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return FakeHttpHandler.Html("");
        });
        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        var fetcher = CreateFetcher(handler, new JobExtractionOptions { Timeout = TimeSpan.FromSeconds(30) });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => fetcher.FetchAsync(new Uri("https://jobs.example.com/1"), cancel.Token));
    }

    // The real connection step: even if a name passed earlier checks, the
    // connection itself refuses private addresses ("DNS rebinding").
    [Fact]
    public async Task The_connection_step_refuses_a_name_that_resolves_to_localhost()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        var rebinding = new FakeHostResolver(new() { ["rebind.example.com"] = ["127.0.0.1"] });
        using var client = new HttpClient(SafeHttpHandler.Create(rebinding));

        var error = await Assert.ThrowsAsync<HttpRequestException>(
            () => client.GetAsync($"http://rebind.example.com:{port}/"));

        Assert.IsType<BlockedAddressException>(error.InnerException);
        // Nothing ever connected to the local server.
        Assert.False(listener.Pending());
    }

    // A stream whose length can't be known up front.
    private sealed class NonSeekableStream(byte[] data) : MemoryStream(data)
    {
        public override bool CanSeek => false;
        public override long Length => throw new NotSupportedException();
    }
}
