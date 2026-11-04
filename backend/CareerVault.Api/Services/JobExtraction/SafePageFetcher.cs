using System.Net;
using System.Net.Sockets;
using System.Text;

namespace CareerVault.Api.Services.JobExtraction;

// Downloads a web page. An interface so tests (and the service) don't need
// the real internet.
public interface IPageFetcher
{
    // Downloads an HTML page. The page's text is in PageFetchResult.Html.
    Task<PageFetchResult> FetchAsync(Uri url, CancellationToken cancellationToken);

    // Downloads a JSON document (e.g. a job board's public job-detail API)
    // with exactly the same safety checks; only JSON responses are accepted.
    // The JSON text is in PageFetchResult.Html.
    Task<PageFetchResult> FetchJsonAsync(Uri url, CancellationToken cancellationToken);
}

// Thrown when a connection would go to a private or blocked address.
public sealed class BlockedAddressException : Exception
{
    public BlockedAddressException()
        : base("The destination address is not allowed.")
    {
    }
}

// Builds the HTTP handler used to fetch job pages safely.
public static class SafeHttpHandler
{
    public static SocketsHttpHandler Create(IHostResolver resolver) => new()
    {
        // SafePageFetcher follows redirects itself, checking each one first.
        AllowAutoRedirect = false,
        // A proxy would connect somewhere we haven't checked.
        UseProxy = false,
        UseCookies = false,
        AutomaticDecompression = DecompressionMethods.All,
        ConnectTimeout = TimeSpan.FromSeconds(5),
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),

        // Runs at the moment of connecting: resolve the host again and only
        // connect to the checked public addresses. This stops "DNS
        // rebinding", where a name passes our earlier check and then
        // switches to an internal address.
        ConnectCallback = async (context, cancellationToken) =>
        {
            var addresses = await UrlSafety.ResolvePublicAddressesAsync(
                context.DnsEndPoint.Host, resolver, cancellationToken)
                ?? throw new BlockedAddressException();

            var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(addresses, context.DnsEndPoint.Port, cancellationToken);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        },
    };
}

