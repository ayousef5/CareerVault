using CareerVault.Api.Identity;

namespace CareerVault.Api.Models;

// A named resume from the earlier Resume Library (e.g. "Software
// Engineering resume"). Resumes are now uploaded straight to applications,
// so new uploads don't belong to one; these older resumes are kept so their
// files stay visible in the Library.
public class Resume
{
    public const int MaxNameLength = 200;

    public int Id { get; set; }

    // The user who owns this resume.
    public string UserId { get; set; } = string.Empty;
    public ApplicationUser User { get; set; } = null!;

    public string Name { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }

    // Set when the user deletes the resume. It's then hidden from the
    // library, but versions still attached to applications are kept so
    // those applications keep their exact resume.
    public DateTimeOffset? DeletedAt { get; set; }

    public List<ResumeVersion> Versions { get; set; } = [];
}

// One upload: a file the user uploaded, under the name it had on their
// computer. Uploading a resume to an application creates its own
// ResumeVersion, so every application's attachment is independent, even when
// several of them have the exact same file (they then share one StoredFile).
// A version is never changed after upload.
public class ResumeVersion
{
    public const int MaxFileNameLength = 255;

    public int Id { get; set; }

    // The older Resume Library resume this belongs to, or null for a file
    // uploaded straight to an application.
    public int? ResumeId { get; set; }
    public Resume? Resume { get; set; }

    // The owner again, so "is this file mine?" is a single simple check.
    public string UserId { get; set; } = string.Empty;

    // 1 for the first upload, then 2, 3... (within an older library
    // resume; always 1 for a file uploaded to an application).
    public int VersionNumber { get; set; }

    // The name the file had on the user's computer (shown only; never used
    // to find the file).
    public string OriginalFileName { get; set; } = string.Empty;

    // application/pdf or the DOCX type, as detected from the file itself.
    public string ContentType { get; set; } = string.Empty;

    public long SizeBytes { get; set; }

    public DateTimeOffset UploadedAt { get; set; }

    // The physical file holding the bytes (possibly shared with other
    // uploads of the exact same file by the same user).
    public int StoredFileId { get; set; }
    public StoredFile StoredFile { get; set; } = null!;
}

// One physical file in storage. Each user has at most one StoredFile for any
// given content (the same SHA-256), so uploading an identical file again
// reuses it instead of storing a second copy. Files are never shared between
// users. It's deleted once no upload (ResumeVersion) uses it any more.
public class StoredFile
{
    public int Id { get; set; }

    // The owner. Only this user's uploads can ever use this file.
    public string UserId { get; set; } = string.Empty;

    // A fingerprint of the bytes (lowercase hex SHA-256).
    public string Sha256 { get; set; } = string.Empty;

    // application/pdf or the DOCX type.
    public string ContentType { get; set; } = string.Empty;

    public long SizeBytes { get; set; }

    // Where the bytes are kept (see IFileStorage). Never sent to the browser.
    public string StorageKey { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }

    public List<ResumeVersion> Versions { get; set; } = [];
}
