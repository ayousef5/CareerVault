using System.Security.Claims;
using CareerVault.Api.DTOs;
using CareerVault.Api.Hosting;
using CareerVault.Api.Identity;
using CareerVault.Api.Services.Jobs;
using CareerVault.Api.Services.Resumes;
using CareerVault.Api.Validation;
using Microsoft.AspNetCore.Mvc;

namespace CareerVault.Api.Endpoints;

// /api/jobs: list, get, create, update and delete the logged-in user's
// jobs, and upload or remove a job's resume:
//   PUT    /api/jobs/{id}/resume    upload a PDF/DOCX and attach it (form: file)
//   DELETE /api/jobs/{id}/resume    remove the attached resume
// Thin on purpose: the rules are in JobService; these only turn HTTP
// requests into service calls and results into status codes.
public static class JobEndpoints
{
    // Room for the file plus the rest of the form.
    private const long FormOverheadBytes = 64 * 1024;

    public static IEndpointRouteBuilder MapJobEndpoints(this IEndpointRouteBuilder app, ResumeOptions resumeOptions)
    {
        // Every endpoint in this group requires a logged-in user.
        var jobs = app.MapGroup("/api/jobs").RequireAuthorization();

        jobs.MapGet("/", ListAsync);
        jobs.MapGet("/{id:int}", GetAsync);
        jobs.MapPost("/", CreateAsync);
        jobs.MapPut("/{id:int}", UpdateAsync);
        jobs.MapDelete("/{id:int}", DeleteAsync);

        jobs.MapPut("/{id:int}/resume", AttachResumeAsync)
            // Antiforgery protects cookie logins; this API uses bearer tokens.
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(resumeOptions.MaxFileBytes + FormOverheadBytes))
            // Uploads are limited per user.
            .RequireRateLimiting(RateLimiting.Uploads);
        jobs.MapDelete("/{id:int}/resume", RemoveResumeAsync);

        return app;
    }

    private static async Task<IResult> ListAsync(ClaimsPrincipal user, JobService jobs) =>
        user.GetUserId() is { } userId
            ? Results.Ok(await jobs.ListAsync(userId))
            : Results.Unauthorized();

    private static async Task<IResult> GetAsync(int id, ClaimsPrincipal user, JobService jobs)
    {
        if (user.GetUserId() is not { } userId)
            return Results.Unauthorized();

        var job = await jobs.GetAsync(userId, id);
        return job is null ? Results.NotFound() : Results.Ok(job);
    }

    private static async Task<IResult> CreateAsync(
        CreateJobRequest request,
        ClaimsPrincipal user,
        JobService jobs)
    {
        if (user.GetUserId() is not { } userId)
            return Results.Unauthorized();

        var result = await jobs.CreateAsync(userId, request);
        return result.Outcome == JobSaveOutcome.Empty
            ? EmptyJobProblem()
            : Results.Created($"/api/jobs/{result.Job!.Id}", result.Job);
    }

    private static async Task<IResult> UpdateAsync(
        int id,
        CreateJobRequest request,
        ClaimsPrincipal user,
        JobService jobs)
    {
        if (user.GetUserId() is not { } userId)
            return Results.Unauthorized();

        var result = await jobs.UpdateAsync(userId, id, request);
        return result.Outcome switch
        {
            JobSaveOutcome.Empty => EmptyJobProblem(),
            JobSaveOutcome.NotFound => Results.NotFound(),
            _ => Results.Ok(result.Job),
        };
    }

    private static async Task<IResult> DeleteAsync(int id, ClaimsPrincipal user, JobService jobs)
    {
        if (user.GetUserId() is not { } userId)
            return Results.Unauthorized();

        return await jobs.DeleteAsync(userId, id) ? Results.NoContent() : Results.NotFound();
    }

    // The 400 Bad Request response for a job with no information in it.
    private static IResult EmptyJobProblem() =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["job"] = [JobValidation.EmptyJobMessage],
        });

    private static async Task<IResult> AttachResumeAsync(
        int id,
        IFormFile? file,
        ClaimsPrincipal user,
        JobService jobs,
        CancellationToken cancellationToken)
    {
        if (user.GetUserId() is not { } userId)
            return Results.Unauthorized();

        // Another user's job is "not found" (checked before the file).
        if (await jobs.GetAsync(userId, id) is null)
            return Results.NotFound();
        if (file is null)
            return FileProblem("Choose a PDF or Word (.docx) file to upload.");

        await using var content = file.OpenReadStream();
        var result = await jobs.AttachResumeAsync(userId, id, file.FileName, content, file.Length, cancellationToken);
        return result.Outcome switch
        {
            JobSaveOutcome.NotFound => Results.NotFound(),
            JobSaveOutcome.InvalidFile => FileProblem(result.Error!),
            _ => Results.Ok(result.Job),
        };
    }

    private static async Task<IResult> RemoveResumeAsync(
        int id,
        ClaimsPrincipal user,
        JobService jobs,
        CancellationToken cancellationToken)
    {
        if (user.GetUserId() is not { } userId)
            return Results.Unauthorized();

        var result = await jobs.RemoveResumeAsync(userId, id, cancellationToken);
        return result.Outcome == JobSaveOutcome.NotFound ? Results.NotFound() : Results.Ok(result.Job);
    }

    // A 400 response about the uploaded file.
    private static IResult FileProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = [message] });
}
