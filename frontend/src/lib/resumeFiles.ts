// Small rules for resume files, used by the Resume Library. No React code,
// so they can be unit-tested (see resumeFiles.test.ts). The backend checks
// every upload again; these just give quick, friendly feedback.

export const PDF_TYPE = 'application/pdf'
export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// The same limit the backend uses.
export const MAX_RESUME_BYTES = 10 * 1024 * 1024

// What the file picker offers.
export const RESUME_FILE_ACCEPT = `.pdf,.docx,${PDF_TYPE},${DOCX_TYPE}`

// Returns a message if the file clearly can't be uploaded, or null if it
// looks fine (the backend still checks the file's real content).
export function checkResumeFile(file: { name: string; size: number }): string | null {
  const extension = file.name.toLowerCase().split('.').pop()
  if (!file.name.includes('.') || (extension !== 'pdf' && extension !== 'docx')) {
    return 'Only PDF and Word (.docx) files can be uploaded.'
  }
  if (file.size === 0) {
    return 'The file is empty.'
  }
  if (file.size > MAX_RESUME_BYTES) {
    return 'The file is larger than 10 MB.'
  }
  return null
}

// A friendly message for a failed upload, using the backend's own message
// when it sent one.
export function uploadErrorMessage(status: number, message?: string): string {
  if (message) {
    return message
  }
  if (status === 413) {
    return 'The file is larger than 10 MB.'
  }
  if (status === 0) {
    return "Couldn't reach CareerVault. Check your connection and try again."
  }
  return "Couldn't upload the file. Please try again."
}

export function isPdf(contentType: string): boolean {
  return contentType === PDF_TYPE
}

export function isDocx(contentType: string): boolean {
  return contentType === DOCX_TYPE
}

// PDFs and Word files can both be previewed in the app.
export function canPreview(contentType: string): boolean {
  return isPdf(contentType) || isDocx(contentType)
}

// "PDF" or "Word" (or "File" for anything unexpected).
export function fileTypeLabel(contentType: string): string {
  if (contentType === PDF_TYPE) return 'PDF'
  if (contentType === DOCX_TYPE) return 'Word'
  return 'File'
}

// 523 → "523 B", 48_213 → "47 KB", 2_400_000 → "2.3 MB".
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// "2026-11-03T14:05:00+00:00" → "Nov 3, 2026" (in the user's time zone).
export function formatUploadDate(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// The result of an action: done (with an optional note to show instead of
// the usual success message), or a message to show.
export type ActionResult = { ok: true; message?: string } | { ok: false; message: string }

export const SESSION_EXPIRED: { ok: false; message: string } = {
  ok: false,
  message: 'Your session expired. Log in again to continue.',
}

// A message for a failed request that isn't an upload.
export function requestErrorMessage(status: number, message: string | undefined, action: string): string {
  if (message) return message
  if (status === 0) return "Couldn't reach CareerVault. Check your connection and try again."
  if (status === 404) return 'That file no longer exists. Refresh the page and try again.'
  return `Couldn't ${action}. Please try again.`
}
