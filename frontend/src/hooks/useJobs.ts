// All job-row state and the logic that keeps it in sync with the server:
// loading (and merging with unsaved work after logging in again),
// autosave, creating and deleting rows, undo/redo and retry.
//
// Pure rules (what to save, how to merge...) live in lib/jobRows.ts and
// lib/spreadsheetEdits.ts; this hook connects them to React state and the
// API. Components get the data and actions from here.
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { fetchAccountEmail, getToken } from '../api/authApi'
import { createJob, deleteJob, fetchJobs, toRequestBody, updateJob } from '../api/jobsApi'
import type { ApiResult } from '../api/apiClient'
import { getCellText } from '../lib/gridColumns'
import {
  createRowSync,
  createTaskQueue,
  decideDelete,
  decideSave,
  hasMeaningfulContent,
  rowHasContent,
  hasPendingChanges,
  planMerge,
} from '../lib/jobRows'
import type { RowSaveStatus, RowSync } from '../lib/jobRows'
import { hasUnsavedWork as anyUnsavedWork } from '../lib/saveStatus'
import { EditHistory, groupChangesByRow } from '../lib/spreadsheetEdits'
import type { CellChange } from '../lib/spreadsheetEdits'
import type {
  EditableField,
  GridRow,
  JobApplication,
  RowUpdate,
  RowValues,
} from '../types/job'
import type { AttachedResume } from '../types/resume'

// How long to wait after the last keystroke before saving.
const AUTOSAVE_DELAY_MS = 700

type UseJobsOptions = {
  isAuthenticated: boolean
  // Ends the session (see useSession) when the API answers 401.
  expireSession: () => void
}

