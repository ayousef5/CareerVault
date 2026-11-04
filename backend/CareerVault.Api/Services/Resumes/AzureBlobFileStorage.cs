using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace CareerVault.Api.Services.Resumes;

// Keeps files in a PRIVATE Azure Blob Storage container, one blob per key
// ("{ownerId}/{random id}"). The app signs in with its managed identity
// (Azure RBAC), so no storage keys or connection strings are needed, and
// files are only ever handed out by the API after an ownership check; the
// container must never allow public access.
public sealed class AzureBlobFileStorage(BlobContainerClient container) : IFileStorage
{
    public async Task<string> SaveAsync(string ownerId, Stream content, CancellationToken cancellationToken)
    {
        var key = StorageKeys.New(ownerId);

        // Streamed to Azure in blocks (never held in memory as a whole).
        // IfNoneMatch "*": never overwrite an existing blob.
        await container.GetBlobClient(key).UploadAsync(content, new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = "application/octet-stream" },
            Conditions = new BlobRequestConditions { IfNoneMatch = ETag.All },
        }, cancellationToken);

        return key;
    }

    public async Task<Stream?> OpenReadAsync(string key, CancellationToken cancellationToken)
    {
        var blob = container.GetBlobClient(CheckKey(key));
        try
        {
            return await blob.OpenReadAsync(new BlobOpenReadOptions(allowModifications: false), cancellationToken);
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            return null;
        }
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            // Deleting a blob that's already gone is fine.
            await container.GetBlobClient(CheckKey(key))
                .DeleteIfExistsAsync(DeleteSnapshotsOption.IncludeSnapshots, cancellationToken: cancellationToken);
        }
        catch (RequestFailedException ex)
        {
            // Reported like a local disk error, so callers treat it the same
            // way (an unused file left behind, logged).
            throw new IOException($"Couldn't delete stored file {key} (status {ex.Status}).", ex);
        }
    }

    private static string CheckKey(string key) =>
        StorageKeys.IsValid(key) ? key : throw new ArgumentException("Invalid storage key.", nameof(key));
}
