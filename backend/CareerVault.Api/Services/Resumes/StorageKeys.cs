using System.Text.RegularExpressions;

namespace CareerVault.Api.Services.Resumes;

// The format of stored-file keys, shared by every IFileStorage:
// "{ownerId}/{32 lowercase hex characters}". Keys are always generated here,
// never derived from a user's file name, and only keys in exactly this format
// are ever accepted, so a key can't point outside the owner's files.
public static partial class StorageKeys
{
    // A new random key for one of this owner's files.
    public static string New(string ownerId)
    {
        if (!OwnerIdPattern().IsMatch(ownerId))
            throw new ArgumentException("Invalid owner id.", nameof(ownerId));
        return $"{ownerId}/{Guid.NewGuid():N}";
    }

    public static bool IsValid(string key) => KeyPattern().IsMatch(key);

    // Splits a valid key into its owner and file parts.
    public static (string Owner, string File) Parse(string key)
    {
        var match = KeyPattern().Match(key);
        if (!match.Success)
            throw new ArgumentException("Invalid storage key.", nameof(key));
        return (match.Groups["owner"].Value, match.Groups["file"].Value);
    }

    // ASP.NET Identity user ids are GUIDs. (\z, not $: no trailing newline.)
    [GeneratedRegex(@"^[A-Za-z0-9-]{1,64}\z")]
    private static partial Regex OwnerIdPattern();

    [GeneratedRegex(@"^(?<owner>[A-Za-z0-9-]{1,64})/(?<file>[a-f0-9]{32})\z")]
    private static partial Regex KeyPattern();
}
