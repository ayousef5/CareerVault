using CareerVault.Api.Models;
using CareerVault.Api.Services.Resumes;
using static CareerVault.Api.Tests.Resumes.ResumeTestApi;

namespace CareerVault.Api.Tests.Resumes;

// The Resume Library (GET /api/resumes/uploads): one entry per unique file,
// with every company and role using it. Each test uses its own new user(s).
public class ResumeLibraryTests : IClassFixture<CareerVaultApiFactory>
{
    private readonly CareerVaultApiFactory _factory;
    private readonly ResumeTestApi _api;

    public ResumeLibraryTests(CareerVaultApiFactory factory)
    {
        _factory = factory;
        _api = new ResumeTestApi(factory);
    }

    // A resume from the earlier Resume Library (made before resumes were
    // uploaded to applications): a named resume with one stored version.
    private async Task<ResumeVersion> AddOlderLibraryResumeAsync(string userId, byte[] file, string fileName, bool deleted = false)
    {
        var key = await _factory.FileStorage.SaveAsync(userId, new MemoryStream(file), CancellationToken.None);
        return await _api.WithDbAsync(async db =>
        {
            var resume = new Resume
            {
                UserId = userId,
                Name = "Old resume",
                CreatedAt = DateTimeOffset.UtcNow.AddDays(-30),
                DeletedAt = deleted ? DateTimeOffset.UtcNow : null,
            };
            var version = new ResumeVersion
            {
                Resume = resume,
                UserId = userId,
                VersionNumber = 1,
                OriginalFileName = fileName,
                ContentType = ResumeContentTypes.Pdf,
                SizeBytes = file.Length,
                UploadedAt = DateTimeOffset.UtcNow.AddDays(-30),
                StoredFile = new StoredFile
                {
                    UserId = userId,
                    Sha256 = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(file)),
                    ContentType = ResumeContentTypes.Pdf,
                    SizeBytes = file.Length,
                    StorageKey = key,
                    CreatedAt = DateTimeOffset.UtcNow.AddDays(-30),
                },
            };
            db.ResumeVersions.Add(version);
            await db.SaveChangesAsync();
            return version;
        });
    }

    [Fact]
    public async Task Is_empty_for_a_new_user()
    {
        var (client, _) = await _api.CreateUserAsync();

        Assert.Empty(await LibraryAsync(client));
    }

    [Fact]
    public async Task Shows_one_entry_per_unique_file_with_every_company_and_role()
    {
        var (client, _) = await _api.CreateUserAsync();
        var google = await CreateJobAsync(client, "Google", "SWE Intern");
        var microsoft = await CreateJobAsync(client, "Microsoft", "AI Intern");
        var shure = await CreateJobAsync(client, "Shure", "Data Intern");
        var shared = ResumeTestFiles.Pdf("shared");
        await AttachAsync(client, google.Id, shared, "cv.pdf");
        await AttachAsync(client, microsoft.Id, shared, "cv.pdf");
        await AttachAsync(client, shure.Id, ResumeTestFiles.Pdf("data version"), "data-cv.pdf");

        var library = await LibraryAsync(client);

        Assert.Equal(2, library.Count);
        // Newest first: the Shure upload, then the shared file.
        Assert.Equal("data-cv.pdf", library[0].OriginalFileName);
        Assert.Equal(["Shure"], library[0].Applications.Select(a => a.CompanyName));

        var sharedEntry = library[1];
        Assert.Equal("cv.pdf", sharedEntry.OriginalFileName);
        Assert.Equal(ResumeContentTypes.Pdf, sharedEntry.ContentType);
        Assert.Equal(shared.Length, sharedEntry.SizeBytes);
        Assert.Equal(
            [(google.Id, "Google", "SWE Intern"), (microsoft.Id, "Microsoft", "AI Intern")],
            sharedEntry.Applications.Select(a => (a.JobId, a.CompanyName, a.JobTitle)));
        // Its file opens through the authenticated file endpoint.
        Assert.Equal(shared, await client.GetByteArrayAsync($"/api/resume-versions/{sharedEntry.VersionId}/file"));
    }

    [Fact]
    public async Task Shows_the_newest_upload_name_for_a_shared_file()
    {
        var (client, _) = await _api.CreateUserAsync();
        var google = await CreateJobAsync(client, "Google");
        var microsoft = await CreateJobAsync(client, "Microsoft");
        var pdf = ResumeTestFiles.Pdf();
        await AttachAsync(client, google.Id, pdf, "first-name.pdf");
        var second = await AttachAsync(client, microsoft.Id, pdf, "second-name.pdf");

        var entry = Assert.Single(await LibraryAsync(client));

        Assert.Equal("second-name.pdf", entry.OriginalFileName);
        Assert.Equal(second.ResumeVersionId, entry.VersionId);
        Assert.Equal(2, entry.Applications.Count);
    }

    [Fact]
    public async Task Replaced_and_removed_uploads_disappear()
    {
        var (client, _) = await _api.CreateUserAsync();
        var google = await CreateJobAsync(client, "Google");
        var microsoft = await CreateJobAsync(client, "Microsoft");
        await AttachAsync(client, google.Id, ResumeTestFiles.Pdf("old"), "old.pdf");
        await AttachAsync(client, microsoft.Id, ResumeTestFiles.Pdf("removed"), "removed.pdf");

        await AttachAsync(client, google.Id, ResumeTestFiles.Pdf("new"), "new.pdf");
        await RemoveAsync(client, microsoft.Id);

        var entry = Assert.Single(await LibraryAsync(client));
        Assert.Equal("new.pdf", entry.OriginalFileName);
        Assert.Equal(["Google"], entry.Applications.Select(a => a.CompanyName));
    }

    [Fact]
    public async Task A_shared_file_stays_while_another_application_uses_it()
    {
        var (client, _) = await _api.CreateUserAsync();
        var google = await CreateJobAsync(client, "Google");
        var microsoft = await CreateJobAsync(client, "Microsoft");
        var shared = ResumeTestFiles.Pdf("shared");
        await AttachAsync(client, google.Id, shared);
        await AttachAsync(client, microsoft.Id, shared);

        await RemoveAsync(client, google.Id);

        var entry = Assert.Single(await LibraryAsync(client));
        Assert.Equal(["Microsoft"], entry.Applications.Select(a => a.CompanyName));
    }

    [Fact]
    public async Task Older_library_resumes_that_are_not_attached_stay_visible()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var older = await AddOlderLibraryResumeAsync(userId, ResumeTestFiles.Pdf("from the old library"), "old-cv.pdf");

        var entry = Assert.Single(await LibraryAsync(client));

        Assert.Equal(older.Id, entry.VersionId);
        Assert.Equal("old-cv.pdf", entry.OriginalFileName);
        Assert.Empty(entry.Applications);
        Assert.Equal(ResumeTestFiles.Pdf("from the old library"),
            await client.GetByteArrayAsync($"/api/resume-versions/{entry.VersionId}/file"));
    }

    [Fact]
    public async Task Uploading_an_older_library_file_to_an_application_reuses_it_and_lists_it_once()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var file = ResumeTestFiles.Pdf("from the old library");
        await AddOlderLibraryResumeAsync(userId, file, "old-cv.pdf");
        var job = await CreateJobAsync(client, "Google", "SWE Intern");

        await AttachAsync(client, job.Id, file, "cv.pdf");

        // Still one stored copy, and one Library entry now showing the application.
        Assert.Single(_api.FilesOf(userId));
        var entry = Assert.Single(await LibraryAsync(client));
        Assert.Equal(["Google"], entry.Applications.Select(a => a.CompanyName));

        // Removing it from the application leaves the older library file.
        await RemoveAsync(client, job.Id);
        var after = Assert.Single(await LibraryAsync(client));
        Assert.Empty(after.Applications);
        Assert.Single(_api.FilesOf(userId));
    }

    [Fact]
    public async Task A_deleted_older_resume_is_not_listed()
    {
        var (client, userId) = await _api.CreateUserAsync();
        await AddOlderLibraryResumeAsync(userId, ResumeTestFiles.Pdf("deleted"), "deleted.pdf", deleted: true);

        Assert.Empty(await LibraryAsync(client));
    }

    [Fact]
    public async Task Only_shows_my_own_files()
    {
        var (alice, _) = await _api.CreateUserAsync();
        var (bob, _) = await _api.CreateUserAsync();
        await AttachAsync(alice, (await CreateJobAsync(alice, "Google")).Id, ResumeTestFiles.Pdf("alice"));

        Assert.Empty(await LibraryAsync(bob));
        Assert.Single(await LibraryAsync(alice));
    }
}
