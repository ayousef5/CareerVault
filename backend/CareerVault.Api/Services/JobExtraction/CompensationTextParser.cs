using System.Text.RegularExpressions;

namespace CareerVault.Api.Services.JobExtraction;

// Finds pay written as text in a job description, such as
// "Compensation Range: $40.00 per hour" or "Salary Range: $75,000 - $85,000".
// Used when a page has no structured pay data.
//
// To avoid mistaking other money for pay, an amount only counts when it
// follows a pay label (compensation, salary, pay, wage, hourly rate...) in
// the same sentence, and amounts about bonuses, assets, relocation and the
// like are ignored. The pay period (/hr, /yr...) is only added when the text
// says it; nothing is guessed.
public static partial class CompensationTextParser
{
    // At most this many separate pay values are kept.
    private const int MaxResults = 5;

    // Words after an amount that mean it isn't the job's pay.
    private static readonly string[] NotPayWords =
    [
        "bonus", "stipend", "reimburse", "referral", "relocation", "allowance",
        "credit", "budget", "assets", "revenue", "funding", "raised", "valuation",
    ];

    // Returns the pay found in the text, formatted like "$40.00/hr" or
    // "$75,000–$85,000/yr" (several values are joined with "; "), or null.
    public static string? Find(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;

        var results = new List<string>();

        foreach (Match match in PayPattern().Matches(text))
        {
            var between = match.Groups["between"].Value;
            var after = match.Groups["after"].Value;
            var context = $"{match.Groups["prefix"].Value} {match.Groups["label"].Value} {between} {after}";

            // "$97 billion" or "$2M" isn't pay.
            if (Magnitude().IsMatch(after))
                continue;

            // "pay a $1,000 referral bonus" isn't the job's pay, but
            // "$40/hour plus bonus" is: only the words between the label and
            // the amount, and the words describing the amount itself (up to
            // three, stopping at a pay period such as "hour"), are checked.
            if (MentionsNotPay(between) || DescribesNotPay(after))
                continue;

            var formatted = Format(match, context);
            if (!results.Contains(formatted))
                results.Add(formatted);

            if (results.Count == MaxResults)
                break;
        }

        return results.Count == 0 ? null : string.Join("; ", results);
    }

    private static bool MentionsNotPay(string text) =>
        NotPayWords.Any(word => text.Contains(word, StringComparison.OrdinalIgnoreCase));

    private static bool DescribesNotPay(string after)
    {
        foreach (var word in Words().Matches(after).Take(3).Select(match => match.Value))
        {
            if (Period(word) != "" || word.Equals("per", StringComparison.OrdinalIgnoreCase))
                return false;
            if (MentionsNotPay(word))
                return true;
        }
        return false;
    }

    private static string Format(Match match, string context)
    {
        var currencyCode = match.Groups["code"].Success ? match.Groups["code"].Value.ToUpperInvariant() : null;
        var min = FormatAmount(match.Groups["min"].Value, currencyCode);
        var max = match.Groups["max"].Success ? FormatAmount(match.Groups["max"].Value, currencyCode, symbolFrom: min) : null;

        var amount = max is not null && max != min ? $"{min}–{max}" : min;
        return amount + Period(context);
    }

    // "$ 75,000" → "$75,000"; "75,000" with "USD" → "USD 75,000". A range's
    // second amount borrows the first one's currency symbol if it has none.
    private static string FormatAmount(string raw, string? currencyCode, string? symbolFrom = null)
    {
        var amount = Whitespace().Replace(raw, "");

        // "USD6,500" → "USD 6,500".
        var code = CodePrefix().Match(amount);
        if (code.Success)
            return $"{code.Value.ToUpperInvariant()} {amount[code.Length..]}";

        if (char.IsDigit(amount[0]))
        {
            var symbol = symbolFrom is not null && !char.IsDigit(symbolFrom[0]) && !char.IsLetter(symbolFrom[0])
                ? symbolFrom[0].ToString()
                : null;
            amount = symbol is not null
                ? symbol + amount
                : currencyCode is not null ? $"{currencyCode} {amount}" : amount;
        }
        return amount;
    }

    // The pay period, only from words the text actually uses.
    private static string Period(string context)
    {
        var text = context.ToLowerInvariant();
        if (HourWords().IsMatch(text)) return "/hr";
        if (YearWords().IsMatch(text)) return "/yr";
        if (MonthWords().IsMatch(text)) return "/mo";
        if (WeekWords().IsMatch(text)) return "/wk";
        if (DayWords().IsMatch(text)) return "/day";
        return "";
    }

    // A pay label, then up to 40 characters that aren't digits, a "$" or the
    // end of a sentence, then an amount (with a currency symbol or code), an
    // optional second amount for a range (either may be followed by a code,
    // as in "$95,000 USD - $120,000 USD"), and a little text after it.
    [GeneratedRegex(
        """
        (?<prefix>\b(?:annual|annualized|yearly|hourly|monthly|weekly|base)\s+)?
        (?<label>\b(?:compensation|salary|salaries|base\s+pay|pay|wages?|hourly\s+rate|rate\s+of\s+pay)\b)
        (?<between>[^$£€\d\n.;]{0,40}?)
        (?<min>[$£€]\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?[kK]?\b
              |(?<code>USD|CAD|EUR|GBP|AUD)\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?[kK]?\b)
        (?:\s?(?:USD|CAD|EUR|GBP|AUD)\b)?
        (?:\s*(?:-|–|—|to)\s*
           (?<max>[$£€]?\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?[kK]?\b)
           (?:\s?(?:USD|CAD|EUR|GBP|AUD)\b)?)?
        (?<after>[^\n]{0,40})
        """,
        RegexOptions.IgnoreCase | RegexOptions.IgnorePatternWhitespace)]
    private static partial Regex PayPattern();

    [GeneratedRegex(@"^\s*(?:million|billion|mm\b|bn\b|m\b|b\b)", RegexOptions.IgnoreCase)]
    private static partial Regex Magnitude();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"[A-Za-z]+")]
    private static partial Regex Words();

    [GeneratedRegex(@"^[A-Za-z]{3}(?=\d)")]
    private static partial Regex CodePrefix();

    [GeneratedRegex(@"\b(?:hour|hours|hourly|hr|hrs)\b")]
    private static partial Regex HourWords();

    [GeneratedRegex(@"\b(?:year|years|yearly|annual|annually|annum|yr|yrs)\b")]
    private static partial Regex YearWords();

    [GeneratedRegex(@"\b(?:month|monthly|mo)\b")]
    private static partial Regex MonthWords();

    [GeneratedRegex(@"\b(?:week|weekly|wk)\b")]
    private static partial Regex WeekWords();

    [GeneratedRegex(@"\b(?:day|daily)\b")]
    private static partial Regex DayWords();
}
