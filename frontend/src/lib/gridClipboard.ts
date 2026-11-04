// What copying from and pasting into the grid should do. The grid
// component only handles the browser's copy/paste events and calls these.
// No React code, so it can be unit-tested (see gridClipboard.test.ts).
import type { GridRow, RowUpdate, RowValues } from '../types/job.ts'
import { getCellText, gridColumns, isDataColumn, LAST_COLUMN } from './gridColumns.ts'
import { convertPastedValue } from './jobRows.ts'
import type { PastedTable } from './pasteParsing.ts'
import { toClipboardCell } from './pasteParsing.ts'
import type { CellRange } from './spreadsheetEdits.ts'

// The selected cells as tab-separated text that Excel and Google Sheets
// understand (one line per row).
export function buildCopyText(rows: readonly GridRow[], range: CellRange): string {
  const lines: string[] = []

  for (let r = range.top; r <= range.bottom; r++) {
    const row = rows[r]
    if (!row) {
      continue
    }

    const cells: string[] = []
    for (let c = range.left; c <= range.right; c++) {
      const column = gridColumns[c]
      // Action columns (the job description button) copy as empty cells,
      // matching paste, which skips them.
      cells.push(isDataColumn(column) ? toClipboardCell(getCellText(row, column.field)) : '')
    }
    lines.push(cells.join('\t'))
  }

  return lines.join('\n')
}

// A single value with no header (e.g. one copied cell).
export function isSingleValuePaste(table: PastedTable): boolean {
  return table.fields === null && table.rows.length === 1 && table.rows[0].length === 1
}

export type GridPastePlan = {
  // One change per affected row; rowKey null means "create a new row".
  updates: RowUpdate[]
  // The pasted area to select afterwards (anchor = bottom-right, focus =
  // top-left), or null when only a description was pasted.
  selection: {
    anchor: { row: number; col: number }
    focus: { row: number; col: number }
  } | null
}

// Works out how a paste fills the grid, starting at the selected range.
// Returns null when nothing in the pasted data maps onto the grid.
//  - A single value pasted over a selected range fills every cell in it.
//  - With a recognised Markdown header row, each column goes to the field
//    its header names; columns with unrecognised headers are skipped.
//  - Otherwise columns go by position from the selected cell, and anything
//    past the last column is skipped.
//  - Empty pasted cells empty that cell (they never shift other values).
//  - Rows past the end of the grid become new rows.
//  - A "Requirements"/"Job Description" header column fills the job
//    description (not a grid column), but an empty one never erases it.
export function planGridPaste(
  table: PastedTable,
  range: CellRange,
  rows: readonly { rowKey: string }[],
): GridPastePlan | null {
  const { rows: cells, isMarkdown, fields } = table
  const isSingleValue = isSingleValuePaste(table)

  const height = isSingleValue ? range.bottom - range.top + 1 : cells.length
  const sourceWidth = isSingleValue
    ? range.right - range.left + 1
    : Math.max(fields?.length ?? 0, ...cells.map((row) => row.length))

  // Which grid column each pasted column goes into (-1 = skip it). Only
  // data columns receive values; the job description is handled below.
  const targetColumns: number[] = []
  for (let i = 0; i < sourceWidth; i++) {
    if (fields) {
      const field = fields[i]
      targetColumns.push(
        field ? gridColumns.findIndex((column) => isDataColumn(column) && column.field === field) : -1,
      )
    } else {
      const col = range.left + i
      targetColumns.push(col <= LAST_COLUMN && isDataColumn(gridColumns[col]) ? col : -1)
    }
  }

  const descriptionColumn = fields ? fields.indexOf('jobDescription') : -1

  const usedColumns = targetColumns.filter((col) => col !== -1)
  if (usedColumns.length === 0 && descriptionColumn === -1) {
    return null
  }

  const updates: RowUpdate[] = []

  for (let r = 0; r < height; r++) {
    const values: RowValues = {}

    for (let i = 0; i < sourceWidth; i++) {
      const col = targetColumns[i]
      const column = gridColumns[col]
      if (col === -1 || !isDataColumn(column)) {
        continue
      }

      const text = isSingleValue ? cells[0][0] : (cells[r][i] ?? '')
      const value = convertPastedValue(column.field, text, isMarkdown)
      if (value !== null) {
        values[column.field] = value
      }
    }

    if (descriptionColumn !== -1) {
      const text = cells[r][descriptionColumn] ?? ''
      if (text.trim() !== '') {
        values.jobDescription = convertPastedValue('jobDescription', text, isMarkdown) ?? ''
      }
    }

    const row = rows[range.top + r]
    if (row && Object.keys(values).length === 0) {
      continue
    }

    updates.push({ rowKey: row ? row.rowKey : null, values })
  }

  const selection =
    usedColumns.length > 0
      ? {
          anchor: { row: range.top + height - 1, col: Math.max(...usedColumns) },
          focus: { row: range.top, col: Math.min(...usedColumns) },
        }
      : null

  return { updates, selection }
}
