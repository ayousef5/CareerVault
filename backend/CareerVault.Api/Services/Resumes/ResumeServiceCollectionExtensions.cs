using Azure.Storage.Blobs;
using CareerVault.Api.Hosting;

namespace CareerVault.Api.Services.Resumes;

// Registers resume storage and the resume service, so Program.cs stays short.
public static class ResumeServiceCollectionExtensions
{
    public static IServiceCollection AddResumes(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        // Optional overrides from appsettings ("Resumes" section).
        services.AddSingleton(configuration.GetSection("Resumes").Get<ResumeOptions>() ?? new ResumeOptions());

        // Where files are kept ("ResumeStorage:Provider"):
        //  - "Local" (default, for development): a private folder on disk.
        //  - "AzureBlob" (production): a private Blob Storage container,
        //    reached with the app's managed identity.
        var storage = configuration.GetSection("ResumeStorage");
        var provider = storage["Provider"];

        if (string.Equals(provider, "AzureBlob", StringComparison.OrdinalIgnoreCase))
        {
            if (!Uri.TryCreate(storage["BlobServiceUri"], UriKind.Absolute, out var serviceUri))
                throw new InvalidOperationException("ResumeStorage:BlobServiceUri must be set to use Azure Blob Storage.");

            var containerName = string.IsNullOrWhiteSpace(storage["ContainerName"]) ? "resumes" : storage["ContainerName"]!;
            var container = new BlobServiceClient(serviceUri, AzureCredentials.Create(configuration))
                .GetBlobContainerClient(containerName);
            services.AddSingleton<IFileStorage>(new AzureBlobFileStorage(container));
        }
        else if (string.IsNullOrWhiteSpace(provider) || string.Equals(provider, "Local", StringComparison.OrdinalIgnoreCase))
        {
            // A folder the web server doesn't serve. Default: App_Data/resumes
            // inside the API project. Override with "ResumeStorage:RootPath".
            var rootPath = storage["RootPath"];
            if (string.IsNullOrWhiteSpace(rootPath))
                rootPath = Path.Combine(environment.ContentRootPath, "App_Data", "resumes");

            services.AddSingleton<IFileStorage>(new LocalFileStorage(new LocalFileStorageOptions { RootPath = rootPath }));
        }
        else
        {
            throw new InvalidOperationException($"Unknown ResumeStorage:Provider \"{provider}\" (use Local or AzureBlob).");
        }

        services.AddScoped<ResumeService>();
        return services;
    }
}
