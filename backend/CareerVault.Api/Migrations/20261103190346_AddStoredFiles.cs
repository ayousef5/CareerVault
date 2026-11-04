using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace CareerVault.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddStoredFiles : Migration
    {
        // Moves where each resume file is stored from ResumeVersions into a
        // new StoredFiles table (one row per physical file), so identical
        // uploads by the same user can share one file. Nothing is deleted:
        //  1. create StoredFiles,
        //  2. create one StoredFile per (user, SHA-256) from the existing
        //     versions, keeping the oldest version's storage key,
        //  3. point every existing version at its StoredFile,
        //  4. only then drop the old StorageKey / Sha256 columns.
        // (If a user had uploaded the same bytes twice before this change,
        // the newer copy's physical file is simply no longer referenced; it
        // stays in storage untouched.)
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1. The new table and its rules.
            migrationBuilder.CreateTable(
                name: "StoredFiles",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    StorageKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoredFiles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StoredFiles_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StoredFiles_StorageKey",
                table: "StoredFiles",
                column: "StorageKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StoredFiles_UserId_Sha256",
                table: "StoredFiles",
                columns: new[] { "UserId", "Sha256" },
                unique: true);

            // 2. One StoredFile per existing (user, SHA-256).
            migrationBuilder.AddColumn<int>(
                name: "StoredFileId",
                table: "ResumeVersions",
                type: "integer",
                nullable: true);

            migrationBuilder.Sql("""
                INSERT INTO "StoredFiles" ("UserId", "Sha256", "ContentType", "SizeBytes", "StorageKey", "CreatedAt")
                SELECT DISTINCT ON ("UserId", "Sha256")
                       "UserId", "Sha256", "ContentType", "SizeBytes", "StorageKey", "UploadedAt"
                FROM "ResumeVersions"
                ORDER BY "UserId", "Sha256", "Id";
                """);

            // 3. Point every existing version at its StoredFile.
            migrationBuilder.Sql("""
                UPDATE "ResumeVersions" AS v
                SET "StoredFileId" = f."Id"
                FROM "StoredFiles" AS f
                WHERE f."UserId" = v."UserId" AND f."Sha256" = v."Sha256";
                """);

            migrationBuilder.AlterColumn<int>(
                name: "StoredFileId",
                table: "ResumeVersions",
                type: "integer",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ResumeVersions_StoredFileId",
                table: "ResumeVersions",
                column: "StoredFileId");

            // No ON DELETE rule (NO ACTION): a file an upload uses can't be deleted.
            migrationBuilder.AddForeignKey(
                name: "FK_ResumeVersions_StoredFiles_StoredFileId",
                table: "ResumeVersions",
                column: "StoredFileId",
                principalTable: "StoredFiles",
                principalColumn: "Id");

            // Uploads made straight to an application have no library resume.
            migrationBuilder.AlterColumn<int>(
                name: "ResumeId",
                table: "ResumeVersions",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            // 4. The old columns, now that their data lives in StoredFiles.
            migrationBuilder.DropIndex(
                name: "IX_ResumeVersions_StorageKey",
                table: "ResumeVersions");

            migrationBuilder.DropColumn(
                name: "Sha256",
                table: "ResumeVersions");

            migrationBuilder.DropColumn(
                name: "StorageKey",
                table: "ResumeVersions");
        }

        // Going back is only possible while every version still fits the old
        // design (each in a library resume, each with its own file). Once
        // resumes have been uploaded to applications, this stops with an
        // error instead of losing them.
        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM "ResumeVersions" WHERE "ResumeId" IS NULL)
                       OR EXISTS (SELECT 1 FROM "ResumeVersions" GROUP BY "StoredFileId" HAVING count(*) > 1) THEN
                        RAISE EXCEPTION 'Resumes have been uploaded to applications or share files; this migration cannot be undone without losing them.';
                    END IF;
                END $$;
                """);

            migrationBuilder.AddColumn<string>(
                name: "Sha256",
                table: "ResumeVersions",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StorageKey",
                table: "ResumeVersions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "ResumeVersions" AS v
                SET "Sha256" = f."Sha256", "StorageKey" = f."StorageKey"
                FROM "StoredFiles" AS f
                WHERE f."Id" = v."StoredFileId";
                """);

            migrationBuilder.AlterColumn<string>(
                name: "Sha256",
                table: "ResumeVersions",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "StorageKey",
                table: "ResumeVersions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ResumeVersions_StorageKey",
                table: "ResumeVersions",
                column: "StorageKey",
                unique: true);

            migrationBuilder.AlterColumn<int>(
                name: "ResumeId",
                table: "ResumeVersions",
                type: "integer",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);

            migrationBuilder.DropForeignKey(
                name: "FK_ResumeVersions_StoredFiles_StoredFileId",
                table: "ResumeVersions");

            migrationBuilder.DropIndex(
                name: "IX_ResumeVersions_StoredFileId",
                table: "ResumeVersions");

            migrationBuilder.DropColumn(
                name: "StoredFileId",
                table: "ResumeVersions");

            migrationBuilder.DropTable(
                name: "StoredFiles");
        }
    }
}
