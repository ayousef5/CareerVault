namespace CareerVault.Api.Services.Resumes;

// Where uploaded files are kept. The rest of the app only knows "save a
// file, get a key back"; where the bytes live (a local folder in
// development, Azure Blob Storage in production) is up to the implementation.
// Keys always have the StorageKeys format.
public interface IFileStorage
{
    // Stores the content as a new file for this owner and returns its key.
    // Keys are generated here: never derived from the user's file name.
    Task<string> SaveAsync(string ownerId, Stream content, CancellationToken cancellationToken);

    // Opens a stored file for reading, or returns null if it doesn't exist.
    Task<Stream?> OpenReadAsync(string key, CancellationToken cancellationToken);

    // Deletes a stored file. Deleting a file that's already gone is fine.
    Task DeleteAsync(string key, CancellationToken cancellationToken);
}

// Settings for local file storage ("ResumeStorage" in appsettings).
public sealed class LocalFileStorageOptions
{
    // The folder files are kept in. It must NOT be a folder the web server
    // serves; files are only ever handed out by the API after an owner check.
    public string RootPath { get; init; } = string.Empty;
}

// Keeps files on the local disk, at {RootPath}/{ownerId}/{random id}.
// Meant for development; production uses AzureBlobFileStorage.
public sealed class LocalFileStorage(LocalFileStorageOptions options) : IFileStorage
{
    private readonly string _root = Path.GetFullPath(options.RootPath);

    public async Task<string> SaveAsync(string ownerId, Stream content, CancellationToken cancellationToken)
    {
        var key = StorageKeys.New(ownerId);
        var path = PathFor(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        // Write to a temporary file first and rename it at the end, so a
        // half-written file never appears under the real key.
        var temporaryPath = path + ".uploading";
        try
        {
            await using (var file = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write))
            {
                await content.CopyToAsync(file, cancellationToken);
            }
            File.Move(temporaryPath, path);
        }
        catch
        {
            File.Delete(temporaryPath);
            throw;
        }

        return key;
    }

    public Task<Stream?> OpenReadAsync(string key, CancellationToken cancellationToken)
    {
        var path = PathFor(key);
        Stream? stream = File.Exists(path)
            ? new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true)
            : null;
        return Task.FromResult(stream);
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        // File.Delete throws if the owner's folder doesn't exist, so check first.
        var path = PathFor(key);
        if (File.Exists(path))
            File.Delete(path);
        return Task.CompletedTask;
    }

    // Turns a key into a path inside the root folder. Only keys in the exact
    // format this class creates are accepted, so a key can never point
    // outside the folder ("../", absolute paths, etc.).
    private string PathFor(string key)
    {
        var (owner, file) = StorageKeys.Parse(key);

        var path = Path.GetFullPath(Path.Combine(_root, owner, file));
        if (!path.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new ArgumentException("Invalid storage key.", nameof(key));

        return path;
    }
}
