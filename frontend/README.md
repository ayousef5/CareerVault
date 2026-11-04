# CareerVault frontend

The React + TypeScript (Vite) app for CareerVault. See the
[root README](../README.md) for the whole project and
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how it fits together.

## Commands

| Command | What it does |
|---------|--------------|
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server at http://localhost:5173 (the API must run at http://localhost:5231) |
| `npm run build` | Type-check (`tsc -b`) and build into `dist/` |
| `npm run lint` | ESLint, including the React hooks rules |
| `npm test` | Unit tests (`src/**/*.test.ts`) with Node's built-in test runner |

## Layout of `src/`

| Folder | Contents |
|--------|----------|
| `app/` | `App.tsx`: login gate and page assembly |
| `components/` | UI: `layout/`, `auth/`, `jobs/` (grid, cell, link cell, Add Job row, details dialog) |
| `hooks/` | `useSession`, `useJobs` (rows + autosave + undo), `useAddJob` (entry row + autofill) |
| `api/` | `apiClient` and one module per backend area |
| `lib/` | Pure, unit-tested logic |
| `types/` | Shared types |
| `styles/` | Global and layout CSS |

The API address is `API_BASE_URL` in `src/api/config.ts`.
