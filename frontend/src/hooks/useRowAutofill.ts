// Reads job details automatically when a complete job link is typed or
// pasted into a grid row's App Link. Like the Add Job row, only EMPTY
// fields are filled (planRowAutofill); the change is saved by the normal
// autosave and is one undo step, so Cmd/Ctrl+Z takes it back.
import { useEffect, useRef, useState } from 'react'
import { getToken } from '../api/authApi'
import { extractJobFromUrl } from '../api/jobExtractionApi'
import { isLikelyJobUrl, planRowAutofill } from '../lib/autofill'
import type { RowUpdate } from '../types/job'
import { AUTO_EXTRACT_DELAY_MS } from './useAddJob'
import type { JobsState } from './useJobs'

type UseRowAutofillOptions = Pick<
  JobsState,
  'getLatestRow' | 'handleApplyChanges' | 'handleSessionExpired'
>

const FIELD_LABELS: Record<string, string> = {
  companyName: 'Company',
  jobTitle: 'Role',
  location: 'Location',
  pay: 'Pay',
  recruiter: 'Recruiter',
  jobDescription: 'Job Description',
}

export function useRowAutofill({
  getLatestRow,
  handleApplyChanges,
  handleSessionExpired,
}: UseRowAutofillOptions) {
  // A short note about the last automatic fill, shown above the grid.
  const [notice, setNotice] = useState<string | null>(null)
  // Waiting timers, rows with a request running, and the link last tried
  // for each row (so the same link isn't read again and again).
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const running = useRef(new Set<string>())
  const lastTried = useRef(new Map<string, string>())

  // Stop waiting timers when the grid goes away (e.g. on logout).
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer)
      }
      pending.clear()
    }
  }, [])

  async function extractForRow(rowKey: string, url: string) {
    const row = getLatestRow(rowKey)
    if (!row || (row.jobUrl ?? '').trim() !== url || running.current.has(rowKey)) {
      return
    }

    lastTried.current.set(rowKey, url)
    running.current.add(rowKey)
    try {
      const result = await extractJobFromUrl(url, getToken())

      if (result.kind === 'unauthorized') {
        // Let the link be tried again after logging back in.
        lastTried.current.delete(rowKey)
        handleSessionExpired()
        return
      }

      if (result.kind === 'failed') {
        setNotice(`${result.message} (Row: ${describeRow(rowKey)})`)
        return
      }

      // Use the row as it is NOW: the user may have typed meanwhile, or
      // changed the link, or deleted the row.
      const latest = getLatestRow(rowKey)
      if (!latest || (latest.jobUrl ?? '').trim() !== url) {
        return
      }

      const plan = planRowAutofill(latest, result.job)
      if (plan.filled.length === 0) {
        return
      }

      const update: RowUpdate = { rowKey, values: plan.values }
      handleApplyChanges([update])
      setNotice(
        `Filled in ${plan.filled.map((field) => FIELD_LABELS[field] ?? field).join(', ')} for ${describeRow(rowKey)} from the posting. Undo with Cmd/Ctrl+Z.`,
      )
    } finally {
      running.current.delete(rowKey)
    }
  }

  function describeRow(rowKey: string) {
    const row = getLatestRow(rowKey)
    return row?.companyName.trim() || row?.jobTitle.trim() || 'this job'
  }

  // Call whenever a row's App Link changes. Waits until the typing stops,
  // then reads the link once if it looks complete.
  function handleUrlChanged(rowKey: string) {
    const existing = timers.current.get(rowKey)
    if (existing) {
      clearTimeout(existing)
      timers.current.delete(rowKey)
    }

    const url = (getLatestRow(rowKey)?.jobUrl ?? '').trim()
    if (!isLikelyJobUrl(url) || lastTried.current.get(rowKey) === url) {
      return
    }

    timers.current.set(
      rowKey,
      setTimeout(() => {
        timers.current.delete(rowKey)
        void extractForRow(rowKey, url)
      }, AUTO_EXTRACT_DELAY_MS),
    )
  }

  return { notice, dismissNotice: () => setNotice(null), handleUrlChanged }
}
