using System.Security.Cryptography;
using CareerVault.Api.Data;
using CareerVault.Api.DTOs;
using CareerVault.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CareerVault.Api.Services.Resumes;

// What happened to a resume request.
public enum ResumeOutcome
{
    Ok,
    // The application (or file) doesn't exist for this user.
    NotFound,
    // The upload wasn't acceptable (see Error).
    Invalid,
}

public sealed record ResumeResult<T>(ResumeOutcome Outcome, T? Value = default, string? Error = null)
{
    public static ResumeResult<T> Ok(T value) => new(ResumeOutcome.Ok, value);
    public static ResumeResult<T> NotFound() => new(ResumeOutcome.NotFound);
    public static ResumeResult<T> Invalid(string error) => new(ResumeOutcome.Invalid, Error: error);
}

// A stored file ready to send: the upload's details and an open stream.
public sealed record ResumeFile(ResumeVersion Version, Stream Content);

// The rules for resume files:
//  - every method only ever sees the given user's own files,
//  - a resume is uploaded straight to an application; each upload gets its
//    own ResumeVersion, so every application's attachment is independent,
//  - identical bytes from the same user are stored once (one StoredFile,
//    found by its SHA-256); different users never share a file,
//  - an upload is checked and fingerprinted as a stream, never read whole
//    into memory,
//  - a physical file is deleted only when no upload uses it any more,
//  - files live in IFileStorage; the database only holds their details.
public sealed class ResumeService(
    CareerVaultDbContext db,
    IFileStorage storage,
    ResumeOptions options,
    ILogger<ResumeService> logger)
{
    // Uploads (and deletions) of the same file by the same user take turns,
    // so two of them at the same moment can't both store a copy, and a file
    // can't be deleted while it's being reused. (A fixed set of locks keeps
    // memory use constant. Across several servers, the database's unique
    // (UserId, Sha256) index is what keeps it safe; see FindOrStoreFileAsync.)
    private static readonly SemaphoreSlim[] FileLocks =
        Enumerable.Range(0, 64).Select(_ => new SemaphoreSlim(1, 1)).ToArray();

    private static SemaphoreSlim LockFor(string userId, string sha256) =>
        FileLocks[(uint)HashCode.Combine(userId, sha256) % FileLocks.Length];

    // ---------- The Resume Library ----------

    // The user's resume files for the Library: one entry per unique file
    // (identical uploads are one entry), each with every application using
    // it, newest first. Files of older library resumes that aren't attached
    // to an application are included with no applications.
    public async Task<List<ResumeFileResponse>> ListLibraryAsync(string userId)
    {
        // Only details are read here, never file contents.
        var versions = await db.ResumeVersions
            .Where(v => v.UserId == userId)
            .Select(v => new
            {
                v.Id,
                v.StoredFileId,
                v.OriginalFileName,
                v.UploadedAt,
                v.StoredFile.ContentType,
                v.StoredFile.SizeBytes,
                IsInLibraryResume = v.ResumeId != null && v.Resume!.DeletedAt == null,
            })
            .ToListAsync();

        // The user's applications that have a resume, in grid order.
        var attachedJobs = await db.JobApplications
            .Where(job => job.UserId == userId && job.ResumeVersionId != null)
            .OrderBy(job => job.SortOrder)
            .ThenBy(job => job.Id)
            .Select(job => new { job.Id, VersionId = job.ResumeVersionId!.Value, job.CompanyName, job.JobTitle })
            .ToListAsync();
        var attachedVersionIds = attachedJobs.Select(job => job.VersionId).ToHashSet();

        var entries = new List<ResumeFileResponse>();
        foreach (var file in versions.GroupBy(v => v.StoredFileId))
        {
            var versionIds = file.Select(v => v.Id).ToHashSet();
            var applications = attachedJobs
                .Where(job => versionIds.Contains(job.VersionId))
                .Select(job => new ResumeFileApplicationResponse
                {
                    JobId = job.Id,
                    CompanyName = job.CompanyName,
                    JobTitle = job.JobTitle,
                })
                .ToList();

            // The uploads still in use: attached, or part of an older library resume.
            var shown = file
                .Where(v => v.IsInLibraryResume || attachedVersionIds.Contains(v.Id))
                .OrderByDescending(v => v.UploadedAt)
                .ThenByDescending(v => v.Id)
                .FirstOrDefault();
            if (shown is null)
                continue;

            entries.Add(new ResumeFileResponse
            {
                StoredFileId = file.Key,
                VersionId = shown.Id,
                OriginalFileName = shown.OriginalFileName,
                UploadedAt = shown.UploadedAt,
                ContentType = shown.ContentType,
                SizeBytes = shown.SizeBytes,
                Applications = applications,
            });
        }

        return entries
            .OrderByDescending(entry => entry.UploadedAt)
            .ThenByDescending(entry => entry.VersionId)
            .ToList();
    }

    // Opens one of the user's uploads for download or preview.
    public async Task<ResumeFile?> OpenVersionAsync(string userId, int versionId, CancellationToken cancellationToken)
    {
        var version = await db.ResumeVersions
            .Include(v => v.StoredFile)
            .AsNoTracking()
            .FirstOrDefaultAsync(v => v.Id == versionId && v.UserId == userId, cancellationToken);
        if (version is null)
            return null;

        var content = await storage.OpenReadAsync(version.StoredFile.StorageKey, cancellationToken);
        if (content is null)
        {
            // The database says it exists but the file is gone.
            logger.LogWarning("Stored file for resume version {VersionId} is missing", version.Id);
            return null;
        }

        return new ResumeFile(version, content);
    }

    // ---------- Attaching to an application ----------

    // Uploads a file and attaches it to the (already ownership-checked) job,
    // replacing any resume it had. Identical bytes the user already stored
    // are reused instead of stored again.
    public async Task<ResumeResult<ResumeVersion>> AttachAsync(
        string userId,
        JobApplication job,
        string? fileName,
        Stream content,
        long length,
        CancellationToken cancellationToken)
    {
        // Refuse oversized files before reading them.
        if (length > options.MaxFileBytes)
            return ResumeResult<ResumeVersion>.Invalid(TooLargeMessage());

        // Checking and fingerprinting need to read the file more than once.
        // Uploaded form files can be re-read; anything else is first copied
        // to a temporary file on disk (never into memory).
        await using var temporaryCopy = content.CanSeek ? null : await CopyToTemporaryFileAsync(content, cancellationToken);
        if (!content.CanSeek && temporaryCopy is null)
            return ResumeResult<ResumeVersion>.Invalid(TooLargeMessage());
        var upload = temporaryCopy ?? content;

        var check = await ResumeFileValidator.CheckAsync(upload, fileName ?? "", options, cancellationToken);
        if (!check.IsValid)
            return ResumeResult<ResumeVersion>.Invalid(check.Error!);

        // SHA-256 is computed in small chunks as the stream is read.
        upload.Position = 0;
        var sha256 = Convert.ToHexStringLower(await SHA256.HashDataAsync(upload, cancellationToken));

        var previousVersionId = job.ResumeVersionId;
        ResumeVersion version;

        var gate = LockFor(userId, sha256);
        await gate.WaitAsync(cancellationToken);
        try
        {
            var storedFile = await FindOrStoreFileAsync(userId, sha256, check.ContentType!, upload, cancellationToken);

            // This application's own upload record, pointing at the file.
            version = new ResumeVersion
            {
                UserId = userId,
                VersionNumber = 1,
                OriginalFileName = ResumeFileValidator.CleanFileName(fileName, check.ContentType!),
                ContentType = storedFile.ContentType,
                SizeBytes = storedFile.SizeBytes,
                UploadedAt = DateTimeOffset.UtcNow,
                StoredFile = storedFile,
            };
            db.ResumeVersions.Add(version);
            job.ResumeVersion = version;

            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch
            {
                // Nothing was attached, so a newly stored file may now be
                // unused. (Forget the failed changes first, so they aren't
                // tried again.)
                db.ChangeTracker.Clear();
                await DeleteFileIfUnusedAsync(storedFile, CancellationToken.None);
                throw;
            }
        }
        finally
        {
            gate.Release();
        }

        // The resume it replaced is no longer attached here.
        if (previousVersionId is { } previous)
            await ReleaseVersionAsync(userId, previous, cancellationToken);

        return ResumeResult<ResumeVersion>.Ok(version);
    }

    // Removes the job's resume (the job is already ownership-checked).
    public async Task DetachAsync(string userId, JobApplication job, CancellationToken cancellationToken)
    {
        if (job.ResumeVersionId is not { } previous)
            return;

        job.ResumeVersionId = null;
        job.ResumeVersion = null;
        await db.SaveChangesAsync(cancellationToken);
        await ReleaseVersionAsync(userId, previous, cancellationToken);
    }

    // Called after an application stops using an upload (its resume was
    // replaced or removed, or the application was deleted). Unless another
    // application or an older library resume still uses it, the upload is
    // removed; and its physical file too, once no other upload uses that.
    public async Task ReleaseVersionAsync(string userId, int versionId, CancellationToken cancellationToken = default)
    {
        var version = await db.ResumeVersions
            .Include(v => v.Resume)
            .Include(v => v.StoredFile)
            .FirstOrDefaultAsync(v => v.Id == versionId && v.UserId == userId, cancellationToken);
        if (version is null)
            return;

        // Still attached to another application (possible for older data).
        if (await db.JobApplications.AnyAsync(job => job.ResumeVersionId == versionId, cancellationToken))
            return;

        // Files of older library resumes stay in the Library as "Not
        // attached to an application".
        if (version.Resume is { DeletedAt: null })
            return;

        var gate = LockFor(userId, version.StoredFile.Sha256);
        await gate.WaitAsync(cancellationToken);
        try
        {
            db.ResumeVersions.Remove(version);

            // A deleted older resume with nothing left goes too.
            if (version.Resume is { } resume
                && !await db.ResumeVersions.AnyAsync(v => v.ResumeId == resume.Id && v.Id != version.Id, cancellationToken))
            {
                db.Resumes.Remove(resume);
            }

            await db.SaveChangesAsync(cancellationToken);
            await DeleteFileIfUnusedAsync(version.StoredFile, cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    // ---------- Helpers ----------

    // The user's stored file with these bytes, storing it if there isn't one.
    // The caller holds the lock for (userId, sha256).
    private async Task<StoredFile> FindOrStoreFileAsync(
        string userId,
        string sha256,
        string contentType,
        Stream upload,
        CancellationToken cancellationToken)
    {
        var existing = await db.StoredFiles
            .FirstOrDefaultAsync(f => f.UserId == userId && f.Sha256 == sha256, cancellationToken);

        if (existing is not null)
        {
            if (await ExistsInStorageAsync(existing.StorageKey, cancellationToken))
                return existing;

            // The database knew this file but it was missing from storage:
            // store this upload's bytes (they're identical) and use them.
            logger.LogWarning("Stored file {StoredFileId} was missing; restoring it from a new upload", existing.Id);
            upload.Position = 0;
            existing.StorageKey = await storage.SaveAsync(userId, upload, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            return existing;
        }

        upload.Position = 0;
        var key = await storage.SaveAsync(userId, upload, cancellationToken);
        var file = new StoredFile
        {
            UserId = userId,
            Sha256 = sha256,
            ContentType = contentType,
            SizeBytes = upload.Length,
            StorageKey = key,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.StoredFiles.Add(file);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return file;
        }
        catch (DbUpdateException)
        {
            // Most likely the same file was just stored by another request
            // (e.g. on another server), and the unique (UserId, Sha256) index
            // refused this second row. Use that file, and remove only the copy
            // stored above: the other request's file is never touched.
            db.Entry(file).State = EntityState.Detached;
            await DeleteFromStorageAsync(key);

            var winner = await db.StoredFiles
                .FirstOrDefaultAsync(f => f.UserId == userId && f.Sha256 == sha256, cancellationToken);
            if (winner is null)
                throw;
            return winner;
        }
    }

    // Deletes a stored file (its row, then its bytes) if no upload uses it.
    // The caller holds the lock for its (UserId, Sha256).
    private async Task DeleteFileIfUnusedAsync(StoredFile file, CancellationToken cancellationToken)
    {
        if (await db.ResumeVersions.AnyAsync(v => v.StoredFileId == file.Id, cancellationToken))
            return;

        db.StoredFiles.Remove(file);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Another upload started using it in the meantime (the database
            // refuses to delete a file an upload points at): keep it.
            db.Entry(file).State = EntityState.Unchanged;
            return;
        }

        // The bytes go only after the database row is gone.
        await DeleteFromStorageAsync(file.StorageKey);
    }

    private async Task<bool> ExistsInStorageAsync(string key, CancellationToken cancellationToken)
    {
        await using var stream = await storage.OpenReadAsync(key, cancellationToken);
        return stream is not null;
    }

    // If removing a file fails, it's just an unused file left in storage.
    private async Task DeleteFromStorageAsync(string key)
    {
        try
        {
            await storage.DeleteAsync(key, CancellationToken.None);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning("Couldn't delete stored file {StorageKey}", key);
        }
    }

    // Copies a stream that can't be re-read into a temporary file that's
    // deleted when closed. Returns null if it's larger than allowed.
    private async Task<Stream?> CopyToTemporaryFileAsync(Stream content, CancellationToken cancellationToken)
    {
        var copy = new FileStream(
            Path.GetTempFileName(), FileMode.Create, FileAccess.ReadWrite, FileShare.None,
            bufferSize: 81920, FileOptions.DeleteOnClose | FileOptions.Asynchronous);

        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await content.ReadAsync(buffer, cancellationToken)) > 0)
        {
            total += read;
            if (total > options.MaxFileBytes)
            {
                await copy.DisposeAsync();
                return null;
            }
            await copy.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }

        copy.Position = 0;
        return copy;
    }

    private string TooLargeMessage() => $"The file is larger than {options.MaxFileBytes / (1024 * 1024)} MB.";
}
