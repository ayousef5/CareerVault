// Rules for job rows that don't need React: what counts as an empty job,
// building the "Add Job" request, autosave and delete decisions, and
// merging server data with unsaved local work after logging in again.
// Kept separate so it can be unit-tested (see jobRows.test.ts).

import {
  extractLinkUrl,
  normalizeStatus,
  parsePastedDate,
  stripMarkdownLinks,
} from './pasteParsing.ts'

// ---------- Job fields ----------

// The status every new job starts with. On its own it doesn't count as
// information the user entered. (The backend uses the same rule.)
export const DEFAULT_STATUS = 'Not Applied'

// The job fields the user can fill in (the backend's CreateJobRequest).
export type JobField =
  | 'companyName'
  | 'pay'
  | 'location'
  | 'jobUrl'
  | 'jobTitle'
  | 'dateApplied'
  | 'status'
  | 'notes'
  | 'jobDescription'
  | 'recruiter'

export const JOB_FIELDS: readonly JobField[] = [
  'companyName',
  'pay',
  'location',
  'jobUrl',
  'jobTitle',
  'dateApplied',
  'status',
  'notes',
  'jobDescription',
  'recruiter',
]

// True when at least one field has something the user typed or chose.
// Blank text and the default "Not Applied" status don't count, so a row
// with nothing else is "empty". A row with only a company (or only a role,
// a link, a date...) is not empty.
export function hasMeaningfulContent(
  values: Partial<Record<JobField, string | null | undefined>>,
): boolean {
  return JOB_FIELDS.some((field) => {
    const value = (values[field] ?? '').trim()
    if (value === '') {
      return false
    }
    if (field === 'status') {
      return value.toLowerCase() !== DEFAULT_STATUS.toLowerCase()
    }
    return true
  })
}

// The same check for a whole row, which also counts an attached resume
// (as the backend does): a row with only a resume isn't empty.
export function rowHasContent(
  row: Partial<Record<JobField, string | null | undefined>> & { resumeVersionId?: number | null },
): boolean {
  return hasMeaningfulContent(row) || (row.resumeVersionId ?? null) !== null
}

// ---------- The "Add Job" form ----------

// What's typed into the Add Job form (every input gives us text).
export type NewJobForm = Record<JobField, string>

export const EMPTY_NEW_JOB: NewJobForm = {
  companyName: '',
  pay: '',
  location: '',
  jobUrl: '',
  jobTitle: '',
  dateApplied: '',
  status: DEFAULT_STATUS,
  notes: '',
  jobDescription: '',
  recruiter: '',
}

// The JSON body for POST and PUT /api/jobs.
export type JobRequestBody = {
  companyName: string
  jobTitle: string
  location: string | null
  jobUrl: string | null
  dateApplied: string | null
  status: string
  notes: string | null
  jobDescription: string | null
  pay: string | null
  recruiter: string | null
}

// Turns the Add Job form into a request body: trims the text and sends
// empty optional fields as null. Returns null when nothing meaningful was
// filled in, so no request is sent.
export function buildNewJobRequest(form: NewJobForm): JobRequestBody | null {
  if (!hasMeaningfulContent(form)) {
    return null
  }

  const optional = (value: string) => (value.trim() === '' ? null : value.trim())

  return {
    companyName: form.companyName.trim(),
    jobTitle: form.jobTitle.trim(),
    location: optional(form.location),
    jobUrl: optional(form.jobUrl),
    dateApplied: optional(form.dateApplied),
    status: form.status.trim() || DEFAULT_STATUS,
    notes: optional(form.notes),
    jobDescription: optional(form.jobDescription),
    pay: optional(form.pay),
    recruiter: optional(form.recruiter),
  }
}

// ---------- Save bookkeeping ----------

// The save state of a single row, shown in the grid.
export type RowSaveStatus =
  | 'unsaved'
  | 'saving'
  | 'saved'
  | 'failed'
  // Every field is empty: it isn't saved, and is deleted when you leave it.
  | 'empty'
  | 'deleting'
  | 'deleteFailed'

