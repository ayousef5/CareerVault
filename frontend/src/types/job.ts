// The shapes of job data used throughout the frontend.
import type { ApplicationStatus } from '../lib/pasteParsing.ts'
import type { AttachedResume } from './resume.ts'

export type { ApplicationStatus }

// One job application, as returned by the backend (its JobResponse).
// Fields marked "| null" are optional in the database.
export type JobApplication = {
  id: number
  companyName: string
  jobTitle: string
  location: string | null
  jobUrl: string | null
  dateApplied: string | null
  status: ApplicationStatus
  notes: string | null
  jobDescription: string | null
  pay: string | null
  recruiter: string | null
  // The exact resume version attached to this application (null = none).
  // Chosen in the Resume dialog, never typed or pasted into the grid.
  resumeVersionId: number | null
  // Details of that version, for display (null = none).
  resume: AttachedResume | null
}

// Every text field the user can edit in the grid (everything except the
// id and the attached resume).
export type EditableField = Exclude<keyof JobApplication, 'id' | 'resumeVersionId' | 'resume'>

// New values for some of a row's fields, as text typed or pasted into cells.
export type RowValues = Partial<Record<EditableField, string>>

// A batch change from the grid. rowKey null means "add this as a new row".
export type RowUpdate = { rowKey: string | null; values: RowValues }

// One row in the grid: a job application plus a frontend-only "rowKey".
// The rowKey never changes, even when a new row's temporary id is replaced
// by its real database id, so React keeps the same row (and cursor) on screen.
export type GridRow = JobApplication & { rowKey: string }