export function useJobs({ isAuthenticated, expireSession }: UseJobsOptions) {
  // The applications shown in the grid: loaded from the backend,
  // plus any edits and new rows the user has made since.
  const [applications, setApplications] = useState<GridRow[]>([])

  // True while we're waiting for the backend to respond.
  const [isLoading, setIsLoading] = useState(true)

  // Holds an error message if the request fails, otherwise null.
  const [error, setError] = useState<string | null>(null)

  // The save state of each row, keyed by rowKey. Used for the indicators.
  const [saveStatuses, setSaveStatuses] = useState<
    Record<string, RowSaveStatus>
  >({})

  // ----- Autosave bookkeeping -----
  // These are refs (not state) because autosave needs the very latest
  // values immediately, without waiting for React to re-render.

  // The latest version of every row, keyed by rowKey.
  const latestRows = useRef(new Map<string, GridRow>())

  // Save bookkeeping for every row, keyed by rowKey.
  const rowSync = useRef(new Map<string, RowSync>())

  // Counter used to make rowKeys for new rows: "new-1", "new-2", ...
  const newRowCounter = useRef(0)

  // Requests that create jobs wait in this line, so they reach the server
  // in the order the jobs were added (see runInCreateQueue).
  const createQueue = useRef(createTaskQueue())

  // Undo/redo history of cell edits. Only edits made by the user are
  // recorded; autosave responses, selection and column resizing are not.
  const history = useRef(new EditHistory<EditableField>())

  // The email of the account whose rows are in memory, so unsaved work is
  // only recovered for that same account after logging back in.
  const dataOwner = useRef<string | null>(null)

  // Forgets every row in memory, e.g. when a different account logs in.
  // Any requests still running for those rows are ignored when they finish.
  function discardLocalRows() {
    for (const sync of rowSync.current.values()) {
      window.clearTimeout(sync.timer)
    }
    latestRows.current.clear()
    rowSync.current.clear()
    history.current = new EditHistory<EditableField>()
  }

  // Puts the rows from GET /api/jobs into the grid without losing unsaved
  // work, then retries the saves that are still pending. The rules for
  // which copy of each row wins are in planMerge (jobRows.ts):
  //   - Clean rows (no unsaved edits) use the server's version.
  //   - Rows with unsaved edits, including ones whose save failed when the
  //     session expired, keep their local version.
  //   - New rows that were never saved (no database id yet) are kept.
  //   - Rows being deleted are kept until the delete finishes.
  // Rows keep the server's order (the order they were added), with
  // never-saved rows after them.
  // useEffectEvent lets the loading effect call this with the latest
  // state and functions without re-running the effect.
  const mergeLoadedRows = useEffectEvent(
    (serverJobs: JobApplication[], ownerEmail: string | null) => {
      // If a different account logged in, or we can't tell which account it
      // is, the rows in memory may belong to someone else: start fresh
      // instead of saving them into this account.
      if (ownerEmail === null || ownerEmail !== dataOwner.current) {
        discardLocalRows()
      }
      dataOwner.current = ownerEmail

      const plan = planMerge(
        serverJobs,
        latestRows.current,
        rowSync.current,
        saveStatuses,
      )

      // Keep the bookkeeping in step with what the grid will show.
      for (const row of plan.cleanRows) {
        latestRows.current.set(row.rowKey, row)
      }
      for (const { rowKey, dbId } of plan.newSyncs) {
        rowSync.current.set(rowKey, createRowSync(dbId))
      }
      for (const rowKey of plan.rowsToForget) {
        window.clearTimeout(rowSync.current.get(rowKey)?.timer)
        latestRows.current.delete(rowKey)
        rowSync.current.delete(rowKey)
      }

      setApplications(plan.rows)
      // Replacing the whole record also removes statuses of rows that are gone.
      setSaveStatuses(plan.statuses)

      // Retry pending saves with the new token.
      for (const rowKey of plan.rowsToRetry) {
        scheduleSave(rowKey, AUTOSAVE_DELAY_MS)
      }

      // Remove completely empty jobs left in the database (e.g. blank rows
      // from before empty rows were blocked). They're already hidden.
      for (const dbId of plan.emptyJobsToDelete) {
        void deleteEmptyJob(dbId)
      }
    },
  )

  // Deletes an empty job found while loading. It isn't shown in the grid,
  // so if this fails nothing is lost: it's simply tried again next load.
  async function deleteEmptyJob(dbId: number) {
    const result = await deleteJob(dbId, getToken())
    // 404: already gone, which is fine.
    if (!result.ok && result.status !== 404) {
      console.error(`Couldn't remove empty job ${dbId} (status ${result.status})`)
    }
  }

  // Load the applications once the user is logged in.
  // [isAuthenticated] at the end means "run again whenever login status changes".
  useEffect(() => {
    // Don't load applications until the user is logged in.
    if (!isAuthenticated) {
      return
    }

    // Becomes true if this effect is cleaned up, so a late response is ignored.
    let ignore = false

    async function loadApplications() {
      // Set to true when we're sent back to the login screen, so the
      // loading message stays ready for the next login.
      let keepLoading = false

      try {
        // Send a GET request to the backend, with the login token.
        const token = getToken()

        const result = await fetchJobs(token)

        // A response from an earlier login session: ignore it, so an old
        // 401 can't log the user out again.
        if (ignore) {
          return
        }

        // If the token is invalid or expired, return to login.
        if (result.status === 401) {
          keepLoading = true
          expireSession()
          return
        }

        // Other errors (including a network failure, status 0).
        if (!result.ok) {
          throw new Error(`Request failed with status ${result.status}`)
        }

        const data = result.data

        // Find out which account this is, so unsaved work is only recovered
        // for the same account.
        const ownerEmail = await fetchAccountEmail(token)

        if (ignore) {
          return
        }

        // Combine the server's rows with any unsaved local work, and clear
        // any error left over from an earlier failed load.
        mergeLoadedRows(data, ownerEmail)
        setError(null)
      } catch (err) {
        if (ignore) {
          return
        }

        // Network problems (e.g. the backend isn't running) end up here too.
        console.error(err)
        setError('Could not load applications. Is the backend running?')
      } finally {
        // Whether it worked or not, we're done loading
        // (unless we went back to the login screen).
        if (!ignore && !keepLoading) {
          setIsLoading(false)
        }
      }
    }

    loadApplications()

    return () => {
      ignore = true
    }
  }, [isAuthenticated, expireSession])

  // Warn before closing the tab if some changes haven't been saved yet.
  const hasUnsavedWork = anyUnsavedWork(saveStatuses)

  useEffect(() => {
    if (!hasUnsavedWork) {
      return
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      // Shows the browser's "Leave site? Changes may not be saved" dialog.
      event.preventDefault()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedWork])

  // A request got 401 (the login expired). Return to the login screen, with
  // the loading message ready for the next login.
  function handleSessionExpired() {
    setIsLoading(true)
    expireSession()
  }

  // Updates one row's save state for the indicators.
  function setRowStatus(rowKey: string, status: RowSaveStatus) {
    setSaveStatuses((current) => ({ ...current, [rowKey]: status }))
  }

  // Starts (or restarts) the countdown before a row is saved.
  function scheduleSave(rowKey: string, delay: number) {
    const sync = rowSync.current.get(rowKey)
    if (!sync) {
      return
    }

    // Typing again cancels the previous countdown, so we only save
    // once the user pauses.
    window.clearTimeout(sync.timer)
    sync.timer = window.setTimeout(() => {
      sync.timer = undefined
      void saveRow(rowKey)
    }, delay)
  }

  // Runs requests that create jobs one at a time, in the order they were
  // started, so the server numbers new jobs (their sort order) in the same
  // order they appear in the grid.
  function runInCreateQueue<T>(task: () => Promise<T>): Promise<T> {
    return createQueue.current(task)
  }

  // Removes a row from the grid and forgets everything about it, including
  // any pending autosave timer.
  function removeRowLocally(rowKey: string) {
    window.clearTimeout(rowSync.current.get(rowKey)?.timer)
    latestRows.current.delete(rowKey)
    rowSync.current.delete(rowKey)
    setApplications((current) =>
      current.filter((application) => application.rowKey !== rowKey),
    )
    setSaveStatuses((current) => {
      const next = { ...current }
      delete next[rowKey]
      return next
    })
  }

  // Sends one row to the backend: POST if it's new, PUT if it already exists.
  async function saveRow(rowKey: string) {
    const sync = rowSync.current.get(rowKey)
    const row = latestRows.current.get(rowKey)
    if (!sync || !row) {
      return
    }

    // decideSave (jobRows.ts) checks, in order: rows being deleted are never
    // sent (so an old timer can't re-create a deleted job); only one request
    // per row at a time; nothing to do if already saved; empty rows aren't
    // stored.
    const decision = decideSave(sync, rowHasContent(row))

    if (decision === 'skip' || decision === 'wait') {
      // 'wait': the request that's running notices newer edits when it
      // finishes and saves again.
      return
    }

    if (decision === 'empty') {
      // Nothing worth storing. The row is deleted when the user leaves it
      // (see handleLeaveRows); until then it simply isn't saved.
      setRowStatus(rowKey, 'empty')
      return
    }

    // Logged out (e.g. a countdown finished on the login screen): keep the
    // changes. They're saved after the next login.
    const token = getToken()
    if (token === null) {
      return
    }

    // Remember which version we're sending, so we can tell afterwards
    // whether the user kept editing while the request was running.
    const versionBeingSaved = sync.version
    const isNewRecord = decision === 'post'

    sync.isSaving = true
    setRowStatus(rowKey, 'saving')

    try {
      const body = toRequestBody(row)
      const result: ApiResult<JobApplication | undefined> = isNewRecord
        ? await runInCreateQueue(() => createJob(body, token))
        : // decideSave only returns "put" for rows that have a database id.
          await updateJob(sync.dbId!, body, token)

      // The row was removed while this request ran (deleted, or a different
      // account logged in), so its result no longer matters.
      if (rowSync.current.get(rowKey) !== sync) {
        return
      }

      // The user deleted this row while the request was running.
      if (sync.isDeleting) {
        sync.isSaving = false
        if (isNewRecord) {
          if (result.ok && result.data) {
            // It was created after all: delete it now that we know its id.
            sync.dbId = result.data.id
            void sendDelete(rowKey)
          } else {
            // It was never created, so there's nothing to delete on the server.
            removeRowLocally(rowKey)
          }
        }
        // For an update, the DELETE that's already running finishes the job.
        return
      }

      // If the token is invalid or expired, return to login.
      if (result.status === 401) {
        // Stop the current save and show that it did not complete.
        sync.isSaving = false

        // This request used an old token, and the user has logged in again
        // since. Don't log them out; just save again with the new token.
        const currentToken = getToken()
        if (currentToken !== null && currentToken !== token) {
          setRowStatus(rowKey, 'unsaved')
          scheduleSave(rowKey, 0)
          return
        }

        setRowStatus(rowKey, 'failed')
        handleSessionExpired()
        return
      }

      // Other errors, including a network failure (status 0).
      if (!result.ok) {
        throw new Error(`Save failed with status ${result.status}`)
      }

      if (isNewRecord) {
        // The backend returns the created record, including its real id.
        const created = result.data
        if (!created) {
          throw new Error('Save succeeded without returning the new job')
        }
        sync.dbId = created.id

        // Swap the temporary id for the real one. We only change the id,
        // so any edits the user made during the request are kept.
        const latest = latestRows.current.get(rowKey)
        if (latest) {
          latestRows.current.set(rowKey, { ...latest, id: created.id })
        }
        setApplications((current) =>
          current.map((application) =>
            application.rowKey === rowKey
              ? { ...application, id: created.id }
              : application,
          ),
        )

        // If the grid was reloaded while this POST was running, the server
        // may already have sent this record back as a separate "db-<id>"
        // row. This row now represents it, so drop that duplicate (as long
        // as it has no unsaved edits of its own).
        const duplicateKey = `db-${created.id}`
        const duplicateSync = rowSync.current.get(duplicateKey)
        if (
          duplicateSync &&
          !hasPendingChanges(duplicateSync) &&
          !duplicateSync.isDeleting
        ) {
          removeRowLocally(duplicateKey)
        }
      }

      // Removed while the response was being read: nothing more to do.
      if (rowSync.current.get(rowKey) !== sync) {
        return
      }

      // Deleted while the response was being read.
      if (sync.isDeleting) {
        sync.isSaving = false
        if (isNewRecord) {
          // The delete was waiting for this id.
          void sendDelete(rowKey)
        }
        return
      }

      sync.savedVersion = versionBeingSaved
      sync.isSaving = false

      if (sync.version > sync.savedVersion) {
        // The user edited the row while we were saving. Save again now,
        // unless a countdown is already waiting to do it.
        setRowStatus(rowKey, 'unsaved')
        if (sync.timer === undefined) {
          void saveRow(rowKey)
        }
      } else {
        // Only now, after the API confirmed it, do we show "Saved".
        setRowStatus(rowKey, 'saved')
      }
    } catch (err) {
      // Network error or an error response. The edits stay in the grid,
      // so nothing is lost; the user can retry.
      console.error(err)
      sync.isSaving = false
      if (rowSync.current.get(rowKey) !== sync) {
        return
      }

      if (sync.isDeleting) {
        // While deleting: a failed create means nothing was stored, so the
        // row can just go; a failed update doesn't matter.
        if (isNewRecord) {
          removeRowLocally(rowKey)
        }
        return
      }

      setRowStatus(rowKey, 'failed')
    }
  }

  // Deletes a row: from the database if it was saved, and from the grid.
  // The row's delete button asks for confirmation before calling this.
  async function deleteRow(rowKey: string) {
    const sync = rowSync.current.get(rowKey)
    const decision = decideDelete(sync)
    if (!sync || decision === 'ignore') {
      return
    }

    // Stop any pending autosave so it can't send this row again.
    window.clearTimeout(sync.timer)
    sync.timer = undefined

    if (decision === 'remove-locally') {
      // Never saved, so there's nothing to delete on the server.
      removeRowLocally(rowKey)
      return
    }

    sync.isDeleting = true
    setRowStatus(rowKey, 'deleting')

    if (decision === 'after-create') {
      // Its POST is still running. saveRow sends the DELETE as soon as
      // that returns the new record's id.
      return
    }

    await sendDelete(rowKey)
  }

  // Sends DELETE /api/jobs/{id} for a row that's being deleted. On success
  // the row is removed; on failure it stays, marked "Delete failed", so
  // nothing disappears without being deleted.
  async function sendDelete(rowKey: string) {
    const sync = rowSync.current.get(rowKey)
    if (!sync || sync.dbId === null) {
      return
    }

    // Can't delete while logged out; Retry is available after logging in.
    const token = getToken()
    if (token === null) {
      sync.isDeleting = false
      setRowStatus(rowKey, 'deleteFailed')
      return
    }

    try {
      const result = await deleteJob(sync.dbId, token)

      // Already removed (e.g. a different account logged in).
      if (rowSync.current.get(rowKey) !== sync) {
        return
      }

      if (result.status === 401) {
        sync.isDeleting = false
        setRowStatus(rowKey, 'deleteFailed')

        // Only log out if this token is still the current one.
        if (getToken() === token) {
          handleSessionExpired()
        }
        return
      }

      // 404 means it's already gone (e.g. deleted in another tab), which
      // is what we wanted.
      if (!result.ok && result.status !== 404) {
        throw new Error(`Delete failed with status ${result.status}`)
      }

      removeRowLocally(rowKey)
    } catch (err) {
      // Network error or server error: keep the row so nothing is lost.
      console.error(err)
      if (rowSync.current.get(rowKey) !== sync) {
        return
      }
      sync.isDeleting = false
      setRowStatus(rowKey, 'deleteFailed')

      // If it has unsaved edits, keep saving them as usual.
      if (sync.version > sync.savedVersion) {
        scheduleSave(rowKey, AUTOSAVE_DELAY_MS)
      }
    }
  }

  // Called when the selection moves away from some rows (or focus leaves
  // the grid). Rows left completely empty are deleted.
  function handleLeaveRows(rowKeys: string[]) {
    for (const rowKey of rowKeys) {
      const row = latestRows.current.get(rowKey)
      const sync = rowSync.current.get(rowKey)
      if (row && sync && !sync.isDeleting && !rowHasContent(row)) {
        void deleteRow(rowKey)
      }
    }
  }

  // Optional fields store null instead of an empty string, like the backend.
  function toFieldValue(field: EditableField, value: string) {
    const isRequired =
      field === 'companyName' || field === 'jobTitle' || field === 'status'
    return value === '' && !isRequired ? null : value
  }

  // Applies one or more field changes to an existing row in a single step,
  // then starts the autosave countdown. However many fields change, the row
  // is saved with one request.
  function updateRow(rowKey: string, values: RowValues) {
    const row = latestRows.current.get(rowKey)
    const sync = rowSync.current.get(rowKey)
    // Rows that are being deleted can't be edited any more.
    if (!row || !sync || sync.isDeleting) {
      return
    }

    const updatedRow: GridRow = { ...row }
    for (const [field, value] of Object.entries(values)) {
      const key = field as EditableField
      Object.assign(updatedRow, { [key]: toFieldValue(key, value ?? '') })
    }
    latestRows.current.set(rowKey, updatedRow)

    setApplications((current) =>
      current.map((application) =>
        application.rowKey === rowKey ? updatedRow : application,
      ),
    )

    // Mark this row as changed and save it after the user pauses.
    sync.version += 1
    setRowStatus(rowKey, 'unsaved')
    scheduleSave(rowKey, AUTOSAVE_DELAY_MS)
  }

  // Called whenever a single cell is edited (each keystroke, a dropdown
  // choice, a date pick...). Keystrokes in the same cell become one undo step.
  function handleCellChange(rowKey: string, field: EditableField, value: string) {
    const row = latestRows.current.get(rowKey)
    if (!row) {
      return
    }

    history.current.recordCellEdit({
      rowKey,
      field,
      before: getCellText(row, field),
      after: value,
    })
    updateRow(rowKey, { [field]: value })
  }

  // Adds new blank rows (optionally pre-filled, e.g. from a paste) to the
  // bottom of the grid and saves each one right away with a single POST.
  // Returns the rowKeys of the new rows.
  function createRows(rowsValues: RowValues[]): string[] {
    const newRows: GridRow[] = []

    // New rows get temporary negative ids (-1, -2, ...) until the backend
    // gives them real ones. Real database ids are always positive.
    let lowestId = Math.min(
      0,
      ...Array.from(latestRows.current.values(), (row) => row.id),
    )

    for (const values of rowsValues) {
      newRowCounter.current += 1
      lowestId -= 1
      const rowKey = `new-${newRowCounter.current}`

      const newRow: GridRow = {
        rowKey,
        id: lowestId,
        companyName: '',
        jobTitle: '',
        location: null,
        jobUrl: null,
        dateApplied: null,
        status: 'Not Applied',
        notes: null,
        jobDescription: null,
        pay: null,
        recruiter: null,
        resumeVersionId: null,
        resume: null,
      }

      // Fill in any starting values.
      for (const [field, value] of Object.entries(values)) {
        const key = field as EditableField
        Object.assign(newRow, { [key]: toFieldValue(key, value ?? '') })
      }

      latestRows.current.set(rowKey, newRow)
      // No database id yet, so it starts as "needs saving".
      rowSync.current.set(rowKey, createRowSync(null))
      newRows.push(newRow)
    }

    setApplications((current) => [...current, ...newRows])

    for (const row of newRows) {
      setRowStatus(row.rowKey, 'unsaved')
      // Create the record in the database straight away.
      void saveRow(row.rowKey)
    }

    return newRows.map((row) => row.rowKey)
  }

  // Adds a job the server has just created (from the Add Job form) to the
  // bottom of the grid. It's already saved, so there's nothing to autosave.
  function addSavedRow(job: JobApplication) {
    const rowKey = `db-${job.id}`
    const row: GridRow = { ...job, rowKey }

    latestRows.current.set(rowKey, row)
    rowSync.current.set(rowKey, createRowSync(job.id))
    setApplications((current) => [...current, row])
    setRowStatus(rowKey, 'saved')
  }

  // Applies a batch of changes from the grid (a paste or clearing a range).
  // Each existing row is updated once; rowKey null means "create a new row".
  // The whole batch becomes a single undo step.
  function handleApplyChanges(updates: RowUpdate[]) {
    const changes: CellChange<EditableField>[] = []
    const rowsToCreate: RowValues[] = []

    for (const update of updates) {
      if (update.rowKey === null) {
        // Never create a completely empty row (e.g. a blank line in a paste).
        if (hasMeaningfulContent(update.values)) {
          rowsToCreate.push(update.values)
        }
        continue
      }

      const row = latestRows.current.get(update.rowKey)
      if (!row) {
        continue
      }

      // Note each cell's old value before changing it, for undo.
      for (const [field, value] of Object.entries(update.values)) {
        const key = field as EditableField
        changes.push({
          rowKey: update.rowKey,
          field: key,
          before: getCellText(row, key),
          after: value ?? '',
        })
      }

      updateRow(update.rowKey, update.values)
    }

    if (rowsToCreate.length > 0) {
      const newRowKeys = createRows(rowsToCreate)

      // New rows started out blank (Status "Not Applied"), so undo empties
      // them again. Empty rows are deleted when the user leaves them.
      newRowKeys.forEach((rowKey, index) => {
        for (const [field, value] of Object.entries(rowsToCreate[index])) {
          changes.push({
            rowKey,
            field: field as EditableField,
            before: field === 'status' ? 'Not Applied' : '',
            after: value ?? '',
          })
        }
      })
    }

    history.current.recordBatch(changes)
  }

  // Applies one side of an undo step to the grid. Each affected row is
  // updated once and saved through the normal autosave.
  function applyHistory(
    changes: CellChange<EditableField>[],
    side: 'before' | 'after',
  ) {
    for (const { rowKey, values } of groupChangesByRow(changes, side)) {
      updateRow(rowKey, values)
    }
  }

  // Cmd/Ctrl+Z: put back the values from before the last edit.
  function handleUndo() {
    const changes = history.current.undo()
    if (changes) {
      applyHistory(changes, 'before')
    }
  }

  // Cmd+Shift+Z / Ctrl+Y: re-apply the last undone edit.
  function handleRedo() {
    const changes = history.current.redo()
    if (changes) {
      applyHistory(changes, 'after')
    }
  }

  // Stops further keystrokes being merged into the latest undo step.
  function handleSealHistory() {
    history.current.seal()
  }

  // Tries again for every row whose last save or delete failed.
  function handleRetry() {
    for (const [rowKey, status] of Object.entries(saveStatuses)) {
      if (status === 'failed') {
        void saveRow(rowKey)
      } else if (status === 'deleteFailed') {
        void deleteRow(rowKey)
      }
    }
  }

  // Saves a description corrected in the details view. It goes through the
  // same path as editing a cell: one undo step, then autosave.
  function handleSaveDescription(rowKey: string, description: string) {
    // Nothing changed: don't send a save.
    const row = latestRows.current.get(rowKey)
    if (!row || (row.jobDescription ?? '') === description) {
      return
    }

    handleSealHistory()
    handleCellChange(rowKey, 'jobDescription', description)
    handleSealHistory()
  }

  // Shows a resume change the server has already saved (an upload,
  // replacement or removal through /api/jobs/{id}/resume). Only the row's
  // resume changes, nothing is sent again, and it isn't part of undo; the
  // row's own unsaved edits (if any) are left for autosave as usual.
  function handleResumeSaved(rowKey: string, resumeVersionId: number | null, resume: AttachedResume | null) {
    const row = latestRows.current.get(rowKey)
    if (!row) {
      return
    }

    const updatedRow: GridRow = { ...row, resumeVersionId, resume }
    latestRows.current.set(rowKey, updatedRow)
    setApplications((current) =>
      current.map((application) => (application.rowKey === rowKey ? updatedRow : application)),
    )
  }

  // A row's values right now (they can change while a request is running).
  function getLatestRow(rowKey: string): GridRow | undefined {
    return latestRows.current.get(rowKey)
  }

  return {
    applications,
    getLatestRow,
    saveStatuses,
    isLoading,
    error,
    handleCellChange,
    handleApplyChanges,
    handleSaveDescription,
    handleResumeSaved,
    deleteRow,
    handleLeaveRows,
    handleUndo,
    handleRedo,
    handleSealHistory,
    handleRetry,
    addSavedRow,
    runInCreateQueue,
    handleSessionExpired,
  }
}

// What useJobs gives to components and other hooks.
export type JobsState = ReturnType<typeof useJobs>
