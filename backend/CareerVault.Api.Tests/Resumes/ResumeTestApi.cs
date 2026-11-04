using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using CareerVault.Api.Data;
using CareerVault.Api.DTOs;
using CareerVault.Api.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace CareerVault.Api.Tests.Resumes;

// Shared helpers for the resume tests: users, jobs, uploads, and a look at
// what's stored (database rows and files).
public sealed class ResumeTestApi(CareerVaultApiFactory factory)
{
    // A new logged-in user, and their user id (stored file keys start with it).
    public async Task<(HttpClient Client, string UserId)> CreateUserAsync()
    {
        var email = $"user-{Guid.NewGuid():N}@example.com";
        var client = await TestUsers.CreateLoggedInClientAsync(factory, email);
        var userId = await WithDbAsync(db => db.Users.Where(u => u.Email == email).Select(u => u.Id).SingleAsync());
        return (client, userId);
    }

    public static async Task<JobResponse> CreateJobAsync(HttpClient client, string company, string title = "Engineer")
    {
        var response = await client.PostAsJsonAsync("/api/jobs", new CreateJobRequest { CompanyName = company, JobTitle = title });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JobResponse>())!;
    }

    public static MultipartFormDataContent Form(byte[] file, string fileName, string contentType = "application/octet-stream")
    {
        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(file);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(fileContent, "file", fileName);
        return form;
    }

    // PUT /api/jobs/{id}/resume
    public static Task<HttpResponseMessage> UploadAsync(HttpClient client, int jobId, byte[] file, string fileName = "cv.pdf", string contentType = "application/octet-stream") =>
        client.PutAsync($"/api/jobs/{jobId}/resume", Form(file, fileName, contentType));

    // Uploads and expects success; returns the updated job.
    public static async Task<JobResponse> AttachAsync(HttpClient client, int jobId, byte[] file, string fileName = "cv.pdf")
    {
        var response = await UploadAsync(client, jobId, file, fileName);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JobResponse>())!;
    }

    // DELETE /api/jobs/{id}/resume, expecting success.
    public static async Task<JobResponse> RemoveAsync(HttpClient client, int jobId)
    {
        var response = await client.DeleteAsync($"/api/jobs/{jobId}/resume");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JobResponse>())!;
    }

    public static async Task<JobResponse> GetJobAsync(HttpClient client, int jobId) =>
        (await client.GetFromJsonAsync<JobResponse>($"/api/jobs/{jobId}"))!;

    public static async Task<List<ResumeFileResponse>> LibraryAsync(HttpClient client) =>
        (await client.GetFromJsonAsync<List<ResumeFileResponse>>("/api/resumes/uploads"))!;

    public static async Task<string?> ErrorAsync(HttpResponseMessage response)
    {
        var problem = await response.Content.ReadFromJsonAsync<HttpValidationProblemDetails>();
        return problem?.Errors.Values.SelectMany(messages => messages).FirstOrDefault();
    }

    // The physical files stored for a user (keys are "{userId}/{random}").
    public List<string> FilesOf(string userId) =>
        factory.FileStorage.Files.Keys.Where(key => key.StartsWith(userId + "/", StringComparison.Ordinal)).ToList();

    public Task<List<StoredFile>> StoredFilesOfAsync(string userId) =>
        WithDbAsync(db => db.StoredFiles.Where(file => file.UserId == userId).AsNoTracking().ToListAsync());

    public Task<int> VersionCountAsync(string userId) =>
        WithDbAsync(db => db.ResumeVersions.CountAsync(version => version.UserId == userId));

    // Runs something against the test database directly.
    public async Task<T> WithDbAsync<T>(Func<CareerVaultDbContext, Task<T>> action)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CareerVaultDbContext>();
        return await action(db);
    }
}
