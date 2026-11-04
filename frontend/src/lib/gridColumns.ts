// The grid's columns: their order, labels, kinds and widths (and where
// the widths are remembered). No React code.
import type { EditableField, GridRow } from '../types/job.ts'

// The kind of control each column uses.
// 'description' and 'resume' are action columns: they show a button that
// opens the job description editor or the Resume dialog, rather than an
// editable value.
export type ColumnKind = 'text' | 'longText' | 'link' | 'date' | 'status' | 'description' | 'resume'

// What a column shows: a text field of the job, or (Resume) its attached
// resume version.
export type GridField = EditableField | 'resume'

export type GridColumn = {
  field: GridField
  label: string
  kind: ColumnKind
  // Starting width in pixels, and the narrowest the user can drag it to.
  defaultWidth: number
  minWidth: number
  required?: boolean
}

// The grid's columns, in display order. Keyboard navigation, selection,
// copy and paste all use this order, so the 1st pasted column goes into
// Company, the 2nd into Pay, and so on.
export const gridColumns: GridColumn[] = [
  { field: 'companyName', label: 'Company', kind: 'text', defaultWidth: 130, minWidth: 70, required: true },
  { field: 'pay', label: 'Pay', kind: 'text', defaultWidth: 76, minWidth: 50 },
  { field: 'location', label: 'Location', kind: 'text', defaultWidth: 108, minWidth: 60 },
  { field: 'jobUrl', label: 'App Link', kind: 'link', defaultWidth: 72, minWidth: 60 },
  { field: 'jobTitle', label: 'Role', kind: 'text', defaultWidth: 150, minWidth: 70, required: true },
  { field: 'dateApplied', label: 'Date Applied', kind: 'date', defaultWidth: 116, minWidth: 108 },
  { field: 'status', label: 'Status', kind: 'status', defaultWidth: 104, minWidth: 96 },
  { field: 'notes', label: 'Comments / Notes', kind: 'longText', defaultWidth: 170, minWidth: 70 },
  { field: 'recruiter', label: 'Recruiter', kind: 'text', defaultWidth: 104, minWidth: 60 },
  { field: 'jobDescription', label: 'Job Description', kind: 'description', defaultWidth: 116, minWidth: 96 },
  { field: 'resume', label: 'Resume', kind: 'resume', defaultWidth: 150, minWidth: 96 },
]

// A column backed by one of the job's text fields (every column except
// Resume).
export type FieldColumn = GridColumn & { field: EditableField }

export function isFieldColumn(column: GridColumn): column is FieldColumn {
  return column.field !== 'resume'
}

// Column widths in pixels, keyed by field name (so saved widths still match
// the right columns even if the column order changes later).
// (The job description isn't a grid column, so it has no width.)
export type ColumnWidths = Partial<Record<GridField, number>>

// Where column widths are kept in the browser. ("v2" because the default
// widths were made more compact; older saved widths are no longer used.)
export const COLUMN_WIDTHS_STORAGE_KEY = 'careervault.columnWidths.v2'

// Loads saved column widths, falling back to the defaults for any column
// that has no (valid) saved width.
export function loadColumnWidths(): ColumnWidths {
  let saved: Record<string, unknown> = {}

  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY) ?? '{}',
    )
    if (parsed !== null && typeof parsed === 'object') {
      saved = parsed as Record<string, unknown>
    }
  } catch {
    // Missing or damaged data: just use the defaults.
  }

  const widths: ColumnWidths = {}
  for (const column of gridColumns) {
    const value = saved[column.field]
    widths[column.field] =
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(column.minWidth, Math.round(value))
        : column.defaultWidth
  }
  return widths
}

// Saves column widths in the browser. This never talks to the backend.
export function saveColumnWidths(widths: ColumnWidths) {
  try {
    localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // Storage can be full or disabled (e.g. private browsing); widths
    // then simply won't be remembered.
  }
}

// Width of the last column, which holds each row's details and delete buttons.
export const ACTIONS_COLUMN_WIDTH = 60

// Total width of all data columns. The table is this plus the actions column.
export function getTotalWidth(widths: ColumnWidths): number {
  return gridColumns.reduce((total, column) => total + getColumnWidth(widths, column), 0)
}

// One column's width (its default if none is saved).
export function getColumnWidth(widths: ColumnWidths, column: GridColumn): number {
  return widths[column.field] ?? column.defaultWidth
}

export const LAST_COLUMN = gridColumns.length - 1

// True for columns holding a value you can type, paste, copy or clear.
// Action columns (the Job Description and Resume buttons) are skipped by
// copy, paste and Delete, so pasting by position works exactly as before.
export function isDataColumn(column: GridColumn): column is FieldColumn {
  return isFieldColumn(column) && column.kind !== 'description'
}

// The fields of the data columns, in grid order: where pasted values go
// by position.
export const pasteFields: EditableField[] = gridColumns
  .filter(isDataColumn)
  .map((column) => column.field)

// Reads a cell's value as text (empty fields become '').
export function getCellText(row: GridRow, field: EditableField): string {
  return row[field] ?? ''
}

