// Unit tests for clearing ranges and undo/redo. Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildClearChanges,
  EditHistory,
  groupChangesByRow,
} from './spreadsheetEdits.ts'

type Field = 'company' | 'pay' | 'status' | 'notes'
type Row = { rowKey: string } & Record<Field, string>

const columns: Field[] = ['company', 'pay', 'status', 'notes']
const getText = (row: Row, field: Field) => row[field]

// The App clears Status to "Not Applied" instead of leaving it empty.
const statusReset: Partial<Record<Field, string>> = { status: 'Not Applied' }

const rows: Row[] = [
  { rowKey: 'a', company: 'FedEx', pay: '25/hr', status: 'Applied', notes: '' },
  { rowKey: 'b', company: 'Google', pay: '', status: 'Offer', notes: 'call back' },
  { rowKey: 'c', company: '', pay: '', status: 'Not Applied', notes: '' },
]

describe('buildClearChanges', () => {
  test('clears a rectangular range, one change per row', () => {
    assert.deepEqual(
      buildClearChanges(rows, { top: 0, bottom: 1, left: 0, right: 1 }, columns, getText),
      [
        { rowKey: 'a', values: { company: '', pay: '' } },
        { rowKey: 'b', values: { company: '' } },
      ],
    )
  })

  test('clears an entire column without touching other columns', () => {
    assert.deepEqual(
      buildClearChanges(rows, { top: 0, bottom: 2, left: 3, right: 3 }, columns, getText),
      [{ rowKey: 'b', values: { notes: '' } }],
    )
  })

  test('clears several whole columns, resetting Status to "Not Applied"', () => {
    assert.deepEqual(
      buildClearChanges(
        rows,
        { top: 0, bottom: 2, left: 1, right: 3 },
        columns,
        getText,
        statusReset,
      ),
      [
        { rowKey: 'a', values: { pay: '', status: 'Not Applied' } },
        { rowKey: 'b', values: { status: 'Not Applied', notes: '' } },
      ],
    )
  })

  test('skips columns with no field (action columns)', () => {
    assert.deepEqual(
      buildClearChanges(rows, { top: 0, bottom: 1, left: 0, right: 1 }, ['company', undefined], getText),
      [
        { rowKey: 'a', values: { company: '' } },
        { rowKey: 'b', values: { company: '' } },
      ],
    )
  })

  test('returns nothing when every selected cell is already empty', () => {
    assert.deepEqual(
      buildClearChanges(rows, { top: 2, bottom: 2, left: 0, right: 1 }, columns, getText),
      [],
    )
  })

  test('ignores rows past the end', () => {
    assert.deepEqual(
      buildClearChanges(rows, { top: 2, bottom: 9, left: 0, right: 0 }, columns, getText),
      [],
    )
  })
})

