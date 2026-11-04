// Which page of CareerVault is showing, kept in the URL hash ("#/resumes")
// so a refresh stays on the same page and the browser's Back button works.
// Two pages don't need a routing library. No React code (see appView.test.ts).

// "applications" shows the same grid page as "dashboard" for now.
export type AppView = 'dashboard' | 'applications' | 'resumes'

const HASHES: Record<AppView, string> = {
  dashboard: '#/',
  applications: '#/applications',
  resumes: '#/resumes',
}

// "#/resumes" → "resumes", "#/applications" → "applications"; anything else
// (including "" and "#") → "dashboard".
export function viewFromHash(hash: string): AppView {
  const path = hash.replace(/\/+$/, '')
  if (path === HASHES.resumes) return 'resumes'
  if (path === HASHES.applications) return 'applications'
  return 'dashboard'
}

export function hashForView(view: AppView): string {
  return HASHES[view]
}
