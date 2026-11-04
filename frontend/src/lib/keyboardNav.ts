// Keyboard rules for the grid and its entry row, kept separate (with no
// React code) so they can be unit-tested (see keyboardNav.test.ts).

// How a cell is being edited, like in Excel and Google Sheets:
//  - 'enter': you started typing over a selected cell. Arrow keys finish
//    the edit and move to the next cell.
//  - 'edit':  you pressed F2 or double-clicked. Arrow keys move the text
//    cursor inside the cell.
export type EditMode = 'enter' | 'edit'

// How far each arrow key moves the selection.
const ARROW_MOVES: Record<string, { row: number; col: number }> = {
  ArrowUp: { row: -1, col: 0 },
  ArrowDown: { row: 1, col: 0 },
  ArrowLeft: { row: 0, col: -1 },
  ArrowRight: { row: 0, col: 1 },
}

// The row/column step for an arrow key, or null for any other key.
export function arrowDelta(key: string): { row: number; col: number } | null {
  return ARROW_MOVES[key] ?? null
}

// While editing a cell: should this key finish the edit and move to a
// neighbouring cell (true), or edit the text normally (false)?
export function arrowMovesCell(mode: EditMode, key: string): boolean {
  return mode === 'enter' && arrowDelta(key) !== null
}

// What we know about a field in the Add Job entry row.
export type EntryField = {
  // 'text' covers text boxes and link boxes; dates and dropdowns use their
  // arrow keys for themselves.
  kind: 'text' | 'date' | 'select'
  selectionStart: number | null
  selectionEnd: number | null
  length: number
}

// In the Add Job entry row: should this arrow key move to another field?
//  - Left at the start of a text box → previous field.
//  - Right at the end of a text box → next field.
//  - Down in a text box → into the grid's first row.
// Otherwise the key does its normal job (moving the text cursor, changing
// a dropdown, stepping through a date).
export function entryRowMove(
  key: string,
  field: EntryField,
): 'previous' | 'next' | 'down' | null {
  if (field.kind === 'select') {
    // Dropdowns use Up/Down to change the choice, but not Left/Right.
    if (key === 'ArrowLeft') return 'previous'
    if (key === 'ArrowRight') return 'next'
    return null
  }

  if (field.kind === 'date') {
    // Dates use every arrow key to move between and change day/month/year.
    return null
  }

  const hasSelectedText =
    field.selectionStart !== null &&
    field.selectionEnd !== null &&
    field.selectionStart !== field.selectionEnd

  if (key === 'ArrowLeft' && !hasSelectedText && field.selectionStart === 0) {
    return 'previous'
  }
  if (key === 'ArrowRight' && !hasSelectedText && field.selectionEnd === field.length) {
    return 'next'
  }
  if (key === 'ArrowDown') {
    return 'down'
  }
  return null
}