// Fetches a job posting page with SSRF protection:
//  - every URL (including each redirect) must pass UrlSafety's checks,
//  - DNS answers must all be public addresses (checked before sending and
//    again when connecting, see SafeHttpHandler),
//  - at most MaxRedirects redirects, MaxResponseBytes bytes and Timeout time,
//  - only HTML pages are accepted.
// The page is only downloaded as text; nothing in it is ever run.
public sealed class SafePageFetcher(
    HttpClient httpClient,
    IHostResolver resolver,
    JobExtractionOptions options,
    ILogger<SafePageFetcher> logger) : IPageFetcher
{
    private static readonly HashSet<HttpStatusCode> RedirectCodes =
    [
        HttpStatusCode.MovedPermanently,
        HttpStatusCode.Found,
        HttpStatusCode.SeeOther,
        HttpStatusCode.TemporaryRedirect,
        HttpStatusCode.PermanentRedirect,
    ];

    // What kind of response a fetch expects.
    private enum ExpectedContent
    {
        Html,
        Json,
    }

    public Task<PageFetchResult> FetchAsync(Uri url, CancellationToken cancellationToken) =>
        FetchAsync(url, ExpectedContent.Html, cancellationToken);

    public Task<PageFetchResult> FetchJsonAsync(Uri url, CancellationToken cancellationToken) =>
        FetchAsync(url, ExpectedContent.Json, cancellationToken);

    // The one request path for both kinds, so every safety check applies
    // to both.
    private async Task<PageFetchResult> FetchAsync(
        Uri url,
        ExpectedContent expected,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(options.Timeout);
        var token = timeout.Token;

        var current = url;
        try
        {
            for (var redirects = 0; ; redirects++)
            {
                var check = UrlSafety.CheckUri(current);
                if (check != JobExtractionError.None)
                    return PageFetchResult.Failed(check);

                // Check where the name points before sending anything.
                if (await UrlSafety.ResolvePublicAddressesAsync(current.IdnHost, resolver, token) is null)
                    return PageFetchResult.Failed(JobExtractionError.BlockedUrl);

                using var request = new HttpRequestMessage(HttpMethod.Get, current);
                request.Headers.UserAgent.ParseAdd("CareerVault/1.0 (job posting import)");
                request.Headers.Accept.ParseAdd(
                    expected == ExpectedContent.Json ? "application/json" : "text/html,application/xhtml+xml");

                using var response = await httpClient.SendAsync(
                    request, HttpCompletionOption.ResponseHeadersRead, token);

                if (RedirectCodes.Contains(response.StatusCode))
                {
                    var location = response.Headers.Location;
                    if (location is null || redirects >= options.MaxRedirects)
                        return PageFetchResult.Failed(JobExtractionError.PageUnavailable, (int)response.StatusCode);

                    // The next loop checks the new URL before following it.
                    current = location.IsAbsoluteUri ? location : new Uri(current, location);
                    continue;
                }

                return await ReadPageAsync(response, current, expected, token);
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return PageFetchResult.Failed(JobExtractionError.Timeout);
        }
        catch (Exception ex) when (IsBlockedAddress(ex))
        {
            return PageFetchResult.Failed(JobExtractionError.BlockedUrl);
        }
        catch (Exception ex) when (ex is HttpRequestException or SocketException or IOException)
        {
            // Only the host and the kind of error are logged, never the full
            // URL (it can contain personal tokens).
            logger.LogInformation(
                "Fetching a job page from {Host} failed ({ErrorType})", current.Host, ex.GetType().Name);
            return PageFetchResult.Failed(JobExtractionError.PageUnavailable);
        }
    }

    // Checks the response and reads it as text, within the size limit.
    private async Task<PageFetchResult> ReadPageAsync(
        HttpResponseMessage response,
        Uri pageUrl,
        ExpectedContent expected,
        CancellationToken token)
    {
        var status = (int)response.StatusCode;

        if (response.StatusCode is HttpStatusCode.Unauthorized
            or HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests)
            return PageFetchResult.Failed(JobExtractionError.BlockedBySite, status);

        if (!response.IsSuccessStatusCode)
            return PageFetchResult.Failed(JobExtractionError.PageUnavailable, status);

        var mediaType = response.Content.Headers.ContentType?.MediaType;
        if (!IsExpectedContentType(mediaType, expected))
            return PageFetchResult.Failed(JobExtractionError.NotHtml, status);

        if (response.Content.Headers.ContentLength > options.MaxResponseBytes)
            return PageFetchResult.Failed(JobExtractionError.TooLarge, status);

        var bytes = await ReadLimitedAsync(response.Content, options.MaxResponseBytes, token);
        if (bytes is null)
            return PageFetchResult.Failed(JobExtractionError.TooLarge, status);

        var html = GetEncoding(response.Content.Headers.ContentType?.CharSet).GetString(bytes);
        return new PageFetchResult(JobExtractionError.None, html, pageUrl, status);
    }

    // HTML pages may omit the content type; JSON must say it's JSON.
    private static bool IsExpectedContentType(string? mediaType, ExpectedContent expected) =>
        expected == ExpectedContent.Json
            ? mediaType is "application/json" or "text/json"
              || (mediaType?.EndsWith("+json", StringComparison.OrdinalIgnoreCase) ?? false)
            : mediaType is null or "text/html" or "application/xhtml+xml";

    // Reads at most maxBytes; returns null if the body is bigger. (Checked
    // while reading, because Content-Length can be missing or wrong.)
    private static async Task<byte[]?> ReadLimitedAsync(
        HttpContent content,
        long maxBytes,
        CancellationToken token)
    {
        await using var stream = await content.ReadAsStreamAsync(token);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;

        while ((read = await stream.ReadAsync(chunk, token)) > 0)
        {
            if (buffer.Length + read > maxBytes)
                return null;
            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    private static Encoding GetEncoding(string? charset)
    {
        try
        {
            return string.IsNullOrWhiteSpace(charset)
                ? Encoding.UTF8
                : Encoding.GetEncoding(charset.Trim('"'));
        }
        catch (ArgumentException)
        {
            return Encoding.UTF8;
        }
    }

    private static bool IsBlockedAddress(Exception? ex)
    {
        for (; ex is not null; ex = ex.InnerException)
        {
            if (ex is BlockedAddressException)
                return true;
        }
        return false;
    }
}
