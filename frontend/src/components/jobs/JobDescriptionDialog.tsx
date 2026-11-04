import { useEffect, useRef, useState } from 'react'
import { describeLength } from '../../lib/jobDisplay'
import './JobDescriptionDialog.css'

type JobDescriptionDialogProps = {
  // e.g. "Platform Engineer" and "Initech", to show which job this is.
  title: string
  subtitle: string
  description: string | null
  // Saves the (possibly empty) text; the dialog then closes.
  onSave: (description: string) => void
  onClose: () => void
}

// Read, paste or type a job's full description. Opened from the grid's
// Job Description column (and the Add Job row). The text is saved with the
// application, so it stays even if the original posting changes or
// disappears.
function JobDescriptionDialog({ title, subtitle, description, onSave, onClose }: JobDescriptionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(description ?? '')
  const isChanged = draft !== (description ?? '')

  // Open as a modal dialog: Escape closes it, focus stays inside.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
    }
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="description-dialog"
      aria-labelledby="description-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <form
        className="description-panel"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(draft)
        }}
      >
        <header className="description-header">
          <div>
            <h2 id="description-dialog-title">Job description</h2>
            <p>
              {title}
              {subtitle && ` · ${subtitle}`}
            </p>
          </div>
          <button type="button" className="description-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <textarea
          className="description-text"
          aria-label="Job description"
          value={draft}
          autoFocus
          placeholder="Paste or type the job description here."
          onChange={(event) => setDraft(event.target.value)}
        />

        <footer className="description-footer">
          <span className="description-count">{describeLength(draft)}</span>
          <button type="button" className="description-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="description-button primary" disabled={!isChanged}>
            Save
          </button>
        </footer>
      </form>
    </dialog>
  )
}

export default JobDescriptionDialog
