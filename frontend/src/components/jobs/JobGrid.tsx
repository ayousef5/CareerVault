// The spreadsheet-style grid of job applications: cell selection, keyboard
// navigation, editing, copy/paste, column selection and resizing.
//
// What the grid shows and what edits do come from the useJobs hook (via
// props); the pure rules it uses live in lib/ (gridColumns, gridClipboard,
// keyboardNav, spreadsheetEdits). This file is about user interaction.
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react'
import {
  ACTIONS_COLUMN_WIDTH,
  getCellText,
  getColumnWidth,
  getTotalWidth,
  gridColumns,
  isDataColumn,
  isFieldColumn,
  LAST_COLUMN,
  loadColumnWidths,
  saveColumnWidths,
} from '../../lib/gridColumns'
import type { ColumnWidths, GridColumn } from '../../lib/gridColumns'
import { buildCopyText, isSingleValuePaste, planGridPaste } from '../../lib/gridClipboard'
import { getSafeUrl } from '../../lib/jobDisplay'
import { rowsLeft } from '../../lib/jobRows'
import type { RowSaveStatus } from '../../lib/jobRows'
import { arrowDelta, arrowMovesCell } from '../../lib/keyboardNav'
import type { EditMode } from '../../lib/keyboardNav'
import { parsePastedTable } from '../../lib/pasteParsing'
import { rowStatusLabels } from '../../lib/saveStatus'
import { buildClearChanges } from '../../lib/spreadsheetEdits'
import type { EditableField, GridRow, RowUpdate } from '../../types/job'
import JobCell from './JobCell'
import './JobGrid.css'


// A cell's position: its row (among the rows currently shown) and column.
type CellPosition = { row: number; col: number }

// The selected cells. "anchor" is where the selection started and "focus"
// is the active cell. When they differ, everything between is selected.
// "columns" is true when whole columns were selected by clicking headers.
type GridSelection = {
  anchor: CellPosition
  focus: CellPosition
  columns?: boolean
}

// True for controls whose text can be selected (not dates or dropdowns).
function isTextControl(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement {
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement &&
      (element.type === 'text' || element.type === 'url'))
  )
}

// ---------- The grid ----------
type JobGridProps = {
  applications: GridRow[]
  saveStatuses: Record<string, RowSaveStatus>
  onCellChange: (rowKey: string, field: EditableField, value: string) => void
  onApplyChanges: (updates: RowUpdate[]) => void
  onDeleteRow: (rowKey: string) => void
  // Opens the application details view for a row.
  onOpenDetails: (rowKey: string) => void
  // Opens the job description editor for a row.
  onOpenDescription: (rowKey: string) => void
  // Opens the Resume dialog (attach, replace, remove, preview) for a row.
  onOpenResume: (rowKey: string) => void
  onLeaveRows: (rowKeys: string[]) => void
  // The Add Job entry row, shown right under the column headers.
  entryRow: ReactNode
  onUndo: () => void
  onRedo: () => void
  onSealHistory: () => void
}

