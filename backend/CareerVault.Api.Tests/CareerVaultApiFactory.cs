using CareerVault.Api.Data;
using CareerVault.Api.Services.Resumes;
using CareerVault.Api.Tests.Resumes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace CareerVault.Api.Tests;

// Starts the real API in memory for tests, with PostgreSQL swapped for an
// in-memory database, so the tests don't need a database server.
public class CareerVaultApiFactory : WebApplicationFactory<Program>
{
    // Each factory gets its own empty database.
    private readonly string _databaseName = $"CareerVaultTests-{Guid.NewGuid()}";

    // Uploaded files go here instead of the disk, so tests can check them.
    public InMemoryFileStorage FileStorage { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        builder.ConfigureServices(services =>
        {
            // Remove the PostgreSQL setup from Program.cs...
            services.RemoveAll<DbContextOptions<CareerVaultDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<CareerVaultDbContext>>();

            // ...and use an in-memory database instead.
            services.AddDbContext<CareerVaultDbContext>(options =>
                options.UseInMemoryDatabase(_databaseName));

            // ...and keep uploaded files in memory instead of on the disk.
            services.RemoveAll<IFileStorage>();
            services.AddSingleton<IFileStorage>(FileStorage);
        });
    }
}
