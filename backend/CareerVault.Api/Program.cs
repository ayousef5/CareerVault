// CareerVault API: setup only. Endpoints live in Endpoints/, rules in
// Services/, database access in Data/.
using CareerVault.Api.Data;
using CareerVault.Api.Endpoints;
using CareerVault.Api.Identity;
using CareerVault.Api.Services.JobExtraction;
using CareerVault.Api.Services.Jobs;
using CareerVault.Api.Services.Resumes;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Enable automatic API documentation.
builder.Services.AddOpenApi();

// Configure the PostgreSQL database connection ("ConnectionStrings:CareerVault").
builder.Services.AddDbContext<CareerVaultDbContext>(options =>
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("CareerVault")));

// Set up user accounts and connect them to PostgreSQL.
builder.Services
    .AddIdentityApiEndpoints<ApplicationUser>()
    .AddEntityFrameworkStores<CareerVaultDbContext>();

// Allow the API to check user permissions.
builder.Services.AddAuthorization();

// The rules for job applications (see Services/Jobs).
builder.Services.AddScoped<JobService>();

// Reading job details from job posting links (see Services/JobExtraction).
builder.Services.AddJobExtraction(builder.Configuration);

// The resume library and its file storage (see Services/Resumes).
builder.Services.AddResumes(builder.Configuration, builder.Environment);

// The name of our CORS policy, so we can refer to it in two places below.
const string FrontendCorsPolicy = "AllowFrontend";

// Where the React frontend runs ("Cors:FrontendOrigin"; the Vite dev
// server by default).
var frontendOrigin = builder.Configuration["Cors:FrontendOrigin"] ?? "http://localhost:5173";

// CORS (Cross-Origin Resource Sharing) lets the browser call this API
// from a different origin, such as the React dev server.
builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCorsPolicy, policy =>
    {
        // Only allow requests coming from the frontend.
        policy.WithOrigins(frontendOrigin)
            // Only allow the HTTP methods our API uses.
            .WithMethods("GET", "POST", "PUT", "DELETE")
            // JSON bodies and the login token.
            .WithHeaders("Content-Type", "Authorization");
    });
});

var app = builder.Build();

// Registration and login endpoints (ASP.NET Identity) under /api/auth.
app.MapGroup("/api/auth").MapIdentityApi<ApplicationUser>();

// Make API documentation available during development.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();

// Apply the CORS policy. This must come before the endpoints are mapped below.
app.UseCors(FrontendCorsPolicy);

// Check who is making each request.
app.UseAuthentication();

// Check whether that user has permission.
app.UseAuthorization();

// /api/jobs, including uploading a job's resume (see Endpoints/JobEndpoints.cs).
var resumeOptions = app.Services.GetRequiredService<ResumeOptions>();
app.MapJobEndpoints(resumeOptions);

// POST /api/jobs/extract (see Endpoints/JobExtractionEndpoints.cs).
app.MapJobExtractionEndpoints();

// The Resume Library list and resume file downloads (see Endpoints/ResumeEndpoints.cs).
app.MapResumeEndpoints();

app.Run();

// Lets the test project start this API in memory.
public partial class Program { }
