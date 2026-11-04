using System.Linq.Expressions;
using CareerVault.Api.Data;
using CareerVault.Api.DTOs;
using CareerVault.Api.Models;
using CareerVault.Api.Services.Resumes;
using CareerVault.Api.Validation;
using Microsoft.EntityFrameworkCore;

namespace CareerVault.Api.Services.Jobs;

// What happened when creating or updating a job.
public enum JobSaveOutcome
{
    Saved,
    // Every field was empty, so nothing was stored.
    Empty,
    // No such job for this user.
    NotFound,
    // The uploaded resume wasn't acceptable (see Error).
    InvalidFile,
}

public sealed record JobSaveResult(JobSaveOutcome Outcome, JobResponse? Job = null, string? Error = null);

// The rules for a user's job applications: every method only ever sees the
// given user's own jobs (account isolation), empty jobs are never stored,
// new jobs go to the bottom of the list (SortOrder), and a job's resume is
// only changed through AttachResumeAsync / RemoveResumeAsync (never by
// saving its other fields).
public sealed class JobService(CareerVaultDbContext db, ResumeService resumes)
{
    // Turns a stored job into what the API sends back. Written as an
    // expression so EF Core can turn it into SQL when listing jobs.
    private static readonly Expression<Func<JobApplication, JobResponse>> ToResponseExpression =
        job => new JobResponse
        {
            Id = job.Id,
            CompanyName = job.CompanyName,
            JobTitle = job.JobTitle,
            Location = job.Location,
            JobUrl = job.JobUrl,
            DateApplied = job.DateApplied,
            Status = job.Status,
            Notes = job.Notes,
            JobDescription = job.JobDescription,
            Pay = job.Pay,
            Recruiter = job.Recruiter,
            ResumeVersionId = job.ResumeVersionId,
            Resume = job.ResumeVersion == null
                ? null
                : new AttachedResumeResponse
                {
                    VersionId = job.ResumeVersion.Id,
                    OriginalFileName = job.ResumeVersion.OriginalFileName,
                    ContentType = job.ResumeVersion.ContentType,
                    SizeBytes = job.ResumeVersion.SizeBytes,
                    UploadedAt = job.ResumeVersion.UploadedAt,
                },
        };

    // All of the user's jobs, oldest first (the order they were added).
    public Task<List<JobResponse>> ListAsync(string userId) =>
        db.JobApplications
            .Where(job => job.UserId == userId)
            .OrderBy(job => job.SortOrder)
            .ThenBy(job => job.Id)
            .Select(ToResponseExpression)
            .ToListAsync();

    public Task<JobResponse?> GetAsync(string userId, int id) =>
        db.JobApplications
            .Where(job => job.Id == id && job.UserId == userId)
            .Select(ToResponseExpression)
            .FirstOrDefaultAsync();

    public async Task<JobSaveResult> CreateAsync(string userId, CreateJobRequest request)
    {
        // Never store a completely empty job.
        if (!JobValidation.HasMeaningfulContent(request))
            return new JobSaveResult(JobSaveOutcome.Empty);

        // Put the new job after the user's existing jobs.
        var lastSortOrder = await db.JobApplications
            .Where(job => job.UserId == userId)
            .MaxAsync(job => (int?)job.SortOrder) ?? 0;

        var job = new JobApplication
        {
            UserId = userId,
            SortOrder = lastSortOrder + 1,
        };
        CopyFields(request, job);

        db.JobApplications.Add(job);
        await db.SaveChangesAsync();

        return new JobSaveResult(JobSaveOutcome.Saved, await GetAsync(userId, job.Id));
    }

    public async Task<JobSaveResult> UpdateAsync(string userId, int id, CreateJobRequest request)
    {
        var job = await FindOwnJobAsync(userId, id);
        if (job is null)
            return new JobSaveResult(JobSaveOutcome.NotFound);

        // Never turn a job into a completely empty one. (The app deletes a
        // job instead when all of its details are cleared.) An attached
        // resume counts as content.
        if (!JobValidation.HasMeaningfulContent(request) && job.ResumeVersionId is null)
            return new JobSaveResult(JobSaveOutcome.Empty);

        // SortOrder and the resume are left alone: editing never moves a
        // job or changes its attachment.
        CopyFields(request, job);
        await db.SaveChangesAsync();

        return new JobSaveResult(JobSaveOutcome.Saved, await GetAsync(userId, job.Id));
    }

    // Uploads a resume file to the user's job, replacing any it had.
    public async Task<JobSaveResult> AttachResumeAsync(
        string userId,
        int id,
        string? fileName,
        Stream content,
        long length,
        CancellationToken cancellationToken)
    {
        var job = await FindOwnJobAsync(userId, id);
        if (job is null)
            return new JobSaveResult(JobSaveOutcome.NotFound);

        var result = await resumes.AttachAsync(userId, job, fileName, content, length, cancellationToken);
        if (result.Outcome == ResumeOutcome.Invalid)
            return new JobSaveResult(JobSaveOutcome.InvalidFile, Error: result.Error);

        return new JobSaveResult(JobSaveOutcome.Saved, await GetAsync(userId, job.Id));
    }

    // Removes the resume from the user's job (fine if it had none).
    public async Task<JobSaveResult> RemoveResumeAsync(string userId, int id, CancellationToken cancellationToken)
    {
        var job = await FindOwnJobAsync(userId, id);
        if (job is null)
            return new JobSaveResult(JobSaveOutcome.NotFound);

        await resumes.DetachAsync(userId, job, cancellationToken);
        return new JobSaveResult(JobSaveOutcome.Saved, await GetAsync(userId, job.Id));
    }

    // Returns false if the user has no such job.
    public async Task<bool> DeleteAsync(string userId, int id)
    {
        var job = await FindOwnJobAsync(userId, id);
        if (job is null)
            return false;

        var versionId = job.ResumeVersionId;
        db.JobApplications.Remove(job);
        await db.SaveChangesAsync();

        // Its resume upload (and the file, if nothing else uses it) goes too.
        if (versionId is { } previous)
            await resumes.ReleaseVersionAsync(userId, previous);
        return true;
    }

    private Task<JobApplication?> FindOwnJobAsync(string userId, int id) =>
        db.JobApplications.FirstOrDefaultAsync(job => job.Id == id && job.UserId == userId);

    // The fields a request can set (everything except the owner, the order
    // and the resume).
    private static void CopyFields(CreateJobRequest request, JobApplication job)
    {
        job.CompanyName = request.CompanyName;
        job.JobTitle = request.JobTitle;
        job.Location = request.Location;
        job.JobUrl = request.JobUrl;
        job.DateApplied = request.DateApplied;
        job.Status = request.Status;
        job.Notes = request.Notes;
        job.JobDescription = request.JobDescription;
        job.Pay = request.Pay;
        job.Recruiter = request.Recruiter;
    }
}
