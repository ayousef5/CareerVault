import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { gridColumns, isFieldColumn } from '../../lib/gridColumns'
import type { NewJobForm } from '../../lib/jobRows'
import { entryRowMove } from '../../lib/keyboardNav'
import type { EntryField } from '../../lib/keyboardNav'
import { statusOptions } from '../../lib/pasteParsing'
import type { EditableField } from '../../types/job'
import DescriptionButton from './DescriptionButton'

// ---------- Add Job entry row ----------
// One compact row of inputs right under the grid's headers, lined up with
// the columns, plus an Add button. This is how new jobs are added; the grid
// itself doesn't create blank rows.
type AddJobRowProps = {
  values: NewJobForm
  isSubmitting: boolean
  error: string | null
  onChange: (field: EditableField, value: string) => void
  onSubmit: () => void
  // A note about what autofill did (shown under the row, not as an error).
  notice: string | null
  // True while "Autofill from URL" is running.
  isAutofilling: boolean
  onAutofill: () => void
  // Pasting spreadsheet cells into any entry field.
  onPaste: (event: ReactClipboardEvent<HTMLElement>, field: EditableField) => void
  // Opens the job description editor for the new job.
  onOpenDescription: () => void
}

function AddJobRow({
  values,
  isSubmitting,
  error,
  onChange,
  onSubmit,
  notice,
  isAutofilling,
  onAutofill,
  onPaste,
  onOpenDescription,
}: AddJobRowProps) {
  // Moves the cursor to the entry field in another column (or the Add
  // button after the last one). Columns without an entry field (Resume)
  // are skipped in the direction of travel.
  function focusField(colIndex: number, direction: 1 | -1 = 1) {
    let index = colIndex
    while (gridColumns[index] && !isFieldColumn(gridColumns[index])) {
      index += direction
    }
    const column = gridColumns[index]
    const id = column ? `add-job-${column.field}` : 'add-job-submit'
    document.getElementById(id)?.focus()
  }

  // Moves the cursor into the grid's first row, in the same column.
  function focusGrid(colIndex: number) {
    document
      .querySelector(`td[data-cell="0-${colIndex}"]`)
      ?.querySelector<HTMLElement>('input, textarea, select, [data-focus-target]')
      ?.focus()
  }

  function handleKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>,
    colIndex: number,
    kind: EntryField['kind'],
  ) {
    // Enter adds the job (there's no <form>, so nothing reloads the page).
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit()
      return
    }

    const target = event.currentTarget
    const move = entryRowMove(event.key, {
      kind,
      selectionStart: target instanceof HTMLInputElement ? target.selectionStart : null,
      selectionEnd: target instanceof HTMLInputElement ? target.selectionEnd : null,
      length: target.value.length,
    })
    if (move === null) {
      return
    }

    event.preventDefault()
    if (move === 'previous' && colIndex > 0) {
      focusField(colIndex - 1, -1)
    } else if (move === 'next') {
      focusField(colIndex + 1)
    } else if (move === 'down') {
      focusGrid(colIndex)
    }
  }

  return (
    <>
      <tr className="entry-row">
        {gridColumns.map((column, colIndex) => {
          if (!isFieldColumn(column)) {
            // Resume: attached once the job has been added (from its row).
            return (
              <td key={column.field} className="entry-hint-cell">
                <span className="entry-hint" title="Add the job first, then attach a resume from its Resume cell">
                  After adding
                </span>
              </td>
            )
          }

          const id = `add-job-${column.field}`
          const value = values[column.field]
          const change = (newValue: string) => onChange(column.field, newValue)
          // The column names show as placeholders, so no separate labels are needed.
          const label = `New job: ${column.label}`

          const textInput = (
            <input
              id={id}
              className="entry-input"
              aria-label={label}
              type={column.kind === 'date' ? 'date' : 'text'}
              placeholder={column.kind === 'link' ? 'Link' : column.label}
              value={value}
              onChange={(event) => change(event.target.value)}
              onKeyDown={(event) =>
                handleKeyDown(event, colIndex, column.kind === 'date' ? 'date' : 'text')
              }
              onPaste={(event) => onPaste(event, column.field)}
            />
          )

          return (
            <td key={column.field}>
              {column.kind === 'description' ? (
                // Opens the description editor; arrow keys move on like a dropdown.
                <DescriptionButton
                  id={id}
                  description={value}
                  tabIndex={0}
                  onOpen={onOpenDescription}
                  onKeyDown={(event) => handleKeyDown(event, colIndex, 'select')}
                />
              ) : column.kind === 'status' ? (
                <select
                  id={id}
                  className="entry-input"
                  aria-label={label}
                  value={value}
                  onChange={(event) => change(event.target.value)}
                  onKeyDown={(event) => handleKeyDown(event, colIndex, 'select')}
                  onPaste={(event) => onPaste(event, column.field)}
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              ) : column.kind === 'link' ? (
                // App Link: the link box plus the "Autofill from URL" button.
                <div className="entry-link">
                  {textInput}
                  <button
                    type="button"
                    className="entry-autofill-button"
                    aria-label="Autofill from URL"
                    title="Autofill from URL: fill in the empty fields from this job posting"
                    disabled={isAutofilling || value.trim() === ''}
                    aria-busy={isAutofilling}
                    onClick={onAutofill}
                  >
                    {isAutofilling ? '…' : '✨'}
                  </button>
                </div>
              ) : (
                textInput
              )}
            </td>
          )
        })}
        <td className="actions-cell">
          <button
            id="add-job-submit"
            type="button"
            className="entry-add-button"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            title="Add Job (Enter)"
            onClick={onSubmit}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault()
                focusField(gridColumns.length - 1, -1)
              }
            }}
          >
            {isSubmitting ? '…' : 'Add'}
          </button>
        </td>
      </tr>
      {/* What autofill did. role="status" lets screen readers announce it. */}
      {notice && !error && (
        <tr className="entry-row-notice">
          <td colSpan={gridColumns.length + 1} role="status">
            {notice}
          </td>
        </tr>
      )}
      {/* role="alert" makes screen readers announce the message. */}
      {error && (
        <tr className="entry-row-error">
          <td colSpan={gridColumns.length + 1} role="alert">
            {error}
          </td>
        </tr>
      )}
    </>
  )
}

export default AddJobRow
