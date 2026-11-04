namespace CareerVault.Api.Services.Resumes;

// Registers the resume library, so Program.cs stays short.
public static class ResumeServiceCollectionExtensions
{
    public static IServiceCollection AddResumes(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        // Optional overrides from appsettings ("Resumes" section).
        services.AddSingleton(configuration.GetSection("Resumes").Get<ResumeOptions>() ?? new ResumeOptions());

        // Files are kept in a private folder (not served by the web server).
        // Default: App_Data/resumes inside the API project. Override with
        // "ResumeStorage:RootPath". Production would swap in cloud storage.
        var rootPath = configuration["ResumeStorage:RootPath"];
        if (string.IsNullOrWhiteSpace(rootPath))
            rootPath = Path.Combine(environment.ContentRootPath, "App_Data", "resumes");

        services.AddSingleton<IFileStorage>(new LocalFileStorage(new LocalFileStorageOptions { RootPath = rootPath }));
        services.AddScoped<ResumeService>();
        return services;
    }
}
