// Shows a resume file over the page. The file is fetched with the login
// token as a Blob (it is never given a public URL):
//  - PDFs are shown through a temporary Blob URL, released as soon as the
//    dialog closes.
//  - Word files are drawn page by page, as Word lays them out, inside a
//    sandboxed frame that can't run code or load anything (see
//    lib/docxPreview.ts). The frame is emptied when the dialog closes. The
//    stored original isn't changed; Download always gives back the exact
//    file that was uploaded.
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  clearDocxFrame,
  DOCX_FRAME_DOCUMENT,
  DOCX_FRAME_SANDBOX,
  renderDocxInto,
} from '../../lib/docxPreview'
import { fileTypeLabel, isDocx, isPdf } from '../../lib/resumeFiles'
import type { ActionResult } from '../../lib/resumeFiles'
import type { ResumeFileRef } from '../../types/resume'

type ResumePreviewDialogProps = {
  file: ResumeFileRef
  // Shown under the file name, e.g. "Google · SWE Intern" (optional).
  subtitle?: string
  getFile: (versionId: number) => Promise<{ ok: true; blob: Blob } | { ok: false; message: string }>
  onDownload: (file: ResumeFileRef) => Promise<ActionResult>
  onClose: () => void
}

function ResumePreviewDialog({ file, subtitle, getFile, onDownload, onClose }: ResumePreviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  // The Word file (in memory), and the frame it's drawn into.
  const [docxFile, setDocxFile] = useState<Blob | null>(null)
  const docxFrame = useRef<HTMLIFrameElement>(null)
  const isOpen = useRef(true)
  const [error, setError] = useState<string | null>(null)
  const pdf = isPdf(file.contentType)
  const docx = isDocx(file.contentType)

  // Open as a modal dialog (Escape closes it, focus stays inside).
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
    }
    return () => dialog?.close()
  }, [])

  // Lets the effect below use the latest getFile without re-running.
  const loadFile = useEffectEvent((versionId: number) => getFile(versionId))

  // Fetch the file, then make a temporary URL for a PDF (released on
  // close) or keep a Word file to draw into the frame.
  useEffect(() => {
    if (!pdf && !docx) {
      return
    }

    let objectUrl: string | null = null
    let ignore = false

    void loadFile(file.id).then((result) => {
      if (ignore) {
        return
      }
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (docx) {
        setDocxFile(result.blob)
        return
      }
      // Always treat it as a PDF, whatever the response said.
      objectUrl = URL.createObjectURL(new Blob([result.blob], { type: 'application/pdf' }))
      setUrl(objectUrl)
    })

    return () => {
      ignore = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [file.id, pdf, docx])

  // When the dialog closes, stop any drawing still in progress and empty
  // the Word frame.
  useEffect(() => {
    isOpen.current = true
    const frame = docxFrame
    return () => {
      isOpen.current = false
      clearDocxFrame(frame.current?.contentDocument)
    }
  }, [])

  // Once the (empty, sandboxed) frame has loaded, draw the Word file in it.
  async function drawDocx() {
    const frameDocument = docxFrame.current?.contentDocument
    if (!frameDocument || !docxFile || !isOpen.current) {
      return
    }
    try {
      await renderDocxInto(frameDocument, docxFile)
    } catch (err) {
      console.error(err)
      if (isOpen.current) {
        setError("This Word file couldn't be previewed. Use Download to open it.")
      }
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="resume-preview-dialog"
      aria-label={`Preview of ${file.originalFileName}`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="resume-preview-panel">
        <header className="resume-preview-header">
          <div>
            <h2>{file.originalFileName}</h2>
            <p>
              {fileTypeLabel(file.contentType)}
              {subtitle && ` · ${subtitle}`}
            </p>
          </div>
          <div className="resume-preview-actions">
            <button type="button" className="resume-button" onClick={() => void onDownload(file)}>
              Download
            </button>
            <button type="button" className="resume-button" aria-label="Close preview" onClick={onClose}>
              ✕
            </button>
          </div>
        </header>

        <div className="resume-preview-body">
          {!pdf && !docx ? (
            <p className="resume-preview-message">
              This file type can't be previewed. Use Download to open it.
            </p>
          ) : error ? (
            <p className="resume-preview-message error" role="alert">{error}</p>
          ) : url ? (
            <iframe className="resume-preview-frame" src={url} title={`${file.originalFileName} (PDF)`} />
          ) : docxFile ? (
            // The Word file, page by page, in a frame that can't run code or
            // load anything (see lib/docxPreview.ts).
            <div className="docx-preview-layout">
              <p className="docx-preview-note">
                Preview only: some Word features may look slightly different. Download gives the original file.
              </p>
              <iframe
                ref={docxFrame}
                className="resume-preview-frame"
                title={`${file.originalFileName} (Word)`}
                sandbox={DOCX_FRAME_SANDBOX}
                srcDoc={DOCX_FRAME_DOCUMENT}
                onLoad={() => void drawDocx()}
              />
            </div>
          ) : (
            <p className="resume-preview-message">Loading preview…</p>
          )}
        </div>
      </div>
    </dialog>
  )
}

export default ResumePreviewDialog
