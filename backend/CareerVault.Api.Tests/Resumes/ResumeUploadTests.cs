using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using CareerVault.Api.DTOs;
using CareerVault.Api.Services.Resumes;
using static CareerVault.Api.Tests.Resumes.ResumeTestApi;

namespace CareerVault.Api.Tests.Resumes;

// Uploading a resume straight to an application (PUT/DELETE
// /api/jobs/{id}/resume), and how identical files share one stored copy.
// Each test uses its own new user(s); files are kept in memory.
public class ResumeUploadTests : IClassFixture<CareerVaultApiFactory>
{
    private readonly CareerVaultApiFactory _factory;
    private readonly ResumeTestApi _api;

    public ResumeUploadTests(CareerVaultApiFactory factory)
    {
        _factory = factory;
        _api = new ResumeTestApi(factory);
    }

    // ---------- Uploading and attaching ----------

    [Fact]
    public async Task Uploads_a_PDF_to_an_application_and_attaches_it()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Google", "SWE Intern");
        var pdf = ResumeTestFiles.Pdf();

        var updated = await AttachAsync(client, job.Id, pdf, "Jane CV.pdf");

        var resume = Assert.IsType<AttachedResumeResponse>(updated.Resume);
        Assert.Equal(updated.ResumeVersionId, resume.VersionId);
        Assert.Equal("Jane CV.pdf", resume.OriginalFileName);
        Assert.Equal(ResumeContentTypes.Pdf, resume.ContentType);
        Assert.Equal(pdf.Length, resume.SizeBytes);
        // The other fields are unchanged.
        Assert.Equal("Google", updated.CompanyName);
        Assert.Equal("SWE Intern", updated.JobTitle);
        // The exact bytes are stored once, under their SHA-256.
        Assert.Equal(pdf, await client.GetByteArrayAsync($"/api/resume-versions/{resume.VersionId}/file"));
        var stored = Assert.Single(await _api.StoredFilesOfAsync(userId));
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(pdf)), stored.Sha256);
        Assert.Single(_api.FilesOf(userId));
        // And the job keeps it.
        Assert.Equal(resume.VersionId, (await GetJobAsync(client, job.Id)).Resume?.VersionId);
    }

    [Fact]
    public async Task Uploads_a_Word_document_and_trusts_the_file_not_the_browser()
    {
        var (client, _) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Initech");

        // The browser claims it's an image; it's really a Word document.
        var response = await UploadAsync(client, job.Id, ResumeTestFiles.Docx(), "cv.docx", contentType: "image/png");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<JobResponse>();
        Assert.Equal(ResumeContentTypes.Docx, updated!.Resume?.ContentType);
    }

    [Fact]
    public async Task Cleans_up_the_uploaded_file_name()
    {
        var (client, _) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Initech");

        var updated = await AttachAsync(client, job.Id, ResumeTestFiles.Pdf(), @"C:\Users\jane\..\secret\cv.pdf");

        Assert.Equal("cv.pdf", updated.Resume?.OriginalFileName);
    }

    // ---------- Refused uploads ----------

    [Theory]
    [InlineData("text", "cv.pdf")]
    [InlineData("docm", "cv.docx")]
    [InlineData("pdf", "cv.exe")]
    public async Task Refuses_files_that_are_not_PDF_or_DOCX_and_stores_nothing(string kind, string fileName)
    {
        var (client, userId) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Initech");
        byte[] file = kind switch
        {
            "docm" => ResumeTestFiles.Docm(),
            "pdf" => ResumeTestFiles.Pdf(),
            _ => "hello"u8.ToArray(),
        };

        var response = await UploadAsync(client, job.Id, file, fileName);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(ResumeFileValidator.WrongTypeMessage, await ErrorAsync(response));
        Assert.Null((await GetJobAsync(client, job.Id)).Resume);
        Assert.Empty(_api.FilesOf(userId));
        Assert.Empty(await _api.StoredFilesOfAsync(userId));
    }

    [Fact]
    public async Task Refuses_an_empty_file_and_a_missing_file()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Initech");

        var empty = await UploadAsync(client, job.Id, [], "cv.pdf");
        var missing = await client.PutAsync($"/api/jobs/{job.Id}/resume",
            new MultipartFormDataContent { { new StringContent("x"), "name" } });

        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Equal("The file is empty.", await ErrorAsync(empty));
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Empty(_api.FilesOf(userId));
    }

    [Fact]
    public async Task Refuses_a_file_over_10_MB()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Initech");
        var tooBig = ResumeTestFiles.Pdf(new string('x', 10 * 1024 * 1024));

        var response = await UploadAsync(client, job.Id, tooBig, "cv.pdf");

        // Either our own check (400) or the server's request limit (413).
        Assert.True(
            response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.RequestEntityTooLarge,
            $"Got {response.StatusCode}");
        Assert.Null((await GetJobAsync(client, job.Id)).Resume);
        Assert.Empty(_api.FilesOf(userId));
    }

    [Fact]
    public async Task A_refused_replacement_keeps_the_attached_resume()
    {
        var (client, _) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Initech");
        var attached = await AttachAsync(client, job.Id, ResumeTestFiles.Pdf());

        var response = await UploadAsync(client, job.Id, "not a resume"u8.ToArray(), "cv.pdf");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(attached.ResumeVersionId, (await GetJobAsync(client, job.Id)).ResumeVersionId);
    }

    // ---------- Ownership and login ----------

    [Fact]
    public async Task Another_users_application_is_not_found_and_nothing_is_stored()
    {
        var (owner, ownerId) = await _api.CreateUserAsync();
        var (stranger, strangerId) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(owner, "Google");
        var attached = await AttachAsync(owner, job.Id, ResumeTestFiles.Pdf());

        var upload = await UploadAsync(stranger, job.Id, ResumeTestFiles.Pdf("theirs"));
        var remove = await stranger.DeleteAsync($"/api/jobs/{job.Id}/resume");
        var download = await stranger.GetAsync($"/api/resume-versions/{attached.ResumeVersionId}/file");

        Assert.Equal(HttpStatusCode.NotFound, upload.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, remove.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, download.StatusCode);
        Assert.Empty(_api.FilesOf(strangerId));
        // The owner's attachment is untouched.
        Assert.Equal(attached.ResumeVersionId, (await GetJobAsync(owner, job.Id)).ResumeVersionId);
        Assert.Single(_api.FilesOf(ownerId));
    }

    [Fact]
    public async Task A_missing_application_is_not_found()
    {
        var (client, _) = await _api.CreateUserAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await UploadAsync(client, 999_999, ResumeTestFiles.Pdf())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync("/api/jobs/999999/resume")).StatusCode);
    }

    [Theory]
    [InlineData("PUT", "/api/jobs/1/resume")]
    [InlineData("DELETE", "/api/jobs/1/resume")]
    [InlineData("GET", "/api/resumes/uploads")]
    [InlineData("GET", "/api/resume-versions/1/file")]
    public async Task Every_resume_endpoint_requires_login(string method, string url)
    {
        var anonymous = _factory.CreateClient();
        var request = new HttpRequestMessage(new HttpMethod(method), url);
        if (method == "PUT")
            request.Content = Form(ResumeTestFiles.Pdf(), "cv.pdf");

        var response = await anonymous.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("GET", "/api/resumes")]
    [InlineData("POST", "/api/resumes")]
    [InlineData("POST", "/api/resumes/1/versions")]
    [InlineData("PUT", "/api/resumes/1")]
    [InlineData("DELETE", "/api/resumes/1")]
    public async Task The_old_library_management_endpoints_are_gone(string method, string url)
    {
        var (client, _) = await _api.CreateUserAsync();
        var request = new HttpRequestMessage(new HttpMethod(method), url);
        if (method is "POST" or "PUT")
            request.Content = Form(ResumeTestFiles.Pdf(), "cv.pdf");

        var response = await client.SendAsync(request);

        Assert.True(
            response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed,
            $"Got {response.StatusCode}");
    }

    // ---------- Identical files share one stored copy ----------

    [Fact]
    public async Task The_same_file_on_two_applications_is_stored_once_but_attached_separately()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var google = await CreateJobAsync(client, "Google");
        var microsoft = await CreateJobAsync(client, "Microsoft");
        var pdf = ResumeTestFiles.Pdf();

        var first = await AttachAsync(client, google.Id, pdf, "cv.pdf");
        var second = await AttachAsync(client, microsoft.Id, pdf, "cv-copy.pdf");

        // Each application has its own upload record (with its own name)...
        Assert.NotEqual(first.ResumeVersionId, second.ResumeVersionId);
        Assert.Equal("cv-copy.pdf", second.Resume?.OriginalFileName);
        Assert.Equal(2, await _api.VersionCountAsync(userId));
        // ...but there's only one physical file.
        Assert.Single(await _api.StoredFilesOfAsync(userId));
        Assert.Single(_api.FilesOf(userId));
        Assert.Equal(pdf, await client.GetByteArrayAsync($"/api/resume-versions/{second.ResumeVersionId}/file"));
    }

    [Fact]
    public async Task Different_contents_are_stored_as_separate_files()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var google = await CreateJobAsync(client, "Google");
        var microsoft = await CreateJobAsync(client, "Microsoft");

        await AttachAsync(client, google.Id, ResumeTestFiles.Pdf("version A"));
        await AttachAsync(client, microsoft.Id, ResumeTestFiles.Pdf("version B"));

        Assert.Equal(2, (await _api.StoredFilesOfAsync(userId)).Count);
        Assert.Equal(2, _api.FilesOf(userId).Count);
    }

    [Fact]
    public async Task Identical_files_from_different_users_are_never_shared()
    {
        var (alice, aliceId) = await _api.CreateUserAsync();
        var (bob, bobId) = await _api.CreateUserAsync();
        var pdf = ResumeTestFiles.Pdf("same bytes");

        var alices = await AttachAsync(alice, (await CreateJobAsync(alice, "Google")).Id, pdf);
        var bobs = await AttachAsync(bob, (await CreateJobAsync(bob, "Google")).Id, pdf);

        // Each user has their own stored copy.
        Assert.Single(_api.FilesOf(aliceId));
        Assert.Single(_api.FilesOf(bobId));
        Assert.NotEqual(
            Assert.Single(await _api.StoredFilesOfAsync(aliceId)).Id,
            Assert.Single(await _api.StoredFilesOfAsync(bobId)).Id);
        // And neither can open the other's upload.
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/resume-versions/{alices.ResumeVersionId}/file")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/api/resume-versions/{bobs.ResumeVersionId}/file")).StatusCode);
    }

    [Fact]
    public async Task Simultaneous_identical_uploads_store_one_file()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var jobs = new List<JobResponse>();
        for (var i = 0; i < 5; i++)
            jobs.Add(await CreateJobAsync(client, $"Company {i}"));
        var pdf = ResumeTestFiles.Pdf("uploaded five times at once");

        var responses = await Task.WhenAll(jobs.Select(job => UploadAsync(client, job.Id, pdf)));

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        Assert.Single(await _api.StoredFilesOfAsync(userId));
        Assert.Single(_api.FilesOf(userId));
        // Every application got its own attachment.
        Assert.Equal(5, await _api.VersionCountAsync(userId));
        foreach (var job in jobs)
            Assert.NotNull((await GetJobAsync(client, job.Id)).Resume);
    }

    [Fact]
    public async Task A_missing_physical_file_is_restored_when_the_same_file_is_uploaded_again()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var google = await CreateJobAsync(client, "Google");
        var microsoft = await CreateJobAsync(client, "Microsoft");
        var pdf = ResumeTestFiles.Pdf();
        var first = await AttachAsync(client, google.Id, pdf);
        // The stored bytes disappear (e.g. deleted from storage by hand).
        _factory.FileStorage.Files.TryRemove(Assert.Single(_api.FilesOf(userId)), out _);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/resume-versions/{first.ResumeVersionId}/file")).StatusCode);

        var second = await AttachAsync(client, microsoft.Id, pdf);

        // Stored again, and both applications can open it.
        Assert.Single(_api.FilesOf(userId));
        Assert.Single(await _api.StoredFilesOfAsync(userId));
        Assert.Equal(pdf, await client.GetByteArrayAsync($"/api/resume-versions/{first.ResumeVersionId}/file"));
        Assert.Equal(pdf, await client.GetByteArrayAsync($"/api/resume-versions/{second.ResumeVersionId}/file"));
    }

    // ---------- Replacing and removing ----------

    [Fact]
    public async Task Replacing_one_applications_resume_does_not_affect_another()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var google = await CreateJobAsync(client, "Google");
        var microsoft = await CreateJobAsync(client, "Microsoft");
        var shared = ResumeTestFiles.Pdf("shared");
        await AttachAsync(client, google.Id, shared);
        var microsofts = await AttachAsync(client, microsoft.Id, shared);

        var replaced = await AttachAsync(client, google.Id, ResumeTestFiles.Pdf("new for Google"));

        Assert.NotEqual(microsofts.ResumeVersionId, replaced.ResumeVersionId);
        // Microsoft keeps exactly its upload, and the shared file is kept for it.
        Assert.Equal(microsofts.ResumeVersionId, (await GetJobAsync(client, microsoft.Id)).ResumeVersionId);
        Assert.Equal(shared, await client.GetByteArrayAsync($"/api/resume-versions/{microsofts.ResumeVersionId}/file"));
        Assert.Equal(2, _api.FilesOf(userId).Count);
        // Google's old upload record is gone.
        Assert.Equal(2, await _api.VersionCountAsync(userId));
    }

    [Fact]
    public async Task Removing_one_applications_resume_does_not_affect_another()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var google = await CreateJobAsync(client, "Google");
        var microsoft = await CreateJobAsync(client, "Microsoft");
        var shared = ResumeTestFiles.Pdf("shared");
        var googles = await AttachAsync(client, google.Id, shared);
        var microsofts = await AttachAsync(client, microsoft.Id, shared);

        var removed = await RemoveAsync(client, google.Id);

        Assert.Null(removed.Resume);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/resume-versions/{googles.ResumeVersionId}/file")).StatusCode);
        Assert.Equal(shared, await client.GetByteArrayAsync($"/api/resume-versions/{microsofts.ResumeVersionId}/file"));
        Assert.Single(_api.FilesOf(userId));
    }

    [Fact]
    public async Task The_physical_file_is_deleted_only_when_no_application_uses_it()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var google = await CreateJobAsync(client, "Google");
        var microsoft = await CreateJobAsync(client, "Microsoft");
        var shared = ResumeTestFiles.Pdf("shared");
        await AttachAsync(client, google.Id, shared);
        await AttachAsync(client, microsoft.Id, shared);

        // One application stops using it: kept.
        await RemoveAsync(client, google.Id);
        Assert.Single(_api.FilesOf(userId));

        // The last one is deleted: the upload, the stored file and its bytes go.
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/jobs/{microsoft.Id}")).StatusCode);
        Assert.Empty(_api.FilesOf(userId));
        Assert.Empty(await _api.StoredFilesOfAsync(userId));
        Assert.Equal(0, await _api.VersionCountAsync(userId));
    }

    [Fact]
    public async Task Replacing_with_a_different_file_deletes_the_old_file_if_nothing_else_uses_it()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Google");
        await AttachAsync(client, job.Id, ResumeTestFiles.Pdf("old"));

        var replaced = await AttachAsync(client, job.Id, ResumeTestFiles.Pdf("new"));

        var stored = Assert.Single(await _api.StoredFilesOfAsync(userId));
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(ResumeTestFiles.Pdf("new"))), stored.Sha256);
        Assert.Single(_api.FilesOf(userId));
        Assert.Equal(1, await _api.VersionCountAsync(userId));
        Assert.Equal(ResumeTestFiles.Pdf("new"), await client.GetByteArrayAsync($"/api/resume-versions/{replaced.ResumeVersionId}/file"));
    }

    [Fact]
    public async Task Replacing_with_the_same_file_keeps_the_stored_file()
    {
        var (client, userId) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Google");
        var pdf = ResumeTestFiles.Pdf();
        var first = await AttachAsync(client, job.Id, pdf, "cv.pdf");

        var again = await AttachAsync(client, job.Id, pdf, "cv-renamed.pdf");

        Assert.NotEqual(first.ResumeVersionId, again.ResumeVersionId);
        Assert.Equal("cv-renamed.pdf", again.Resume?.OriginalFileName);
        Assert.Single(_api.FilesOf(userId));
        Assert.Equal(pdf, await client.GetByteArrayAsync($"/api/resume-versions/{again.ResumeVersionId}/file"));
    }

    [Fact]
    public async Task Removing_when_nothing_is_attached_is_fine()
    {
        var (client, _) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Google");

        var removed = await RemoveAsync(client, job.Id);

        Assert.Null(removed.Resume);
    }

    // ---------- Normal job saves never change the attachment ----------

    [Fact]
    public async Task Saving_a_jobs_other_fields_never_changes_its_resume()
    {
        var (client, _) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Google");
        var attached = await AttachAsync(client, job.Id, ResumeTestFiles.Pdf());

        // Like an old autosave: the whole row, with a different (or no) resume id.
        var response = await client.PutAsJsonAsync($"/api/jobs/{job.Id}", new
        {
            companyName = "Google",
            jobTitle = "Engineer",
            status = "Applied",
            notes = "Phone screen booked",
            resumeVersionId = (int?)null,
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var stored = await GetJobAsync(client, job.Id);
        Assert.Equal("Phone screen booked", stored.Notes);
        Assert.Equal(attached.ResumeVersionId, stored.ResumeVersionId);
        Assert.NotNull(stored.Resume);
    }

    [Fact]
    public async Task Creating_a_job_ignores_a_resume_id()
    {
        var (owner, _) = await _api.CreateUserAsync();
        var (client, _) = await _api.CreateUserAsync();
        var ownersJob = await CreateJobAsync(owner, "Google");
        var ownersUpload = await AttachAsync(owner, ownersJob.Id, ResumeTestFiles.Pdf());

        var response = await client.PostAsJsonAsync("/api/jobs", new
        {
            companyName = "Sneaky",
            resumeVersionId = ownersUpload.ResumeVersionId,
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JobResponse>();
        Assert.Null(created!.ResumeVersionId);
        Assert.Null(created.Resume);
    }

    [Fact]
    public async Task A_job_with_only_a_resume_left_is_not_rejected_as_empty()
    {
        var (client, _) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Google");
        await AttachAsync(client, job.Id, ResumeTestFiles.Pdf());

        var response = await client.PutAsJsonAsync($"/api/jobs/{job.Id}", new CreateJobRequest());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull((await GetJobAsync(client, job.Id)).Resume);
    }

    // ---------- Previews and downloads ----------

    [Fact]
    public async Task Previews_inline_and_downloads_as_an_attachment_with_safe_headers()
    {
        var (client, _) = await _api.CreateUserAsync();
        var job = await CreateJobAsync(client, "Google");
        var attached = await AttachAsync(client, job.Id, ResumeTestFiles.Pdf(), "Jane CV.pdf");
        var url = $"/api/resume-versions/{attached.ResumeVersionId}/file";

        var preview = await client.GetAsync(url);
        var download = await client.GetAsync(url + "?download=true");

        Assert.Equal("application/pdf", preview.Content.Headers.ContentType?.MediaType);
        Assert.Equal("inline", preview.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Equal("attachment", download.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Equal("Jane CV.pdf", download.Content.Headers.ContentDisposition?.FileNameStar);
        Assert.Equal("nosniff", preview.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("sandbox", preview.Headers.GetValues("Content-Security-Policy").Single());
        Assert.True(preview.Headers.CacheControl?.NoStore);
    }
}
