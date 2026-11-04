import { getSafeUrl } from '../../lib/jobDisplay'

// Shows a clickable link plus a pencil button. While the cell is being
// edited (or has no valid link yet) it shows a text box instead.
type LinkCellProps = {
  url: string | null
  isEditing: boolean
  tabIndex: number
  onChange: (value: string) => void
  onStartEditing: () => void
}

function LinkCell({
  url,
  isEditing,
  tabIndex,
  onChange,
  onStartEditing,
}: LinkCellProps) {
  const safeUrl = getSafeUrl(url)

  // Show the text box when editing, or when there's no valid link to show.
  if (isEditing || safeUrl === null) {
    return (
      <input
        className="cell-input"
        type="url"
        value={url ?? ''}
        placeholder="Paste link"
        aria-label="App link"
        tabIndex={tabIndex}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  return (
    // data-focus-target lets the grid move keyboard focus onto this cell.
    <div
      className="link-cell"
      tabIndex={tabIndex}
      data-focus-target
      aria-label={`App link: ${safeUrl}`}
    >
      {/* target="_blank" opens a new tab; rel="noopener noreferrer"
          stops the new page from controlling this one. */}
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="table-link"
        title={safeUrl}
        tabIndex={-1}
      >
        Open ↗
      </a>
      <button
        type="button"
        className="cell-icon-button"
        aria-label="Edit link"
        title="Edit link (F2)"
        tabIndex={-1}
        onClick={onStartEditing}
      >
        ✎
      </button>
    </div>
  )
}

export default LinkCell
