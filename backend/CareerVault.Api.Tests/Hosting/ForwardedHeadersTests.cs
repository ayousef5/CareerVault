using System.Net;
using CareerVault.Api.Hosting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace CareerVault.Api.Tests.Hosting;

// X-Forwarded-For / -Proto are only believed from private-network proxies
// (Azure's ingress), and only the last hop is read.
public class ForwardedHeadersTests
{
    private static ForwardedHeadersOptions Options(Dictionary<string, string?>? settings = null)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings ?? []).Build();
        var options = new ForwardedHeadersOptions();
        ForwardedHeadersSetup.Configure(options, configuration);
        return options;
    }

    // Runs the real middleware on one request; returns what the app then sees.
    private static async Task<(string Scheme, string? ClientAddress)> SendAsync(
        ForwardedHeadersOptions options, string peerAddress, string? forwardedFor, string? forwardedProto)
    {
        var context = new DefaultHttpContext();
        context.Request.Scheme = "http";
        context.Connection.RemoteIpAddress = IPAddress.Parse(peerAddress);
        if (forwardedFor is not null)
            context.Request.Headers["X-Forwarded-For"] = forwardedFor;
        if (forwardedProto is not null)
            context.Request.Headers["X-Forwarded-Proto"] = forwardedProto;

        var middleware = new ForwardedHeadersMiddleware(_ => Task.CompletedTask, NullLoggerFactory.Instance, Microsoft.Extensions.Options.Options.Create(options));
        await middleware.Invoke(context);
        return (context.Request.Scheme, context.Connection.RemoteIpAddress?.ToString());
    }

    [Theory]
    [InlineData("10.0.4.17")]
    [InlineData("100.100.3.9")]
    [InlineData("172.20.0.5")]
    [InlineData("::ffff:10.0.4.17")]
    public async Task Believes_the_ingress_proxy_on_a_private_network(string proxyAddress)
    {
        var (scheme, client) = await SendAsync(Options(), proxyAddress, "203.0.113.7", "https");

        Assert.Equal("https", scheme);
        Assert.Equal("203.0.113.7", client);
    }

    [Fact]
    public async Task Ignores_the_headers_from_anyone_else()
    {
        var (scheme, client) = await SendAsync(Options(), "198.51.100.9", "203.0.113.7", "https");

        Assert.Equal("http", scheme);
        Assert.Equal("198.51.100.9", client);
    }

    [Fact]
    public async Task Reads_only_the_address_the_proxy_added_not_what_the_client_sent()
    {
        // The client sent "X-Forwarded-For: 1.2.3.4"; the proxy appended the real address.
        var (_, client) = await SendAsync(Options(), "10.0.4.17", "1.2.3.4, 203.0.113.7", "https");

        Assert.Equal("203.0.113.7", client);
    }

    [Fact]
    public async Task Trusted_networks_can_be_configured()
    {
        var options = Options(new() { ["ForwardedHeaders:TrustedNetworks:0"] = "10.20.0.0/16" });

        Assert.Equal("https", (await SendAsync(options, "10.20.1.1", "203.0.113.7", "https")).Scheme);
        Assert.Equal("http", (await SendAsync(options, "10.30.1.1", "203.0.113.7", "https")).Scheme);
    }

    [Fact]
    public void A_mistyped_network_stops_startup()
    {
        Assert.ThrowsAny<FormatException>(() => Options(new() { ["ForwardedHeaders:TrustedNetworks:0"] = "10.0.0.0/99" }));
    }

    [Fact]
    public void Only_client_address_and_scheme_are_forwarded_one_hop()
    {
        var options = Options();

        Assert.Equal(ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto, options.ForwardedHeaders);
        Assert.Equal(1, options.ForwardLimit);
        Assert.Empty(options.KnownProxies);
    }
}
