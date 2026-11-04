# CareerVault API container (for Azure Container Apps).
# Build from the backend/ folder:   docker build -t careervault-api .
# Runs as a non-root user and listens on port 8080 (plain HTTP; Azure's
# ingress provides HTTPS). All settings come from environment variables.

# ---------- Build ----------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first (cached until the project file changes).
COPY CareerVault.Api/CareerVault.Api.csproj CareerVault.Api/
RUN dotnet restore CareerVault.Api/CareerVault.Api.csproj

COPY CareerVault.Api/ CareerVault.Api/
RUN dotnet publish CareerVault.Api/CareerVault.Api.csproj \
    --configuration Release --no-restore --output /app/publish /p:UseAppHost=false

# ---------- Run ----------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_NOLOGO=1
EXPOSE 8080

COPY --from=build /app/publish .

# The image's built-in non-root "app" user.
USER $APP_UID

ENTRYPOINT ["dotnet", "CareerVault.Api.dll"]
