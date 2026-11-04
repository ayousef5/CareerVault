// Where the CareerVault API runs. Every API request builds its URL from this.
//
// Set VITE_API_BASE_URL when building for production (e.g. in the Azure
// Static Web Apps GitHub Actions workflow); Vite bakes it into the build.
// Without it (local development, tests) the local API is used.

export const LOCAL_API_BASE_URL = 'http://localhost:5231'

// The API address to use: the configured one (without a trailing slash),
// or the local API when none is set.
export function resolveApiBaseUrl(configured: string | undefined): string {
  const value = configured?.trim().replace(/\/+$/, '') ?? ''
  return value === '' ? LOCAL_API_BASE_URL : value
}

// import.meta.env exists in Vite builds, not when tests run under Node.
const env = (import.meta as { env?: Record<string, string | undefined> }).env

export const API_BASE_URL = resolveApiBaseUrl(env?.VITE_API_BASE_URL)
