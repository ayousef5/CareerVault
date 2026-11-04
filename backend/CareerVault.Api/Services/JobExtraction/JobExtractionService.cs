using AngleSharp.Html.Parser;

namespace CareerVault.Api.Services.JobExtraction;

// Extracts job details from a job posting URL. It only reads the page; it
// never saves anything. The user reviews the result and adds the job.
public interface IJobExtractionService
{
    Task<JobExtractionResult> ExtractAsync(string? url, CancellationToken cancellationToken);
}

public sealed class JobExtractionService(
    IPageFetcher fetcher,
    IEnumerable<IJobPostingExtractor> extractors,
    ILogger<JobExtractionService> logger,
    IEnumerable<IAsyncJobPostingExtractor>? asyncExtractors = null) : IJobExtractionService
{
    // Scripting is off: the page is parsed as plain markup and no
    // JavaScript (or anything else) from it is ever run.
    private static readonly HtmlParser Parser = new(new HtmlParserOptions { IsScripting = false });

    public async Task<JobExtractionResult> ExtractAsync(string? url, CancellationToken cancellationToken)
    {
        // 1. Is this a URL we're allowed to fetch at all?
        var (uri, urlError) = UrlSafety.CheckUrl(url);
        if (uri is null || urlError != JobExtractionError.None)
            return new JobExtractionResult(urlError == JobExtractionError.None ? JobExtractionError.InvalidUrl : urlError);

        // 2. Download the page safely.
        var page = await fetcher.FetchAsync(uri, cancellationToken);
        if (page.Error != JobExtractionError.None || page.Html is null)
        {
            LogOutcome(uri, page.Error);
            return new JobExtractionResult(
                page.Error == JobExtractionError.None ? JobExtractionError.PageUnavailable : page.Error,
                Url: uri);
        }

        // 3. Run every extractor in order; earlier ones win, later ones only
        // fill in fields that are still missing. Extractors that make one
        // extra (safe) request, such as Workday's, go first.
        var document = Parser.ParseDocument(page.Html);
        var pageUrl = page.FinalUrl ?? uri;
        var job = new ExtractedJob();

        foreach (var extractor in asyncExtractors ?? [])
            job = job.WithFallback(await extractor.ExtractAsync(document, pageUrl, cancellationToken));

        foreach (var extractor in extractors)
            job = job.WithFallback(extractor.Extract(document, pageUrl));

        var error = job.IsEmpty ? JobExtractionError.NoJobDataFound : JobExtractionError.None;
        LogOutcome(uri, error);

        return error == JobExtractionError.None
            ? new JobExtractionResult(JobExtractionError.None, job, uri)
            : new JobExtractionResult(error, Url: uri);
    }

    // Logs only the host and outcome: no full URL (it can contain personal
    // tokens) and no page content.
    private void LogOutcome(Uri uri, JobExtractionError error) =>
        logger.LogInformation("Job extraction from {Host}: {Outcome}", uri.Host, error);
}

// Registers everything job extraction needs, so Program.cs stays short.
public static class JobExtractionServiceCollectionExtensions
{
    public static IServiceCollection AddJobExtraction(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Optional overrides from appsettings.json ("JobExtraction" section).
        services.AddSingleton(
            configuration.GetSection("JobExtraction").Get<JobExtractionOptions>() ?? new JobExtractionOptions());

        services.AddSingleton<IHostResolver, DnsHostResolver>();

        services.AddHttpClient<IPageFetcher, SafePageFetcher>()
            .ConfigurePrimaryHttpMessageHandler(provider =>
                SafeHttpHandler.Create(provider.GetRequiredService<IHostResolver>()))
            // The default HttpClient logging writes full URLs; leave it out.
            .RemoveAllLoggers();

        // Order matters: earlier extractors win and later ones only fill in
        // missing fields. Workday (which needs one extra request, made
        // through the safe fetcher) runs first; then the other site-specific
        // extractors (which only act on their own sites), then structured
        // JobPosting data, then general page metadata.
        services.AddScoped<IAsyncJobPostingExtractor, WorkdayJobPostingExtractor>();
        services.AddSingleton<IJobPostingExtractor, GreenhouseJobPostingExtractor>();
        services.AddSingleton<IJobPostingExtractor, JsonLdJobPostingExtractor>();
        services.AddSingleton<IJobPostingExtractor, PageMetadataExtractor>();

        services.AddScoped<IJobExtractionService, JobExtractionService>();
        return services;
    }
}
