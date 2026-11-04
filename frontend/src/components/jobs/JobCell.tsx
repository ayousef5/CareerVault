// The control inside one grid cell: a text box, a one-line text area, a
// date picker, the Status dropdown, the App Link cell, or the Job
// Description and Resume buttons. The grid decides
// which cell is active and handles the keyboard; this only draws the cell.
import type { GridColumn } from '../../lib/gridColumns'
import { getCellText, isFieldColumn } from '../../lib/gridColumns'
import { getStatusClass } from '../../lib/jobDisplay'
import { statusOptions } from '../../lib/pasteParsing'
import type { GridRow } from '../../types/job'
import DescriptionButton from './DescriptionButton'
import LinkCell from './LinkCell'
import ResumeButton from './ResumeButton'

type JobCellProps = {
  row: GridRow
  column: GridColumn
  // 0 for the one cell reachable with Tab from outside the grid, else -1.
  tabIndex: number
  // True while this (link) cell is being edited.
  isEditing: boolean
  onChange: (value: string) => void
  onStartEditing: () => void
  // Opens the job description editor for this row.
  onOpenDescription: () => void
  // Opens the Resume dialog for this row.
  onOpenResume: () => void
}

function JobCell({
  row,
  column,
  tabIndex,
  isEditing,
  onChange,
  onStartEditing,
  onOpenDescription,
  onOpenResume,
}: JobCellProps) {
  const value = isFieldColumn(column) ? getCellText(row, column.field) : ''

  switch (column.kind) {
    case 'text':
      return (
        <input
          className={column.field === 'companyName' ? 'cell-input cell-strong' : 'cell-input'}
          value={value}
          placeholder={column.required ? column.label : '—'}
          aria-label={column.label}
          aria-invalid={column.required === true && value.trim() === ''}
          tabIndex={tabIndex}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'longText':
      return (
        // One line normally; grows taller while you're editing it.
        <textarea
          className="cell-input cell-textarea"
          rows={1}
          value={value}
          placeholder="—"
          aria-label={column.label}
          tabIndex={tabIndex}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'date':
      return (
        <input
          className="cell-input"
          type="date"
          value={value}
          aria-label={column.label}
          tabIndex={tabIndex}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'status':
      return (
        // The dropdown keeps the coloured status badge look.
        <select
          className={`cell-select status-badge ${getStatusClass(row.status)}`}
          value={row.status}
          aria-label={column.label}
          tabIndex={tabIndex}
          onChange={(event) => onChange(event.target.value)}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      )
    case 'link':
      return (
        <LinkCell
          url={row.jobUrl}
          isEditing={isEditing}
          tabIndex={tabIndex}
          onChange={onChange}
          onStartEditing={onStartEditing}
        />
      )
    case 'description':
      return (
        <DescriptionButton
          description={row.jobDescription}
          tabIndex={tabIndex}
          onOpen={onOpenDescription}
        />
      )
    case 'resume':
      return <ResumeButton resume={row.resume} tabIndex={tabIndex} onOpen={onOpenResume} />
  }
}

export default JobCell
