// The Resume dialog for one application, opened from its Resume cell:
// upload a PDF or Word file straight to this application, or Preview,
// Download, Replace or Remove the one attached. (The Resume Library is only
// an overview; it's never used to pick a file here.)
import type { ActionResult } from '../../lib/resumeFiles'
import type { AttachedResume } from '../../types/resume'
import ResumeAttachment from './ResumeAttachment'
import './ResumeDialog.css'
import { useModalDialog } from './useModalDialog'

type ResumeDialogProps = {
  title: string
  subtitle: string
  attached: AttachedResume | null
  canUpload: boolean
  onUpload: (file: File) => Promise<ActionResult>
  onRemove: () => Promise<ActionResult>
  onSessionExpired: () => void
  onClose: () => void
}

function ResumeDialog({
  title,
  subtitle,
  attached,
  canUpload,
  onUpload,
  onRemove,
  onSessionExpired,
  onClose,
}: ResumeDialogProps) {
  const dialogRef = useModalDialog()

  return (
    <dialog
      ref={dialogRef}
      className="resume-dialog"
      aria-labelledby="resume-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="resume-dialog-panel">
        <header className="resume-dialog-header">
          <div>
            <h2 id="resume-dialog-title">Resume</h2>
            <p>
              {title}
              {subtitle && ` · ${subtitle}`}
            </p>
          </div>
          <button type="button" className="resume-dialog-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="resume-dialog-body">
          <ResumeAttachment
            attached={attached}
            canUpload={canUpload}
            onUpload={onUpload}
            onRemove={onRemove}
            onSessionExpired={onSessionExpired}
            previewSubtitle={subtitle ? `${subtitle} · ${title}` : title}
          />
        </div>

        <footer className="resume-dialog-footer">
          <button type="button" className="resume-button" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </dialog>
  )
}

export default ResumeDialog
