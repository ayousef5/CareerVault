// Unit tests for the grid column definitions. Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  getCellText,
  getColumnWidth,
  getTotalWidth,
  gridColumns,
  isDataColumn,
  isFieldColumn,
  LAST_COLUMN,
  loadColumnWidths,
  pasteFields,
} from './gridColumns.ts'
import type { GridRow } from '../types/job.ts'

describe('gridColumns', () => {
  test('has the grid columns in order (no Requirements column)', () => {
    assert.deepEqual(
      gridColumns.map((column) => column.label),
      [
        'Company',
        'Pay',
        'Location',
        'App Link',
        'Role',
        'Date Applied',
        'Status',
        'Comments / Notes',
        'Recruiter',
        'Job Description',
        'Resume',
      ],
    )
    assert.equal(LAST_COLUMN, 10)
  })

  test('the Resume column is an action column with no text field behind it', () => {
    const resume = gridColumns[10]
    assert.equal(resume.kind, 'resume')
    assert.equal(isFieldColumn(resume), false)
    assert.equal(isDataColumn(resume), false)
    // Every other column is backed by one of the job's text fields.
    assert.ok(gridColumns.slice(0, 10).every(isFieldColumn))
  })

  test('the Job Description column is an action column, not pasted by position', () => {
    assert.equal(isDataColumn(gridColumns[9]), false)
    assert.ok(gridColumns.slice(0, 9).every(isDataColumn))
    // Pasting by position still goes into the 9 data columns only.
    assert.deepEqual(pasteFields, gridColumns.slice(0, 9).map((column) => column.field))
  })

  test('every column can be at least as narrow as its minimum width', () => {
    for (const column of gridColumns) {
      assert.ok(column.minWidth <= column.defaultWidth, column.label)
    }
  })
})

describe('column widths', () => {
  test('uses defaults when nothing is saved', () => {
    // Without browser storage (as in these tests), the defaults are used.
    const widths = loadColumnWidths()
    for (const column of gridColumns) {
      assert.equal(widths[column.field], column.defaultWidth)
    }
  })

  test('falls back to the default for a column with no saved width', () => {
    const company = gridColumns[0]
    assert.equal(getColumnWidth({}, company), company.defaultWidth)
    assert.equal(getColumnWidth({ companyName: 200 }, company), 200)
  })

  test('adds up every column width', () => {
    const defaults = gridColumns.reduce((total, column) => total + column.defaultWidth, 0)
    assert.equal(getTotalWidth({}), defaults)
    assert.equal(getTotalWidth({ companyName: gridColumns[0].defaultWidth + 50 }), defaults + 50)
  })
})

describe('getCellText', () => {
  test('reads a field as text, with empty fields as ""', () => {
    const row = { rowKey: 'db-1', companyName: 'Acme', location: null } as GridRow
    assert.equal(getCellText(row, 'companyName'), 'Acme')
    assert.equal(getCellText(row, 'location'), '')
  })
})
