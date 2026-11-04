using System.Net;
using CareerVault.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace CareerVault.Api.Tests.Hosting;

// /health (the app is running) and /health/ready (it can reach the database).
public class HealthEndpointTests : IClassFixture<CareerVaultApiFactory>
{
    private readonly CareerVaultApiFactory _factory;

    public HealthEndpointTests(CareerVaultApiFactory factory)
    {
        _factory = factory;
    }

    [Theory]
    [InlineData("/health")]
    [InlineData("/health/ready")]
    public async Task Answers_healthy_without_logging_in(string url)
    {
        var response = await _factory.CreateClient().GetAsync(url);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Is_never_rate_limited()
    {
        var client = _factory.CreateClient();

        for (var i = 0; i < 30; i++)
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
    }

    // The API pointed at a PostgreSQL server that isn't there.
    private sealed class UnreachableDatabaseFactory : WebApplicationFactory<Program>
    {
        public const string Password = "not-a-real-password-123";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<CareerVaultDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<CareerVaultDbContext>>();
                // Port 1 on this machine: the connection is refused at once.
                services.AddDbContext<CareerVaultDbContext>(options => options.UseNpgsql(
                    $"Host=127.0.0.1;Port=1;Database=careervault;Username=probe;Password={Password};Timeout=3"));
            });
        }
    }

    [Fact]
    public async Task Readiness_fails_without_the_database_but_reveals_nothing()
    {
        await using var factory = new UnreachableDatabaseFactory();
        var client = factory.CreateClient();

        var live = await client.GetAsync("/health");
        var ready = await client.GetAsync("/health/ready");

        // Still running, but not ready for traffic.
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, ready.StatusCode);
        var body = await ready.Content.ReadAsStringAsync();
        Assert.Equal("Unhealthy", body);
        Assert.DoesNotContain(UnreachableDatabaseFactory.Password, body);
        Assert.DoesNotContain("127.0.0.1", body);
    }
}
