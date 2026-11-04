using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CareerVault.Api.Tests;

// Creates real user accounts through the API's /api/auth endpoints.
public static class TestUsers
{
    private const string Password = "Test-Passw0rd!";

    // Registers a new user, logs in, and returns a client that sends that
    // user's access token with every request.
    public static async Task<HttpClient> CreateLoggedInClientAsync(
        WebApplicationFactory<Program> factory,
        string? email = null)
    {
        email ??= $"user-{Guid.NewGuid():N}@example.com";
        var client = factory.CreateClient();

        var register = await client.PostAsJsonAsync(
            "/api/auth/register",
            new { email, password = Password });
        register.EnsureSuccessStatusCode();

        var token = await LogInAsync(client, email);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", token);

        return client;
    }

    // Logs an existing user in again and returns a fresh access token.
    public static async Task<string> LogInAsync(HttpClient client, string email)
    {
        var login = await client.PostAsJsonAsync(
            "/api/auth/login?useCookies=false",
            new { email, password = Password });
        login.EnsureSuccessStatusCode();

        var body = await login.Content.ReadFromJsonAsync<LoginResponse>();
        return body!.AccessToken;
    }

    private record LoginResponse(string AccessToken);
}
