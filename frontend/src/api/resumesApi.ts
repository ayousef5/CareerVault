// Requests for resume files (/api/resumes/uploads and /api/resume-versions).
// Files are only ever fetched with the login token; there are no public file
// URLs. Resumes are uploaded to and removed from applications in jobsApi.ts.
import type { LibraryFile } from '../types/resume.ts'
import { apiRequest } from './apiClient.ts'

// The Resume Library: one entry per unique file, newest first, each with
// every application using it.
export function fetchResumeLibrary(token: string | null) {
  return apiRequest<LibraryFile[]>('/api/resumes/uploads', { token, readJson: true })
}

// The original file, as a Blob (for a preview or a download).
export function fetchResumeFile(versionId: number, token: string | null) {
  return apiRequest<Blob>(`/api/resume-versions/${versionId}/file`, { token, readBlob: true })
}
