namespace CareerVault.Api.Hosting;

// Settings production can't run safely without. Checked at startup in the
// Production environment, so a missing setting stops the app with a clear
// message instead of, say, losing uploaded resumes on the next restart.
// Only setting NAMES appear in the messages, never their values.
public static class ProductionChecks
{
    public static List<string> FindProblems(IConfiguration configuration)
    {
        var problems = new List<string>();

        if (string.IsNullOrWhiteSpace(configuration.GetConnectionString("CareerVault")))
            problems.Add("ConnectionStrings:CareerVault is not set.");

        if (!IsHttpsUrl(configuration["Cors:FrontendOrigin"]))
            problems.Add("Cors:FrontendOrigin must be the frontend's https:// address.");

        // A container's disk is wiped on restart: resumes must go to Blob Storage.
        if (!string.Equals(configuration["ResumeStorage:Provider"], "AzureBlob", StringComparison.OrdinalIgnoreCase))
            problems.Add("ResumeStorage:Provider must be AzureBlob.");
        if (!IsHttpsUrl(configuration["ResumeStorage:BlobServiceUri"]))
            problems.Add("ResumeStorage:BlobServiceUri must be the storage account's https:// blob address.");

        // Without shared keys, every login would end when the container restarts.
        if (!IsHttpsUrl(configuration["DataProtection:BlobUri"]))
            problems.Add("DataProtection:BlobUri must be the https:// address of the key blob (e.g. .../dataprotection/keys.xml).");

        return problems;
    }

    public static void ThrowIfInvalid(IConfiguration configuration)
    {
        var problems = FindProblems(configuration);
        if (problems.Count > 0)
            throw new InvalidOperationException("CareerVault is not configured for production: " + string.Join(" ", problems));
    }

    private static bool IsHttpsUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps;
}
