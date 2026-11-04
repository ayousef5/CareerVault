using CareerVault.Api.DTOs;
using CareerVault.Api.Validation;

namespace CareerVault.Api.Tests;

public class JobValidationTests
{
    [Fact]
    public void A_job_with_only_default_values_is_empty()
    {
        Assert.False(JobValidation.HasMeaningfulContent(new CreateJobRequest()));
    }

    [Fact]
    public void Blank_text_and_the_default_status_in_any_case_are_empty()
    {
        var request = new CreateJobRequest
        {
            CompanyName = "   ",
            JobTitle = "",
            Location = " ",
            Notes = "\t",
            Status = " not applied ",
        };

        Assert.False(JobValidation.HasMeaningfulContent(request));
    }

    [Theory]
    [InlineData("company")]
    [InlineData("title")]
    [InlineData("location")]
    [InlineData("url")]
    [InlineData("date")]
    [InlineData("notes")]
    [InlineData("description")]
    [InlineData("pay")]
    [InlineData("recruiter")]
    [InlineData("status")]
    public void Any_single_filled_in_field_makes_a_job_valid(string field)
    {
        var request = new CreateJobRequest();
        switch (field)
        {
            case "company": request.CompanyName = "FedEx"; break;
            case "title": request.JobTitle = "Intern"; break;
            case "location": request.Location = "Memphis, TN"; break;
            case "url": request.JobUrl = "https://example.com"; break;
            case "date": request.DateApplied = new DateOnly(2026, 10, 25); break;
            case "notes": request.Notes = "Call back"; break;
            case "description": request.JobDescription = "C#"; break;
            case "pay": request.Pay = "25/hr"; break;
            case "recruiter": request.Recruiter = "Sam"; break;
            case "status": request.Status = "Applied"; break;
        }

        Assert.True(JobValidation.HasMeaningfulContent(request));
    }
}
