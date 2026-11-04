// Unit tests for copying from and pasting into the grid. Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { GridRow } from '../types/job.ts'
import { buildCopyText, isSingleValuePaste, planGridPaste } from './gridClipboard.ts'
import { parsePastedTable } from './pasteParsing.ts'

// Column indexes: 0 Company, 1 Pay, 2 Location, 3 App Link, 4 Role,
// 5 Date Applied, 6 Status, 7 Comments / Notes, 8 Recruiter.
const row = (rowKey: string, values: Partial<GridRow> = {}) =>
  ({
    rowKey,
    id: 1,
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
    ...values,
  }) as GridRow

const rows = [row('a', { companyName: 'Acme', pay: '25/hr' }), row('b', { companyName: 'Globex' })]

describe('buildCopyText', () => {
  test('copies the selected cells as tab-separated rows', () => {
    assert.equal(
      buildCopyText(rows, { top: 0, bottom: 1, left: 0, right: 2 }),
      'Acme\t25/hr\t\nGlobex\t\t',
    )
  })

  test('copies the Job Description column as empty cells', () => {
    const withDescription = [row('a', { recruiter: 'Sam', jobDescription: 'Full text' })]
    assert.equal(buildCopyText(withDescription, { top: 0, bottom: 0, left: 8, right: 9 }), 'Sam\t')
  })

  test('quotes cells that contain tabs, line breaks or quotes', () => {
    const notes = [row('a', { notes: 'line 1\nsaid "hi"' })]
    assert.equal(buildCopyText(notes, { top: 0, bottom: 0, left: 7, right: 7 }), '"line 1\nsaid ""hi"""')
  })
})

describe('planGridPaste', () => {
  const at = (top: number, left: number) => ({ top, bottom: top, left, right: left })

  test('pastes rows by position from the selected cell', () => {
    const plan = planGridPaste(parsePastedTable('Initech\t30/hr\nUmbrella\t'), at(0, 0), rows)

    assert.deepEqual(plan?.updates, [
      { rowKey: 'a', values: { companyName: 'Initech', pay: '30/hr' } },
      { rowKey: 'b', values: { companyName: 'Umbrella', pay: '' } },
    ])
    assert.deepEqual(plan?.selection, { anchor: { row: 1, col: 1 }, focus: { row: 0, col: 0 } })
  })

  test('creates new rows past the end of the grid', () => {
    const plan = planGridPaste(parsePastedTable('One\nTwo\nThree'), at(1, 0), rows)

    assert.deepEqual(
      plan?.updates.map((update) => update.rowKey),
      ['b', null, null],
    )
  })

  test('ignores columns past the last one', () => {
    const plan = planGridPaste(parsePastedTable('Sam\textra\tmore'), at(0, 8), rows)
    assert.deepEqual(plan?.updates, [{ rowKey: 'a', values: { recruiter: 'Sam' } }])
  })

  test('never pastes into the Job Description column by position', () => {
    // Starting at Recruiter (8): the next column is the description button.
    const plan = planGridPaste(parsePastedTable('Sam\tLong description text'), at(0, 8), rows)
    assert.deepEqual(plan?.updates, [{ rowKey: 'a', values: { recruiter: 'Sam' } }])

    // Pasting straight onto the description column does nothing.
    assert.equal(planGridPaste(parsePastedTable('a\tb'), at(0, 9), rows), null)
  })

  test('a single value fills every selected cell', () => {
    const plan = planGridPaste(parsePastedTable('Applied'), { top: 0, bottom: 1, left: 6, right: 6 }, rows)
    assert.deepEqual(plan?.updates, [
      { rowKey: 'a', values: { status: 'Applied' } },
      { rowKey: 'b', values: { status: 'Applied' } },
    ])
  })

  test('skips existing rows when nothing usable was pasted for them', () => {
    // "maybe" isn't a known status, so row "a" is left alone.
    const plan = planGridPaste(parsePastedTable('maybe'), at(0, 6), rows)
    assert.deepEqual(plan?.updates, [])
  })

  test('maps Markdown columns by header, including the job description', () => {
    const table = parsePastedTable(
      ['| Role | Company | Job Description |', '| --- | --- | --- |', '| Intern | FedEx | Ship it |'].join('\n'),
    )

    const plan = planGridPaste(table, at(1, 3), rows)

    assert.deepEqual(plan?.updates, [
      { rowKey: 'b', values: { jobTitle: 'Intern', companyName: 'FedEx', jobDescription: 'Ship it' } },
    ])
    assert.deepEqual(plan?.selection, { anchor: { row: 1, col: 4 }, focus: { row: 1, col: 0 } })
  })

  test('an empty pasted description never erases an existing one', () => {
    const table = parsePastedTable(['| Company | Requirements |', '| --- | --- |', '| FedEx | |'].join('\n'))

    const plan = planGridPaste(table, at(0, 0), rows)

    assert.deepEqual(plan?.updates, [{ rowKey: 'a', values: { companyName: 'FedEx' } }])
  })

  test('returns null when nothing maps onto the grid', () => {
    const table = parsePastedTable(['| Mystery | Company |', '| --- | --- |', '| x | y |'].join('\n'))
    // Only "Company" is known, so this does map...
    assert.notEqual(planGridPaste(table, at(0, 0), rows), null)

    // ...but a position-based paste that starts past the last column doesn't.
    assert.equal(planGridPaste(parsePastedTable('a\tb'), at(0, 9), rows), null)
  })
})

describe('isSingleValuePaste', () => {
  test('is true only for one cell with no header', () => {
    assert.equal(isSingleValuePaste(parsePastedTable('Acme')), true)
    assert.equal(isSingleValuePaste(parsePastedTable('Acme\tCorp')), false)
    assert.equal(isSingleValuePaste(parsePastedTable('| Company |\n| --- |\n| Acme |')), false)
  })
})
