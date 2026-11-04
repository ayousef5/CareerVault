// Uploading, replacing and removing a job application's resume. The file
// goes straight to that application (PUT/DELETE /api/jobs/{id}/resume); the
// row is then updated with what the server saved. Normal grid autosave never
// touches the resume. A 401 ends the session like everywhere else.
import { getToken } from '../api/authApi'
import { removeJobResume, uploadJobResume } from '../api/jobsApi'
import { interpretResumeResult } from '../lib/jobResume'
import type { ResumeChange } from '../lib/jobResume'
import { checkResumeFile, SESSION_EXPIRED } from '../lib/resumeFiles'
import type { ActionResult } from '../lib/resumeFiles'
import type { JobsState } from './useJobs'

type UseJobResumeOptions = Pick<JobsState, 'getLatestRow' | 'handleResumeSaved' | 'handleSessionExpired'>

const NOT_SAVED_YET = 'This job is still being saved. Try again in a moment.'

export function useJobResume({ getLatestRow, handleResumeSaved, handleSessionExpired }: UseJobResumeOptions) {
  // Applies the server's answer to the row (or reports what went wrong).
  function finish(rowKey: string, change: ResumeChange, success: string): ActionResult {
    if (change.kind === 'expired') {
      handleSessionExpired()
      return SESSION_EXPIRED
    }
    if (change.kind === 'failed') {
      return { ok: false, message: change.message }
    }
    handleResumeSaved(rowKey, change.resumeVersionId, change.resume)
    return { ok: true, message: success }
  }

  // The row's database id, or null while it hasn't been created yet
  // (new rows have temporary negative ids).
  function savedId(rowKey: string): number | null {
    const row = getLatestRow(rowKey)
    return row && row.id > 0 ? row.id : null
  }

  // Uploads a PDF or Word file and attaches it, replacing any resume.
  async function upload(rowKey: string, file: File): Promise<ActionResult> {
    const problem = checkResumeFile(file)
    if (problem) {
      return { ok: false, message: problem }
    }

    const id = savedId(rowKey)
    if (id === null) {
      return { ok: false, message: NOT_SAVED_YET }
    }

    const hadResume = getLatestRow(rowKey)?.resume != null
    const result = await uploadJobResume(id, file, getToken())
    return finish(
      rowKey,
      interpretResumeResult(result, 'upload'),
      hadResume ? `Replaced with “${file.name}”.` : `Attached “${file.name}”.`,
    )
  }

  // Removes the attached resume from this application only.
  async function remove(rowKey: string): Promise<ActionResult> {
    const id = savedId(rowKey)
    if (id === null) {
      return { ok: false, message: NOT_SAVED_YET }
    }

    const result = await removeJobResume(id, getToken())
    return finish(rowKey, interpretResumeResult(result, 'remove'), 'Removed the resume from this application.')
  }

  return { upload, remove }
}

export type JobResume = ReturnType<typeof useJobResume>
