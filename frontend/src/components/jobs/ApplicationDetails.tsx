import { useEffect, useRef, useState } from 'react'
import { formatDisplayDate, getSafeUrl, getStatusClass } from '../../lib/jobDisplay'
import type { ActionResult } from '../../lib/resumeFiles'
import type { AttachedResume } from '../../types/resume'
import './ApplicationDetails.css'
import ResumeAttachment from './ResumeAttachment'

// The job fields the details view shows. Any job row from the grid fits.
export type ApplicationDetailsJob = {
  companyName: string
  jobTitle: string
  location: string | null
  pay: string | null
  jobUrl: string | null
  dateApplied: string | null
  status: string
  recruiter: string | null
  notes: string | null
  jobDescription: string | null
  // The resume uploaded to this application (null = none).
  resume: AttachedResume | null
}

type ApplicationDetailsProps = {
  job: ApplicationDetailsJob
  // The row's save state, e.g. "Saving…" (optional).
  saveStatusLabel?: string | null
  // Saves a corrected description (through the normal autosave).
  onSaveDescription: (description: string) => void
  // Uploading (or replacing) and removing this application's resume.
  canUploadResume: boolean
  onUploadResume: (file: File) => Promise<ActionResult>
  onRemoveResume: () => Promise<ActionResult>
  // Ends the session after a 401 while opening the resume file.
  onSessionExpired: () => void
  // Goes back to the grid.
  onClose: () => void
}

// Shown in place of a value that isn't filled in.
const NOT_PROVIDED = 'Not provided'

// A dialog showing everything about one job application, including the
// full job description, over the grid. Closing it returns to the grid.
function ApplicationDetails({
  job,
  saveStatusLabel,
  onSaveDescription,
  canUploadResume,
  onUploadResume,
  onRemoveResume,
  onSessionExpired,
  onClose,
}: ApplicationDetailsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  // True while the description is being edited, and the text being typed.
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')

  // Open as a modal dialog: the page behind is dimmed, keyboard focus stays
  // inside, and Escape closes it.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
    }
    return () => dialog?.close()
  }, [])

  function startEditing() {
    setDraft(job.jobDescription ?? '')
    setIsEditing(true)
  }

  function saveDescription() {
    onSaveDescription(draft)
    setIsEditing(false)
  }

  const safeUrl = getSafeUrl(job.jobUrl)
  const title = job.jobTitle.trim() || 'Untitled role'
  const company = job.companyName.trim() || 'Unknown company'
  const description = job.jobDescription?.trim() ? job.jobDescription : null

  // Label + value pairs for the facts at the top.
  const facts: { label: string; value: string | null }[] = [
    { label: 'Company', value: job.companyName.trim() || null },
    { label: 'Role', value: job.jobTitle.trim() || null },
    { label: 'Location', value: job.location },
    { label: 'Pay', value: job.pay },
    { label: 'Date applied', value: formatDisplayDate(job.dateApplied) },
    { label: 'Recruiter', value: job.recruiter },
  ]

  return (
    <dialog
      ref={dialogRef}
      className="details-dialog"
      aria-labelledby="details-title"
      // Escape: first leaves description editing, then closes the dialog.
      onCancel={(event) => {
        event.preventDefault()
        if (isEditing) {
          setIsEditing(false)
        } else {
          onClose()
        }
      }}
      // Clicking the dimmed area outside the panel closes it.
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="details-panel">
        <header className="details-header">
          <div>
            <h2 id="details-title">{title}</h2>
            <p className="details-company">{company}</p>
          </div>
          <div className="details-header-actions">
            <span className={`status-badge ${getStatusClass(job.status)}`}>{job.status}</span>
            <button
              type="button"
              className="details-close"
              aria-label="Close and return to the grid"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </header>

        <div className="details-body">
          <dl className="details-facts">
            {facts.map((fact) => (
              <div key={fact.label} className="details-fact">
                <dt>{fact.label}</dt>
                <dd className={fact.value?.trim() ? undefined : 'details-missing'}>
                  {fact.value?.trim() ? fact.value : NOT_PROVIDED}
                </dd>
              </div>
            ))}
            <div className="details-fact details-fact-wide">
              <dt>Job posting</dt>
              <dd>
                {safeUrl ? (
                  // rel="noopener noreferrer" stops the new tab controlling this one.
                  <a href={safeUrl} target="_blank" rel="noopener noreferrer">
                    {safeUrl}
                  </a>
                ) : (
                  <span className="details-missing">{NOT_PROVIDED}</span>
                )}
              </dd>
            </div>
          </dl>

          <section className="details-section">
            <h3>Resume</h3>
            <ResumeAttachment
              attached={job.resume}
              canUpload={canUploadResume}
              onUpload={onUploadResume}
              onRemove={onRemoveResume}
              onSessionExpired={onSessionExpired}
              previewSubtitle={`${company} · ${title}`}
            />
          </section>

          <section className="details-section">
            <h3>Comments / Notes</h3>
            {job.notes?.trim() ? (
              <p className="details-text">{job.notes}</p>
            ) : (
              <p className="details-missing">No notes yet.</p>
            )}
          </section>

          <section className="details-section">
            <div className="details-section-header">
              <h3>Job description</h3>
              {!isEditing && (
                <button type="button" className="details-button" onClick={startEditing}>
                  {description ? 'Edit' : 'Add description'}
                </button>
              )}
              {saveStatusLabel && <span className="details-save-status">{saveStatusLabel}</span>}
            </div>

            {isEditing ? (
              <div className="details-editor">
                <textarea
                  aria-label="Job description"
                  value={draft}
                  autoFocus
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="details-editor-actions">
                  <button type="button" className="details-button primary" onClick={saveDescription}>
                    Save description
                  </button>
                  <button type="button" className="details-button" onClick={() => setIsEditing(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : description ? (
              // The full text, with its paragraphs and line breaks kept.
              <div className="details-text details-description">{description}</div>
            ) : (
              <p className="details-missing">No job description saved yet.</p>
            )}
          </section>
        </div>

        <footer className="details-footer">
          <button type="button" className="details-button" onClick={onClose}>
            ← Back to grid
          </button>
        </footer>
      </div>
    </dialog>
  )
}

export default ApplicationDetails
