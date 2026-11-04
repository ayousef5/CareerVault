namespace CareerVault.Api.DTOs;

// One entry in the Resume Library (GET /api/resumes/uploads): one unique
// file (identical uploads by the same user are one entry), with every
// application it's attached to. Where the file is stored is never sent to
// the browser; it's opened through GET /api/resume-versions/{VersionId}/file.
public class ResumeFileResponse
{
    // The physical file this entry stands for.
    public int StoredFileId { get; set; }

    // The most recent upload of this file: its name and date are shown, and
    // its id is used for preview and download.
    public int VersionId { get; set; }
    public string OriginalFileName { get; set; } = string.Empty;
    public DateTimeOffset UploadedAt { get; set; }

    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }

    // Every application using this file (empty for an older library resume
    // that isn't attached to any application).
    public List<ResumeFileApplicationResponse> Applications { get; set; } = [];
}

// An application a Library file is attached to.
public class ResumeFileApplicationResponse
{
    public int JobId { get; set; }
    public string CompanyName { get; set; } = string.Empty;
    public string JobTitle { get; set; } = string.Empty;
}
