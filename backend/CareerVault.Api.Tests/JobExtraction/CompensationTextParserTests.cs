using CareerVault.Api.Services.JobExtraction;

namespace CareerVault.Api.Tests.JobExtraction;

public class CompensationTextParserTests
{
    [Theory]
    // The examples from the task.
    [InlineData("Compensation Range: $40.00 per hour", "$40.00/hr")]
    [InlineData("Salary Range: $75,000 - $85,000 per year", "$75,000–$85,000/yr")]
    [InlineData("Pay: $25/hour", "$25/hr")]
    [InlineData("Hourly Rate: $30.00", "$30.00/hr")]
    [InlineData("Annual Salary: $80,000 - $95,000", "$80,000–$95,000/yr")]
    // Variations in capitals, spacing, separators and currencies.
    [InlineData("COMPENSATION RANGE:$40.00 PER HOUR", "$40.00/hr")]
    [InlineData("salary range: $75,000–$85,000 annually", "$75,000–$85,000/yr")]
    [InlineData("Salary: $75,000 to $85,000 a year", "$75,000–$85,000/yr")]
    [InlineData("Pay range: $ 75,000 — 85,000 USD per year", "$75,000–$85,000/yr")]
    [InlineData("Salary: $120k - $150k", "$120k–$150k")]
    [InlineData("Base pay: £45,000 per annum", "£45,000/yr")]
    [InlineData("Compensation: USD 6,500 per month", "USD 6,500/mo")]
    [InlineData("Wage: $900 per week", "$900/wk")]
    [InlineData("The base salary range for this role is $110,000 - $130,000.", "$110,000–$130,000")]
    [InlineData("Compensation: $40/hour plus bonus eligibility", "$40/hr")]
    // Currency codes after the amounts (as Workday writes them).
    [InlineData("Base Pay Range: $95,000 USD - $120,000 USD", "$95,000–$120,000")]
    [InlineData("Salary Range: $75,000 USD - $85,000 USD per year", "$75,000–$85,000/yr")]
    public void Recognises_common_ways_of_writing_pay(string text, string expected)
    {
        Assert.Equal(expected, CompensationTextParser.Find(text));
    }

    [Theory]
    // No pay period in the text: the amount is kept without one.
    [InlineData("Salary Range: $75,000 - $85,000", "$75,000–$85,000")]
    [InlineData("Compensation: $5,000", "$5,000")]
    public void Does_not_invent_a_pay_period(string text, string expected)
    {
        Assert.Equal(expected, CompensationTextParser.Find(text));
    }

    [Fact]
    public void Lists_several_ranges_in_order_without_duplicates()
    {
        var text = """
            New York salary range: $120,000 - $140,000 per year
            Chicago salary range: $110,000 - $130,000 per year
            New York salary range: $120,000 - $140,000 per year
            """;

        Assert.Equal("$120,000–$140,000/yr; $110,000–$130,000/yr", CompensationTextParser.Find(text));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("A great place to work. Apply today!")]
    [InlineData("Salary is competitive and depends on experience.")]
    public void Returns_nothing_when_no_pay_is_stated(string? text)
    {
        Assert.Null(CompensationTextParser.Find(text));
    }

    [Theory]
    [InlineData("We manage $97 billion in assets for clients worldwide.")]
    [InlineData("The company raised $20 million last year.")]
    [InlineData("We pay a $1,000 referral bonus for every hire.")]
    [InlineData("Compensation includes a $500 home-office stipend.")]
    [InlineData("We pay up to $5,000 in relocation costs.")]
    [InlineData("Our 401(k) matches up to $3,000. Pay is competitive.")]
    [InlineData("Salary: competitive. Office budget: $2,000 per year.")]
    [InlineData("Our firm has $2M in revenue.")]
    // A range missing its minimum (seen on a real page) isn't guessed at.
    [InlineData("Base Pay Range: $ USD - $154,500 USD")]
    public void Ignores_dollar_amounts_that_are_not_the_jobs_pay(string text)
    {
        Assert.Null(CompensationTextParser.Find(text));
    }

    [Fact]
    public void Finds_the_pay_among_unrelated_amounts()
    {
        var text = "We manage $97 billion in assets.\nCompensation Range: $40.00 per hour\nWe pay a $1,000 referral bonus.";
        Assert.Equal("$40.00/hr", CompensationTextParser.Find(text));
    }
}
