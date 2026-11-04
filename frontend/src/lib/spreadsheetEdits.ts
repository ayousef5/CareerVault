// Spreadsheet editing logic that doesn't need React: clearing a selected
// range and the undo/redo history. Kept separate so it can be unit-tested
// (see spreadsheetEdits.test.ts).

// A rectangle of cells: row indexes (top..bottom) and column indexes
// (left..right), both inclusive.
export type CellRange = {
  top: number
  bottom: number
  left: number
  right: number
}

// New text values for some fields of one row.
export type RowChange<Field extends string> = {
  rowKey: string
  values: Partial<Record<Field, string>>
}

// Works out what Delete/Backspace should change in a selected range: every
// selected cell is reset to its "cleared" value. That's '' for most fields;
// "resetValues" can give a different one, e.g. Status → "Not Applied"
// because Status can never be empty. Cells already at that value are left
// out. Returns one change per affected row, so each row is saved only once.
export function buildClearChanges<Row extends { rowKey: string }, Field extends string>(
  rows: readonly Row[],
  range: CellRange,
  // One entry per column; undefined for columns that can't be cleared.
  columnFields: readonly (Field | undefined)[],
  getText: (row: Row, field: Field) => string,
  resetValues: Partial<Record<Field, string>> = {},
): RowChange<Field>[] {
  const changes: RowChange<Field>[] = []

  for (let r = range.top; r <= range.bottom; r++) {
    const row = rows[r]
    if (!row) {
      continue
    }

    const values: Partial<Record<Field, string>> = {}
    let hasChanges = false

    for (let c = range.left; c <= range.right; c++) {
      const field = columnFields[c]
      if (field === undefined) {
        continue
      }

      const clearedValue = resetValues[field] ?? ''
      if (getText(row, field) !== clearedValue) {
        values[field] = clearedValue
        hasChanges = true
      }
    }

    if (hasChanges) {
      changes.push({ rowKey: row.rowKey, values })
    }
  }

  return changes
}

// ---------- Undo / redo ----------

// One cell's value before and after an edit.
export type CellChange<Field extends string> = {
  rowKey: string
  field: Field
  before: string
  after: string
}

// One undoable action, e.g. typing in a cell or a whole multi-cell paste.
type HistoryEntry<Field extends string> = CellChange<Field>[]

// Groups cell changes by row, using either the "before" values (for undo)
// or the "after" values (for redo). Each row then needs only one save.
export function groupChangesByRow<Field extends string>(
  changes: readonly CellChange<Field>[],
  side: 'before' | 'after',
): RowChange<Field>[] {
  const byRow = new Map<string, Partial<Record<Field, string>>>()

  for (const change of changes) {
    const values: Partial<Record<Field, string>> = byRow.get(change.rowKey) ?? {}
    values[change.field] = change[side]
    byRow.set(change.rowKey, values)
  }

  return Array.from(byRow, ([rowKey, values]) => ({ rowKey, values }))
}

// Keeps the undo and redo stacks.
//
// Typing in a cell sends one change per keystroke; those are merged into a
// single undo step until the history is "sealed" (when the user leaves the
// cell, starts a new edit, or makes a bulk change).
export class EditHistory<Field extends string> {
  private undoStack: HistoryEntry<Field>[] = []
  private redoStack: HistoryEntry<Field>[] = []
  // True while the newest undo step can still absorb more keystrokes.
  private isOpen = false
  private readonly limit: number

  constructor(limit = 100) {
    this.limit = limit
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  // Records a single-cell edit. Consecutive edits to the same cell are
  // merged into one undo step, keeping the original "before" value.
  recordCellEdit(change: CellChange<Field>) {
    const last = this.undoStack[this.undoStack.length - 1]
    const lastChange = last?.length === 1 ? last[0] : undefined

    if (
      this.isOpen &&
      lastChange &&
      lastChange.rowKey === change.rowKey &&
      lastChange.field === change.field
    ) {
      lastChange.after = change.after
      // Typed something and then changed it back: nothing to undo.
      if (lastChange.before === lastChange.after) {
        this.undoStack.pop()
        this.isOpen = false
      }
    } else if (change.before !== change.after) {
      this.push([{ ...change }])
      this.isOpen = true
    } else {
      // Nothing actually changed, so there's nothing to record.
      return
    }

    // A new edit makes the old redo steps meaningless.
    this.redoStack = []
  }

  // Records a multi-cell action (paste, clearing a range or columns) as a
  // single undo step. Changes that don't actually change anything are dropped.
  recordBatch(changes: readonly CellChange<Field>[]) {
    const real = changes.filter((change) => change.before !== change.after)
    this.isOpen = false
    if (real.length === 0) {
      return
    }

    this.push(real.map((change) => ({ ...change })))
    this.redoStack = []
  }

  // Stops merging further keystrokes into the newest undo step.
  seal() {
    this.isOpen = false
  }

  // Takes the newest undo step. Returns its changes (apply their "before"
  // values to undo), or null if there's nothing to undo.
  undo(): CellChange<Field>[] | null {
    this.isOpen = false
    const entry = this.undoStack.pop()
    if (!entry) {
      return null
    }
    this.redoStack.push(entry)
    return entry
  }

  // Takes the newest redo step. Returns its changes (apply their "after"
  // values to redo), or null if there's nothing to redo.
  redo(): CellChange<Field>[] | null {
    this.isOpen = false
    const entry = this.redoStack.pop()
    if (!entry) {
      return null
    }
    this.undoStack.push(entry)
    return entry
  }

  private push(entry: HistoryEntry<Field>) {
    this.undoStack.push(entry)
    // Forget the oldest steps once the limit is reached.
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift()
    }
  }
}
