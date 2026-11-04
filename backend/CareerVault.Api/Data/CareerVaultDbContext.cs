// IdentityDbContext<ApplicationUser> 
// gives us Identity's user and security tables.



// DbSet<JobApplication> gives us access to our job applications table.

using CareerVault.Api.Identity;
using CareerVault.Api.Models;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace CareerVault.Api.Data;

// Connects our C# models to the PostgreSQL database.
public class CareerVaultDbContext : IdentityDbContext<ApplicationUser>
{
    // Receives the database settings from Program.cs.
    public CareerVaultDbContext(
        DbContextOptions<CareerVaultDbContext> options)
        : base(options)
    {
    }

    // Represents the JobApplications table.
    public DbSet<JobApplication> JobApplications => Set<JobApplication>();

    // The user's resume library and its uploaded files (metadata only; the
    // files themselves are kept outside the database, see IFileStorage).
    public DbSet<Resume> Resumes => Set<Resume>();
    public DbSet<ResumeVersion> ResumeVersions => Set<ResumeVersion>();
    public DbSet<StoredFile> StoredFiles => Set<StoredFile>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // Each job application belongs to one user.
        builder.Entity<JobApplication>()
            .HasOne(job => job.User)
            .WithMany()
            .HasForeignKey(job => job.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Speeds up loading one user's jobs in their saved order.
        builder.Entity<JobApplication>()
            .HasIndex(job => new { job.UserId, job.SortOrder });

        // A job can point at one resume version. NoAction means the database
        // refuses to delete a version that a job still points at, so an
        // application can never lose its resume by accident. (ResumeService
        // only ever removes versions no application uses.)
        builder.Entity<JobApplication>()
            .HasOne(job => job.ResumeVersion)
            .WithMany()
            .HasForeignKey(job => job.ResumeVersionId)
            .OnDelete(DeleteBehavior.NoAction);

        // Each resume belongs to one user (deleted with the user).
        builder.Entity<Resume>(resume =>
        {
            resume.HasOne(r => r.User)
                .WithMany()
                .HasForeignKey(r => r.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            resume.Property(r => r.Name).HasMaxLength(Resume.MaxNameLength);
            resume.HasIndex(r => r.UserId);
        });

        builder.Entity<ResumeVersion>(version =>
        {
            // Versions of an older library resume belong to it (removed with
            // it). Uploads made straight to an application have no resume.
            version.HasOne(v => v.Resume)
                .WithMany(r => r.Versions)
                .HasForeignKey(v => v.ResumeId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Cascade);

            // Every upload points at one physical file. NoAction: the
            // database refuses to delete a file an upload still uses.
            version.HasOne(v => v.StoredFile)
                .WithMany(file => file.Versions)
                .HasForeignKey(v => v.StoredFileId)
                .OnDelete(DeleteBehavior.NoAction);

            // The owner, for direct ownership checks on downloads.
            version.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(v => v.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            version.Property(v => v.OriginalFileName).HasMaxLength(ResumeVersion.MaxFileNameLength);
            version.Property(v => v.ContentType).HasMaxLength(100);

            // A resume can't have two "version 2"s. (Uploads without a
            // resume have a null ResumeId, which the database doesn't
            // count as a duplicate.)
            version.HasIndex(v => new { v.ResumeId, v.VersionNumber }).IsUnique();
            version.HasIndex(v => v.UserId);
        });

        builder.Entity<StoredFile>(file =>
        {
            // Each stored file belongs to one user (deleted with the user).
            file.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(f => f.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            file.Property(f => f.Sha256).HasMaxLength(64);
            file.Property(f => f.ContentType).HasMaxLength(100);
            file.Property(f => f.StorageKey).HasMaxLength(200);

            // One copy per user per content: identical uploads by the same
            // user must reuse this row. The database enforces it, which also
            // makes two identical uploads at the same moment safe.
            file.HasIndex(f => new { f.UserId, f.Sha256 }).IsUnique();
            file.HasIndex(f => f.StorageKey).IsUnique();
        });
    }
}