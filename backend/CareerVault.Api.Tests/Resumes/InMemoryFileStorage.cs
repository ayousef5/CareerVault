using System.Collections.Concurrent;
using CareerVault.Api.Services.Resumes;

namespace CareerVault.Api.Tests.Resumes;

// Keeps "stored" files in memory, so API tests don't touch the disk.
public sealed class InMemoryFileStorage : IFileStorage
{
    public ConcurrentDictionary<string, byte[]> Files { get; } = new();

    public async Task<string> SaveAsync(string ownerId, Stream content, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        await content.CopyToAsync(buffer, cancellationToken);
        var key = $"{ownerId}/{Guid.NewGuid():N}";
        Files[key] = buffer.ToArray();
        return key;
    }

    public Task<Stream?> OpenReadAsync(string key, CancellationToken cancellationToken) =>
        Task.FromResult<Stream?>(Files.TryGetValue(key, out var bytes) ? new MemoryStream(bytes) : null);

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        Files.TryRemove(key, out _);
        return Task.CompletedTask;
    }
}
