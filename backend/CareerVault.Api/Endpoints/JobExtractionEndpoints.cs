using CareerVault.Api.DTOs;
using CareerVault.Api.Services.JobExtraction;

namespace CareerVault.Api.Endpoints;

// POST /api/jobs/extract: reads job details from a posting URL.
// Thin on purpose: all the work is in JobExtractionService.
public static class JobExtractionEndpoints
{
    public static IEndpointRouteBuilder MapJobExtractionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/jobs/extract", ExtractAsync)
            // Logged-in users only, like the rest of /api/jobs.
            .RequireAuthorization();

        return app;
    }

    private static async Task<IResult> ExtractAsync(
        ExtractJobRequest request,
        IJobExtractionService extractionService,
        CancellationToken cancellationToken)
    {
        var result = await extractionService.ExtractAsync(request.Url, cancellationToken);

        if (result.Error == JobExtractionError.None && result.Job is not null)
        {
            var job = result.Job;
            return Results.Ok(new ExtractedJobResponse
            {
                Url = request.Url!.Trim(),
                CompanyName = job.CompanyName,
                JobTitle = job.JobTitle,
                Location = job.Location,
                Pay = job.Pay,
                JobDescription = job.JobDescription,
                Recruiter = job.Recruiter,
            });
        }

        // Friendly messages only: no internal details.
        var (status, message) = Describe(result.Error);
        return Results.Problem(detail: message, statusCode: status);
    }

    private static (int Status, string Message) Describe(JobExtractionError error) => error switch
    {
        JobExtractionError.InvalidUrl => (StatusCodes.Status400BadRequest,
            "Enter a full job posting link starting with http:// or https://."),
        JobExtractionError.BlockedUrl => (StatusCodes.Status400BadRequest,
            "This link can't be used. Only public websites are supported."),
        JobExtractionError.BlockedBySite => (StatusCodes.Status502BadGateway,
            "The job site doesn't allow automatic reading. Please enter the details manually."),
        JobExtractionError.Timeout => (StatusCodes.Status504GatewayTimeout,
            "The job site took too long to respond. Try again or enter the details manually."),
        JobExtractionError.NotHtml => (StatusCodes.Status422UnprocessableEntity,
            "That link isn't a web page CareerVault can read."),
        JobExtractionError.TooLarge => (StatusCodes.Status422UnprocessableEntity,
            "That page is too large to read."),
        JobExtractionError.NoJobDataFound => (StatusCodes.Status422UnprocessableEntity,
            "No job details were found on that page. Please enter them manually."),
        _ => (StatusCodes.Status502BadGateway,
            "The job posting couldn't be loaded. Check the link and try again."),
    };
}
