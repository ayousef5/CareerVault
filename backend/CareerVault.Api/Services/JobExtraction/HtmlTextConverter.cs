using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;

namespace CareerVault.Api.Services.JobExtraction;

// Turns job description HTML into readable plain text, keeping paragraphs,
// line breaks and list items ("• item"). Scripts, styles and similar
// elements are dropped; nothing is ever run.
public static partial class HtmlTextConverter
{
    // The longest description we keep (about 25 pages of text).
    public const int MaxDescriptionLength = 100_000;

    private static readonly HtmlParser Parser = new(new HtmlParserOptions { IsScripting = false });

    // Elements whose content is never part of the readable text.
    private static readonly HashSet<string> SkippedElements =
    [
        "script", "style", "noscript", "template", "svg", "head", "iframe",
        "object", "button", "form", "select", "input", "textarea",
    ];

    // Elements that start a new paragraph.
    private static readonly HashSet<string> BlockElements =
    [
        "p", "div", "section", "article", "header", "footer", "main", "aside",
        "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "tr",
        "blockquote", "pre", "dl", "dt", "dd", "figure", "hr",
    ];

    // Converts an HTML snippet (or plain text) into readable text.
    // Returns null if nothing readable is left.
    public static string? FromHtml(string? html)
    {
        if (string.IsNullOrWhiteSpace(html))
            return null;

        // Some sites send the HTML escaped once more ("&lt;p&gt;...").
        if (!html.Contains('<') && html.Contains("&lt;"))
            html = WebUtility.HtmlDecode(html);

        // Plain text: just tidy up the spacing, keeping its line breaks.
        if (!LooksLikeHtml().IsMatch(html))
            return Normalize(WebUtility.HtmlDecode(html));

        var document = Parser.ParseDocument($"<body>{html}</body>");
        return document.Body is null ? null : FromNode(document.Body);
    }

    // Converts an element already on a parsed page into readable text.
    public static string? FromNode(INode node)
    {
        var text = new StringBuilder();
        Append(node, text);
        return Normalize(text.ToString());
    }

    private static void Append(INode node, StringBuilder text)
    {
        if (node is IText textNode)
        {
            // In HTML, any run of spaces and line breaks shows as one space.
            text.Append(Whitespace().Replace(textNode.Data, " "));
            return;
        }

        if (node is not IElement element)
        {
            foreach (var child in node.ChildNodes)
                Append(child, text);
            return;
        }

        var name = element.LocalName;
        if (SkippedElements.Contains(name))
            return;

        if (name == "br")
        {
            text.Append('\n');
            return;
        }

        if (name == "li")
        {
            // Numbered for <ol>, bullets otherwise.
            var marker = element.ParentElement?.LocalName == "ol"
                ? $"{element.ParentElement.Children.Where(c => c.LocalName == "li").ToList().IndexOf(element) + 1}. "
                : "• ";
            StartNewLine(text);
            text.Append(marker);
            foreach (var child in element.ChildNodes)
                Append(child, text);
            StartNewLine(text);
            return;
        }

        var isBlock = BlockElements.Contains(name);
        if (isBlock)
            text.Append("\n\n");

        foreach (var child in element.ChildNodes)
            Append(child, text);

        if (name is "td" or "th")
            text.Append(' ');

        if (isBlock)
            text.Append("\n\n");
    }

    // Moves to a new line unless already at the start of one, so list items
    // sit on consecutive lines without blank lines between them.
    private static void StartNewLine(StringBuilder text)
    {
        if (text.Length > 0 && text[^1] != '\n')
            text.Append('\n');
    }

    // Trims every line, keeps at most one blank line between paragraphs,
    // and caps the length.
    private static string? Normalize(string text)
    {
        var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n')
            .Select(line => SpacesAndTabs().Replace(line, " ").Trim());

        var result = BlankLines().Replace(string.Join('\n', lines), "\n\n").Trim();
        if (result.Length == 0)
            return null;

        return result.Length > MaxDescriptionLength ? result[..MaxDescriptionLength] : result;
    }

    [GeneratedRegex(@"<\s*[a-zA-Z!/]")]
    private static partial Regex LooksLikeHtml();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"[ \t ]+")]
    private static partial Regex SpacesAndTabs();

    [GeneratedRegex(@"\n{3,}")]
    private static partial Regex BlankLines();
}
