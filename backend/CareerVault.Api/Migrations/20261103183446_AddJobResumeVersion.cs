using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CareerVault.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddJobResumeVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ResumeVersionId",
                table: "JobApplications",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_JobApplications_ResumeVersionId",
                table: "JobApplications",
                column: "ResumeVersionId");

            migrationBuilder.AddForeignKey(
                name: "FK_JobApplications_ResumeVersions_ResumeVersionId",
                table: "JobApplications",
                column: "ResumeVersionId",
                principalTable: "ResumeVersions",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_JobApplications_ResumeVersions_ResumeVersionId",
                table: "JobApplications");

            migrationBuilder.DropIndex(
                name: "IX_JobApplications_ResumeVersionId",
                table: "JobApplications");

            migrationBuilder.DropColumn(
                name: "ResumeVersionId",
                table: "JobApplications");
        }
    }
}