describe('clearing Status cells', () => {
  // Status is column 2.
  const STATUS = 2

  test('a single Status cell resets to "Not Applied"', () => {
    assert.deepEqual(
      buildClearChanges(
        rows,
        { top: 0, bottom: 0, left: STATUS, right: STATUS },
        columns,
        getText,
        statusReset,
      ),
      [{ rowKey: 'a', values: { status: 'Not Applied' } }],
    )
  })

  test('a Status cell that is already "Not Applied" is not changed', () => {
    assert.deepEqual(
      buildClearChanges(
        rows,
        { top: 2, bottom: 2, left: STATUS, right: STATUS },
        columns,
        getText,
        statusReset,
      ),
      [],
    )
  })

  test('a range including Status resets it alongside the other cells', () => {
    assert.deepEqual(
      buildClearChanges(
        rows,
        { top: 0, bottom: 1, left: 1, right: STATUS },
        columns,
        getText,
        statusReset,
      ),
      [
        { rowKey: 'a', values: { pay: '', status: 'Not Applied' } },
        { rowKey: 'b', values: { status: 'Not Applied' } },
      ],
    )
  })

  test('clearing the entire Status column resets every row, never to empty', () => {
    const changes = buildClearChanges(
      rows,
      { top: 0, bottom: rows.length - 1, left: STATUS, right: STATUS },
      columns,
      getText,
      statusReset,
    )

    assert.deepEqual(changes, [
      { rowKey: 'a', values: { status: 'Not Applied' } },
      { rowKey: 'b', values: { status: 'Not Applied' } },
    ])
    for (const change of changes) {
      assert.notEqual(change.values.status, '')
    }
  })

  test('clearing the Status column is one undo step that undo and redo reverse', () => {
    // The same steps the App takes: build the clear, record it as one
    // batch, then undo (apply "before") and redo (apply "after").
    const changes = buildClearChanges(
      rows,
      { top: 0, bottom: rows.length - 1, left: STATUS, right: STATUS },
      columns,
      getText,
      statusReset,
    )

    const history = new EditHistory<Field>()
    history.recordBatch(
      changes.flatMap(({ rowKey, values }) =>
        Object.entries(values).map(([field, after]) => ({
          rowKey,
          field: field as Field,
          before: getText(rows.find((row) => row.rowKey === rowKey)!, field as Field),
          after: after ?? '',
        })),
      ),
    )

    const undone = history.undo()
    assert.ok(undone)
    assert.equal(history.canUndo, false)
    assert.deepEqual(groupChangesByRow(undone, 'before'), [
      { rowKey: 'a', values: { status: 'Applied' } },
      { rowKey: 'b', values: { status: 'Offer' } },
    ])

    const redone = history.redo()
    assert.ok(redone)
    assert.deepEqual(groupChangesByRow(redone, 'after'), [
      { rowKey: 'a', values: { status: 'Not Applied' } },
      { rowKey: 'b', values: { status: 'Not Applied' } },
    ])
  })
})

describe('groupChangesByRow', () => {
  test('groups before/after values per row', () => {
    const changes = [
      { rowKey: 'a', field: 'company' as Field, before: 'Old', after: 'New' },
      { rowKey: 'a', field: 'pay' as Field, before: '', after: '25/hr' },
      { rowKey: 'b', field: 'notes' as Field, before: 'x', after: '' },
    ]
    assert.deepEqual(groupChangesByRow(changes, 'before'), [
      { rowKey: 'a', values: { company: 'Old', pay: '' } },
      { rowKey: 'b', values: { notes: 'x' } },
    ])
    assert.deepEqual(groupChangesByRow(changes, 'after'), [
      { rowKey: 'a', values: { company: 'New', pay: '25/hr' } },
      { rowKey: 'b', values: { notes: '' } },
    ])
  })
})

