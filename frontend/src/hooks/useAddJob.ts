// The Add Job entry row's state and actions: the typed values, adding the
// job, "Autofill from URL", and pasting spreadsheet rows into the row.
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { ClipboardEvent } from 'react'
import { getToken } from '../api/authApi'
import { createJob } from '../api/jobsApi'
import { extractJobFromUrl } from '../api/jobExtractionApi'
import { applyAutofill, createSingleFlight, describeAutofill, isLikelyJobUrl } from '../lib/autofill'
import { pasteFields } from '../lib/gridColumns'
import { buildNewJobRequest, EMPTY_NEW_JOB, planEntryRowPaste } from '../lib/jobRows'
import type { NewJobForm } from '../lib/jobRows'
import { parsePastedTable } from '../lib/pasteParsing'
import type { EditableField } from '../types/job'
import type { JobsState } from './useJobs'

// How long to wait after the last change to App Link before reading it.
export const AUTO_EXTRACT_DELAY_MS = 800

type UseAddJobOptions = Pick<
  JobsState,
  'addSavedRow' | 'runInCreateQueue' | 'handleApplyChanges' | 'handleSessionExpired'
>

export function useAddJob({
  addSavedRow,
  runInCreateQueue,
  handleApplyChanges,
  handleSessionExpired,
}: UseAddJobOptions) {
  // ----- The "Add Job" form -----
  // Kept here (not in the form) so typed values survive being sent to the
  // login screen when the session expires.
  const [newJob, setNewJob] = useState<NewJobForm>(EMPTY_NEW_JOB)
  const [isAddingJob, setIsAddingJob] = useState(false)
  const [addJobError, setAddJobError] = useState<string | null>(null)

  // The latest form values, readable at any moment (e.g. when an autofill
  // request finishes), so autofill never overwrites what was just typed.
  const newJobRef = useRef<NewJobForm>(EMPTY_NEW_JOB)

  // Changes the form, keeping newJobRef in step.
  function updateNewJob(update: (current: NewJobForm) => NewJobForm) {
    newJobRef.current = update(newJobRef.current)
    setNewJob(newJobRef.current)
  }

  // ----- Autofill from URL -----
  const [isAutofilling, setIsAutofilling] = useState(false)
  // A short note about what autofill did (not an error).
  const [addJobNotice, setAddJobNotice] = useState<string | null>(null)
  // Makes sure only one extraction request runs at a time.
  const extractionFlight = useRef(createSingleFlight())

  // ----- Automatic autofill -----
  // Pasting or typing a complete job link into App Link reads the posting
  // by itself, shortly after the typing stops. Each link is tried once
  // (the ✨ button can always run it again).
  const lastAutoUrl = useRef<string | null>(null)

  const autofillIfUnchanged = useEffectEvent((url: string) => {
    if (newJobRef.current.jobUrl.trim() === url && lastAutoUrl.current !== url) {
      lastAutoUrl.current = url
      void handleAutofill()
    }
  })

  useEffect(() => {
    const url = newJob.jobUrl.trim()
    if (!isLikelyJobUrl(url) || url === lastAutoUrl.current) {
      return
    }
    const timer = setTimeout(() => autofillIfUnchanged(url), AUTO_EXTRACT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [newJob.jobUrl])

  // The Add Job form's button: creates the job on the server, then adds it
  // to the bottom of the grid and clears the form. Nothing is sent if every
  // field is empty.
  async function handleAddJob() {
    if (isAddingJob) {
      return
    }

    const body = buildNewJobRequest(newJob)
    if (body === null) {
      setAddJobError('Fill in at least one field (for example Company or Role).')
      return
    }

    setAddJobError(null)
    setIsAddingJob(true)

    try {
      const token = getToken()
      const result = await runInCreateQueue(() => createJob(body, token))

      if (result.status === 401) {
        // The form keeps what was typed, so it can be added after logging in.
        setAddJobError('Your session expired. Log in again, then click Add Job.')
        handleSessionExpired()
        return
      }

      if (result.status === 400) {
        setAddJobError('Fill in at least one field (for example Company or Role).')
        return
      }

      // Other errors, including a network failure (status 0).
      if (!result.ok) {
        throw new Error(`Add job failed with status ${result.status}`)
      }

      addSavedRow(result.data)
      updateNewJob(() => EMPTY_NEW_JOB)
      lastAutoUrl.current = null
      setAddJobNotice(null)
    } catch (err) {
      console.error(err)
      setAddJobError("Couldn't add the job. Check your connection and try again.")
    } finally {
      setIsAddingJob(false)
    }
  }

  // The entry row's Autofill button: reads the job posting at the App Link
  // and fills in the EMPTY fields only (see applyAutofill). Nothing is
  // saved: the user reviews the row and clicks Add.
  async function handleAutofill() {
    const url = newJobRef.current.jobUrl.trim()
    if (url === '') {
      setAddJobNotice(null)
      setAddJobError('Paste a job posting link into App Link first.')
      return
    }

    // Only one request at a time (the button is also disabled meanwhile).
    if (extractionFlight.current.isBusy) {
      return
    }

    setAddJobError(null)
    setAddJobNotice(null)
    setIsAutofilling(true)

    try {
      const result = await extractionFlight.current.run(() => extractJobFromUrl(url, getToken()))
      if (result === null) {
        return
      }

      if (result.kind === 'unauthorized') {
        // The form keeps everything typed, so autofill can be tried again.
        setAddJobError('Your session expired. Log in again, then click Autofill again.')
        handleSessionExpired()
        return
      }

      if (result.kind === 'failed') {
        // The link and everything else in the row stay as they are.
        setAddJobError(result.message)
        return
      }

      // Merge into the form as it is NOW, in case the user typed meanwhile.
      const outcome = applyAutofill(newJobRef.current, result.job)
      updateNewJob(() => outcome.form)
      setAddJobNotice(describeAutofill(outcome))
    } finally {
      setIsAutofilling(false)
    }
  }

  // Pasting into the Add Job entry row (Cmd+V / Ctrl+V). The mapping rules
  // are in planEntryRowPaste (jobRows.ts):
  //  - A single value is pasted into the field normally by the browser.
  //  - One spreadsheet row fills the entry row's fields; press Add to save.
  //  - Several rows each become a job, added to the bottom of the grid in
  //    the spreadsheet's order. They're created through the grid's normal
  //    path, so empty rows are skipped, they're saved one at a time (keeping
  //    their order), and a row that fails to save stays in the grid marked
  //    "Save failed" with Retry.
  function handleEntryPaste(event: ClipboardEvent<HTMLElement>, field: EditableField) {
    const plan = planEntryRowPaste(
      parsePastedTable(event.clipboardData.getData('text/plain')),
      field,
      pasteFields,
    )

    if (plan.kind === 'native') {
      return
    }

    event.preventDefault()

    const dateNote =
      plan.invalidDates > 0
        ? `${plan.invalidDates} pasted ${plan.invalidDates === 1 ? "date wasn't" : "dates weren't"} a real date and ${plan.invalidDates === 1 ? 'was' : 'were'} left empty.`
        : null

    if (plan.kind === 'fill') {
      updateNewJob((current) => ({ ...current, ...plan.values }))
      setAddJobError(dateNote)
      return
    }

    if (plan.rows.length === 0) {
      setAddJobError('Nothing to add: every pasted row was empty.')
      return
    }

    handleApplyChanges(plan.rows.map((values) => ({ rowKey: null, values })))
    setAddJobError(dateNote)
  }


  return {
    newJob,
    updateNewJob,
    isAddingJob,
    addJobError,
    addJobNotice,
    isAutofilling,
    handleAddJob,
    handleAutofill,
    handleEntryPaste,
  }
}
