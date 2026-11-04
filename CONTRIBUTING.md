# Contributing to CareerVault

Thanks for helping! This guide covers the day-to-day workflow. Read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first for the big picture.

## Development setup

1. Install the .NET 10 SDK, Node.js 24+, PostgreSQL and the EF Core tool
   (`dotnet tool install --global dotnet-ef`).
2. Set the database connection string (see "Configuration" in the
   [README](README.md)); prefer `dotnet user-secrets` for anything with a
   password.
3. `cd backend/CareerVault.Api && dotnet ef database update`
4. Run the API: `dotnet run --launch-profile http` (http://localhost:5231)
5. Run the frontend: `cd frontend && npm install && npm run dev`
   (http://localhost:5173)

## Workflow

1. Create a branch from `main` (`feature/short-description`).
2. Make small, focused commits.
3. Before opening a pull request, run everything:
   ```bash
   cd frontend && npm run build && npm run lint && npm test
   cd ../backend/CareerVault.Api.Tests && dotnet build && dotnet test
   ```
4. Describe what changed, why, and how you tested it in the pull request.

## Coding conventions

**General**
- Write for a reader who is new to the project: descriptive names, short
  focused functions, and plain-English comments that explain *why*.
- Don't add a dependency unless it clearly earns its place.
- Keep behaviour changes and pure refactors in separate commits.

**Frontend (TypeScript/React)**
- No `any`. Describe API shapes in `src/types/` or next to the request.
- Components (`src/components/`) render UI and forward user actions. They
  don't call `fetch`.
- Stateful logic shared by components goes in a hook (`src/hooks/`).
- Every HTTP request goes through `src/api/` (and `apiClient.ts` for
  authenticated calls). Handle a `401` by calling the session's
  `expireSession` / `handleSessionExpired`, never by logging out ad hoc.
- Anything that can be a plain function goes in `src/lib/` with a
  `*.test.ts` next to it.
- Files inside `src/lib/` and `src/api/` import each other **with** the `.ts`
  extension (`import { x } from './jobRows.ts'`) so Node's test runner can load
  them; React files may omit it.
- `npm run lint` must pass (ESLint + React hooks rules).

**Backend (C#)**
- Endpoints (`Endpoints/`) stay thin: get the user id with
  `user.GetUserId()`, call a service, map the result to a status code.
- Business rules live in services (`Services/<Area>/`); register them in
  `Program.cs` (or an `Add<Area>()` extension like `AddJobExtraction`).
- Never return EF entities from an endpoint; use a DTO from `DTOs/`.
- Every query for user data filters by `UserId`.
- Error responses use `Results.Problem` / `ValidationProblem` with friendly
  messages and no internal details.
- Nullable reference types are on; keep the build at 0 warnings.

## Where to add things

| You want to… | Go to |
|--------------|-------|
| Add a UI component | `frontend/src/components/<area>/` (e.g. `jobs/`), with its CSS next to it if it has its own styles |
| Add stateful frontend behaviour | a hook in `frontend/src/hooks/` |
| Add a pure rule (parsing, formatting, decisions) | `frontend/src/lib/` + a test file |
| Call a new API endpoint | a function in `frontend/src/api/` using `apiRequest` |
| Add backend logic | a service in `backend/CareerVault.Api/Services/<Area>/` |
| Change what counts as an empty job | `Validation/JobValidation.cs` **and** `hasMeaningfulContent` in `frontend/src/lib/jobRows.ts` |

### Adding an API endpoint

1. Add request/response DTOs in `DTOs/` if needed.
2. Put the logic in a service method (`Services/...`), taking the user id as a
   parameter if the data belongs to a user.
3. Map the endpoint in the matching `Endpoints/*Endpoints.cs` file (or a new
   one with a `Map<Area>Endpoints` extension, called from `Program.cs`), with
   `.RequireAuthorization()` for anything user-specific.
4. Add tests in `CareerVault.Api.Tests` (see `JobsEndpointTests.cs`: they use
   real HTTP requests against an in-memory database and real login).
5. If the browser calls it with a new method or header, update the CORS
   policy in `Program.cs`.

### Adding a database field (e.g. "Salary range")

1. **Model**: add the property to `Models/JobApplication.cs`.
2. **Migration**: `dotnet ef migrations add AddSalaryRange`, review it (make
   sure existing rows are handled), then `dotnet ef database update`.
3. **DTOs**: add it to `CreateJobRequest` and `JobResponse`.
4. **Service**: copy it in `JobService.CopyFields` and map it in
   `ToResponseExpression`; update `JobValidation` if it should count as content.
5. **Frontend types**: `src/types/job.ts` (`JobApplication`), `toRequestBody`
   in `src/api/jobsApi.ts`, and `JobField` / `JOB_FIELDS` / `EMPTY_NEW_JOB` /
   `JobRequestBody` / `buildNewJobRequest` in `src/lib/jobRows.ts`.
6. **Grid column** (optional): add an entry to `gridColumns` in
   `src/lib/gridColumns.ts`; the grid, entry row, copy/paste and keyboard
   navigation all follow that list.
7. **Paste headers** (optional): add header names in `HEADER_ALIASES`
   (`src/lib/pasteParsing.ts`).
8. Update tests and the docs.

## Tests

| Where | What | Run |
|-------|------|-----|
| `frontend/src/**/*.test.ts` | Pure logic and API modules (Node's built-in test runner, `fetch` faked) | `npm test` |
| `backend/CareerVault.Api.Tests` | API endpoints over HTTP (EF InMemory, real Identity login), extraction parsing, URL safety, the safe fetcher | `dotnet test` |

Guidelines:
- Test behaviour, not implementation: inputs and observable results.
- Never let tests reach the internet: use `FakePageFetcher` /
  `FakeHttpHandler` / `FakeHostResolver` (backend) or a fake `fetch`
  (frontend).
- Each backend test creates its own users, so tests don't depend on each other.
- When you move code, keep its tests and update only their imports.