describe('EditHistory', () => {
  test('merges keystrokes in one cell into a single undo step', () => {
    const history = new EditHistory<Field>()
    history.recordCellEdit({ rowKey: 'a', field: 'company', before: '', after: 'F' })
    history.recordCellEdit({ rowKey: 'a', field: 'company', before: 'F', after: 'Fe' })
    history.recordCellEdit({ rowKey: 'a', field: 'company', before: 'Fe', after: 'FedEx' })

    assert.deepEqual(history.undo(), [
      { rowKey: 'a', field: 'company', before: '', after: 'FedEx' },
    ])
    assert.equal(history.canUndo, false)
  })

  test('sealing starts a new undo step, even for the same cell', () => {
    const history = new EditHistory<Field>()
    history.recordCellEdit({ rowKey: 'a', field: 'pay', before: '', after: '25' })
    history.seal()
    history.recordCellEdit({ rowKey: 'a', field: 'pay', before: '25', after: '30' })

    assert.deepEqual(history.undo(), [{ rowKey: 'a', field: 'pay', before: '25', after: '30' }])
    assert.deepEqual(history.undo(), [{ rowKey: 'a', field: 'pay', before: '', after: '25' }])
  })

  test('editing a different cell starts a new undo step', () => {
    const history = new EditHistory<Field>()
    history.recordCellEdit({ rowKey: 'a', field: 'pay', before: '', after: '25' })
    history.recordCellEdit({ rowKey: 'b', field: 'pay', before: '', after: '30' })
    assert.equal(history.undo()?.[0].rowKey, 'b')
    assert.equal(history.undo()?.[0].rowKey, 'a')
  })

  test('typing and then restoring the original value records nothing', () => {
    const history = new EditHistory<Field>()
    history.recordCellEdit({ rowKey: 'a', field: 'notes', before: 'hi', after: 'hix' })
    history.recordCellEdit({ rowKey: 'a', field: 'notes', before: 'hix', after: 'hi' })
    assert.equal(history.canUndo, false)
  })

  test('a multi-cell paste is a single undo step', () => {
    const history = new EditHistory<Field>()
    history.recordBatch([
      { rowKey: 'a', field: 'company', before: '', after: 'FedEx' },
      { rowKey: 'a', field: 'pay', before: '', after: '25/hr' },
      { rowKey: 'b', field: 'company', before: 'Old', after: 'Google' },
      { rowKey: 'b', field: 'pay', before: '30', after: '30' }, // unchanged: dropped
    ])

    const undone = history.undo()
    assert.equal(undone?.length, 3)
    assert.equal(history.canUndo, false)
  })

  test('a batch with no real changes is not recorded', () => {
    const history = new EditHistory<Field>()
    history.recordBatch([{ rowKey: 'a', field: 'pay', before: '1', after: '1' }])
    history.recordBatch([])
    assert.equal(history.canUndo, false)
  })

  test('undo and redo walk back and forth through several actions', () => {
    const history = new EditHistory<Field>()
    history.recordBatch([{ rowKey: 'a', field: 'company', before: '', after: 'One' }])
    history.recordBatch([{ rowKey: 'a', field: 'company', before: 'One', after: 'Two' }])
    history.recordBatch([{ rowKey: 'a', field: 'company', before: 'Two', after: 'Three' }])

    assert.equal(history.undo()?.[0].before, 'Two')
    assert.equal(history.undo()?.[0].before, 'One')
    assert.equal(history.redo()?.[0].after, 'Two')
    assert.equal(history.redo()?.[0].after, 'Three')
    assert.equal(history.redo(), null)
    assert.equal(history.canUndo, true)
  })

  test('a new edit after undoing clears the redo history', () => {
    const history = new EditHistory<Field>()
    history.recordBatch([{ rowKey: 'a', field: 'pay', before: '', after: '1' }])
    history.undo()
    assert.equal(history.canRedo, true)

    history.recordCellEdit({ rowKey: 'a', field: 'pay', before: '', after: '2' })
    assert.equal(history.canRedo, false)
  })

  test('a no-op edit after undoing keeps the redo history', () => {
    const history = new EditHistory<Field>()
    history.recordBatch([{ rowKey: 'a', field: 'pay', before: '', after: '1' }])
    history.undo()
    history.recordCellEdit({ rowKey: 'a', field: 'pay', before: '', after: '' })
    assert.equal(history.canRedo, true)
  })

  test('typing right after an undo starts a new step instead of merging', () => {
    const history = new EditHistory<Field>()
    history.recordCellEdit({ rowKey: 'a', field: 'pay', before: '', after: '1' })
    history.undo()
    history.recordCellEdit({ rowKey: 'a', field: 'pay', before: '', after: '2' })
    assert.deepEqual(history.undo(), [{ rowKey: 'a', field: 'pay', before: '', after: '2' }])
    assert.equal(history.canUndo, false)
  })

  test('undo and redo return null when there is nothing to do', () => {
    const history = new EditHistory<Field>()
    assert.equal(history.undo(), null)
    assert.equal(history.redo(), null)
  })

  test('keeps at most "limit" undo steps', () => {
    const history = new EditHistory<Field>(2)
    for (const value of ['1', '2', '3']) {
      history.recordBatch([{ rowKey: 'a', field: 'pay', before: '', after: value }])
    }
    assert.equal(history.undo()?.[0].after, '3')
    assert.equal(history.undo()?.[0].after, '2')
    assert.equal(history.undo(), null)
  })
})
