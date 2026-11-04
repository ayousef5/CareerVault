// The top of the application. App only puts the pieces together:
//  - useSession decides between the login screen and the dashboard,
//  - useJobs holds the job rows and keeps them in sync with the server,
//  - useAddJob runs the Add Job entry row,
//  - the components under components/ draw the page.
//  - useRowAutofill reads job details when a link is pasted into a row,
// Search filtering, which dialog is open, and which page is showing (the
// dashboard, My Applications or the Resume Library, see useAppView) are
// App's own state.
import { useState } from 'react'
import AuthScreen from '../components/auth/AuthScreen'
import AddJobRow from '../components/jobs/AddJobRow'
import ApplicationDetails from '../components/jobs/ApplicationDetails'
import JobDescriptionDialog from '../components/jobs/JobDescriptionDialog'
import JobGrid from '../components/jobs/JobGrid'
import ResumeDialog from '../components/jobs/ResumeDialog'
import Sidebar from '../components/layout/Sidebar'
import ResumeLibraryPage from '../components/resumes/ResumeLibraryPage'
import { useAppView } from '../hooks/useAppView'
import SummaryCards from '../components/layout/SummaryCards'
import { useAddJob } from '../hooks/useAddJob'
import { useJobResume } from '../hooks/useJobResume'
import { useJobs } from '../hooks/useJobs'
import { useRowAutofill } from '../hooks/useRowAutofill'
import { useSession } from '../hooks/useSession'
import type { NewJobForm } from '../lib/jobRows'
import type { EditableField, RowUpdate } from '../types/job'
import { rowStatusLabels, summarizeSaveStatuses } from '../lib/saveStatus'

