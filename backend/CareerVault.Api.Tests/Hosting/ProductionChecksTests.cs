using CareerVault.Api.Hosting;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace CareerVault.Api.Tests.Hosting;

// Production refuses to start without its database, CORS, storage and key
// settings, and never prints their values.
public class ProductionChecksTests
{
    private static readonly Dictionary<string, string?> Complete = new()
    {
        ["ConnectionStrings:CareerVault"] = "Host=db.example;Password=s3cret-value",
        ["Cors:FrontendOrigin"] = "https://orange-flower-03a292f10.5.azurestaticapps.net",
        ["ResumeStorage:Provider"] = "AzureBlob",
        ["ResumeStorage:BlobServiceUri"] = "https://careervault.blob.core.windows.net",
        ["DataProtection:BlobUri"] = "https://careervault.blob.core.windows.net/dataprotection/keys.xml",
    };

    private static List<string> Problems(Action<Dictionary<string, string?>>? change = null)
    {
        var settings = new Dictionary<string, string?>(Complete);
        change?.Invoke(settings);
        return ProductionChecks.FindProblems(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
    }

    [Fact]
    public void A_complete_configuration_passes()
    {
        Assert.Empty(Problems());
    }

    [Theory]
    [InlineData("ConnectionStrings:CareerVault", null, "ConnectionStrings:CareerVault")]
    [InlineData("Cors:FrontendOrigin", "http://localhost:5173", "Cors:FrontendOrigin")]
    [InlineData("ResumeStorage:Provider", "Local", "ResumeStorage:Provider")]
    [InlineData("ResumeStorage:BlobServiceUri", null, "ResumeStorage:BlobServiceUri")]
    [InlineData("DataProtection:BlobUri", "keys.xml", "DataProtection:BlobUri")]
    public void Reports_each_missing_or_unsafe_setting(string key, string? value, string expectedName)
    {
        var problem = Assert.Single(Problems(settings => settings[key] = value));

        Assert.Contains(expectedName, problem);
    }

    [Fact]
    public void Never_includes_setting_values_in_the_message()
    {
        var error = Assert.Throws<InvalidOperationException>(() =>
            ProductionChecks.ThrowIfInvalid(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:CareerVault"] = "Host=db.example;Password=s3cret-value",
            }).Build()));

        Assert.DoesNotContain("s3cret-value", error.Message);
    }

    private sealed class UnconfiguredProductionFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.UseEnvironment("Production");
    }

    [Fact]
    public void The_app_does_not_start_in_production_without_its_settings()
    {
        using var factory = new UnconfiguredProductionFactory();

        var error = Assert.ThrowsAny<InvalidOperationException>(() => factory.CreateClient());
        // (Blob storage is the first thing it can't set up.)
        Assert.Contains("ResumeStorage:BlobServiceUri", error.Message);
    }
}
