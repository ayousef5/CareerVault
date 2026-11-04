using System.Security.Claims;

namespace CareerVault.Api.Identity;

public static class ClaimsPrincipalExtensions
{
    // The logged-in user's id from their access token, or null if missing.
    public static string? GetUserId(this ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");
}
