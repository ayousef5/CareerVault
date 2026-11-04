using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CareerVault.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPayAndRecruiter : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Pay",
                table: "JobApplications",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Recruiter",
                table: "JobApplications",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Pay",
                table: "JobApplications");

            migrationBuilder.DropColumn(
                name: "Recruiter",
                table: "JobApplications");
        }
    }
}
