using System.IO.Compression;
using System.Text;

namespace CareerVault.Api.Tests.Resumes;

// Small, valid (and deliberately invalid) files for upload tests.
public static class ResumeTestFiles
{
    // The smallest thing that counts as a PDF here: it starts with "%PDF-".
    public static byte[] Pdf(string text = "Jane Doe resume") =>
        Encoding.ASCII.GetBytes($"%PDF-1.7\n% {text}\n%%EOF\n");

    // A minimal Word document (a ZIP with the parts Word needs).
    public static byte[] Docx(string mainContentType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        bool includeDocument = true)
    {
        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            Write(zip, "[Content_Types].xml",
                $"""<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="{mainContentType}"/></Types>""");
            if (includeDocument)
            {
                Write(zip, "word/document.xml",
                    """<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Jane Doe</w:t></w:r></w:p></w:body></w:document>""");
            }
        }
        return buffer.ToArray();
    }

    // A macro-enabled Word document (.docm), which isn't accepted.
    public static byte[] Docm() =>
        Docx("application/vnd.ms-word.document.macroEnabled.main+xml");

    private static void Write(ZipArchive zip, string name, string content)
    {
        using var writer = new StreamWriter(zip.CreateEntry(name).Open(), Encoding.UTF8);
        writer.Write(content);
    }
}
