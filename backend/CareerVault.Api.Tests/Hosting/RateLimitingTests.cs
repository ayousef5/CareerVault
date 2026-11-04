using System.Net;
using System.Net.Http.Json;
using CareerVault.Api.Hosting;
using CareerVault.Api.Tests.Resumes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using static CareerVault.Api.Tests.Resumes.ResumeTestApi;

namespace CareerVault.Api.Tests.Hosting;

// The per-minute limits on login, job-posting reading and resume uploads.
// Each test uses its own app (with its own counters) and low limits.
public class RateLimitingTests
{
    private sealed class LowLimitsFactory : CareerVaultApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("RateLimiting:AuthPerMinute", "4");
            builder.UseSetting("RateLimiting:ExtractionPerMinute", "2");
            builder.UseSetting("RateLimiting:UploadsPerMinute", "2");
        }
    }

    private static async Task AssertTooManyRequestsAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.True(response.Headers.RetryAfter?.Delta > TimeSpan.Zero, "Retry-After is missing");
        var problem = await response.Content.ReadFromJsonAsync<ProblemDetails>();
        Assert.Equal(RateLimiting.RejectedMessage, problem?.Detail);
    }

    [Fact]
    public async Task Too_many_login_attempts_are_refused()
    {
        await using var factory = new LowLimitsFactory();
        var client = factory.CreateClient();
        var attempt = new { email = "someone@example.com", password = "Wrong-Passw0rd!" };

        for (var i = 0; i < 4; i++)
        {
            var response = await client.PostAsJsonAsync("/api/auth/login?useCookies=false", attempt);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        await AssertTooManyRequestsAsync(await client.PostAsJsonAsync("/api/auth/login?useCookies=false", attempt));
        // Registration shares the same limit.
        await AssertTooManyRequestsAsync(await client.PostAsJsonAsync("/api/auth/register", attempt));
    }

    [Fact]
    public async Task Job_posting_reading_is_limited_per_user()
    {
        await using var factory = new LowLimitsFactory();
        var client = await TestUsers.CreateLoggedInClientAsync(factory);
        // An invalid link is refused straight away (no web request), which
        // still counts towards the limit.
        var request = new { url = "not a link" };

        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/jobs/extract", request)).StatusCode);

        await AssertTooManyRequestsAsync(await client.PostAsJsonAsync("/api/jobs/extract", request));
    }

    [Fact]
    public async Task Resume_uploads_are_limited_per_user_not_for_everyone()
    {
        await using var factory = new LowLimitsFactory();
        var alice = await TestUsers.CreateLoggedInClientAsync(factory);
        var bob = await TestUsers.CreateLoggedInClientAsync(factory);
        var alicesJob = await CreateJobAsync(alice, "Google");
        var bobsJob = await CreateJobAsync(bob, "Microsoft");

        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.OK, (await UploadAsync(alice, alicesJob.Id, ResumeTestFiles.Pdf($"v{i}"))).StatusCode);
        await AssertTooManyRequestsAsync(await UploadAsync(alice, alicesJob.Id, ResumeTestFiles.Pdf("v3")));

        // Bob has his own allowance.
        Assert.Equal(HttpStatusCode.OK, (await UploadAsync(bob, bobsJob.Id, ResumeTestFiles.Pdf("bob"))).StatusCode);
        // Other job endpoints aren't limited.
        for (var i = 0; i < 10; i++)
            Assert.Equal(HttpStatusCode.OK, (await alice.GetAsync("/api/jobs")).StatusCode);
    }
}
