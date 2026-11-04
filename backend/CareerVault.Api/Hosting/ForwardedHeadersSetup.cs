using Microsoft.AspNetCore.HttpOverrides;

namespace CareerVault.Api.Hosting;

// Azure Container Apps ends HTTPS at its ingress proxy and forwards plain
// HTTP to the container, adding X-Forwarded-For (the client's address) and
// X-Forwarded-Proto ("https"). The app needs those for the real client
// address (rate limiting) and scheme (HSTS), but must not believe them from
// just anyone:
//  - they're only accepted from proxies on private networks (the container
//    has no public address, so its direct callers are Azure's ingress),
//  - only the last hop is read (ForwardLimit = 1), the one the ingress added,
//    so values a client puts in its own request are ignored.
// The trusted networks can be changed with "ForwardedHeaders:TrustedNetworks".
public static class ForwardedHeadersSetup
{
    public static readonly string[] DefaultTrustedNetworks =
    [
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        // Carrier-grade NAT range, used by Azure's managed infrastructure.
        "100.64.0.0/10",
        "127.0.0.0/8",
        "::1/128",
    ];

    public static void Configure(ForwardedHeadersOptions options, IConfiguration configuration)
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = 1;

        var networks = configuration.GetSection("ForwardedHeaders:TrustedNetworks").Get<string[]>();
        if (networks is not { Length: > 0 })
            networks = DefaultTrustedNetworks;

        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();
        foreach (var network in networks)
        {
            // A typo stops the app at startup rather than trusting the wrong thing.
            options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network.Trim()));
        }
    }
}
