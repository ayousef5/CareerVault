// Opening resume files: fetching one with the login token (for a preview)
// and downloading the original. Used by the Resume Library and by the job
// grid's Resume dialog and View App. Files are never given public URLs
// or kept in localStorage / sessionStorage; a download uses a temporary
// in-memory link that is released straight afterwards.
import { getToken } from '../api/authApi'
import { fetchResumeFile } from '../api/resumesApi'
import type { ResumeFileRef } from '../types/resume'
import { requestErrorMessage, SESSION_EXPIRED } from '../lib/resumeFiles'
import type { ActionResult } from '../lib/resumeFiles'

export type FileResult = { ok: true; blob: Blob } | { ok: false; message: string }

type UseResumeFilesOptions = {
  // Ends the session (and shows the login screen) after a 401.
  onSessionExpired: () => void
}

export function useResumeFiles({ onSessionExpired }: UseResumeFilesOptions) {
  // Fetches a version's file (with the login token) for a preview.
  async function getFile(versionId: number): Promise<FileResult> {
    const result = await fetchResumeFile(versionId, getToken())
    if (result.status === 401) {
      onSessionExpired()
      return SESSION_EXPIRED
    }
    if (!result.ok) {
      return { ok: false, message: requestErrorMessage(result.status, result.message, 'open the file') }
    }
    return { ok: true, blob: result.data }
  }

  // Downloads a version's original file to the user's computer.
  async function download(version: Pick<ResumeFileRef, 'id' | 'originalFileName'>): Promise<ActionResult> {
    const file = await getFile(version.id)
    if (!file.ok) {
      return file
    }

    // A temporary link to the file in memory, clicked once and then removed.
    const url = URL.createObjectURL(file.blob)
    const link = document.createElement('a')
    link.href = url
    link.download = version.originalFileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Give the browser a moment to start the download before freeing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return { ok: true }
  }

  return { getFile, download }
}
