// CareerVault API: setup only. Endpoints live in Endpoints/, rules in
// Services/, database access in Data/.
using CareerVault.Api.Data;
using CareerVault.Api.Endpoints;
using CareerVault.Api.Hosting;
using CareerVault.Api.Identity;
using CareerVault.Api.Services.JobExtraction;
using CareerVault.Api.Services.Jobs;
using CareerVault.Api.Services.Resumes;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
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

// The keys that sign login tokens (ASP.NET Data Protection). In Azure they're
// kept in a private blob ("DataProtection:BlobUri"), so logins survive
// container restarts and work across replicas. Without that setting (local
// development, tests) they're kept on this machine as before.
var dataProtection = builder.Services.AddDataProtection().SetApplicationName("CareerVault");
if (Uri.TryCreate(builder.Configuration["DataProtection:BlobUri"], UriKind.Absolute, out var keysBlobUri))
{
    dataProtection.PersistKeysToAzureBlobStorage(keysBlobUri, AzureCredentials.Create(builder.Configuration));
}

// Health checks for Azure's probes: /health (the app is running) and
// /health/ready (it can also reach PostgreSQL).
builder.Services.AddHealthChecks()
    .AddDbContextCheck<CareerVaultDbContext>("database", tags: ["ready"]);

// Limits on login, job-posting reading and resume uploads (see Hosting/RateLimiting.cs).
builder.Services.AddCareerVaultRateLimiting(builder.Configuration);

// Trust X-Forwarded-For / -Proto only from Azure's ingress proxy
// (see Hosting/ForwardedHeadersSetup.cs).
builder.Services.Configure<ForwardedHeadersOptions>(options =>
    ForwardedHeadersSetup.Configure(options, builder.Configuration));

// Error responses in the standard "problem details" format (no internals).
builder.Services.AddProblemDetails();

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

// Production must have its database, CORS, storage and key settings; stop
// now with a clear message if any is missing (see Hosting/ProductionChecks.cs).
if (app.Environment.IsProduction())
{
    ProductionChecks.ThrowIfInvalid(app.Configuration);
}

// First, so everything below sees the real client address and scheme.
app.UseForwardedHeaders();

if (app.Environment.IsProduction())
{
    // Unexpected errors become a plain 500 problem response.
    app.UseExceptionHandler();
    // Azure's ingress serves HTTPS only; HSTS tells browsers to stay on it.
    app.UseHsts();
}
else
{
    app.UseHttpsRedirection();
}

// Registration and login endpoints (ASP.NET Identity) under /api/auth,
// rate limited per client address.
app.MapGroup("/api/auth")
    .RequireRateLimiting(RateLimiting.Auth)
    .MapIdentityApi<ApplicationUser>();

// Make API documentation available during development.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Apply the CORS policy. This must come before the endpoints are mapped below.
app.UseCors(FrontendCorsPolicy);

// Check who is making each request.
app.UseAuthentication();

// Check whether that user has permission.
app.UseAuthorization();

// After authentication, so uploads and extraction are limited per user.
app.UseRateLimiter();

// Health probes (no login needed; they only answer "Healthy" or "Unhealthy").
app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains("ready") });

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
