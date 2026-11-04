using System.Net;
using CareerVault.Api.Services.JobExtraction;

namespace CareerVault.Api.Tests.JobExtraction;

public class UrlSafetyTests
{
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not a url")]
    [InlineData("/relative/path")]
    [InlineData("ftp://example.com/job")]
    [InlineData("file:///etc/passwd")]
    [InlineData("javascript:alert(1)")]
    [InlineData("mailto:jobs@example.com")]
    [InlineData("gopher://example.com/")]
    public void Non_http_urls_are_invalid(string url)
    {
        Assert.Equal(JobExtractionError.InvalidUrl, UrlSafety.CheckUrl(url).Error);
    }

    [Theory]
    [InlineData("http://localhost/")]
    [InlineData("http://LOCALHOST/jobs")]
    [InlineData("http://app.localhost/")]
    [InlineData("http://printer.local/")]
    [InlineData("http://db.internal/")]
    [InlineData("http://intranet/")]
    [InlineData("http://127.0.0.1/")]
    [InlineData("http://127.1.2.3/")]
    [InlineData("http://10.1.2.3/")]
    [InlineData("http://172.16.0.5/")]
    [InlineData("http://172.31.255.255/")]
    [InlineData("http://192.168.1.1/")]
    [InlineData("http://169.254.169.254/latest/meta-data/")]
    [InlineData("http://100.64.0.1/")]
    [InlineData("http://0.0.0.0/")]
    [InlineData("http://[::1]/")]
    [InlineData("http://[fe80::1]/")]
    [InlineData("http://[fd12:3456::1]/")]
    [InlineData("http://[::ffff:127.0.0.1]/")]
    [InlineData("http://2130706433/")]
    [InlineData("https://user:password@example.com/")]
    [InlineData("https://example.com:8080/")]
    [InlineData("http://example.com:22/")]
    public void Local_private_and_unusual_destinations_are_blocked(string url)
    {
        Assert.Equal(JobExtractionError.BlockedUrl, UrlSafety.CheckUrl(url).Error);
    }

    [Theory]
    [InlineData("https://boards.greenhouse.io/acme/jobs/123")]
    [InlineData("http://example.com/job?id=5")]
    [InlineData("https://careers.example.co.uk:443/role")]
    [InlineData("https://93.184.216.34/")]
    public void Public_web_urls_are_allowed(string url)
    {
        var (uri, error) = UrlSafety.CheckUrl(url);
        Assert.Equal(JobExtractionError.None, error);
        Assert.NotNull(uri);
    }

    [Theory]
    [InlineData("8.8.8.8", true)]
    [InlineData("93.184.216.34", true)]
    [InlineData("2606:4700:4700::1111", true)]
    [InlineData("64:ff9b::808:808", true)]       // NAT64 of 8.8.8.8
    [InlineData("127.0.0.1", false)]
    [InlineData("10.0.0.1", false)]
    [InlineData("172.20.1.1", false)]
    [InlineData("192.168.0.10", false)]
    [InlineData("169.254.169.254", false)]
    [InlineData("100.100.100.100", false)]
    [InlineData("224.0.0.1", false)]
    [InlineData("255.255.255.255", false)]
    [InlineData("::1", false)]
    [InlineData("::", false)]
    [InlineData("fe80::abcd", false)]
    [InlineData("fc00::1", false)]
    [InlineData("ff02::1", false)]
    [InlineData("::ffff:10.0.0.1", false)]        // IPv4 inside IPv6
    [InlineData("64:ff9b::7f00:1", false)]       // NAT64 of 127.0.0.1
    public void Only_public_addresses_count_as_public(string address, bool expected)
    {
        Assert.Equal(expected, UrlSafety.IsPublicAddress(IPAddress.Parse(address)));
    }

    [Fact]
    public async Task A_host_name_is_refused_if_any_of_its_addresses_is_private()
    {
        var resolver = new FakeHostResolver(new()
        {
            ["public.example"] = ["93.184.216.34", "2606:4700::1"],
            ["mixed.example"] = ["93.184.216.34", "10.0.0.5"],
            ["empty.example"] = [],
        });

        Assert.NotNull(await UrlSafety.ResolvePublicAddressesAsync("public.example", resolver, default));
        Assert.Null(await UrlSafety.ResolvePublicAddressesAsync("mixed.example", resolver, default));
        Assert.Null(await UrlSafety.ResolvePublicAddressesAsync("empty.example", resolver, default));
    }
}