function JobGrid({
  applications,
  saveStatuses,
  onCellChange,
  onApplyChanges,
  onDeleteRow,
  onOpenDetails,
  onOpenDescription,
  onOpenResume,
  onLeaveRows,
  entryRow,
  onUndo,
  onRedo,
  onSealHistory,
}: JobGridProps) {
  // Which cells are selected (null until the user clicks into the grid).
  const [selection, setSelection] = useState<GridSelection | null>(null)

  // True while the user is typing in the active cell ("edit mode").
  // False means the cell is only selected, so arrow keys move between cells.
  const [isEditing, setIsEditing] = useState(false)

  // While editing: 'enter' (started by typing, so arrow keys move to the
  // next cell) or 'edit' (F2 / double-click, so arrow keys move the text
  // cursor). See keyboardNav.ts.
  const editMode = useRef<EditMode>('edit')

  const tableRef = useRef<HTMLTableElement>(null)

  // Each column's width in pixels, restored from the browser on first load.
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(loadColumnWidths)

  // Set when keyboard focus should move to the active cell after the next
  // render: 'select' highlights the cell's text, 'caretEnd' puts the
  // cursor at the end of the text for editing.
  const pendingFocus = useRef<'select' | 'caretEnd' | null>(null)

  // The value the cell had when editing started, so Escape can put it back.
  const editStart = useRef<{
    rowKey: string
    field: EditableField
    value: string
  } | null>(null)

  // True while the mouse button is held down to drag-select a range.
  const isDragging = useRef(false)

  // True while the mouse button is held down to drag across column headers.
  const isDraggingColumns = useRef(false)

  const rowCount = applications.length
  const active = selection?.focus ?? null

  // The selected rectangle (top/bottom rows, left/right columns).
  const range = selection
    ? {
        top: Math.min(selection.anchor.row, selection.focus.row),
        bottom: Math.max(selection.anchor.row, selection.focus.row),
        left: Math.min(selection.anchor.col, selection.focus.col),
        right: Math.max(selection.anchor.col, selection.focus.col),
      }
    : null
  const isMultiCell =
    range !== null && (range.top !== range.bottom || range.left !== range.right)

  // After each render, move keyboard focus to the active cell if asked to.
  useEffect(() => {
    const mode = pendingFocus.current
    if (!mode || !selection) {
      return
    }

    const cell = tableRef.current?.querySelector(
      `td[data-cell="${selection.focus.row}-${selection.focus.col}"]`,
    )
    const target = cell?.querySelector<HTMLElement>(
      'input, textarea, select, [data-focus-target]',
    )

    // The cell may not exist yet (e.g. a row that's still being added).
    // Leave the request in place and try again after the next render.
    if (!target) {
      return
    }

    pendingFocus.current = null
    target.focus()

    if (isTextControl(target)) {
      if (mode === 'caretEnd') {
        const end = target.value.length
        target.setSelectionRange(end, end)
      } else {
        // Highlight the text so typing replaces it, like in a spreadsheet.
        target.select()
      }
    }
  })

  // Stop drag-selecting when the mouse button is released anywhere.
  useEffect(() => {
    function stopDragging() {
      isDragging.current = false
      isDraggingColumns.current = false
    }

    window.addEventListener('mouseup', stopDragging)
    return () => window.removeEventListener('mouseup', stopDragging)
  }, [])

  // The rows that were selected last time, so we can tell when the user
  // leaves a row (the app then deletes it if it's completely empty).
  const previousSelectedRows = useRef<string[]>([])

  // useEffectEvent lets the effect below call the latest onLeaveRows
  // without re-running whenever the parent re-renders.
  const reportLeftRows = useEffectEvent((rowKeys: string[]) => {
    onLeaveRows(rowKeys)
  })

  // Whenever the selection (or the rows) change, report rows that are no
  // longer selected.
  useEffect(() => {
    const selectedRows = selection
      ? applications
          .slice(
            Math.min(selection.anchor.row, selection.focus.row),
            Math.max(selection.anchor.row, selection.focus.row) + 1,
          )
          .map((row) => row.rowKey)
      : []

    const left = rowsLeft(previousSelectedRows.current, selectedRows)
    previousSelectedRows.current = selectedRows

    if (left.length > 0) {
      reportLeftRows(left)
    }
  }, [selection, applications])

  // Selects one cell, or extends the range to it when "extend" is true.
  function selectCell(position: CellPosition, extend = false) {
    if (rowCount === 0) {
      return
    }

    // Keep the position inside the grid.
    const next = {
      row: Math.max(0, Math.min(position.row, rowCount - 1)),
      col: Math.max(0, Math.min(position.col, LAST_COLUMN)),
    }

    setSelection(
      extend && selection
        ? { anchor: selection.anchor, focus: next }
        : { anchor: next, focus: next },
    )
    setIsEditing(false)
    editStart.current = null
    pendingFocus.current = 'select'
    // Moving to another cell ends the current undo step.
    onSealHistory()
  }

  // Selects whole columns, from column "fromCol" to column "toCol".
  // The top cell of "toCol" becomes the active cell.
  function selectColumns(fromCol: number, toCol: number) {
    if (rowCount === 0) {
      return
    }

    setSelection({
      anchor: { row: rowCount - 1, col: fromCol },
      focus: { row: 0, col: toCol },
      columns: true,
    })
    setIsEditing(false)
    editStart.current = null
    pendingFocus.current = 'select'
    onSealHistory()
  }

  // Switches the active cell into edit mode.
  function startEditing(caretAtEnd: boolean, mode: EditMode) {
    if (!active) {
      return
    }

    const row = applications[active.row]
    if (!row) {
      return
    }

    // Action columns (Job Description, Resume) open a dialog instead.
    const column = gridColumns[active.col]
    if (!isDataColumn(column)) {
      return
    }

    // Start a fresh undo step for this edit.
    onSealHistory()

    // Remember the starting value so Escape can undo the edit.
    const field = column.field
    editStart.current = { rowKey: row.rowKey, field, value: getCellText(row, field) }

    setSelection({ anchor: active, focus: active })
    setIsEditing(true)
    editMode.current = mode

    if (caretAtEnd) {
      pendingFocus.current = 'caretEnd'
    }
  }

  // Leaves edit mode. With revert = true (Escape), the cell gets its
  // starting value back.
  function finishEditing(revert: boolean) {
    const start = editStart.current

    if (revert && start) {
      const row = applications.find((r) => r.rowKey === start.rowKey)
      if (row && getCellText(row, start.field) !== start.value) {
        onCellChange(start.rowKey, start.field, start.value)
      }
    }

    editStart.current = null
    setIsEditing(false)
    // The finished edit becomes one complete undo step.
    onSealHistory()
  }

  // Moves the selection by one step. Moving up from the first row goes to
  // the Add Job entry row above it.
  function moveSelection(delta: { row: number; col: number }, extend: boolean) {
    if (!active) {
      return
    }

    if (delta.row === -1 && active.row === 0 && !extend && focusEntryField(active.col)) {
      return
    }

    selectCell({ row: active.row + delta.row, col: active.col + delta.col }, extend)
  }

  // Puts the cursor in the entry-row field for a column. Returns false if
  // there is no entry row.
  function focusEntryField(col: number): boolean {
    const field = document.getElementById(`add-job-${gridColumns[col].field}`)
    if (!field) {
      return false
    }
    field.focus()
    return true
  }

  // Tab / Shift+Tab: move right or left, wrapping onto the next or previous
  // row. Returns false at the very start or end of the grid so the browser
  // can move focus out of the grid as usual.
  function tabTo(direction: 1 | -1): boolean {
    if (!active) {
      return false
    }

    let { row, col } = active
    col += direction

    if (col > LAST_COLUMN) {
      col = 0
      row += 1
    } else if (col < 0) {
      col = LAST_COLUMN
      row -= 1
    }

    if (row < 0 || row >= rowCount) {
      return false
    }

    selectCell({ row, col })
    return true
  }

  // Delete / Backspace: empty every selected cell, including whole selected
  // columns. Status cells are reset to "Not Applied" instead, because Status
  // can't be empty. Headers and rows are never removed. Each row is updated, and saved, only once, and
  // the whole clear is a single undo step.
  function clearRange() {
    if (!range) {
      return
    }

    const updates = buildClearChanges(
      applications,
      range,
      // The job description column isn't cleared by Delete (it's edited in
      // its own editor), so it has no field here.
      gridColumns.map((column) => (isDataColumn(column) ? column.field : undefined)),
      getCellText,
      // Status can't be empty, so clearing it resets it to "Not Applied".
      { status: 'Not Applied' },
    )

    if (updates.length > 0) {
      onApplyChanges(updates)
    }
  }

  // All keyboard handling for the grid. Key presses bubble up here from
  // whichever cell control has focus.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLTableElement>) {
    const target = event.target as HTMLElement
    if (!active || !target.closest('td[data-cell]')) {
      return
    }

    const column = gridColumns[active.col]
    const { key, shiftKey } = event

    // ----- Undo / redo -----
    // Undo: Cmd+Z (Mac) or Ctrl+Z. Redo: Cmd+Shift+Z, Ctrl+Shift+Z or Ctrl+Y.
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const letter = key.toLowerCase()
      const isUndo = letter === 'z' && !shiftKey
      const isRedo =
        (letter === 'z' && shiftKey) || (letter === 'y' && event.ctrlKey && !shiftKey)

      if (isUndo || isRedo) {
        event.preventDefault()
        // Finish any edit in progress first, so it becomes its own undo step.
        if (isEditing) {
          finishEditing(false)
        }
        if (isUndo) {
          onUndo()
        } else {
          onRedo()
        }
        pendingFocus.current = 'select'
        return
      }
    }

    // ----- Edit mode: the user is typing in the cell -----
    if (isEditing) {
      // After typing over a cell, arrow keys finish the edit and move to the
      // neighbouring cell. (After F2 or a double-click they move the cursor.)
      const delta = arrowDelta(key)
      if (delta && arrowMovesCell(editMode.current, key)) {
        event.preventDefault()
        finishEditing(false)
        moveSelection(delta, shiftKey)
        return
      }

      if (key === 'Escape') {
        // Undo this edit and go back to just selecting the cell.
        event.preventDefault()
        finishEditing(true)
        pendingFocus.current = 'select'
      } else if (key === 'Enter') {
        // Shift+Enter adds a line break in Comments / Notes.
        if (column.kind === 'longText' && shiftKey) {
          return
        }
        // Enter finishes the edit and moves down (never submits anything).
        event.preventDefault()
        finishEditing(false)
        selectCell({ row: active.row + 1, col: active.col })
      } else if (key === 'Tab') {
        finishEditing(false)
        if (tabTo(shiftKey ? -1 : 1)) {
          event.preventDefault()
        }
      }
      // Every other key (arrows, Home, End, letters...) edits the text normally.
      return
    }

    // ----- Select mode: the cell is selected but not being edited -----

    // Leave shortcuts like Ctrl/Cmd+C and Ctrl/Cmd+V to the copy and paste
    // handlers, and Alt+Down to open the Status dropdown.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return
    }

    switch (key) {
      case 'ArrowUp':
        event.preventDefault()
        moveSelection({ row: -1, col: 0 }, shiftKey)
        return
      case 'ArrowDown':
        event.preventDefault()
        selectCell({ row: active.row + 1, col: active.col }, shiftKey)
        return
      case 'ArrowLeft':
        event.preventDefault()
        selectCell({ row: active.row, col: active.col - 1 }, shiftKey)
        return
      case 'ArrowRight':
        event.preventDefault()
        selectCell({ row: active.row, col: active.col + 1 }, shiftKey)
        return
      case 'Home':
        event.preventDefault()
        selectCell({ row: active.row, col: 0 }, shiftKey)
        return
      case 'End':
        event.preventDefault()
        selectCell({ row: active.row, col: LAST_COLUMN }, shiftKey)
        return
      case 'Enter':
        // Enter moves down (Shift+Enter moves up).
        event.preventDefault()
        selectCell({ row: active.row + (shiftKey ? -1 : 1), col: active.col })
        return
      case 'Tab':
        if (tabTo(shiftKey ? -1 : 1)) {
          event.preventDefault()
        }
        return
      case 'F2':
        event.preventDefault()
        if (column.kind === 'description' || column.kind === 'resume') {
          // These are edited in their own dialogs.
          openActiveDialog()
          return
        }
        // F2 edits the cell with the cursor at the end of the text.
        startEditing(true, 'edit')
        return
      case 'Escape':
        // Shrink a range back down to just the active cell.
        event.preventDefault()
        selectCell(active)
        return
      case 'Delete':
      case 'Backspace':
        event.preventDefault()
        clearRange()
        return
    }

    // Typing a normal character starts editing, replacing the cell's
    // contents, just like a spreadsheet.
    if (key.length === 1) {
      if (column.kind === 'description' || column.kind === 'resume') {
        // Not a text cell: Space opens its dialog, other keys do nothing.
        event.preventDefault()
        if (key === ' ') {
          openActiveDialog()
        }
        return
      }

      if (column.kind === 'status') {
        // The dropdown jumps to the matching status by itself.
        return
      }

      const row = applications[active.row]
      if (column.kind === 'link' && row && getSafeUrl(row.jobUrl) !== null) {
        // The link is showing, not a text box, so switch to the text box
        // and start it off with the typed character.
        event.preventDefault()
        startEditing(true, 'enter')
        onCellChange(row.rowKey, 'jobUrl', key)
        return
      }

      // The cell's text is already highlighted, so the browser replaces it
      // with the typed character. Arrow keys will then move to the next cell.
      startEditing(false, 'enter')
    }
  }

  // Opens the description editor or the Resume dialog for the active
  // cell's row.
  function openActiveDialog() {
    const row = active ? applications[active.row] : undefined
    if (!row) {
      return
    }
    if (gridColumns[active!.col].kind === 'resume') {
      onOpenResume(row.rowKey)
    } else {
      onOpenDescription(row.rowKey)
    }
  }

  function handleCellMouseDown(
    event: ReactMouseEvent<HTMLTableCellElement>,
    position: CellPosition,
  ) {
    // Only the main (left) mouse button selects.
    if (event.button !== 0) {
      return
    }

    const isActiveCell =
      active?.row === position.row && active?.col === position.col
    const target = event.target as HTMLElement

    // Already typing in this cell: let the click move the text cursor.
    if (isEditing && isActiveCell) {
      return
    }

    // Shift+click selects everything from the active cell to here.
    if (event.shiftKey && selection) {
      event.preventDefault()
      selectCell(position, true)
      return
    }

    // Let the Status dropdown, the link and the pencil button work normally.
    if (gridColumns[position.col].kind === 'status' || target.closest('a, button')) {
      selectCell(position)
      // The browser focuses these itself.
      pendingFocus.current = null
      return
    }

    // Double-clicking the selected cell edits it where you clicked, with
    // arrow keys moving the text cursor. (A single click only selects, like
    // in Google Sheets, so arrow keys keep moving between cells.)
    if (isActiveCell && !isMultiCell && event.detail >= 2) {
      startEditing(false, 'edit')
      return
    }

    // First click only selects the cell. preventDefault stops the browser
    // from placing a text cursor, so dragging selects cells instead of text.
    event.preventDefault()
    selectCell(position)
    isDragging.current = true
  }

  // Dragging over cells with the mouse button held extends the range.
  function handleCellMouseEnter(position: CellPosition) {
    if (isDragging.current && selection) {
      setSelection({ anchor: selection.anchor, focus: position })
      // Keep keyboard focus on the outlined cell, so typing goes there.
      pendingFocus.current = 'select'
    }
  }

  // Clicking a column header selects that whole column. Shift+click extends
  // the selection to this column; dragging across headers selects several.
  function handleHeaderMouseDown(
    event: ReactMouseEvent<HTMLTableCellElement>,
    colIndex: number,
  ) {
    if (event.button !== 0 || rowCount === 0) {
      return
    }

    // Stops the browser from selecting the header text.
    event.preventDefault()

    const fromCol = event.shiftKey && selection ? selection.anchor.col : colIndex
    selectColumns(fromCol, colIndex)
    isDraggingColumns.current = true
  }

  function handleHeaderMouseEnter(colIndex: number) {
    if (isDraggingColumns.current && selection?.columns) {
      selectColumns(selection.anchor.col, colIndex)
    }
  }

  // Keeps the selection in sync if focus arrives some other way,
  // e.g. tabbing into the grid from the search box.
  function handleCellFocus(position: CellPosition, target: EventTarget) {
    if (active?.row === position.row && active?.col === position.col) {
      return
    }

    setSelection({ anchor: position, focus: position })
    setIsEditing(false)
    // Highlight a text cell's text, so typing replaces it like in a
    // spreadsheet. (Dropdowns and links are left alone.)
    if (target instanceof Element && isTextControl(target)) {
      pendingFocus.current = 'select'
    }
  }

  // Copy and paste. These listen on the whole document because a focused
  // dropdown or link doesn't always receive these events directly.
  useEffect(() => {
    // True when keyboard focus is inside one of the grid's cells.
    function isGridFocused() {
      const element = document.activeElement
      return (
        element !== null &&
        tableRef.current !== null &&
        tableRef.current.contains(element) &&
        element.closest('td[data-cell]') !== null
      )
    }

    // Copies the selected cells as tab-separated text that Excel and
    // Google Sheets understand.
    function handleCopy(event: ClipboardEvent) {
      // While editing, let the browser copy the highlighted text as usual.
      if (!range || isEditing || !isGridFocused()) {
        return
      }

      event.preventDefault()
      event.clipboardData?.setData('text/plain', buildCopyText(applications, range))
    }

    // Pastes tab-separated text into the grid, starting at the top-left
    // selected cell. Extra rows are created when the data runs past the end.
    function handlePaste(event: ClipboardEvent) {
      if (!range || !isGridFocused()) {
        return
      }

      // Works for both tab-separated spreadsheet data and Markdown tables.
      const table = parsePastedTable(event.clipboardData?.getData('text/plain') ?? '')
      if (table.rows.length === 0) {
        return
      }

      // While editing, a single plain value is pasted into the text box as
      // usual. (A one-cell Markdown table like "| FedEx |" is still cleaned up.)
      if (isEditing && isSingleValuePaste(table) && !table.isMarkdown) {
        return
      }

      event.preventDefault()
      finishEditing(false)

      // Where every pasted value goes (see lib/gridClipboard.ts).
      const plan = planGridPaste(table, range, applications)
      if (plan === null) {
        return
      }

      // The whole paste is applied (and undone) as one step.
      onApplyChanges(plan.updates)

      // Select the pasted area, keeping its top-left cell active.
      if (plan.selection) {
        setSelection(plan.selection)
        pendingFocus.current = 'select'
      }
    }

    document.addEventListener('copy', handleCopy)
    document.addEventListener('paste', handlePaste)

    return () => {
      document.removeEventListener('copy', handleCopy)
      document.removeEventListener('paste', handlePaste)
    }
  })

  // Starts resizing a column when its header's right edge is dragged.
  // While dragging, the <col> and table widths are changed directly for
  // smooth movement; the final width is saved to state and the browser
  // when the mouse button is released. No API requests are involved.
  function handleResizeStart(
    event: ReactMouseEvent<HTMLSpanElement>,
    columnIndex: number,
  ) {
    if (event.button !== 0) {
      return
    }

    // Stops the browser from selecting text while dragging.
    event.preventDefault()
    event.stopPropagation()

    const column = gridColumns[columnIndex]
    const table = tableRef.current
    const col = table?.querySelectorAll('col')[columnIndex]
    if (!table || !col) {
      return
    }

    const startX = event.clientX
    const startWidth = getColumnWidth(columnWidths, column)
    const otherColumnsWidth = getTotalWidth(columnWidths) - startWidth
    let newWidth = startWidth

    // Shows the resize cursor everywhere and blocks text selection until
    // the drag ends, even if the mouse leaves the header.
    document.body.classList.add('is-resizing-column')

    function handleMouseMove(moveEvent: MouseEvent) {
      newWidth = Math.max(
        column.minWidth,
        Math.round(startWidth + moveEvent.clientX - startX),
      )
      col!.style.width = `${newWidth}px`
      // Only this column changes; the table grows or shrinks by the same
      // amount so the other columns keep their widths.
      table!.style.width = `${otherColumnsWidth + newWidth + ACTIONS_COLUMN_WIDTH}px`
    }

    function handleMouseUp() {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.classList.remove('is-resizing-column')

      const updated = { ...columnWidths, [column.field]: newWidth }
      setColumnWidths(updated)
      saveColumnWidths(updated)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }


  // Only the active cell can be reached with Tab from outside the grid
  // (or the first cell if nothing is selected yet).
  function getTabIndex(row: GridRow, column: GridColumn, isActiveCell: boolean) {
    return isActiveCell ||
      (selection === null && row === applications[0] && column === gridColumns[0])
      ? 0
      : -1
  }

  return (
    // The wrapper lets the grid scroll sideways on small screens.
    <div className="table-wrapper">
      <table
        ref={tableRef}
        className="applications-table"
        // The table is exactly as wide as its columns, so widening one
        // column never squeezes the others; the wrapper scrolls instead.
        style={{ width: getTotalWidth(columnWidths) + ACTIONS_COLUMN_WIDTH }}
        onKeyDown={handleKeyDown}
        // Leaving the grid ends edit mode.
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsEditing(false)
            // Clicking outside the grid counts as leaving the selected rows.
            onLeaveRows(previousSelectedRows.current)
          }
        }}
      >
        {/* Column widths (resizable, remembered in the browser). */}
        <colgroup>
          {gridColumns.map((column) => (
            <col key={column.field} style={{ width: getColumnWidth(columnWidths, column) }} />
          ))}
          <col style={{ width: ACTIONS_COLUMN_WIDTH }} />
        </colgroup>
        <thead
          // Moving into the entry row counts as leaving the selected rows.
          onFocus={() => {
            setIsEditing(false)
            onLeaveRows(previousSelectedRows.current)
          }}
        >
          <tr>
            {gridColumns.map((column, colIndex) => (
              <th
                key={column.field}
                // Highlight headers of selected columns.
                className={
                  selection?.columns &&
                  range &&
                  colIndex >= range.left &&
                  colIndex <= range.right
                    ? 'col-selected'
                    : undefined
                }
                onMouseDown={(event) => handleHeaderMouseDown(event, colIndex)}
                onMouseEnter={() => handleHeaderMouseEnter(colIndex)}
              >
                <span className="header-label">{column.label}</span>
                {/* Drag this strip on the header's right edge to resize. */}
                <span
                  className="column-resizer"
                  aria-hidden="true"
                  onMouseDown={(event) => handleResizeStart(event, colIndex)}
                />
              </th>
            ))}
            {/* The delete-button column has no title. */}
            <th className="actions-header" aria-label="Actions" />
          </tr>
          {entryRow}
        </thead>
        <tbody>
          {applications.length === 0 && (
            <tr>
              <td colSpan={gridColumns.length + 1} className="grid-message">
                No applications to show. Type in the row above and press Add.
              </td>
            </tr>
          )}

          {applications.map((application, rowIndex) => {
            // This row's save state (rows that were never edited have none).
            const rowStatus = saveStatuses[application.rowKey]

            return (
              <tr
                key={application.rowKey}
                // e.g. "row-unsaved" or "row-failed" adds a coloured marker.
                className={rowStatus ? `row-${rowStatus}` : undefined}
                title={rowStatus ? rowStatusLabels[rowStatus] : undefined}
              >
                {gridColumns.map((column, colIndex) => {
                  const position = { row: rowIndex, col: colIndex }
                  const isActiveCell =
                    active?.row === rowIndex && active?.col === colIndex
                  const isInRange =
                    isMultiCell &&
                    range !== null &&
                    rowIndex >= range.top &&
                    rowIndex <= range.bottom &&
                    colIndex >= range.left &&
                    colIndex <= range.right

                  const classNames = [
                    isActiveCell ? 'cell-active' : '',
                    isActiveCell && isEditing ? 'cell-editing' : '',
                    isInRange ? 'cell-in-range' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')

                  return (
                    <td
                      key={column.field}
                      data-cell={`${rowIndex}-${colIndex}`}
                      className={classNames || undefined}
                      onMouseDown={(event) => handleCellMouseDown(event, position)}
                      onMouseEnter={() => handleCellMouseEnter(position)}
                      onFocus={(event) => handleCellFocus(position, event.target)}
                    >
                      <JobCell
                        row={application}
                        column={column}
                        tabIndex={getTabIndex(application, column, isActiveCell)}
                        isEditing={isEditing && isActiveCell}
                        onChange={(value) => {
                          if (isFieldColumn(column)) {
                            onCellChange(application.rowKey, column.field, value)
                          }
                        }}
                        onStartEditing={() => startEditing(true, 'edit')}
                        onOpenDescription={() => onOpenDescription(application.rowKey)}
                        onOpenResume={() => onOpenResume(application.rowKey)}
                      />
                    </td>
                  )
                })}
                <td className="actions-cell">
                  <button
                    type="button"
                    className="row-action-button"
                    aria-label="Open details"
                    title="Open details"
                    onClick={() => onOpenDetails(application.rowKey)}
                  >
                    ⤢
                  </button>
                  <button
                    type="button"
                    className="row-action-button row-delete-button"
                    aria-label="Delete job"
                    title="Delete job"
                    disabled={rowStatus === 'deleting'}
                    onClick={() => onDeleteRow(application.rowKey)}
                  >
                    🗑
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default JobGrid
