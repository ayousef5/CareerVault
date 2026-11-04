# CareerVault

CareerVault is a full-stack job application tracker. You keep every job you're
interested in or have applied to in a fast, spreadsheet-style grid that saves
automatically, fill in a new job by pasting its posting link, and keep the
exact resume you sent with each application.

## Features

- **Accounts** – register and log in; every user only ever sees their own jobs
  and files.
- **Spreadsheet-style grid** – click a cell and type; arrow keys, Tab, Enter,
  Home/End, F2 and double-click work like Excel or Google Sheets.
- **Autosave** – every edit is saved about 0.7 seconds after you stop typing,
  with a status for each row ("Saving…", "Save failed" + Retry, …).
- **Add Job entry row** – a compact row under the column headers for new jobs.
- **Autofill from URL** – paste a job posting link and CareerVault reads the
  company, role, location, pay, recruiter and full description from the page,
  automatically (or with ✨). Only empty fields are filled; nothing you typed is
  overwritten, and filling an existing row can be undone.
- **Job descriptions** – every job keeps its full description (in the Job
  Description column), so it's still there after the posting is taken down.
- **Resumes per application** – upload a PDF or Word file straight to an
  application from its Resume cell or its details view, then preview,
  download, replace or remove it. Each application keeps its own resume.
- **Resume Library** – an overview of every resume you've used: one entry per
  file, with every company and role it was sent to.
- **Previews** – PDFs and Word documents open in the app; Word files are drawn
  page by page, close to how Word shows them.
- **Copy and paste** – copy/paste cell ranges to and from Excel/Google Sheets
  (tab-separated), paste Markdown tables (matched by their header names), and
  paste several rows at once to create several jobs.
- **Undo / redo** – Cmd/Ctrl+Z and Cmd+Shift+Z / Ctrl+Y for edits, pastes and
  clears.
- **Application details** – open any job to see all its details, its full job
  description and its resume.
- **Order and cleanup** – jobs stay in the order they were added; completely
  empty jobs are never stored.
- **Safe recovery** – if your login expires mid-edit, unsaved work is kept and
  saved after you log back in.

## Technology stack

| Area     | Technology |
|----------|------------|
| Frontend | React 19, TypeScript, Vite |
| Backend  | C# / ASP.NET Core 10 (Minimal APIs), ASP.NET Identity (bearer tokens) |
| Database | PostgreSQL via Entity Framework Core 10 (Npgsql) |
| Parsing  | AngleSharp (reading job posting pages; scripts are never run) |
| Previews | docx-preview (Word files, drawn in the browser in a sandboxed frame) |
| Tests    | Node's built-in test runner (frontend), xUnit + EF Core InMemory (backend) |

## Repository structure

```
CareerVault/
├─ frontend/                  React + TypeScript app (Vite)
│  └─ src/
│     ├─ main.tsx             Entry point: global styles + <App />
│     ├─ app/App.tsx          Puts the page together (login gate, hooks, components)
│     ├─ api/                 All HTTP requests to the backend
│     ├─ hooks/               Stateful logic (session, job rows + autosave, Add Job row,
│     │                       autofill, resume uploads, Resume Library)
│     ├─ components/          UI: layout/, auth/, jobs/ (grid, cells, dialogs), resumes/
│     ├─ lib/                 Pure logic with unit tests (paste parsing, merge, undo…)
│     ├─ types/               Shared TypeScript types (job.ts, resume.ts)
│     └─ styles/              Global and page-layout CSS
├─ backend/
│  ├─ CareerVault.Api/        ASP.NET Core API
│  │  ├─ Program.cs           Setup only (services, middleware, endpoint mapping)
│  │  ├─ Endpoints/           HTTP endpoints (thin: call a service, return a status)
│  │  ├─ Services/            Business logic (Jobs/, JobExtraction/, Resumes/)
│  │  ├─ DTOs/                Request/response shapes sent over HTTP
│  │  ├─ Models/              Database entities (JobApplication, ResumeVersion, StoredFile)
│  │  ├─ Identity/            The user account type and claim helpers
│  │  ├─ Data/                EF Core DbContext
│  │  ├─ Hosting/             Production setup (rate limits, proxy headers, startup checks)
│  │  ├─ Validation/          Shared rules (what counts as an empty job)
│  │  └─ Migrations/          EF Core database migrations (never edit by hand once applied)
│  ├─ CareerVault.Api.Tests/  xUnit tests (API endpoints, extraction, URL safety, resumes, hosting)
│  └─ Dockerfile              The API's production container image
├─ docs/ARCHITECTURE.md       How the pieces fit together, with diagrams
├─ docs/DEPLOYMENT.md         Deploying to Azure (Container Apps, PostgreSQL, Blob Storage)
└─ CONTRIBUTING.md            Development workflow and conventions
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for diagrams and design
decisions, and [CONTRIBUTING.md](CONTRIBUTING.md) for where to add things.

## How it works

### Frontend ↔ backend

The React app calls the API at `http://localhost:5231` (set in
`frontend/src/api/config.ts`). Every request goes through
`frontend/src/api/apiClient.ts`, which adds the login token and returns a typed
`{ ok, status, data }` result. The API answers with JSON DTOs (`JobResponse`,
`ExtractedJobResponse`, `ResumeFileResponse`); database entities are never
sent directly.

