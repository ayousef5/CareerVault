// The shapes of resume data returned by the backend.

// The resume file uploaded to a job application (the backend's
// AttachedResumeResponse). Each application has its own upload, even when
// several share the exact same file. The file is read with the login token
// through /api/resume-versions/{versionId}/file.
export type AttachedResume = {
  versionId: number
  originalFileName: string
  // "application/pdf" or the Word (.docx) type.
  contentType: string
  sizeBytes: number
  // An ISO date-time, e.g. "2026-11-03T14:05:00+00:00".
  uploadedAt: string
}

// An application a Library file is attached to.
export type LibraryApplication = {
  jobId: number
  companyName: string
  jobTitle: string
}

// One entry in the Resume Library (GET /api/resumes/uploads): one unique
// file, with every application using it. Identical uploads by the same user
// are one entry. Older library resumes that aren't attached to anything have
// no applications.
export type LibraryFile = {
  storedFileId: number
  // The newest upload of this file: its name and date are shown, and its
  // id is used for Preview and Download.
  versionId: number
  originalFileName: string
  uploadedAt: string
  contentType: string
  sizeBytes: number
  applications: LibraryApplication[]
}

// What the preview dialog and downloads need to open a file.
export type ResumeFileRef = {
  id: number
  originalFileName: string
  contentType: string
}
