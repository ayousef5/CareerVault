using System.Security.Cryptography;
using CareerVault.Api.Data;
using CareerVault.Api.Models;
using CareerVault.Api.Services.Resumes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging.Abstractions;

namespace CareerVault.Api.Tests.Resumes;

// Tests ResumeService directly, for cases that are hard to create through
// HTTP: uploads that arrive as a one-way stream, and losing the race to
// store an identical file (the database's unique index refusing the insert).
public class ResumeServiceTests
{
    private const string UserId = "user-1";

    private sealed class Setup : IAsyncDisposable
    {
        public InMemoryDatabaseRoot Root { get; } = new();
        public string Name { get; } = $"ResumeServiceTests-{Guid.NewGuid()}";
        public InMemoryFileStorage Storage { get; } = new();
        public CareerVaultDbContext Db { get; }
        public ResumeService Service { get; }

        public Setup(ResumeOptions? options = null, IInterceptor? interceptor = null)
        {
            Db = NewContext(interceptor);
            Service = new ResumeService(Db, Storage, options ?? new ResumeOptions(), NullLogger<ResumeService>.Instance);
        }

        // Another connection to the same test database.
        public CareerVaultDbContext NewContext(IInterceptor? interceptor = null)
        {
            var builder = new DbContextOptionsBuilder<CareerVaultDbContext>().UseInMemoryDatabase(Name, Root);
            if (interceptor is not null)
                builder.AddInterceptors(interceptor);
            return new CareerVaultDbContext(builder.Options);
        }

        public async Task<JobApplication> AddJobAsync()
        {
            var job = new JobApplication { UserId = UserId, CompanyName = "Google", SortOrder = 1 };
            Db.JobApplications.Add(job);
            await Db.SaveChangesAsync();
            return job;
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    // A stream that can only be read once, front to back (like a network
    // stream), and doesn't know its length.
    private sealed class OneWayStream(byte[] content) : Stream
    {
        private readonly MemoryStream _inner = new(content);
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => _inner.Read(buffer, offset, count);
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    private sealed class UnreadableStream : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => throw new InvalidOperationException("Read when it shouldn't be.");
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    [Fact]
    public async Task Accepts_an_upload_that_can_only_be_read_once()
    {
        await using var setup = new Setup();
        var job = await setup.AddJobAsync();
        var pdf = ResumeTestFiles.Pdf("one-way");

        // Length 0: the size isn't known up front.
        var result = await setup.Service.AttachAsync(UserId, job, "cv.pdf", new OneWayStream(pdf), 0, CancellationToken.None);

        Assert.Equal(ResumeOutcome.Ok, result.Outcome);
        var stored = Assert.Single(await setup.Db.StoredFiles.ToListAsync());
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(pdf)), stored.Sha256);
        Assert.Equal(pdf.Length, stored.SizeBytes);
        Assert.Equal(pdf, setup.Storage.Files[stored.StorageKey]);
    }

    [Fact]
    public async Task Refuses_a_one_way_upload_that_turns_out_too_large()
    {
        await using var setup = new Setup(new ResumeOptions { MaxFileBytes = 1_000 });
        var job = await setup.AddJobAsync();
        var big = ResumeTestFiles.Pdf(new string('x', 5_000));

        var result = await setup.Service.AttachAsync(UserId, job, "cv.pdf", new OneWayStream(big), 0, CancellationToken.None);

        Assert.Equal(ResumeOutcome.Invalid, result.Outcome);
        Assert.Empty(setup.Storage.Files);
        Assert.Empty(await setup.Db.StoredFiles.ToListAsync());
    }

    [Fact]
    public async Task Refuses_an_upload_whose_stated_size_is_too_large_without_reading_it()
    {
        await using var setup = new Setup(new ResumeOptions { MaxFileBytes = 1_000 });
        var job = await setup.AddJobAsync();

        // Reading this stream would fail, so passing shows it's never read.
        var result = await setup.Service.AttachAsync(UserId, job, "cv.pdf", new UnreadableStream(), 5_000, CancellationToken.None);

        Assert.Equal(ResumeOutcome.Invalid, result.Outcome);
        Assert.Empty(setup.Storage.Files);
    }

    // Pretends another request (e.g. on another server) stored the same file
    // at the same moment: just before this request's StoredFile is saved, the
    // "winner" is inserted, and the save fails as the unique index would.
    private sealed class LoseTheRaceInterceptor(Func<Task> insertWinner) : SaveChangesInterceptor
    {
        private bool _armed = true;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            var addsStoredFile = eventData.Context!.ChangeTracker.Entries<StoredFile>()
                .Any(entry => entry.State == EntityState.Added);
            if (_armed && addsStoredFile)
            {
                _armed = false;
                await insertWinner();
                throw new DbUpdateException("duplicate key value violates unique constraint \"IX_StoredFiles_UserId_Sha256\"");
            }
            return result;
        }
    }

    [Fact]
    public async Task Losing_the_race_reuses_the_winners_file_and_never_deletes_it()
    {
        var pdf = ResumeTestFiles.Pdf("raced");
        const string winnerKey = UserId + "/0123456789abcdef0123456789abcdef";
        Setup? setup = null;
        var interceptor = new LoseTheRaceInterceptor(async () =>
        {
            // The other request's file and row.
            setup!.Storage.Files[winnerKey] = pdf;
            await using var other = setup.NewContext();
            other.StoredFiles.Add(new StoredFile
            {
                UserId = UserId,
                Sha256 = Convert.ToHexStringLower(SHA256.HashData(pdf)),
                ContentType = ResumeContentTypes.Pdf,
                SizeBytes = pdf.Length,
                StorageKey = winnerKey,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await other.SaveChangesAsync();
        });
        setup = new Setup(interceptor: interceptor);
        await using var _ = setup;
        var job = await setup.AddJobAsync();

        var result = await setup.Service.AttachAsync(UserId, job, "cv.pdf", new MemoryStream(pdf), pdf.Length, CancellationToken.None);

        Assert.Equal(ResumeOutcome.Ok, result.Outcome);
        // The upload uses the winner's file...
        await using var check = setup.NewContext();
        var stored = Assert.Single(await check.StoredFiles.ToListAsync());
        Assert.Equal(winnerKey, stored.StorageKey);
        var version = await check.ResumeVersions.SingleAsync();
        Assert.Equal(stored.Id, version.StoredFileId);
        Assert.Equal(version.Id, (await check.JobApplications.SingleAsync()).ResumeVersionId);
        // ...the winner's bytes are untouched, and the extra copy was removed.
        Assert.Equal(winnerKey, Assert.Single(setup.Storage.Files.Keys));
        Assert.Equal(pdf, setup.Storage.Files[winnerKey]);
    }
}
