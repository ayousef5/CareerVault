using Azure.Core;
using Azure.Identity;

namespace CareerVault.Api.Hosting;

// How the API signs in to Azure (Blob Storage). In Azure Container Apps
// this is the app's managed identity, so there are no passwords or keys to
// store. Locally, DefaultAzureCredential also accepts `az login`.
public static class AzureCredentials
{
    // "Azure:ManagedIdentityClientId" is only needed for a user-assigned
    // identity; leave it empty for a system-assigned one.
    public static TokenCredential Create(IConfiguration configuration) =>
        new DefaultAzureCredential(new DefaultAzureCredentialOptions
        {
            ManagedIdentityClientId = NullIfBlank(configuration["Azure:ManagedIdentityClientId"]),
        });

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
