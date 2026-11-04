using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CareerVault.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddJobDescription : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "JobDescription",
                table: "JobApplications",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "JobDescription",
                table: "JobApplications");
        }
    }
}
