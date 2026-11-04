using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Azure;
using Azure.Core;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using CareerVault.Api.Services.Resumes;

namespace CareerVault.Api.Tests.Resumes;

// AzureBlobFileStorage against an in-memory stand-in for a blob container
// (the Azure SDK's clients are designed to be faked like this), so these
// tests never contact Azure.
public class AzureBlobFileStorageTests
{
    // ---------- Fakes ----------

    private sealed class FakeContainer : BlobContainerClient
    {
        public ConcurrentDictionary<string, byte[]> Blobs { get; } = new();
        public List<BlobUploadOptions> Uploads { get; } = [];
        public int? FailDeletesWithStatus { get; set; }

        public override BlobClient GetBlobClient(string blobName) => new FakeBlob(this, blobName);
    }

    private sealed class FakeBlob(FakeContainer container, string name) : BlobClient
    {
        public override string Name => name;

        public override async Task<Response<BlobContentInfo>> UploadAsync(
            Stream content, BlobUploadOptions options, CancellationToken cancellationToken = default)
        {
            container.Uploads.Add(options);
            if (options.Conditions?.IfNoneMatch == ETag.All && container.Blobs.ContainsKey(name))
                throw new RequestFailedException(409, "BlobAlreadyExists");

            using var buffer = new MemoryStream();
            await content.CopyToAsync(buffer, cancellationToken);
            container.Blobs[name] = buffer.ToArray();
            return Response.FromValue(
                BlobsModelFactory.BlobContentInfo(new ETag("\"1\""), DateTimeOffset.UtcNow, null, null, null, null, 0),
                new FakeResponse(201));
        }

        public override Task<Stream> OpenReadAsync(BlobOpenReadOptions options, CancellationToken cancellationToken = default) =>
            container.Blobs.TryGetValue(name, out var bytes)
                ? Task.FromResult<Stream>(new MemoryStream(bytes))
                : throw new RequestFailedException(404, "BlobNotFound");

        public override Task<Response<bool>> DeleteIfExistsAsync(
            DeleteSnapshotsOption snapshotsOption = default,
            BlobRequestConditions? conditions = default,
            CancellationToken cancellationToken = default)
        {
            if (container.FailDeletesWithStatus is { } status)
                throw new RequestFailedException(status, "Failed");
            var existed = container.Blobs.TryRemove(name, out _);
            return Task.FromResult(Response.FromValue(existed, new FakeResponse(existed ? 202 : 404)));
        }
    }

    private sealed class FakeResponse(int status) : Response
    {
        public override int Status => status;
        public override string ReasonPhrase => "";
        public override Stream? ContentStream { get; set; }
        public override string ClientRequestId { get; set; } = "";
        public override void Dispose() { }
        protected override bool ContainsHeader(string name) => false;
        protected override IEnumerable<HttpHeader> EnumerateHeaders() => [];
        protected override bool TryGetHeader(string name, [NotNullWhen(true)] out string? value) { value = null; return false; }
        protected override bool TryGetHeaderValues(string name, [NotNullWhen(true)] out IEnumerable<string>? values) { values = null; return false; }
    }

    private const string Owner = "161f1cb0-52b3-44f2-9d9b-49a7ccde31ba";

    // ---------- Tests ----------

    [Fact]
    public async Task Saves_opens_and_deletes_a_file()
    {
        var container = new FakeContainer();
        var storage = new AzureBlobFileStorage(container);
        var bytes = ResumeTestFiles.Pdf();

        var key = await storage.SaveAsync(Owner, new MemoryStream(bytes), CancellationToken.None);

        Assert.True(StorageKeys.IsValid(key));
        Assert.StartsWith(Owner + "/", key);
        Assert.Equal(bytes, container.Blobs[key]);

        await using (var stream = await storage.OpenReadAsync(key, CancellationToken.None))
        {
            using var copy = new MemoryStream();
            await stream!.CopyToAsync(copy);
            Assert.Equal(bytes, copy.ToArray());
        }

        await storage.DeleteAsync(key, CancellationToken.None);
        Assert.Empty(container.Blobs);
    }

    [Fact]
    public async Task Never_overwrites_an_existing_blob_and_never_marks_it_as_a_document()
    {
        var container = new FakeContainer();
        await new AzureBlobFileStorage(container).SaveAsync(Owner, new MemoryStream([1, 2, 3]), CancellationToken.None);

        var upload = Assert.Single(container.Uploads);
        Assert.Equal(ETag.All, upload.Conditions?.IfNoneMatch);
        // Served only by the API (with its own safe headers), never as-is.
        Assert.Equal("application/octet-stream", upload.HttpHeaders?.ContentType);
    }

    [Fact]
    public async Task A_missing_blob_opens_as_null()
    {
        var storage = new AzureBlobFileStorage(new FakeContainer());

        Assert.Null(await storage.OpenReadAsync($"{Owner}/{Guid.NewGuid():N}", CancellationToken.None));
    }

    [Fact]
    public async Task Deleting_a_missing_blob_is_fine_and_failures_are_reported_as_storage_errors()
    {
        var container = new FakeContainer();
        var storage = new AzureBlobFileStorage(container);
        var key = $"{Owner}/{Guid.NewGuid():N}";

        await storage.DeleteAsync(key, CancellationToken.None);

        container.FailDeletesWithStatus = 403;
        await Assert.ThrowsAsync<IOException>(() => storage.DeleteAsync(key, CancellationToken.None));
    }

    [Theory]
    [InlineData("../../etc/passwd")]
    [InlineData("other-user/../" + Owner + "/0123456789abcdef0123456789abcdef")]
    [InlineData(Owner + "/0123456789abcdef0123456789abcdef\n")]
    [InlineData(Owner + "/NOT-HEX")]
    [InlineData("")]
    public async Task Refuses_keys_that_are_not_in_the_storage_format(string key)
    {
        var storage = new AzureBlobFileStorage(new FakeContainer());

        await Assert.ThrowsAsync<ArgumentException>(() => storage.OpenReadAsync(key, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => storage.DeleteAsync(key, CancellationToken.None));
    }

    [Theory]
    [InlineData("../evil")]
    [InlineData("user/../../x")]
    [InlineData("user\n")]
    public async Task Refuses_unsafe_owner_ids(string ownerId)
    {
        var container = new FakeContainer();

        await Assert.ThrowsAsync<ArgumentException>(() =>
            new AzureBlobFileStorage(container).SaveAsync(ownerId, new MemoryStream([1]), CancellationToken.None));
        Assert.Empty(container.Blobs);
    }
}
