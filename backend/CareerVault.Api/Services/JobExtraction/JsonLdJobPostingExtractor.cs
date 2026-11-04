using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Html.Dom;

namespace CareerVault.Api.Services.JobExtraction;

// Reads schema.org "JobPosting" structured data (JSON-LD), which many job
// boards include for search engines. It's the most reliable source, so
// this extractor runs first.
public sealed partial class JsonLdJobPostingExtractor : IJobPostingExtractor
{
    private const int MaxDepth = 8;

    public ExtractedJob? Extract(IHtmlDocument document, Uri pageUrl)
    {
        foreach (var script in document.QuerySelectorAll("script[type='application/ld+json']"))
        {
            var posting = FindJobPosting(script.TextContent);
            if (posting is not null)
                return posting;
        }
        return null;
    }

    // Parses one JSON-LD block and reads the first JobPosting in it.
    private static ExtractedJob? FindJobPosting(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions
            {
                AllowTrailingCommas = true,
                CommentHandling = JsonCommentHandling.Skip,
                MaxDepth = 64,
            });

            return FindJobPostingElement(document.RootElement, 0) is { } posting
                ? ReadJobPosting(posting)
                : null;
        }
        catch (JsonException)
        {
            // Broken JSON on the page: ignore this block.
            return null;
        }
    }

    // Looks for an object whose @type is JobPosting, including inside
    // "@graph" lists and nested objects.
    private static JsonElement? FindJobPostingElement(JsonElement element, int depth)
    {
        if (depth > MaxDepth)
            return null;

        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                if (FindJobPostingElement(item, depth + 1) is { } found)
                    return found;
            }
            return null;
        }

        if (element.ValueKind != JsonValueKind.Object)
            return null;

        if (element.TryGetProperty("@type", out var type) && IsJobPostingType(type))
            return element;

        foreach (var property in element.EnumerateObject())
        {
            if (property.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array
                && FindJobPostingElement(property.Value, depth + 1) is { } found)
                return found;
        }
        return null;
    }

    private static bool IsJobPostingType(JsonElement type) => type.ValueKind switch
    {
        JsonValueKind.String => IsJobPostingName(type.GetString()),
        JsonValueKind.Array => type.EnumerateArray().Any(t =>
            t.ValueKind == JsonValueKind.String && IsJobPostingName(t.GetString())),
        _ => false,
    };

    // "JobPosting", "schema:JobPosting" or "https://schema.org/JobPosting".
    private static bool IsJobPostingName(string? name) =>
        name is not null && name.EndsWith("JobPosting", StringComparison.OrdinalIgnoreCase);

    private static ExtractedJob ReadJobPosting(JsonElement posting) => new()
    {
        JobTitle = CleanLine(GetText(posting, "title")),
        CompanyName = CleanLine(GetName(posting, "hiringOrganization")),
        Location = CleanLine(ReadLocation(posting)),
        Pay = ReadPay(posting),
        JobDescription = HtmlTextConverter.FromHtml(GetText(posting, "description")),
        // JobPosting has no "recruiter" field; a named application contact
        // is the closest thing. Nothing else is guessed.
        Recruiter = CleanLine(GetName(posting, "applicationContact")),
    };

    // ---------- Location ----------

    private static string? ReadLocation(JsonElement posting)
    {
        var places = new List<string>();

        if (posting.TryGetProperty("jobLocationType", out var locationType)
            && locationType.ValueKind == JsonValueKind.String
            && string.Equals(locationType.GetString(), "TELECOMMUTE", StringComparison.OrdinalIgnoreCase))
            places.Add("Remote");

        if (posting.TryGetProperty("jobLocation", out var jobLocation))
        {
            foreach (var place in AsList(jobLocation))
            {
                var text = place.ValueKind == JsonValueKind.String
                    ? place.GetString()
                    : FormatAddress(place.TryGetProperty("address", out var address) ? address : place);

                if (!string.IsNullOrWhiteSpace(text) && !places.Contains(text))
                    places.Add(text);
            }
        }

        return places.Count == 0 ? null : string.Join("; ", places);
    }

    // "City, Region", or the country if that's all there is.
    private static string? FormatAddress(JsonElement address)
    {
        if (address.ValueKind == JsonValueKind.String)
            return address.GetString();
        if (address.ValueKind != JsonValueKind.Object)
            return null;

        var parts = new[] { GetName(address, "addressLocality"), GetName(address, "addressRegion") }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .ToList();

        if (parts.Count == 0 && GetName(address, "addressCountry") is { } country)
            parts.Add(country);

        return parts.Count == 0 ? null : string.Join(", ", parts);
    }

    // ---------- Pay ----------

    // Formats baseSalary (or estimatedSalary) like "$120,000–$140,000/yr".
    private static string? ReadPay(JsonElement posting)
    {
        foreach (var name in new[] { "baseSalary", "estimatedSalary" })
        {
            if (!posting.TryGetProperty(name, out var salary))
                continue;

            foreach (var amount in AsList(salary))
            {
                if (FormatSalary(amount, posting) is { } text)
                    return text;
            }
        }
        return null;
    }

    private static string? FormatSalary(JsonElement salary, JsonElement posting)
    {
        // A plain number or text ("$50/hr") with no structure.
        if (salary.ValueKind is JsonValueKind.Number or JsonValueKind.String)
            return CleanLine(salary.ToString());
        if (salary.ValueKind != JsonValueKind.Object)
            return null;

        var currency = GetText(salary, "currency") ?? GetText(posting, "salaryCurrency");
        var value = salary.TryGetProperty("value", out var v) ? v : salary;

        decimal? min, max;
        string? unit = GetText(salary, "unitText");

        if (value.ValueKind == JsonValueKind.Object)
        {
            min = GetNumber(value, "minValue");
            max = GetNumber(value, "maxValue");
            var single = GetNumber(value, "value");
            if (min is null && max is null)
                min = single;
            unit = GetText(value, "unitText") ?? unit;
        }
        else
        {
            min = ToNumber(value);
            max = null;
        }

        if (min is null && max is null)
            return null;

        var amount = min is not null && max is not null && min != max
            ? $"{FormatMoney(min.Value, currency)}–{FormatMoney(max.Value, currency)}"
            : FormatMoney((min ?? max)!.Value, currency);

        return amount + FormatUnit(unit);
    }

    private static string FormatMoney(decimal amount, string? currency)
    {
        var number = amount % 1 == 0
            ? amount.ToString("N0", CultureInfo.InvariantCulture)
            : amount.ToString("N2", CultureInfo.InvariantCulture);

        return currency?.ToUpperInvariant() switch
        {
            null or "" => number,
            "USD" => $"${number}",
            "CAD" => $"CA${number}",
            "AUD" => $"A${number}",
            "EUR" => $"€{number}",
            "GBP" => $"£{number}",
            var code => $"{code} {number}",
        };
    }

    private static string FormatUnit(string? unit) => unit?.ToUpperInvariant() switch
    {
        "HOUR" => "/hr",
        "DAY" => "/day",
        "WEEK" => "/wk",
        "MONTH" => "/mo",
        "YEAR" => "/yr",
        _ => "",
    };

    // ---------- JSON helpers ----------

    // A property's text, or the first item's text if it's a list.
    private static string? GetText(JsonElement element, string property)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(property, out var value))
            return null;

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.ToString(),
            JsonValueKind.Array => value.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.String)
                .Select(item => item.GetString())
                .FirstOrDefault(),
            _ => null,
        };
    }

    // A property that is either text or an object with a "name".
    private static string? GetName(JsonElement element, string property)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(property, out var value))
            return null;

        foreach (var item in AsList(value))
        {
            if (item.ValueKind == JsonValueKind.String)
                return item.GetString();
            if (item.ValueKind == JsonValueKind.Object && GetText(item, "name") is { } name)
                return name;
        }
        return null;
    }

    private static decimal? GetNumber(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) ? ToNumber(value) : null;

    private static decimal? ToNumber(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Number when value.TryGetDecimal(out var number) => number,
        JsonValueKind.String when decimal.TryParse(
            value.GetString()?.Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) => parsed,
        _ => null,
    };

    private static IEnumerable<JsonElement> AsList(JsonElement value) =>
        value.ValueKind == JsonValueKind.Array ? value.EnumerateArray() : [value];

    // One-line fields: decode entities, drop tags, collapse spaces.
    internal static string? CleanLine(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;

        var cleaned = Whitespace().Replace(Tags().Replace(WebUtility.HtmlDecode(text), " "), " ").Trim();
        if (cleaned.Length == 0)
            return null;
        return cleaned.Length > 300 ? cleaned[..300] : cleaned;
    }

    [GeneratedRegex(@"<[^>]*>")]
    private static partial Regex Tags();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