// Behind-the-scenes bookkeeping that autosave keeps for each row.
export type RowSync = {
  // The real database id, or null if the row hasn't been created yet.
  dbId: number | null
  // Goes up by 1 on every edit.
  version: number
  // The newest version the API has confirmed as saved.
  savedVersion: number
  // True while a save request for this row is running.
  isSaving: boolean
  // The pending autosave timer, if any.
  timer: number | undefined
  // True from the moment the row is being deleted until that finishes.
  // Autosave never sends a row while this is true.
  isDeleting: boolean
}

// Bookkeeping for a row. A row loaded from the database starts as
// "nothing to save"; a brand-new row starts as "needs saving".
export function createRowSync(dbId: number | null): RowSync {
  return {
    dbId,
    version: dbId === null ? 1 : 0,
    savedVersion: 0,
    isSaving: false,
    timer: undefined,
    isDeleting: false,
  }
}

// True when a row has edits the API hasn't confirmed yet, or a save is
// still running for it.
export function hasPendingChanges(sync: RowSync): boolean {
  return sync.isSaving || sync.version > sync.savedVersion
}

// What an autosave attempt should do for a row right now:
//  - 'skip':  nothing to do (row deleted or being deleted, or already saved)
//  - 'wait':  a request is already running; it saves again when it finishes
//  - 'empty': the row has no information, so don't store it
//  - 'post':  create it (no database id yet)
//  - 'put':   update the existing record
export type SaveDecision = 'skip' | 'wait' | 'empty' | 'post' | 'put'

export function decideSave(
  sync: RowSync | undefined,
  rowIsMeaningful: boolean,
): SaveDecision {
  // A deleted row has no bookkeeping, and a row being deleted must never be
  // sent again, so an old autosave timer can't re-create or overwrite it.
  if (!sync || sync.isDeleting) {
    return 'skip'
  }
  if (sync.isSaving) {
    return 'wait'
  }
  if (sync.savedVersion === sync.version) {
    return 'skip'
  }
  if (!rowIsMeaningful) {
    return 'empty'
  }
  return sync.dbId === null ? 'post' : 'put'
}

// What deleting a row needs to do:
//  - 'ignore':         already deleted, or a delete is already running
//  - 'remove-locally': never saved, so just remove it from the grid
//  - 'after-create':   its first save (POST) is still running; delete it
//                      once that returns the database id
//  - 'send-delete':    send DELETE /api/jobs/{id}
export type DeleteDecision = 'ignore' | 'remove-locally' | 'after-create' | 'send-delete'

export function decideDelete(sync: RowSync | undefined): DeleteDecision {
  if (!sync || sync.isDeleting) {
    return 'ignore'
  }
  if (sync.dbId === null) {
    return sync.isSaving ? 'after-create' : 'remove-locally'
  }
  return 'send-delete'
}

// The rows that were selected before but aren't any more ("left" rows).
export function rowsLeft(previous: readonly string[], next: readonly string[]): string[] {
  const stillSelected = new Set(next)
  return previous.filter((rowKey) => !stillSelected.has(rowKey))
}

// ---------- Merging after (re)loading ----------

export type MergePlan<Row> = {
  // The grid's rows, in order: the server's order, then local rows the
  // server doesn't have yet (in the order they were added).
  rows: Row[]
  // Every row's save state (rows that are gone have none).
  statuses: Record<string, RowSaveStatus>
  // Server copies that replace the local version of clean rows.
  cleanRows: Row[]
  // Server rows we had no bookkeeping for yet.
  newSyncs: { rowKey: string; dbId: number }[]
  // Rows whose save should be retried (with the new login token).
  rowsToRetry: string[]
  // Saved rows the server no longer has; forget them.
  rowsToForget: string[]
  // Database ids of completely empty jobs (e.g. blank rows left over from
  // before empty rows were blocked). They aren't shown and should be deleted.
  emptyJobsToDelete: number[]
}

