// The Resume Library page: an overview of the resumes used across your
// applications. One row per unique file (the same file uploaded to several
// applications is one row), with every company and role using it, plus
// Preview and Download. Resumes are uploaded from each application, not here.
import { useState } from 'react'
import { useResumeFiles } from '../../hooks/useResumeFiles'
import { useResumeLibrary } from '../../hooks/useResumeLibrary'
import { describeApplications } from '../../lib/jobResume'
import { canPreview, fileTypeLabel, formatFileSize, formatUploadDate } from '../../lib/resumeFiles'
import type { LibraryFile, ResumeFileRef } from '../../types/resume'
import ResumePreviewDialog from './ResumePreviewDialog'
import './ResumeLibrary.css'

type ResumeLibraryPageProps = {
  // Ends the session (shows the login screen) after a 401.
  onSessionExpired: () => void
}

function toFileRef(file: LibraryFile): ResumeFileRef {
  return { id: file.versionId, originalFileName: file.originalFileName, contentType: file.contentType }
}

function ResumeLibraryPage({ onSessionExpired }: ResumeLibraryPageProps) {
  const library = useResumeLibrary({ onSessionExpired })
  const files = useResumeFiles({ onSessionExpired })

  // The file being previewed, if any.
  const [preview, setPreview] = useState<LibraryFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function download(file: LibraryFile) {
    setError(null)
    const result = await files.download(toFileRef(file))
    if (!result.ok) setError(result.message)
  }

  return (
    <>
      <header className="page-header">
        <h1>Resume Library</h1>
        <p className="subtitle">
          Every resume you've uploaded to your applications. To add or change one, open the application.
        </p>
      </header>

      {error && <p className="resume-notice error" role="alert">{error}</p>}

      {library.isLoading ? (
        <p className="resume-empty">Loading your resumes…</p>
      ) : library.loadError ? (
        <p className="resume-empty error" role="alert">{library.loadError}</p>
      ) : library.files.length === 0 ? (
        <p className="resume-empty">
          No resumes yet. Upload one from an application's Resume cell in My Applications.
        </p>
      ) : (
        <section className="resume-panel">
          {/* Scrolls sideways on narrow screens. */}
          <div className="resume-table-wrapper">
            <table className="resume-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Uploaded</th>
                  <th>Used for</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {library.files.map((file) => (
                  <tr key={file.storedFileId}>
                    <td className="resume-file-name">{file.originalFileName}</td>
                    <td className="resume-nowrap">{fileTypeLabel(file.contentType)}</td>
                    <td className="resume-nowrap">{formatFileSize(file.sizeBytes)}</td>
                    <td className="resume-nowrap">{formatUploadDate(file.uploadedAt)}</td>
                    <td>
                      {/* Every company and role using this file, or "Not attached…". */}
                      <ul
                        className={
                          file.applications.length > 0 ? 'resume-applications' : 'resume-applications resume-not-attached'
                        }
                      >
                        {describeApplications(file).map((line, index) => (
                          <li key={file.applications[index]?.jobId ?? 'none'}>{line}</li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      <div className="resume-row-actions">
                        {canPreview(file.contentType) && (
                          <button type="button" className="resume-button" onClick={() => setPreview(file)}>
                            Preview
                          </button>
                        )}
                        <button type="button" className="resume-button" onClick={() => void download(file)}>
                          Download
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {preview && (
        <ResumePreviewDialog
          key={preview.versionId}
          file={toFileRef(preview)}
          getFile={files.getFile}
          onDownload={files.download}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  )
}

export default ResumeLibraryPage
