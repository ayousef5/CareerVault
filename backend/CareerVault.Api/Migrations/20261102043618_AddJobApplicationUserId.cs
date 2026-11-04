using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CareerVault.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddJobApplicationUserId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Add UserId as optional temporarily.
            migrationBuilder.AddColumn<string>(
                name: "UserId",
                table: "JobApplications",
                type: "text",
                nullable: true);

            // Assign existing jobs to your account.
            migrationBuilder.Sql(
                """
                UPDATE "JobApplications"
                SET "UserId" = 'dced08b8-fbe8-4f82-8edf-6f109abb34c4';
                """);

            // Make UserId required for every job.
            migrationBuilder.AlterColumn<string>(
                name: "UserId",
                table: "JobApplications",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UserId",
                table: "JobApplications");
        }
    }
}
