using System.Security.Claims;
using CareerVault.Api.Identity;
using CareerVault.Api.Services.Resumes;
using Microsoft.Net.Http.Headers;

namespace CareerVault.Api.Endpoints;

// Resume files:
//   GET /api/resumes/uploads              the Resume Library: my files, one
//                                          entry per unique file, with the
//                                          applications using each
//   GET /api/resume-versions/{id}/file    preview or download a file (?download=true)
// Resumes are uploaded to and removed from applications through
// PUT/DELETE /api/jobs/{id}/resume (see JobEndpoints). Thin on purpose: the
// rules are in ResumeService. Everything requires login and only ever
// reaches the user's own files; there are no public file URLs.
public static class ResumeEndpoints
{
    public static IEndpointRouteBuilder MapResumeEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/resumes/uploads", ListUploadsAsync).RequireAuthorization();
        app.MapGet("/api/resume-versions/{id:int}/file", DownloadAsync).RequireAuthorization();

        return app;
    }

    private static async Task<IResult> ListUploadsAsync(ClaimsPrincipal user, ResumeService resumes) =>
        user.GetUserId() is { } userId
            ? Results.Ok(await resumes.ListLibraryAsync(userId))
            : Results.Unauthorized();

    // Sends one of the user's files: shown in the browser by default (for
    // previews), or as a download with ?download=true.
    private static async Task<IResult> DownloadAsync(
        int id,
        bool? download,
        ClaimsPrincipal user,
        ResumeService resumes,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        if (user.GetUserId() is not { } userId)
            return Results.Unauthorized();

        var file = await resumes.OpenVersionAsync(userId, id, cancellationToken);
        if (file is null)
            return Results.NotFound();

        var headers = context.Response.Headers;
        // The browser must use our content type, never guess another one.
        headers.XContentTypeOptions = "nosniff";
        // Personal documents: don't keep copies in shared caches.
        headers.CacheControl = "private, no-store";
        // If the file is opened directly, nothing in it can run as our site.
        headers.ContentSecurityPolicy = "sandbox";

        var disposition = new ContentDispositionHeaderValue(download == true ? "attachment" : "inline");
        disposition.SetHttpFileName(file.Version.OriginalFileName);
        headers.ContentDisposition = disposition.ToString();

        return Results.Stream(file.Content, file.Version.ContentType, enableRangeProcessing: true);
    }
}
