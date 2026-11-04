// Labels for each row's save state, and the overall status shown above the
// grid. No React code, so it can be unit-tested (see saveStatus.test.ts).
import type { RowSaveStatus } from './jobRows.ts'

// Text (and tooltip) for each row-level save state.
export const rowStatusLabels: Record<RowSaveStatus, string> = {
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Save failed',
  empty: 'Empty row: it will be deleted when you leave it',
  deleting: 'Deleting…',
  deleteFailed: 'Delete failed',
}

export type OverallSaveStatus = 'failed' | 'saving' | 'unsaved' | 'saved'

// True if anything isn't confirmed saved yet (used to warn before closing).
export function hasUnsavedWork(statuses: Record<string, RowSaveStatus>): boolean {
  return Object.values(statuses).some((status) => status !== 'saved')
}

// The single status shown above the grid. The most important state wins:
// failed, then saving (or deleting), then unsaved (or empty).
export function summarizeSaveStatuses(statuses: Record<string, RowSaveStatus>): {
  status: OverallSaveStatus | null
  text: string
} {
  const statusList = Object.values(statuses)
  const saveFailedCount = statusList.filter((status) => status === 'failed').length
  const deleteFailedCount = statusList.filter((status) => status === 'deleteFailed').length
  const failedCount = saveFailedCount + deleteFailedCount

  const status: OverallSaveStatus | null =
    failedCount > 0
      ? 'failed'
      : statusList.includes('saving') || statusList.includes('deleting')
        ? 'saving'
        : statusList.includes('unsaved') || statusList.includes('empty')
          ? 'unsaved'
          : statusList.includes('saved')
            ? 'saved'
            : null

  const failedWhat =
    deleteFailedCount === 0 ? 'Save' : saveFailedCount === 0 ? 'Delete' : 'Save/delete'

  const text =
    status === 'failed'
      ? `${failedWhat} failed (${failedCount} ${failedCount === 1 ? 'row' : 'rows'})`
      : status === 'saved'
        ? 'All changes saved'
        : status === 'saving' && !statusList.includes('saving')
          ? rowStatusLabels.deleting
          : status === 'unsaved' && !statusList.includes('unsaved')
            ? 'Empty row (deleted when you leave it)'
            : status
              ? rowStatusLabels[status]
              : ''

  return { status, text }
}
