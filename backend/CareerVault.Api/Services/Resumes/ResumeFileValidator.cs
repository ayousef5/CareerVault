using System.IO.Compression;
using System.Text;

namespace CareerVault.Api.Services.Resumes;

// Settings for resume uploads ("Resumes" in appsettings).
public sealed class ResumeOptions
{
    // The largest file accepted (10 MB).
    public long MaxFileBytes { get; init; } = 10 * 1024 * 1024;
}

// The two kinds of files a resume can be.
public static class ResumeContentTypes
{
    public const string Pdf = "application/pdf";
    public const string Docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

// The result of checking an uploaded file: the detected content type, or
// a message explaining why it was refused.
public sealed record ResumeFileCheck(string? ContentType, string? Error)
{
    public bool IsValid => Error is null;
}

// Decides whether an uploaded file is an acceptable resume. The type is
// worked out from the file's own bytes, never from what the browser says:
//  - PDF: starts with "%PDF-".
//  - DOCX: a ZIP file containing word/document.xml, whose content types
//    say it's a normal Word document (macro-enabled .docm is refused).
// The file's extension must also match (.pdf / .docx).
public static class ResumeFileValidator
{
    public const string WrongTypeMessage = "Only PDF and Word (.docx) files can be uploaded.";

    // The Word document type as listed inside a .docx file.
    private const string WordMainPart = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

    // [Content_Types].xml is tiny; anything bigger is suspicious.
    private const int MaxContentTypesBytes = 1024 * 1024;

    // Checks a file without reading all of it into memory: a PDF needs only
    // its first bytes, a Word file only its list of entries and its small
    // content-types part. "content" must be seekable (an uploaded form file
    // is); it's left at position 0 afterwards.
    public static async Task<ResumeFileCheck> CheckAsync(
        Stream content,
        string fileName,
        ResumeOptions options,
        CancellationToken cancellationToken = default)
    {
        if (!content.CanSeek)
            throw new ArgumentException("The upload must be seekable.", nameof(content));

        try
        {
            if (content.Length == 0)
                return new ResumeFileCheck(null, "The file is empty.");

            if (content.Length > options.MaxFileBytes)
                return new ResumeFileCheck(null, $"The file is larger than {options.MaxFileBytes / (1024 * 1024)} MB.");

            var extension = Path.GetExtension(fileName).ToLowerInvariant();

            if (extension == ".pdf" && await StartsWithAsync(content, "%PDF-"u8.ToArray(), cancellationToken))
                return new ResumeFileCheck(ResumeContentTypes.Pdf, null);

            if (extension == ".docx" && await IsDocxAsync(content, cancellationToken))
                return new ResumeFileCheck(ResumeContentTypes.Docx, null);

            return new ResumeFileCheck(null, WrongTypeMessage);
        }
        finally
        {
            content.Position = 0;
        }
    }

    // True when the stream begins with exactly these bytes.
    private static async Task<bool> StartsWithAsync(Stream content, byte[] prefix, CancellationToken cancellationToken)
    {
        content.Position = 0;
        var buffer = new byte[prefix.Length];
        var read = await content.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false, cancellationToken);
        return read == prefix.Length && buffer.AsSpan().SequenceEqual(prefix);
    }

    private static async Task<bool> IsDocxAsync(Stream content, CancellationToken cancellationToken)
    {
        // Every ZIP file starts with "PK\x03\x04".
        if (!await StartsWithAsync(content, "PK\u0003\u0004"u8.ToArray(), cancellationToken))
            return false;

        try
        {
            content.Position = 0;
            await using var zip = await ZipArchive.CreateAsync(
                content, ZipArchiveMode.Read, leaveOpen: true, entryNameEncoding: null, cancellationToken);

            // Only the list of entries is read; nothing is unpacked except
            // the small content-types file.
            if (zip.GetEntry("word/document.xml") is null)
                return false;

            var contentTypes = zip.GetEntry("[Content_Types].xml");
            if (contentTypes is null || contentTypes.Length > MaxContentTypesBytes)
                return false;

            await using var entry = await contentTypes.OpenAsync(cancellationToken);
            using var reader = new StreamReader(entry, Encoding.UTF8);
            var text = await reader.ReadToEndAsync(cancellationToken);
            return text.Contains(WordMainPart, StringComparison.Ordinal);
        }
        catch (InvalidDataException)
        {
            // Not a readable ZIP file.
            return false;
        }
    }

    // Makes a file name safe to show and store: no folders, no control
    // characters, not too long. Falls back to "resume" + the extension.
    public static string CleanFileName(string? fileName, string contentType)
    {
        var extension = contentType == ResumeContentTypes.Docx ? ".docx" : ".pdf";

        // Browsers sometimes send a full path ("C:\Users\me\cv.pdf").
        var name = (fileName ?? "").Replace('\\', '/');
        name = name[(name.LastIndexOf('/') + 1)..];
        name = new string(name.Where(c => !char.IsControl(c)).ToArray()).Trim();

        if (name.Length == 0 || name == extension)
            name = "resume" + extension;

        if (name.Length > Models.ResumeVersion.MaxFileNameLength)
            name = name[..(Models.ResumeVersion.MaxFileNameLength - extension.Length)] + extension;

        return name;
    }
}
