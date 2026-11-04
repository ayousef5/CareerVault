using System.Net;
using System.Net.Sockets;

namespace CareerVault.Api.Services.JobExtraction;

// Rules that stop the server from being tricked into fetching internal or
// private addresses (server-side request forgery, "SSRF").
public static class UrlSafety
{
    // Only the normal web ports. Other ports are usually internal services.
    private static readonly int[] AllowedPorts = [80, 443];

    // Address ranges the server must never connect to.
    private static readonly IPNetwork[] BlockedNetworks =
    [
        // IPv4
        IPNetwork.Parse("0.0.0.0/8"),          // "this network"
        IPNetwork.Parse("10.0.0.0/8"),         // private
        IPNetwork.Parse("100.64.0.0/10"),      // carrier-grade NAT
        IPNetwork.Parse("127.0.0.0/8"),        // loopback (localhost)
        IPNetwork.Parse("169.254.0.0/16"),     // link-local (incl. cloud metadata 169.254.169.254)
        IPNetwork.Parse("172.16.0.0/12"),      // private
        IPNetwork.Parse("192.0.0.0/24"),       // IETF protocol assignments
        IPNetwork.Parse("192.0.2.0/24"),       // documentation
        IPNetwork.Parse("192.88.99.0/24"),     // 6to4 relay
        IPNetwork.Parse("192.168.0.0/16"),     // private
        IPNetwork.Parse("198.18.0.0/15"),      // benchmarking
        IPNetwork.Parse("198.51.100.0/24"),    // documentation
        IPNetwork.Parse("203.0.113.0/24"),     // documentation
        IPNetwork.Parse("224.0.0.0/4"),        // multicast
        IPNetwork.Parse("240.0.0.0/4"),        // reserved, incl. 255.255.255.255
        // IPv6
        IPNetwork.Parse("::/128"),             // unspecified
        IPNetwork.Parse("::1/128"),            // loopback
        IPNetwork.Parse("64:ff9b:1::/48"),     // local-use NAT64
        IPNetwork.Parse("100::/64"),           // discard
        IPNetwork.Parse("2001:db8::/32"),      // documentation
        IPNetwork.Parse("fc00::/7"),           // unique local (private)
        IPNetwork.Parse("fe80::/10"),          // link-local
        IPNetwork.Parse("fec0::/10"),          // old site-local
        IPNetwork.Parse("ff00::/8"),           // multicast
    ];

    // Checks the parts of a URL that don't need DNS: http(s) only, a real
    // host name, no "user:password@", only ports 80/443, and no obviously
    // local names. Returns the parsed URL, or the reason it's not allowed.
    public static (Uri? Uri, JobExtractionError Error) CheckUrl(string? text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 2048)
            return (null, JobExtractionError.InvalidUrl);

        if (!Uri.TryCreate(text.Trim(), UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || string.IsNullOrEmpty(uri.Host))
            return (null, JobExtractionError.InvalidUrl);

        return (uri, CheckUri(uri));
    }

    // The same checks for an already-parsed URL (used for every redirect).
    public static JobExtractionError CheckUri(Uri uri)
    {
        if (!uri.IsAbsoluteUri
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            return JobExtractionError.InvalidUrl;

        // "https://user:pass@site" can hide where a request really goes.
        if (!string.IsNullOrEmpty(uri.UserInfo))
            return JobExtractionError.BlockedUrl;

        if (!AllowedPorts.Contains(uri.Port))
            return JobExtractionError.BlockedUrl;

        var host = uri.IdnHost.TrimEnd('.').ToLowerInvariant();

        // A raw IP address in the URL must itself be public.
        if (IPAddress.TryParse(host.Trim('[', ']'), out var literal))
            return IsPublicAddress(literal) ? JobExtractionError.None : JobExtractionError.BlockedUrl;

        // Names that only exist on local or internal networks, including
        // single-word names like "intranet" or "db".
        if (host == "localhost" || host.EndsWith(".localhost")
            || host.EndsWith(".local") || host.EndsWith(".internal")
            || !host.Contains('.'))
            return JobExtractionError.BlockedUrl;

        return JobExtractionError.None;
    }

    // True only for addresses on the public internet.
    public static bool IsPublicAddress(IPAddress address)
    {
        // IPv4 written inside IPv6 (e.g. ::ffff:127.0.0.1): check the IPv4 part.
        if (address.IsIPv4MappedToIPv6)
            address = address.MapToIPv4();

        // NAT64 (64:ff9b::/96) also wraps an IPv4 address.
        if (address.AddressFamily == AddressFamily.InterNetworkV6
            && IPNetwork.Parse("64:ff9b::/96").Contains(address))
        {
            var bytes = address.GetAddressBytes();
            address = new IPAddress(bytes[12..]);
        }

        return !BlockedNetworks.Any(network => network.Contains(address));
    }

    // Resolves a host name and checks that every address it points to is
    // public. If any address is private, the whole host is refused, so a
    // name can't mix a public and an internal address.
    public static async Task<IPAddress[]?> ResolvePublicAddressesAsync(
        string host,
        IHostResolver resolver,
        CancellationToken cancellationToken)
    {
        IPAddress[] addresses = IPAddress.TryParse(host.Trim('[', ']'), out var literal)
            ? [literal]
            : await resolver.ResolveAsync(host, cancellationToken);

        if (addresses.Length == 0 || !addresses.All(IsPublicAddress))
            return null;

        return addresses;
    }
}

// Looks up the IP addresses for a host name. An interface so tests can
// pretend a name points anywhere.
public interface IHostResolver
{
    Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken);
}

// The real DNS lookup.
public sealed class DnsHostResolver : IHostResolver
{
    public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken) =>
        Dns.GetHostAddressesAsync(host, cancellationToken);
}
