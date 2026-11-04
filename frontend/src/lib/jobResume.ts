// Rules for a job application's resume: what an upload or removal result
// means for the user, and how the Resume Library describes a file's
// applications. No React code, so it can be unit-tested (see
// jobResume.test.ts).
import type { ApiResult } from '../api/apiClient.ts'
import type { JobApplication } from '../types/job.ts'
import type { AttachedResume, LibraryApplication, LibraryFile } from '../types/resume.ts'
import { uploadErrorMessage } from './resumeFiles.ts'

// What happened when uploading or removing a job's resume.
export type ResumeChange =
  // Saved on the server: these are the job's resume details now.
  | { kind: 'saved'; resumeVersionId: number | null; resume: AttachedResume | null }
  // The login token is missing or expired.
  | { kind: 'expired' }
  // Anything else; "message" is safe to show to the user.
  | { kind: 'failed'; message: string }

const APPLICATION_GONE = 'This application no longer exists. Refresh the page and try again.'

// Turns the server's answer to PUT/DELETE /api/jobs/{id}/resume into a
// ResumeChange.
export function interpretResumeResult(
  result: ApiResult<JobApplication>,
  action: 'upload' | 'remove',
): ResumeChange {
  if (result.ok) {
    return {
      kind: 'saved',
      resumeVersionId: result.data.resumeVersionId ?? null,
      resume: result.data.resume ?? null,
    }
  }
  if (result.status === 401) {
    return { kind: 'expired' }
  }
  if (result.status === 404) {
    return { kind: 'failed', message: APPLICATION_GONE }
  }
  if (action === 'upload') {
    return { kind: 'failed', message: uploadErrorMessage(result.status, result.message) }
  }
  return {
    kind: 'failed',
    message: result.status === 0
      ? "Couldn't reach CareerVault. Check your connection and try again."
      : "Couldn't remove the resume. Please try again.",
  }
}

// ---------- Resume Library ----------

export const NOT_ATTACHED = 'Not attached to an application.'

// "Google · SWE Intern" (with fallbacks for blank fields).
export function applicationLabel(application: LibraryApplication): string {
  const company = application.companyName.trim() || 'Unknown company'
  const role = application.jobTitle.trim() || 'Untitled role'
  return `${company} · ${role}`
}

// The lines shown for a Library file: one per application using it, or
// the "not attached" note.
export function describeApplications(file: LibraryFile): string[] {
  return file.applications.length > 0 ? file.applications.map(applicationLabel) : [NOT_ATTACHED]
}

// Checks a Library response has the expected shape, dropping anything
// malformed, so nothing unexpected reaches the page.
export function parseLibraryFiles(body: unknown): LibraryFile[] {
  if (!Array.isArray(body)) {
    return []
  }

  const files: LibraryFile[] = []
  for (const item of body) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (
      typeof record.storedFileId !== 'number' ||
      typeof record.versionId !== 'number' ||
      typeof record.originalFileName !== 'string' ||
      typeof record.uploadedAt !== 'string' ||
      typeof record.contentType !== 'string' ||
      typeof record.sizeBytes !== 'number'
    ) {
      continue
    }

    const applications = Array.isArray(record.applications)
      ? record.applications.filter(
          (app): app is LibraryApplication =>
            typeof app === 'object' &&
            app !== null &&
            typeof (app as LibraryApplication).jobId === 'number' &&
            typeof (app as LibraryApplication).companyName === 'string' &&
            typeof (app as LibraryApplication).jobTitle === 'string',
        )
      : []

    files.push({
      storedFileId: record.storedFileId,
      versionId: record.versionId,
      originalFileName: record.originalFileName,
      uploadedAt: record.uploadedAt,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      applications: applications.map(({ jobId, companyName, jobTitle }) => ({ jobId, companyName, jobTitle })),
    })
  }
  return files
}
