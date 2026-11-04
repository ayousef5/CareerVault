using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using CareerVault.Api.DTOs;

namespace CareerVault.Api.Tests;

// Tests the /api/jobs endpoints through real HTTP requests.
// Every test uses its own new user(s), so tests don't affect each other.
public class JobsEndpointTests : IClassFixture<CareerVaultApiFactory>
{
    private readonly CareerVaultApiFactory _factory;

    public JobsEndpointTests(CareerVaultApiFactory factory)
    {
        _factory = factory;
    }

    private static async Task<JobResponse> CreateJobAsync(
        HttpClient client,
        CreateJobRequest request)
    {
        var response = await client.PostAsJsonAsync("/api/jobs", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JobResponse>())!;
    }

    private static async Task<List<JobResponse>> GetJobsAsync(HttpClient client)
    {
        return (await client.GetFromJsonAsync<List<JobResponse>>("/api/jobs"))!;
    }

    // ---------- Empty records ----------

    [Fact]
    public async Task Creating_a_completely_empty_job_is_rejected_and_nothing_is_stored()
    {
        var client = await TestUsers.CreateLoggedInClientAsync(_factory);

        var response = await client.PostAsJsonAsync("/api/jobs", new CreateJobRequest());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await GetJobsAsync(client));
    }

    [Fact]
    public async Task A_job_with_only_blank_text_and_the_default_status_is_rejected()
    {
        var client = await TestUsers.CreateLoggedInClientAsync(_factory);

        var response = await client.PostAsJsonAsync("/api/jobs", new CreateJobRequest
        {
            CompanyName = "  ",
            JobTitle = " ",
            Status = "Not Applied",
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await GetJobsAsync(client));
    }

    [Fact]
    public async Task A_partially_completed_job_is_allowed()
    {
        var client = await TestUsers.CreateLoggedInClientAsync(_factory);

        // A company but no role.
        var created = await CreateJobAsync(client, new CreateJobRequest { CompanyName = "FedEx" });

        Assert.Equal("FedEx", created.CompanyName);
        Assert.Equal("", created.JobTitle);
        Assert.Single(await GetJobsAsync(client));
    }

    [Fact]
    public async Task Editing_a_job_to_be_completely_empty_is_rejected_and_the_job_is_unchanged()
    {
        var client = await TestUsers.CreateLoggedInClientAsync(_factory);
        var created = await CreateJobAsync(client, new CreateJobRequest { CompanyName = "FedEx" });

        var response = await client.PutAsJsonAsync($"/api/jobs/{created.Id}", new CreateJobRequest());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var stored = await client.GetFromJsonAsync<JobResponse>($"/api/jobs/{created.Id}");
        Assert.Equal("FedEx", stored!.CompanyName);
    }

    // ---------- Insertion order ----------

    [Fact]
    public async Task Jobs_come_back_in_the_order_they_were_added_even_after_edits_and_logging_in_again()
    {
        var email = $"order-{Guid.NewGuid():N}@example.com";
        var client = await TestUsers.CreateLoggedInClientAsync(_factory, email);

        var first = await CreateJobAsync(client, new CreateJobRequest { CompanyName = "First" });
        await CreateJobAsync(client, new CreateJobRequest { CompanyName = "Second" });
        await CreateJobAsync(client, new CreateJobRequest { CompanyName = "Third" });

        // Editing the first job must not move it.
        var edit = await client.PutAsJsonAsync($"/api/jobs/{first.Id}", new CreateJobRequest
        {
            CompanyName = "First (edited)",
            Status = "Applied",
        });
        edit.EnsureSuccessStatusCode();

        // Simulate a browser refresh / logging in again with a new token.
        var freshClient = _factory.CreateClient();
        var token = await TestUsers.LogInAsync(freshClient, email);
        freshClient.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", token);

        var names = (await GetJobsAsync(freshClient)).Select(job => job.CompanyName);
        Assert.Equal(new[] { "First (edited)", "Second", "Third" }, names);
    }

    [Fact]
    public async Task A_job_added_after_a_delete_goes_to_the_bottom()
    {
        var client = await TestUsers.CreateLoggedInClientAsync(_factory);
        await CreateJobAsync(client, new CreateJobRequest { CompanyName = "A" });
        var b = await CreateJobAsync(client, new CreateJobRequest { CompanyName = "B" });
        await CreateJobAsync(client, new CreateJobRequest { CompanyName = "C" });

        (await client.DeleteAsync($"/api/jobs/{b.Id}")).EnsureSuccessStatusCode();
        await CreateJobAsync(client, new CreateJobRequest { CompanyName = "D" });

        var names = (await GetJobsAsync(client)).Select(job => job.CompanyName);
        Assert.Equal(new[] { "A", "C", "D" }, names);
    }

    // ---------- Deleting ----------

    [Fact]
    public async Task Deleting_your_own_job_removes_it()
    {
        var client = await TestUsers.CreateLoggedInClientAsync(_factory);
        var keep = await CreateJobAsync(client, new CreateJobRequest { CompanyName = "Keep" });
        var remove = await CreateJobAsync(client, new CreateJobRequest { CompanyName = "Remove" });

        var response = await client.DeleteAsync($"/api/jobs/{remove.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var getRemoved = await client.GetAsync($"/api/jobs/{remove.Id}");
        Assert.Equal(HttpStatusCode.NotFound, getRemoved.StatusCode);
        Assert.Equal(new[] { keep.Id }, (await GetJobsAsync(client)).Select(job => job.Id));
    }

    [Fact]
    public async Task A_user_cannot_delete_another_users_job()
    {
        var owner = await TestUsers.CreateLoggedInClientAsync(_factory);
        var otherUser = await TestUsers.CreateLoggedInClientAsync(_factory);
        var job = await CreateJobAsync(owner, new CreateJobRequest { CompanyName = "Private" });

        var response = await otherUser.DeleteAsync($"/api/jobs/{job.Id}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Single(await GetJobsAsync(owner));
    }

    [Fact]
    public async Task A_user_cannot_edit_or_see_another_users_job()
    {
        var owner = await TestUsers.CreateLoggedInClientAsync(_factory);
        var otherUser = await TestUsers.CreateLoggedInClientAsync(_factory);
        var job = await CreateJobAsync(owner, new CreateJobRequest { CompanyName = "Private" });

        var put = await otherUser.PutAsJsonAsync(
            $"/api/jobs/{job.Id}",
            new CreateJobRequest { CompanyName = "Hacked" });
        var get = await otherUser.GetAsync($"/api/jobs/{job.Id}");

        Assert.Equal(HttpStatusCode.NotFound, put.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
        Assert.Empty(await GetJobsAsync(otherUser));
        Assert.Equal("Private", (await GetJobsAsync(owner)).Single().CompanyName);
    }

    [Fact]
    public async Task Deleting_without_logging_in_is_rejected()
    {
        var owner = await TestUsers.CreateLoggedInClientAsync(_factory);
        var job = await CreateJobAsync(owner, new CreateJobRequest { CompanyName = "Keep" });

        var anonymous = _factory.CreateClient();
        var response = await anonymous.DeleteAsync($"/api/jobs/{job.Id}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Single(await GetJobsAsync(owner));
    }

    [Fact]
    public async Task Deleting_a_job_that_does_not_exist_returns_not_found()
    {
        var client = await TestUsers.CreateLoggedInClientAsync(_factory);

        var response = await client.DeleteAsync("/api/jobs/999999");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
