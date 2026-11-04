// Puts details read from a job posting link into the Add Job entry row.
// No React code, so it can be unit-tested (see autofill.test.ts).
import type { ExtractedJobResponse } from '../api/jobExtractionApi.ts'
import { EMPTY_NEW_JOB } from './jobRows.ts'
import type { JobField, NewJobForm } from './jobRows.ts'

// Which extracted value goes into which Add Job field. Date Applied,
// Status and Comments / Notes are never touched by autofill.
const AUTOFILL_FIELDS: { field: JobField; from: keyof ExtractedJobResponse; label: string }[] = [
  { field: 'companyName', from: 'companyName', label: 'Company' },
  { field: 'jobTitle', from: 'jobTitle', label: 'Role' },
  { field: 'location', from: 'location', label: 'Location' },
  { field: 'pay', from: 'pay', label: 'Pay' },
  { field: 'recruiter', from: 'recruiter', label: 'Recruiter' },
  { field: 'jobDescription', from: 'jobDescription', label: 'Job description' },
  { field: 'jobUrl', from: 'url', label: 'App Link' },
]

export type AutofillOutcome = {
  // The form with empty fields filled in.
  form: NewJobForm
  // Fields that were filled from the posting.
  filled: JobField[]
  // Fields the posting had a different value for, but which already had
  // the user's own text, so they were left alone.
  kept: JobField[]
}

// Fills only the EMPTY fields of the form with extracted values. Anything
// the user already typed is kept, including a description and the link.
export function applyAutofill(form: NewJobForm, extracted: ExtractedJobResponse): AutofillOutcome {
  const next = { ...form }
  const filled: JobField[] = []
  const kept: JobField[] = []

  for (const { field, from } of AUTOFILL_FIELDS) {
    const value = extracted[from]?.trim()
    if (!value) {
      continue
    }

    const current = form[field].trim()
    if (current !== '') {
      if (current !== value && field !== 'jobUrl') {
        kept.push(field)
      }
      continue
    }

    next[field] = value
    filled.push(field)
  }

  return { form: next, filled, kept }
}

function labelsFor(fields: JobField[]): string {
  return fields
    .map((field) => AUTOFILL_FIELDS.find((item) => item.field === field)?.label ?? field)
    .join(', ')
}

// A short message telling the user what autofill did.
export function describeAutofill(outcome: AutofillOutcome): string {
  // The link itself doesn't count as "found information".
  const filled = outcome.filled.filter((field) => field !== 'jobUrl')

  if (filled.length === 0 && outcome.kept.length === 0) {
    return "No job details could be read from that posting. Please enter them manually."
  }

  if (filled.length === 0) {
    return `Nothing new to fill in: you've already entered ${labelsFor(outcome.kept)}, so your values were kept.`
  }

  let message = `Filled in ${labelsFor(filled)} from the posting. Review them, then click Add.`
  if (outcome.kept.length > 0) {
    message += ` Kept your own ${labelsFor(outcome.kept)}.`
  }
  if (filled.includes('jobDescription')) {
    message += ' The full description is saved with the job (see Open details).'
  }
  return message
}

// True when the text looks like a complete job posting link worth reading
// automatically: an http(s) URL with a dotted host and no spaces. Partial
// typing ("https://goo") doesn't count, so nothing fires too early.
export function isLikelyJobUrl(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length > 2048 || /\s/.test(trimmed)) {
    return false
  }
  try {
    const url = new URL(trimmed)
    const host = url.hostname
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(host)
    )
  } catch {
    return false
  }
}

// The text values of a row already in the grid (null fields become '').
type RowText = { [Field in JobField]?: string | null }

// For a job already in the grid: the values to fill from an extracted
// posting. Same rule as the Add Job row (applyAutofill): only EMPTY fields
// are filled; Date Applied, Status and Notes are never touched.
export function planRowAutofill(
  row: RowText,
  extracted: ExtractedJobResponse,
): { values: Partial<Record<JobField, string>>; filled: JobField[] } {
  const form = { ...EMPTY_NEW_JOB }
  for (const field of Object.keys(form) as JobField[]) {
    form[field] = row[field] ?? ''
  }

  const outcome = applyAutofill(form, extracted)
  const values: Partial<Record<JobField, string>> = {}
  for (const field of outcome.filled) {
    values[field] = outcome.form[field]
  }
  return { values, filled: outcome.filled.filter((field) => field !== 'jobUrl') }
}

// Runs one task at a time: while one is running, further calls are
// ignored (they return null) instead of starting duplicate requests.
export function createSingleFlight() {
  let busy = false

  return {
    get isBusy() {
      return busy
    },
    async run<T>(task: () => Promise<T>): Promise<T | null> {
      if (busy) {
        return null
      }
      busy = true
      try {
        return await task()
      } finally {
        busy = false
      }
    },
  }
}