### Authentication

ASP.NET Identity provides `/api/auth/register` and `/api/auth/login`. Logging in
returns a bearer access token, which the frontend keeps in `sessionStorage`
(for the current tab) and sends as `Authorization: Bearer …`. Every `/api/jobs`
and resume endpoint requires it, and every query filters by the logged-in
user's id. When
any request gets **401**, `useSession` logs out and shows the login screen;
unsaved edits stay in memory and are saved after logging back in (to the same
account only).

### Database

PostgreSQL holds ASP.NET Identity's tables (`AspNetUsers`, …),
`JobApplications`, and the resume tables (`ResumeVersions` for each upload,
`StoredFiles` for each physical file; see Resumes below). Each job belongs to one user (`UserId`, deleted with the
user) and has a `SortOrder`: new jobs get the user's highest number + 1, so the
list always comes back in the order jobs were added, and editing never moves a
job. The backend rejects (400) any job whose fields are all empty (the default
status "Not Applied" counts as empty).

### Job creation and autosave

- **New jobs** are added through the Add Job entry row (or by pasting rows past
  the end of the grid). Creating requests are sent one at a time so their
  `SortOrder` matches the grid.
- **Edits** update the row on screen immediately. Each row has a version number;
  700 ms after the last change the whole row is sent (PUT). Only one request per
  row runs at a time, newer edits are never overwritten by older responses, and
  a failed save keeps the edit and shows Retry.
- **Empty rows**: if you clear every field of a job, it's deleted when you move
  to another row.
- **Deleting** (🗑 on a row) sends DELETE; pending autosaves for that row can
  never re-create it.

### Spreadsheet paste

Pasted text is read as tab-separated data (Excel/Google Sheets) or a Markdown
table. Values go into columns by position from the selected cell, unless a
Markdown table has a header row, in which case each column goes to the field
its header names ("Company", "Role", "Job Description", …). Dates such as
`10/30/2026` or `Oct 30, 2026` and status words such as "interview" are
converted; values that can't be read are left unchanged rather than guessed.

### Job descriptions and the details dialog

The full description is stored in `JobApplication.JobDescription`. The grid's
**Job Description** column shows its length ("1,240 words") and opens an
editor; click **⤢** on a row to open the details dialog, which shows every
field, the whole description with its paragraphs, and the attached resume.

### URL extraction and autofill

Clicking **✨** next to App Link sends the link to `POST /api/jobs/extract`.
The backend downloads the page safely (only public http/https addresses, every
redirect checked, size and time limits; see the SSRF section in
ARCHITECTURE.md), reads structured `JobPosting` data first and page metadata
second (Workday and Greenhouse job links get dedicated extractors first;
for Workday it also reads the posting's public job-detail JSON through the
same safe fetcher), and returns whatever it found. **Nothing is saved**: the frontend fills
only the empty fields of the entry row and you click Add. Pasting a complete
link into App Link starts this automatically after a short pause; for a row
already in the grid, the filled fields are saved by autosave and can be undone.

### Resumes

- **Uploading** – a resume is uploaded straight to one application
  (`PUT /api/jobs/{id}/resume`, PDF or `.docx`, up to 10 MB) and removed with
  `DELETE /api/jobs/{id}/resume`. Normal job saves never change it, so autosave
  can't overwrite an upload. The file type is checked from the file's own
  bytes, and uploads are read as streams, never all at once into memory.
- **One copy per file** – every upload gets its own record (`ResumeVersion`),
  so replacing or removing one application's resume never affects another.
  Identical files from the same user (same SHA-256) share one physical file
  (`StoredFile`, unique per user and hash); files are never shared between
  users. A physical file is deleted only when no application uses it.
