using System.Net;
using System.Net.Sockets;
using CareerVault.Api.Services.JobExtraction;

namespace CareerVault.Api.Tests.JobExtraction;

// Pretends host names point at the given addresses. Unknown names fail
// like a real "host not found".
public sealed class FakeHostResolver(Dictionary<string, string[]> addresses) : IHostResolver
{
    public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken)
    {
        if (!addresses.TryGetValue(host, out var list))
            throw new SocketException((int)SocketError.HostNotFound);
        return Task.FromResult(list.Select(IPAddress.Parse).ToArray());
    }
}

// Answers HTTP requests without a network, and records which URLs were asked for.
public sealed class FakeHttpHandler(
    Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
{
    public List<Uri> RequestedUrls { get; } = [];

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        RequestedUrls.Add(request.RequestUri!);
        return respond(request, cancellationToken);
    }

    public static HttpResponseMessage Html(string html) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(html, System.Text.Encoding.UTF8, "text/html"),
    };

    public static HttpResponseMessage Redirect(string location, HttpStatusCode code = HttpStatusCode.Found)
    {
        var response = new HttpResponseMessage(code);
        response.Headers.Location = new Uri(location, UriKind.RelativeOrAbsolute);
        return response;
    }
}

// Returns a fixed page (or error) instead of fetching anything, and
// optionally a fixed JSON document for FetchJsonAsync (by default that
// fails, as if there were no such API).
public sealed class FakePageFetcher(PageFetchResult result, PageFetchResult? jsonResult = null) : IPageFetcher
{
    // How many HTML pages were requested.
    public int Calls { get; private set; }

    // Every JSON address that was requested, in order.
    public List<Uri> JsonRequests { get; } = [];

    public Task<PageFetchResult> FetchAsync(Uri url, CancellationToken cancellationToken)
    {
        Calls++;
        return Task.FromResult(result with { FinalUrl = result.FinalUrl ?? url });
    }

    public Task<PageFetchResult> FetchJsonAsync(Uri url, CancellationToken cancellationToken)
    {
        JsonRequests.Add(url);
        var json = jsonResult ?? PageFetchResult.Failed(JobExtractionError.PageUnavailable, 404);
        return Task.FromResult(json with { FinalUrl = json.FinalUrl ?? url });
    }

    // A fake that serves this page, and this JSON for any JSON request.
    public static FakePageFetcher WithHtmlAndJson(string html, string json) =>
        new(new PageFetchResult(JobExtractionError.None, html),
            new PageFetchResult(JobExtractionError.None, json));

    public static FakePageFetcher WithHtml(string html) =>
        new(new PageFetchResult(JobExtractionError.None, html));
}
