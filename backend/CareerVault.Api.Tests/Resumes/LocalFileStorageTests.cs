using CareerVault.Api.Services.Resumes;

namespace CareerVault.Api.Tests.Resumes;

// Uses a temporary folder that is deleted after each test.
public sealed class LocalFileStorageTests : IDisposable
{
    private const string Owner = "3f1c2b8e-1d2a-4c5b-9e8f-0a1b2c3d4e5f";
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"careervault-tests-{Guid.NewGuid():N}");
    private readonly LocalFileStorage _storage;

    public LocalFileStorageTests()
    {
        _storage = new LocalFileStorage(new LocalFileStorageOptions { RootPath = _root });
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
            Directory.Delete(_root, recursive: true);
    }

    private static MemoryStream Bytes(string text) => new(System.Text.Encoding.UTF8.GetBytes(text));

    private static async Task<string> ReadAllAsync(Stream stream)
    {
        using var reader = new StreamReader(stream);
        return await reader.ReadToEndAsync();
    }

    [Fact]
    public async Task Saves_reads_and_deletes_a_file()
    {
        var key = await _storage.SaveAsync(Owner, Bytes("resume bytes"), default);

        await using (var stream = await _storage.OpenReadAsync(key, default))
        {
            Assert.NotNull(stream);
            Assert.Equal("resume bytes", await ReadAllAsync(stream));
        }

        await _storage.DeleteAsync(key, default);
        Assert.Null(await _storage.OpenReadAsync(key, default));
    }

    [Fact]
    public async Task Keeps_files_in_the_owners_folder_under_a_random_name()
    {
        var first = await _storage.SaveAsync(Owner, Bytes("a"), default);
        var second = await _storage.SaveAsync(Owner, Bytes("b"), default);

        Assert.NotEqual(first, second);
        Assert.StartsWith($"{Owner}/", first);
        Assert.True(File.Exists(Path.Combine(_root, first)));
        // No temporary files are left behind.
        Assert.Empty(Directory.GetFiles(_root, "*.uploading", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Deleting_a_missing_file_is_not_an_error()
    {
        await _storage.DeleteAsync($"{Owner}/{Guid.NewGuid():N}", default);
    }

    [Theory]
    [InlineData("../outside")]
    [InlineData("/etc/passwd")]
    [InlineData("owner/../../etc/passwd")]
    [InlineData("owner/not-a-random-id")]
    [InlineData("owner\\0123456789abcdef0123456789abcdef")]
    [InlineData("")]
    public async Task Refuses_keys_it_did_not_create(string key)
    {
        await Assert.ThrowsAsync<ArgumentException>(() => _storage.OpenReadAsync(key, default));
        await Assert.ThrowsAsync<ArgumentException>(() => _storage.DeleteAsync(key, default));
    }

    [Theory]
    [InlineData("../evil")]
    [InlineData("a/b")]
    [InlineData("")]
    public async Task Refuses_unsafe_owner_ids(string ownerId)
    {
        await Assert.ThrowsAsync<ArgumentException>(() => _storage.SaveAsync(ownerId, Bytes("x"), default));
    }
}
