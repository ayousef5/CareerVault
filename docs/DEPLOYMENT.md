# Deploying CareerVault to Azure

```
Browser ──► Azure Static Web Apps (React build)
   │
   └──► Azure Container Apps (CareerVault API, HTTPS at the ingress)
            ├──► Azure Database for PostgreSQL (jobs, accounts, resume records)
            └──► Azure Blob Storage (private): resumes/ and dataprotection/keys.xml
                 (reached with the app's managed identity, no keys)
```

The API is one container (`backend/Dockerfile`): .NET 10, a non-root user,
plain HTTP on port **8080**. Azure's ingress provides HTTPS. Every setting
comes from environment variables; nothing secret is in the image or the repo.

In the Production environment the API **refuses to start** if a required
setting is missing, with a message that names the setting (never its value):
see `backend/CareerVault.Api/Hosting/ProductionChecks.cs`.

The commands below use placeholders like `<rg>`; replace them with your own
names. Run them with the [Azure CLI](https://learn.microsoft.com/cli/azure/)
after `az login`.

---

## 1. Create the Azure resources

```bash
RG=<rg>                 # e.g. careervault-rg
LOC=<region>            # e.g. eastus
PG=<pg-server>          # e.g. careervault-db (becomes <pg-server>.postgres.database.azure.com)
ST=<storageaccount>     # e.g. careervaultfiles (lowercase letters/digits only)
ACR=<registry>          # e.g. careervaultacr
ENV=<containerapp-env>  # e.g. careervault-env
APP=careervault-api

az group create -n $RG -l $LOC
```

### PostgreSQL (Azure Database for PostgreSQL – Flexible Server)

```bash
az postgres flexible-server create -g $RG -n $PG -l $LOC \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 \
  --admin-user cvadmin --admin-password '<a-strong-password>' \
  --public-access 0.0.0.0          # 0.0.0.0 = allow Azure services only
az postgres flexible-server db create -g $RG -s $PG -d careervault
```

SSL is required by the server. The connection string the API uses:

```
Host=<pg-server>.postgres.database.azure.com;Port=5432;Database=careervault;Username=cvadmin;Password=<password>;SSL Mode=VerifyFull;GSS Encryption Mode=Disable
```

(`GSS Encryption Mode=Disable` avoids a harmless Kerberos library warning in
the container. If `VerifyFull` ever fails with a certificate error, `Require`
still encrypts the connection.)

### Blob Storage (private)

```bash
az storage account create -g $RG -n $ST -l $LOC --sku Standard_LRS --kind StorageV2 \
  --min-tls-version TLS1_2 --allow-blob-public-access false --allow-shared-key-access false

# You need data access yourself to create the containers:
ST_ID=$(az storage account show -g $RG -n $ST --query id -o tsv)
az role assignment create --assignee "$(az ad signed-in-user show --query id -o tsv)" \
  --role "Storage Blob Data Contributor" --scope $ST_ID

az storage container create --account-name $ST -n resumes --auth-mode login
az storage container create --account-name $ST -n dataprotection --auth-mode login
```

Both containers are private (public access is disabled for the whole
account). Resume files are only ever handed out by the API after it checks
the owner. `dataprotection/keys.xml` holds the keys that sign login tokens, so
logins survive restarts and work across replicas; the app creates the blob
itself.

### Container registry and Container Apps environment

```bash
az acr create -g $RG -n $ACR --sku Basic
az containerapp env create -g $RG -n $ENV -l $LOC
```

## 2. Build the image

```bash
# Builds in Azure from the backend/ folder (no Docker needed locally).
az acr build -r $ACR -t careervault-api:v1 backend/
```

(Locally: `cd backend && docker build -t careervault-api .`)

## 3. Create the Container App

```bash
az containerapp create -g $RG -n $APP --environment $ENV \
  --image $ACR.azurecr.io/careervault-api:v1 \
  --registry-server $ACR.azurecr.io --registry-identity system \
  --system-assigned \
  --ingress external --target-port 8080 \
  --min-replicas 0 --max-replicas 2 \
  --secrets db-connection='<the connection string above>' \
  --env-vars \
    ConnectionStrings__CareerVault=secretref:db-connection \
    Cors__FrontendOrigin=https://orange-flower-03a292f10.5.azurestaticapps.net \
    ResumeStorage__BlobServiceUri=https://$ST.blob.core.windows.net \
    ResumeStorage__ContainerName=resumes \
    DataProtection__BlobUri=https://$ST.blob.core.windows.net/dataprotection/keys.xml
```

### Managed identity permissions

The app's identity needs **Storage Blob Data Contributor** on the storage
account (read, write and delete blobs). It needs no storage keys.

```bash
PRINCIPAL=$(az containerapp show -g $RG -n $APP --query identity.principalId -o tsv)
az role assignment create --assignee-object-id $PRINCIPAL --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" --scope $ST_ID
```

(With `--registry-identity system`, the same identity also pulls images from
the registry. Role assignments can take a few minutes to apply; restart the
revision if the first start fails with a 403 from storage.)

### Health probes and HTTPS

In the portal (Container App → Containers → Health probes), or in the app's
YAML:

```yaml
probes:
  - type: Liveness
    httpGet: { path: /health, port: 8080 }
  - type: Readiness
    httpGet: { path: /health/ready, port: 8080 }   # also checks PostgreSQL
```

Ingress → leave **Insecure connections** off, so the app is HTTPS only.
`/health` and `/health/ready` answer only `Healthy` / `Unhealthy`.

### Settings reference

| Environment variable | Required | Value |
|---|---|---|
| `ConnectionStrings__CareerVault` | yes | `secretref:db-connection` (the secret above) |
| `Cors__FrontendOrigin` | yes | The Static Web Apps URL, `https://…`, no trailing slash |
| `ResumeStorage__BlobServiceUri` | yes | `https://<storageaccount>.blob.core.windows.net` |
| `ResumeStorage__ContainerName` | no | `resumes` (default) |
| `DataProtection__BlobUri` | yes | `https://<storageaccount>.blob.core.windows.net/dataprotection/keys.xml` |
| `Azure__ManagedIdentityClientId` | only for a user-assigned identity | The identity's client id |
| `RateLimiting__AuthPerMinute` / `__ExtractionPerMinute` / `__UploadsPerMinute` | no | Defaults `10` / `30` / `10` |
| `ForwardedHeaders__TrustedNetworks__0`, `__1`, … | no | Proxies trusted for `X-Forwarded-*` (default: private networks; see below) |
| `ASPNETCORE_ENVIRONMENT` | set by the image | `Production` |

Instead of a Container Apps secret, the connection string can be a
**Key Vault reference** (give the identity *Key Vault Secrets User* and use
`--secrets db-connection=keyvaultref:<secret-uri>,identityref:system`).

## 4. Database migrations

Migrations are **not** run when the container starts (several replicas
starting at once would race). Run them once per release, before deploying a
version that needs them:

```bash
# Allow your own IP address for a moment:
az postgres flexible-server firewall-rule create -g $RG -n $PG --rule-name migrate \
  --start-ip-address <your-ip> --end-ip-address <your-ip>

cd backend/CareerVault.Api
dotnet ef migrations bundle --output efbundle --force
./efbundle --connection '<the connection string>'

az postgres flexible-server firewall-rule delete -g $RG -n $PG --rule-name migrate --yes
```

Alternatively, `dotnet ef migrations script --idempotent --output migrate.sql`
produces SQL you can review and run with `psql`. Both are safe to run again:
already-applied migrations are skipped.

### Moving existing local resumes (optional)

Local files live in `backend/CareerVault.Api/App_Data/resumes/{userId}/{id}`,
and blobs use the same names, so copying keeps every database link working:

```bash
azcopy login
azcopy copy 'backend/CareerVault.Api/App_Data/resumes/*' "https://$ST.blob.core.windows.net/resumes/" --recursive
```

(Only useful if you also migrate the matching local database rows.)

## 5. Frontend (Azure Static Web Apps)

The frontend reads the API address from **`VITE_API_BASE_URL`** at build time
(falling back to `http://localhost:5231` for local development; see
`frontend/src/api/config.ts` and `frontend/.env.example`).

1. In GitHub → the repository → **Settings → Secrets and variables →
   Actions → Variables**, add `VITE_API_BASE_URL` =
   `https://<app>.<region>.azurecontainerapps.io` (the Container App's URL,
   no trailing slash).
2. In the Static Web Apps workflow Azure created
   (`.github/workflows/azure-static-web-apps-*.yml`), give the build step the
   variable, and make sure the app paths point at `frontend/`:

   ```yaml
         - name: Build And Deploy
           uses: Azure/static-web-apps-deploy@v1
           env:
             VITE_API_BASE_URL: ${{ vars.VITE_API_BASE_URL }}
           with:
             # …existing settings…
             app_location: "frontend"
             output_location: "dist"
   ```

Vite bakes the value into the build, so changing it needs a new deployment.
Static Web Apps **preview** environments get their own URLs, which CORS
doesn't allow unless you add them.

## 6. GitHub Actions for the API (optional)

Deploy the API on every push to `main` that changes `backend/`. It signs in
to Azure with OpenID Connect, so no Azure password is stored in GitHub.

One-time setup: create an app registration with a federated credential for
`repo:<owner>/CareerVault:ref:refs/heads/main`, give it **Contributor** on the
resource group (or *AcrPush* on the registry plus *Container Apps
Contributor* on the app), and add these repository secrets:
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. Add variables
`AZURE_RG`, `AZURE_ACR`, `AZURE_CONTAINER_APP`.

`.github/workflows/deploy-api.yml`:

```yaml
name: Deploy API
on:
  push:
    branches: [main]
    paths: ["backend/**"]
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: "10.0.x"

      - name: Test
        run: dotnet test backend/CareerVault.Api.Tests

      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Build image in Azure
        run: az acr build -r ${{ vars.AZURE_ACR }} -t careervault-api:${{ github.sha }} backend/

      - name: Deploy
        run: |
          az containerapp update -g ${{ vars.AZURE_RG }} -n ${{ vars.AZURE_CONTAINER_APP }} \
            --image ${{ vars.AZURE_ACR }}.azurecr.io/careervault-api:${{ github.sha }}
```

Run migrations (step 4) **before** pushing a change that adds one.

## 7. Check the deployment

1. `https://<app-url>/health` → `Healthy`; `/health/ready` → `Healthy`.
2. Open the Static Web Apps URL, register, log in.
3. Add a job, paste a posting link (autofill), upload a resume, preview and
   download it, check the Resume Library.
4. Restart the Container App revision, refresh the page: you should still be
   logged in (the login keys are in Blob Storage).

## Troubleshooting

- **The app won't start: "CareerVault is not configured for production: …"**
  The message lists the missing settings by name (section 3).
- **Everyone is logged out after each restart.** `DataProtection__BlobUri` is
  missing or the identity lacks *Storage Blob Data Contributor*.
- **403 from storage.** The role assignment hasn't applied yet (wait a few
  minutes and restart), or it's on the wrong storage account.
- **CORS errors in the browser.** `Cors__FrontendOrigin` must match the
  frontend URL exactly (`https://`, no trailing slash).
- **Logins return 429 (too many attempts) for everyone.** The API isn't
  seeing real client addresses because the ingress proxy's address isn't
  trusted. By default proxies on private networks (`10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`) are trusted; if your
  environment's ingress uses another range, set
  `ForwardedHeaders__TrustedNetworks__0=<cidr>`.
- **Logs.** Container App → Monitoring → Log stream (or Log Analytics). Logs
  are JSON; EF Core's SQL logging is reduced to warnings in production.

## Costs (rough; check the Azure pricing calculator)

- Container Apps (Consumption): about $0 when scaled to zero (the first
  request after idle takes a few seconds); roughly $15–40/month with one
  replica always running.
- PostgreSQL Flexible Server, Burstable B1ms: roughly $15–20/month (free for
  12 months on new accounts).
- Container Registry Basic: about $5/month.
- Blob Storage, Static Web Apps (Free), Log Analytics (first GB free): under
  a few dollars a month at this size.
