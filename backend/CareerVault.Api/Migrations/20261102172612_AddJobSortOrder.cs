using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CareerVault.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddJobSortOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_JobApplications_UserId",
                table: "JobApplications");

            migrationBuilder.AddColumn<int>(
                name: "SortOrder",
                table: "JobApplications",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Give existing jobs an order that matches when they were created
            // (Id goes up with every new job). No data is changed or removed.
            migrationBuilder.Sql(
                "UPDATE \"JobApplications\" SET \"SortOrder\" = \"Id\";");

            migrationBuilder.CreateIndex(
                name: "IX_JobApplications_UserId_SortOrder",
                table: "JobApplications",
                columns: new[] { "UserId", "SortOrder" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_JobApplications_UserId_SortOrder",
                table: "JobApplications");

            migrationBuilder.DropColumn(
                name: "SortOrder",
                table: "JobApplications");

            migrationBuilder.CreateIndex(
                name: "IX_JobApplications_UserId",
                table: "JobApplications",
                column: "UserId");
        }
    }
}
