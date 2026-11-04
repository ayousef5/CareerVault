using System.Text;
using CareerVault.Api.Services.Resumes;

namespace CareerVault.Api.Tests.Resumes;

public class ResumeFileValidatorTests
{
    private static readonly ResumeOptions Options = new() { MaxFileBytes = 1_000 };

    // The validator works on streams (uploads are never read whole into memory).
    private static Task<ResumeFileCheck> CheckAsync(byte[] content, string fileName, ResumeOptions options) =>
        ResumeFileValidator.CheckAsync(new MemoryStream(content), fileName, options);

    // A stream that counts how many bytes were read from it.
    private sealed class CountingStream(byte[] content) : MemoryStream(content)
    {
        public long BytesRead { get; private set; }

        public override int Read(byte[] buffer, int offset, int count) => Counted(base.Read(buffer, offset, count));
        public override int Read(Span<byte> buffer) => Counted(base.Read(buffer));
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            Task.FromResult(Read(buffer, offset, count));
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(Read(buffer.Span));

        private int Counted(int read)
        {
            BytesRead += read;
            return read;
        }
    }

    [Fact]
    public async Task Checks_a_PDF_by_reading_only_its_first_bytes_and_rewinds_the_stream()
    {
        var bigPdf = ResumeTestFiles.Pdf(new string('x', 500_000));
        var stream = new CountingStream(bigPdf);

        var check = await ResumeFileValidator.CheckAsync(stream, "cv.pdf", new ResumeOptions());

        Assert.True(check.IsValid);
        Assert.True(stream.BytesRead < 100, $"Read {stream.BytesRead} bytes");
        // Ready to be read again (for the SHA-256 and storing).
        Assert.Equal(0, stream.Position);
    }

    [Fact]
    public async Task Checks_a_Word_document_without_reading_all_of_it()
    {
        // A .docx with a large extra part that the check doesn't need.
        using var buffer = new MemoryStream();
        buffer.Write(ResumeTestFiles.Docx());
        using (var zip = new System.IO.Compression.ZipArchive(buffer, System.IO.Compression.ZipArchiveMode.Update, leaveOpen: true))
        {
            using var writer = new StreamWriter(zip.CreateEntry("word/media/big.bin", System.IO.Compression.CompressionLevel.NoCompression).Open());
            writer.Write(new string('x', 400_000));
        }
        var stream = new CountingStream(buffer.ToArray());

        var check = await ResumeFileValidator.CheckAsync(stream, "cv.docx", new ResumeOptions());

        Assert.True(check.IsValid);
        Assert.True(stream.BytesRead < stream.Length / 2, $"Read {stream.BytesRead} of {stream.Length} bytes");
        Assert.Equal(0, stream.Position);
    }

    [Fact]
    public async Task Rewinds_the_stream_after_refusing_a_file_too()
    {
        var stream = new MemoryStream("just some text"u8.ToArray());

        var check = await ResumeFileValidator.CheckAsync(stream, "cv.pdf", new ResumeOptions());

        Assert.False(check.IsValid);
        Assert.Equal(0, stream.Position);
    }

    [Fact]
    public async Task Accepts_a_PDF()
    {
        var check = await CheckAsync(ResumeTestFiles.Pdf(), "cv.pdf", Options);

        Assert.True(check.IsValid);
        Assert.Equal(ResumeContentTypes.Pdf, check.ContentType);
    }

    [Fact]
    public async Task Accepts_a_Word_document()
    {
        var check = await CheckAsync(ResumeTestFiles.Docx(), "CV.DOCX", new ResumeOptions());

        Assert.True(check.IsValid);
        Assert.Equal(ResumeContentTypes.Docx, check.ContentType);
    }

    [Theory]
    // The name says PDF but the content doesn't (and the other way round).
    [InlineData("text", "cv.pdf")]
    [InlineData("pdf", "cv.docx")]
    [InlineData("docx", "cv.pdf")]
    [InlineData("pdf", "cv.txt")]
    [InlineData("pdf", "cv")]
    [InlineData("exe", "cv.pdf")]
    // Word files that aren't plain .docx documents.
    [InlineData("docm", "cv.docx")]
    [InlineData("zip", "cv.docx")]
    [InlineData("brokenzip", "cv.docx")]
    public async Task Refuses_files_that_are_not_really_PDF_or_DOCX(string kind, string fileName)
    {
        byte[] content = kind switch
        {
            "text" => Encoding.UTF8.GetBytes("just some text"),
            "pdf" => ResumeTestFiles.Pdf(),
            "docx" => ResumeTestFiles.Docx(),
            "docm" => ResumeTestFiles.Docm(),
            "zip" => ResumeTestFiles.Docx(includeDocument: false),
            "brokenzip" => [0x50, 0x4B, 0x03, 0x04, 0x00, 0x01, 0x02],
            _ => [0x4D, 0x5A, 0x90, 0x00], // an .exe starts with "MZ"
        };

        var check = await CheckAsync(content, fileName, new ResumeOptions());

        Assert.False(check.IsValid);
        Assert.Equal(ResumeFileValidator.WrongTypeMessage, check.Error);
    }

    [Fact]
    public async Task Refuses_an_empty_file()
    {
        Assert.Equal("The file is empty.", (await CheckAsync([], "cv.pdf", Options)).Error);
    }

    [Fact]
    public async Task Refuses_a_file_over_the_size_limit()
    {
        var big = ResumeTestFiles.Pdf(new string('x', 2_000));

        var check = await CheckAsync(big, "cv.pdf", new ResumeOptions { MaxFileBytes = 1024 * 1024 });
        Assert.True(check.IsValid);

        Assert.False((await CheckAsync(big, "cv.pdf", Options)).IsValid);
    }

    [Theory]
    [InlineData("cv.pdf", "cv.pdf")]
    [InlineData(@"C:\Users\jane\Documents\cv.pdf", "cv.pdf")]
    [InlineData("../../etc/cv.pdf", "cv.pdf")]
    [InlineData("  my\u0000 cv\n.pdf ", "my cv.pdf")]
    [InlineData("", "resume.pdf")]
    [InlineData(null, "resume.pdf")]
    [InlineData(".pdf", "resume.pdf")]
    public void Cleans_up_file_names(string? fileName, string expected)
    {
        Assert.Equal(expected, ResumeFileValidator.CleanFileName(fileName, ResumeContentTypes.Pdf));
    }

    [Fact]
    public void Shortens_very_long_file_names_but_keeps_the_extension()
    {
        var name = ResumeFileValidator.CleanFileName(new string('a', 400) + ".docx", ResumeContentTypes.Docx);

        Assert.Equal(255, name.Length);
        Assert.EndsWith(".docx", name);
    }
}
