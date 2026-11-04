// An application's resume: the attached file (with Preview, Download,
// Replace and Remove), or an Upload button when there's none. Used in the
// grid's Resume dialog and in View App. Choosing a file uploads it straight
// to this application; other applications are never affected.
import { useRef, useState } from 'react'
import { useResumeFiles } from '../../hooks/useResumeFiles'
import type { ActionResult } from '../../lib/resumeFiles'
import {
  canPreview,
  fileTypeLabel,
  formatFileSize,
  formatUploadDate,
  RESUME_FILE_ACCEPT,
} from '../../lib/resumeFiles'
import type { AttachedResume, ResumeFileRef } from '../../types/resume'
import ResumePreviewDialog from '../resumes/ResumePreviewDialog'
import '../resumes/ResumeLibrary.css'
import './ResumeAttachment.css'

type ResumeAttachmentProps = {
  attached: AttachedResume | null
  // False while the application is still being created (no id yet).
  canUpload: boolean
  onUpload: (file: File) => Promise<ActionResult>
  onRemove: () => Promise<ActionResult>
  // Ends the session after a 401 while opening the file.
  onSessionExpired: () => void
  // Shown in the preview, e.g. "Google · SWE Intern".
  previewSubtitle?: string
}

function toFileRef(attached: AttachedResume): ResumeFileRef {
  return { id: attached.versionId, originalFileName: attached.originalFileName, contentType: attached.contentType }
}

function ResumeAttachment({
  attached,
  canUpload,
  onUpload,
  onRemove,
  onSessionExpired,
  previewSubtitle,
}: ResumeAttachmentProps) {
  const files = useResumeFiles({ onSessionExpired })
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)

  // Runs an action, showing "busy" text meanwhile and the result after.
  async function run(label: string, action: () => Promise<ActionResult>) {
    setBusy(label)
    setError(null)
    setNotice(null)
    const result = await action()
    setBusy(null)
    if (result.ok) {
      setNotice(result.message ?? null)
    } else {
      setError(result.message)
    }
  }

  function handleFileChosen(file: File | undefined) {
    // Clear the input so choosing the same file again still uploads.
    if (fileInput.current) {
      fileInput.current.value = ''
    }
    if (file) {
      void run(`Uploading “${file.name}”…`, () => onUpload(file))
    }
  }

  const uploadLabel = attached ? 'Replace' : 'Upload PDF or DOCX'

  return (
    <div className="resume-attachment">
      {attached ? (
        <div className="resume-attached">
          <div>
            <p className="resume-attached-name">{attached.originalFileName}</p>
            <p className="resume-attached-meta">
              {fileTypeLabel(attached.contentType)} · {formatFileSize(attached.sizeBytes)} · uploaded{' '}
              {formatUploadDate(attached.uploadedAt)}
            </p>
          </div>
          <div className="resume-attached-actions">
            {canPreview(attached.contentType) && (
              <button type="button" className="resume-button" onClick={() => setIsPreviewing(true)}>
                Preview
              </button>
            )}
            <button
              type="button"
              className="resume-button"
              onClick={() => void run('Downloading…', () => files.download(toFileRef(attached)))}
            >
              Download
            </button>
            <button
              type="button"
              className="resume-button"
              disabled={busy !== null || !canUpload}
              onClick={() => fileInput.current?.click()}
            >
              {uploadLabel}
            </button>
            <button
              type="button"
              className="resume-button danger"
              disabled={busy !== null}
              onClick={() => void run('Removing…', onRemove)}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="resume-attached">
          <p className="resume-attachment-empty">No resume attached.</p>
          <button
            type="button"
            className="resume-button primary"
            disabled={busy !== null || !canUpload}
            onClick={() => fileInput.current?.click()}
          >
            {uploadLabel}
          </button>
        </div>
      )}

      {/* Hidden; the Upload / Replace buttons open it. */}
      <input
        ref={fileInput}
        type="file"
        accept={RESUME_FILE_ACCEPT}
        hidden
        aria-label="Choose a resume file"
        onChange={(event) => handleFileChosen(event.target.files?.[0])}
      />

      <div aria-live="polite">
        {!canUpload && <p className="resume-notice">This job is still being saved; you can upload a resume in a moment.</p>}
        {busy && <p className="resume-notice">{busy}</p>}
        {notice && <p className="resume-notice success">{notice}</p>}
        {error && <p className="resume-notice error" role="alert">{error}</p>}
      </div>

      {isPreviewing && attached && (
        <ResumePreviewDialog
          file={toFileRef(attached)}
          subtitle={previewSubtitle}
          getFile={files.getFile}
          onDownload={files.download}
          onClose={() => setIsPreviewing(false)}
        />
      )}
    </div>
  )
}

export default ResumeAttachment