// Works out how to combine the rows from GET /api/jobs with unsaved local
// work, without losing anything:
//  - Clean rows use the server's copy.
//  - Rows with unsaved edits (including failed saves) keep the local copy.
//  - New rows that were never saved are kept.
//  - Rows being deleted are kept until the delete finishes.
//  - Completely empty jobs with no unsaved local edits are left out and
//    listed for deletion. Jobs with at least one meaningful field stay.
// The server already returns rows in the order they were added.
export function planMerge<Job extends { id: number }>(
  serverJobs: readonly Job[],
  localRows: ReadonlyMap<string, Job & { rowKey: string }>,
  syncs: ReadonlyMap<string, RowSync>,
  previousStatuses: Readonly<Record<string, RowSaveStatus | undefined>>,
): MergePlan<Job & { rowKey: string }> {
  type Row = Job & { rowKey: string }

  const plan: MergePlan<Row> = {
    rows: [],
    statuses: {},
    cleanRows: [],
    newSyncs: [],
    rowsToRetry: [],
    rowsToForget: [],
    emptyJobsToDelete: [],
  }

  // Which local row stands for each database id. Rows added in this tab
  // keep their "new-..." rowKey after being saved, so look them up by id.
  const rowKeyByDbId = new Map<number, string>()
  for (const [rowKey, sync] of syncs) {
    if (sync.dbId !== null) {
      rowKeyByDbId.set(sync.dbId, rowKey)
    }
  }

  const included = new Set<string>()

  // Keeps a local row that still has work to finish.
  function keepLocal(rowKey: string, row: Row, sync: RowSync) {
    plan.rows.push(row)
    included.add(rowKey)

    if (sync.isDeleting) {
      plan.statuses[rowKey] = 'deleting'
      return
    }

    const previous = previousStatuses[rowKey]
    plan.statuses[rowKey] = sync.isSaving
      ? 'saving'
      : previous === 'failed' || previous === 'empty'
        ? previous
        : 'unsaved'

    // A row whose request is still running isn't retried: when that request
    // finishes it saves again if needed, so a new row is never POSTed twice.
    if (!sync.isSaving) {
      plan.rowsToRetry.push(rowKey)
    }
  }

  // 1. Every row the server returned, in the server's order.
  for (const job of serverJobs) {
    const rowKey = rowKeyByDbId.get(job.id) ?? `db-${job.id}`
    if (included.has(rowKey)) {
      continue
    }

    const sync = syncs.get(rowKey)
    const local = localRows.get(rowKey)

    if (sync && local && (hasPendingChanges(sync) || sync.isDeleting)) {
      keepLocal(rowKey, local, sync)
      continue
    }

    // A completely empty job with no local edits: clean it up instead of
    // showing it. (Not for a "Delete failed" row: Retry handles that one.)
    if (
      !rowHasContent(job as Partial<Record<JobField, string | null>> & { resumeVersionId?: number | null }) &&
      previousStatuses[rowKey] !== 'deleteFailed'
    ) {
      plan.emptyJobsToDelete.push(job.id)
      included.add(rowKey)
      if (sync) {
        plan.rowsToForget.push(rowKey)
      }
      continue
    }

    // Clean row: the server's copy is the latest.
    const row = { ...job, rowKey } as Row
    plan.rows.push(row)
    plan.cleanRows.push(row)
    included.add(rowKey)
    if (!sync) {
      plan.newSyncs.push({ rowKey, dbId: job.id })
    }
    // Keep "Delete failed" so the Retry button can still delete it.
    plan.statuses[rowKey] =
      previousStatuses[rowKey] === 'deleteFailed' ? 'deleteFailed' : 'saved'
  }

  // 2. Local rows the server didn't return.
  for (const [rowKey, row] of localRows) {
    if (included.has(rowKey)) {
      continue
    }

    const sync = syncs.get(rowKey)
    if (sync && (sync.dbId === null || hasPendingChanges(sync) || sync.isDeleting)) {
      keepLocal(rowKey, row, sync)
    } else {
      // A saved row the server no longer has (e.g. deleted elsewhere).
      plan.rowsToForget.push(rowKey)
    }
  }

  return plan
}

// ---------- Pasting spreadsheet data ----------

