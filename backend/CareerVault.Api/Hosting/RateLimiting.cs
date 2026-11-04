using System.Threading.RateLimiting;
using CareerVault.Api.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace CareerVault.Api.Hosting;

// Requests allowed per minute ("RateLimiting" in appsettings).
public sealed class RateLimitSettings
{
    // Login, registration and the other /api/auth endpoints, per client address.
    public int AuthPerMinute { get; set; } = 10;
    // Reading job postings (/api/jobs/extract), per user.
    public int ExtractionPerMinute { get; set; } = 30;
    // Resume uploads, per user.
    public int UploadsPerMinute { get; set; } = 10;
}

// Limits on the endpoints that cost the most or attract abuse: guessing
// passwords, making the server fetch web pages, and uploading files.
// Everything else is unlimited. Over the limit, the API answers 429 with a
// Retry-After header and a short message the frontend shows.
public static class RateLimiting
{
    public const string Auth = "auth";
    public const string Extraction = "extraction";
    public const string Uploads = "uploads";

    public const string RejectedMessage = "Too many requests. Please wait a minute and try again.";

    public static IServiceCollection AddCareerVaultRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<RateLimitSettings>(configuration.GetSection("RateLimiting"));

        return services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (context, cancellationToken) =>
            {
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                    context.HttpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString();

                await Results.Problem(
                        statusCode: StatusCodes.Status429TooManyRequests,
                        title: "Too many requests",
                        detail: RejectedMessage)
                    .ExecuteAsync(context.HttpContext);
            };

            // Not logged in yet, so limited by the client's address.
            options.AddPolicy(Auth, context =>
                PerMinute($"ip:{ClientAddress(context)}", Settings(context).AuthPerMinute));

            // Logged in: limited per user (falling back to the address).
            options.AddPolicy(Extraction, context =>
                PerMinute(UserOrAddress(context), Settings(context).ExtractionPerMinute));
            options.AddPolicy(Uploads, context =>
                PerMinute(UserOrAddress(context), Settings(context).UploadsPerMinute));
        });
    }

    private static RateLimitSettings Settings(HttpContext context) =>
        context.RequestServices.GetRequiredService<IOptions<RateLimitSettings>>().Value;

    private static RateLimitPartition<string> PerMinute(string key, int permitLimit) =>
        RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = Math.Max(1, permitLimit),
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        });

    // The real client address (see ForwardedHeadersSetup).
    private static string ClientAddress(HttpContext context) =>
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    private static string UserOrAddress(HttpContext context) =>
        context.User.GetUserId() is { } userId ? $"user:{userId}" : $"ip:{ClientAddress(context)}";
}