- **Storage** – files are kept outside the web root (by default
  `backend/CareerVault.Api/App_Data/resumes`, git-ignored) behind the
  `IFileStorage` interface, and are only ever sent by the API to their owner
  (`GET /api/resume-versions/{id}/file`). There are no public file URLs.
- **Resume Library** – `GET /api/resumes/uploads` lists one entry per unique
  file with every application using it; files from the earlier library that
  aren't attached show as "Not attached to an application".
- **Previews** – PDFs open from a temporary in-memory URL. Word files are
  drawn by docx-preview inside a sandboxed frame that can't run scripts or
  load anything from the internet; embedded HTML is never rendered and only
  safe links stay clickable.

## Running locally

**Requirements:** .NET 10 SDK, Node.js 24+ (the tests run TypeScript files directly),
PostgreSQL, and the EF Core tool (`dotnet tool install --global dotnet-ef`).

1. **Database** – create a PostgreSQL database (default name `careervault`) and
   set its connection string in
   `backend/CareerVault.Api/appsettings.Development.json`
   (`ConnectionStrings:CareerVault`), or in user secrets / an environment
   variable (see below).
2. **Apply migrations**
   ```bash
   cd backend/CareerVault.Api
   dotnet ef database update
   ```
3. **Start the API** (http://localhost:5231)
   ```bash
   dotnet run --launch-profile http
   ```
4. **Start the frontend** (http://localhost:5173)
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
5. Open http://localhost:5173, register, and start adding jobs.

## Running tests

```bash
# Frontend: type checks + build, lint, unit tests
cd frontend
npm run build
npm run lint
npm test

# Backend: build and all API/service tests (no database needed;
# tests use an in-memory database and never contact real websites)
cd backend/CareerVault.Api.Tests
dotnet build
dotnet test
```

## Database migrations

When you change a class in `backend/CareerVault.Api/Models/` (or the
`DbContext`):

```bash
cd backend/CareerVault.Api
dotnet ef migrations add DescribeYourChange   # creates a file in Migrations/
# review the generated migration (and keep existing data safe), then:
dotnet ef database update
```

Commit the new migration files. Never edit or delete a migration that has
already been applied to a shared database; add a new one instead.

## Configuration

| Setting | Where | Default |
|---------|-------|---------|
| `ConnectionStrings:CareerVault` | `appsettings.Development.json`, user secrets, or env var `ConnectionStrings__CareerVault` | `Host=localhost;Port=5432;Database=careervault;…` |
| `Cors:FrontendOrigin` | appsettings or env var `Cors__FrontendOrigin` | `http://localhost:5173` |
| `JobExtraction:MaxRedirects` / `MaxResponseBytes` / `Timeout` | appsettings or env vars `JobExtraction__…` | `5` / `3145728` (3 MB) / `00:00:10` |
| `ResumeStorage:RootPath` | appsettings or env var `ResumeStorage__RootPath` | `App_Data/resumes` in the API project |
| `Resumes:MaxFileBytes` | appsettings or env var `Resumes__MaxFileBytes` | `10485760` (10 MB) |
| `ResumeStorage:Provider` / `BlobServiceUri` / `ContainerName` | env vars `ResumeStorage__…` | `Local` in development, `AzureBlob` in production |
| `DataProtection:BlobUri` | env var `DataProtection__BlobUri` | Not set (keys kept locally); required in production |
| `RateLimiting:AuthPerMinute` / `ExtractionPerMinute` / `UploadsPerMinute` | env vars `RateLimiting__…` | `10` / `30` / `10` |
| `VITE_API_BASE_URL` (frontend, build time) | build environment or `frontend/.env.production.local` | `http://localhost:5231` |
| API address used by the frontend | `frontend/src/api/config.ts` (`API_BASE_URL`) | `http://localhost:5231` |

Keep passwords out of committed files: use
`dotnet user-secrets set "ConnectionStrings:CareerVault" "Host=…;Password=…"`
in `backend/CareerVault.Api`, or environment variables. `.env` files are
git-ignored.

## Deployment

The API runs as a container (`backend/Dockerfile`) on Azure Container Apps,
with Azure Database for PostgreSQL and private Azure Blob Storage for resumes;
the frontend is on Azure Static Web Apps. Health probes: `/health` and
`/health/ready`. Production refuses to start if a required setting is
missing, and logs are JSON. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for
step-by-step setup, settings, permissions, migrations and GitHub Actions.

## Roadmap

Ideas for later versions: refresh tokens (stay logged in longer), more site-specific extractors (Lever, Ashby…) once they've been
tested, historical job archives, and AI-powered skill extraction and
hiring-trend analysis.