// Converts pasted text into the value stored for a field. Returns null when
// the text can't be used (an empty or invalid date, or an unknown status),
// so that cell is left as it was. "fromMarkdown" is true when the text came
// from a Markdown table. Used by both the grid and the Add Job entry row.
export function convertPastedValue(
  field: JobField,
  text: string,
  fromMarkdown: boolean,
): string | null {
  if (field === 'jobUrl') {
    // "[FedEx Job](https://...)" → "https://..."; a plain URL stays as is.
    return extractLinkUrl(text)
  }

  // In Markdown, "[FedEx Job](https://...)" in any other column keeps
  // just the link text, "FedEx Job".
  const value = fromMarkdown ? stripMarkdownLinks(text) : text

  if (field === 'dateApplied') {
    // e.g. "10/30/2026" or "Oct 30, 2026" → "2026-10-30"
    return parsePastedDate(value)
  }

  if (field === 'status') {
    // e.g. "applied", " Interview " or "Phone screen" → a real status
    return normalizeStatus(value)
  }

  return value.trim()
}

// What pasting into the Add Job entry row should do:
//  - 'native': a single value; let the browser paste it into the field.
//  - 'fill':   one row; put its values into the entry row's fields.
//  - 'create': several rows; create a job for each (in order).
// "invalidDates" counts dates that couldn't be read (they're left empty).
export type EntryRowPaste =
  | { kind: 'native' }
  | { kind: 'fill'; values: Partial<NewJobForm>; invalidDates: number }
  | {
      kind: 'create'
      rows: Partial<Record<JobField, string>>[]
      invalidDates: number
      skippedEmptyRows: number
    }

// Works out how pasted cells map onto the Add Job fields.
//  - Without a header row, columns go by position, starting at the field
//    that was pasted into (usually Company), in the grid's column order.
//    Columns past the last field are ignored.
//  - With a recognised Markdown header row, each column goes to the field
//    its header names.
//  - Empty pasted cells stay in place, so later values don't shift into
//    the wrong fields.
//  - Completely empty rows are skipped when creating jobs.
export function planEntryRowPaste(
  table: { rows: string[][]; isMarkdown: boolean; fields: (JobField | null)[] | null },
  startField: JobField,
  columnFields: readonly JobField[],
): EntryRowPaste {
  const { rows, isMarkdown, fields } = table

  if (rows.length === 0 || (fields === null && rows.length === 1 && rows[0].length === 1)) {
    return { kind: 'native' }
  }

  const startIndex = Math.max(0, columnFields.indexOf(startField))

  // The field each pasted column goes into (undefined = skip it).
  function fieldForColumn(index: number): JobField | undefined {
    if (fields) {
      return fields[index] ?? undefined
    }
    return columnFields[startIndex + index]
  }

  let invalidDates = 0

  function convertRow(cells: string[]): Partial<Record<JobField, string>> {
    const values: Partial<Record<JobField, string>> = {}
    const width = Math.max(cells.length, fields?.length ?? 0)

    for (let i = 0; i < width; i++) {
      const field = fieldForColumn(i)
      if (field === undefined) {
        continue
      }

      const text = cells[i] ?? ''
      if (text.trim() === '') {
        // An empty cell empties that field (Status keeps its value, since
        // it can never be empty).
        if (field !== 'status') {
          values[field] = ''
        }
        continue
      }

      const value = convertPastedValue(field, text, isMarkdown)
      if (value === null) {
        // Not a real date, or not a status we know: leave the field alone.
        if (field === 'dateApplied') {
          invalidDates += 1
        }
        continue
      }
      values[field] = value
    }

    return values
  }

  if (rows.length === 1) {
    const values = convertRow(rows[0])
    return { kind: 'fill', values, invalidDates }
  }

  const converted = rows.map(convertRow)
  const meaningful = converted.filter((values) => hasMeaningfulContent(values))

  return {
    kind: 'create',
    rows: meaningful,
    invalidDates,
    skippedEmptyRows: converted.length - meaningful.length,
  }
}

// ---------- Creating jobs in order ----------

// Makes a queue that runs async tasks one at a time, in the order they
// were added, even if an earlier one fails. Jobs are created through this
// so the server numbers them (their sort order) in the same order.
export function createTaskQueue() {
  let last: Promise<unknown> = Promise.resolve()

  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = last.then(task, task)
    last = result.catch(() => undefined)
    return result
  }
}