function App() {
  // Which page is showing: the dashboard, My Applications or the Resume Library.
  const view = useAppView()

  // Whether the user is logged in (see hooks/useSession.ts).
  const { isAuthenticated, logIn, expireSession } = useSession()

  // The text typed into the search bar.
  const [searchTerm, setSearchTerm] = useState('')

  // All job rows and their actions (see hooks/useJobs.ts).
  const jobs = useJobs({ isAuthenticated, expireSession })
  const { applications, saveStatuses, isLoading, error } = jobs

  // The Add Job entry row (see hooks/useAddJob.ts).
  const addJob = useAddJob(jobs)

  // Automatic "autofill from URL" for rows already in the grid.
  const rowAutofill = useRowAutofill(jobs)

  // Uploading and removing each application's resume (see hooks/useJobResume.ts).
  const jobResume = useJobResume(jobs)

  // The overall save status shown above the grid (see lib/saveStatus.ts).
  const overall = summarizeSaveStatuses(saveStatuses)

  // The row whose details view is open (null = just the grid).
  const [detailsRowKey, setDetailsRowKey] = useState<string | null>(null)

  // Whose job description is open in the editor: a grid row, the Add Job
  // row ('new'), or nobody (null).
  const [descriptionTarget, setDescriptionTarget] = useState<string | 'new' | null>(null)

  // The row whose Resume dialog is open (null = none).
  const [resumeRowKey, setResumeRowKey] = useState<string | null>(null)

  // Keep only applications whose company, title, or location matches the search.
  // Rows added in this session always stay visible so they don't vanish while you type.
  const search = searchTerm.trim().toLowerCase()
  const filteredApplications = applications.filter(
    (application) =>
      application.rowKey.startsWith('new-') ||
      application.companyName.toLowerCase().includes(search) ||
      application.jobTitle.toLowerCase().includes(search) ||
      (application.location ?? '').toLowerCase().includes(search),
  )

  // The job shown in the details view. If that row has been deleted, the
  // view simply isn't shown.
  const detailsRow = detailsRowKey
    ? applications.find((application) => application.rowKey === detailsRowKey)
    : undefined

  const descriptionRow =
    descriptionTarget && descriptionTarget !== 'new'
      ? applications.find((application) => application.rowKey === descriptionTarget)
      : undefined

  // The row whose Resume dialog is open. If it's deleted, the dialog closes.
  const resumeRow = resumeRowKey
    ? applications.find((application) => application.rowKey === resumeRowKey)
    : undefined

  // A grid edit. Changing a row's App Link may read the posting.
  function handleCellChange(rowKey: string, field: EditableField, value: string) {
    jobs.handleCellChange(rowKey, field, value)
    if (field === 'jobUrl') {
      rowAutofill.handleUrlChanged(rowKey)
    }
  }

  // A paste or a cleared range. Pasting a link into ONE row reads the
  // posting; big multi-row pastes don't, so they don't fire many requests.
  function handleApplyChanges(updates: RowUpdate[]) {
    jobs.handleApplyChanges(updates)
    const [update] = updates
    if (updates.length === 1 && update.rowKey !== null && 'jobUrl' in update.values) {
      rowAutofill.handleUrlChanged(update.rowKey)
    }
  }

  // Show the login screen if the user isn't authenticated.
  if (!isAuthenticated) {
    return (
      <AuthScreen onLogin={logIn} />
    )
  }

  return (
    <div className="app-layout">
      <Sidebar activeView={view} />

      <main className="main-content">
        {view === 'resumes' ? (
          // The job hooks above keep running, so unsaved grid edits and
          // autosave carry on while the library is open.
          <ResumeLibraryPage onSessionExpired={jobs.handleSessionExpired} />
        ) : (
          <>
            {/* Page header */}
            {view === 'applications' ? (
              <header className="page-header">
                <h1>My Applications</h1>
                <p className="subtitle">Every job you're tracking, with its saved description.</p>
              </header>
            ) : (
              <>
                <header className="page-header">
                  <h1>Welcome back</h1>
                  <p className="subtitle">Here's an overview of your job search.</p>
                </header>

                <SummaryCards applications={applications} />
              </>
            )}

            {/* Applications grid with search */}
            <section className="applications-panel">
              <div className="panel-header">
                <h2>Applications</h2>

                <div className="panel-actions">
                  {/* Overall save status. role="status" lets screen readers announce it. */}
                  <div className="save-status-area" role="status">
                    {overall.status && (
                      <span className={`save-status save-status-${overall.status}`}>
                        {overall.text}
                      </span>
                    )}
                    {overall.status === 'failed' && (
                      <button
                        type="button"
                        className="retry-button"
                        onClick={jobs.handleRetry}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                  <input
                    type="search"
                    className="search-input"
                    placeholder="Search applications..."
                    aria-label="Search applications"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                </div>
              </div>

              {/* What automatic autofill did for a grid row. */}
              {rowAutofill.notice && (
                <div className="autofill-notice" role="status">
                  <span>{rowAutofill.notice}</span>
                  <button
                    type="button"
                    className="autofill-notice-close"
                    aria-label="Dismiss"
                    onClick={rowAutofill.dismissNotice}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Show a loading message, an error, or the editable grid. */}
              {isLoading ? (
                <p className="empty-message">Loading applications...</p>
              ) : error ? (
                <p className="empty-message error-message">{error}</p>
              ) : (
                <>
                  <JobGrid
                    // The only way to start a new job (besides pasting rows).
                    entryRow={
                      <AddJobRow
                        values={addJob.newJob}
                        isSubmitting={addJob.isAddingJob}
                        error={addJob.addJobError}
                        notice={addJob.addJobNotice}
                        isAutofilling={addJob.isAutofilling}
                        onAutofill={addJob.handleAutofill}
                        onChange={(field, value) =>
                          addJob.updateNewJob((current: NewJobForm) => ({ ...current, [field]: value }))
                        }
                        onSubmit={addJob.handleAddJob}
                        onPaste={addJob.handleEntryPaste}
                        onOpenDescription={() => setDescriptionTarget('new')}
                      />
                    }
                    applications={filteredApplications}
                    saveStatuses={saveStatuses}
                    onCellChange={handleCellChange}
                    onApplyChanges={handleApplyChanges}
                    onDeleteRow={(rowKey) => void jobs.deleteRow(rowKey)}
                    onOpenDetails={setDetailsRowKey}
                    onOpenDescription={setDescriptionTarget}
                    onOpenResume={setResumeRowKey}
                    onLeaveRows={jobs.handleLeaveRows}
                    onUndo={jobs.handleUndo}
                    onRedo={jobs.handleRedo}
                    onSealHistory={jobs.handleSealHistory}
                  />
                </>
              )}
            </section>
          </>
        )}
      </main>

      {/* The full details of one application, over the grid. */}
      {view !== 'resumes' && detailsRow && (
        <ApplicationDetails
          key={detailsRow.rowKey}
          job={detailsRow}
          saveStatusLabel={
            saveStatuses[detailsRow.rowKey] && saveStatuses[detailsRow.rowKey] !== 'saved'
              ? rowStatusLabels[saveStatuses[detailsRow.rowKey]]
              : null
          }
          onSaveDescription={(description) =>
            jobs.handleSaveDescription(detailsRow.rowKey, description)
          }
          // Uploads need the job's database id (new rows get it once saved).
          canUploadResume={detailsRow.id > 0}
          onUploadResume={(file) => jobResume.upload(detailsRow.rowKey, file)}
          onRemoveResume={() => jobResume.remove(detailsRow.rowKey)}
          onSessionExpired={jobs.handleSessionExpired}
          onClose={() => setDetailsRowKey(null)}
        />
      )}

      {/* Upload, replace, remove or preview a row's resume. */}
      {view !== 'resumes' && resumeRow && (
        <ResumeDialog
          key={resumeRow.rowKey}
          title={resumeRow.jobTitle || 'Untitled role'}
          subtitle={resumeRow.companyName}
          attached={resumeRow.resume}
          canUpload={resumeRow.id > 0}
          onUpload={(file) => jobResume.upload(resumeRow.rowKey, file)}
          onRemove={() => jobResume.remove(resumeRow.rowKey)}
          onSessionExpired={jobs.handleSessionExpired}
          onClose={() => setResumeRowKey(null)}
        />
      )}

      {/* The job description editor, for a grid row or the Add Job row. */}
      {view !== 'resumes' && descriptionRow && (
        <JobDescriptionDialog
          key={descriptionRow.rowKey}
          title={descriptionRow.jobTitle || 'Untitled role'}
          subtitle={descriptionRow.companyName}
          description={descriptionRow.jobDescription}
          onSave={(description) => {
            jobs.handleSaveDescription(descriptionRow.rowKey, description)
            setDescriptionTarget(null)
          }}
          onClose={() => setDescriptionTarget(null)}
        />
      )}
      {view !== 'resumes' && descriptionTarget === 'new' && (
        <JobDescriptionDialog
          key="new"
          title={addJob.newJob.jobTitle || 'New job'}
          subtitle={addJob.newJob.companyName}
          description={addJob.newJob.jobDescription}
          onSave={(description) => {
            addJob.updateNewJob((current) => ({ ...current, jobDescription: description }))
            setDescriptionTarget(null)
          }}
          onClose={() => setDescriptionTarget(null)}
        />
      )}
    </div>
  )
}

export default App
