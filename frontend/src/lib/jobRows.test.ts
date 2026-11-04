// Unit tests for job-row rules. Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { pasteFields } from './gridColumns.ts'
import { parsePastedTable } from './pasteParsing.ts'
import {
  buildNewJobRequest,
  convertPastedValue,
  createRowSync,
  createTaskQueue,
  planEntryRowPaste,
  decideDelete,
  decideSave,
  EMPTY_NEW_JOB,
  hasMeaningfulContent,
  planMerge,
  rowHasContent,
  rowsLeft,
} from './jobRows.ts'
import type { JobField, RowSync } from './jobRows.ts'

// The grid's 9 data columns, in order (where values are pasted by
// position). The Job Description column is an action column, not one of them.
const GRID_FIELDS: JobField[] = pasteFields

describe('rowHasContent', () => {
  test('a row with only an attached resume is not empty (it is kept and saved)', () => {
    assert.equal(rowHasContent({ companyName: '', status: 'Not Applied', resumeVersionId: 7 }), true)
  })

  test('a row with no text and no resume is empty', () => {
    assert.equal(rowHasContent({ companyName: ' ', status: 'Not Applied', resumeVersionId: null }), false)
    assert.equal(rowHasContent({ companyName: '' }), false)
  })

  test('text still counts as before', () => {
    assert.equal(rowHasContent({ companyName: 'Initech', resumeVersionId: null }), true)
  })
})

describe('hasMeaningfulContent', () => {
  test('a job with only default values is empty', () => {
    assert.equal(hasMeaningfulContent(EMPTY_NEW_JOB), false)
    assert.equal(hasMeaningfulContent({}), false)
  })

  test('blank text, nulls and "Not Applied" in any case are empty', () => {
    assert.equal(
      hasMeaningfulContent({
        companyName: '   ',
        jobTitle: '',
        location: null,
        notes: '\n',
        status: ' not applied ',
      }),
      false,
    )
  })

  test('a partially completed job is not empty', () => {
    assert.equal(hasMeaningfulContent({ companyName: 'FedEx', jobTitle: '' }), true)
    assert.equal(hasMeaningfulContent({ jobUrl: 'https://example.com' }), true)
    assert.equal(hasMeaningfulContent({ dateApplied: '2026-10-25' }), true)
    assert.equal(hasMeaningfulContent({ status: 'Applied' }), true)
  })
})

describe('buildNewJobRequest (the Add Job form)', () => {
  test('returns null for an empty form, so nothing is created', () => {
    assert.equal(buildNewJobRequest(EMPTY_NEW_JOB), null)
    assert.equal(
      buildNewJobRequest({ ...EMPTY_NEW_JOB, companyName: '  ', notes: ' ' }),
      null,
    )
  })

  test('builds a request for a partially filled form, trimming text', () => {
    assert.deepEqual(
      buildNewJobRequest({
        ...EMPTY_NEW_JOB,
        companyName: '  FedEx ',
        pay: '25/hr',
        dateApplied: '2026-10-25',
        notes: '   ',
      }),
      {
        companyName: 'FedEx',
        jobTitle: '',
        location: null,
        jobUrl: null,
        dateApplied: '2026-10-25',
        status: 'Not Applied',
        notes: null,
        jobDescription: null,
        pay: '25/hr',
        recruiter: null,
      },
    )
  })

  test('keeps a chosen status', () => {
    assert.equal(
      buildNewJobRequest({ ...EMPTY_NEW_JOB, status: 'Interviewing' })?.status,
      'Interviewing',
    )
  })
})

// Helper: bookkeeping for a row with some overrides.
function sync(overrides: Partial<RowSync> = {}): RowSync {
  return { ...createRowSync(1), ...overrides }
}

describe('decideSave (autosave)', () => {
  test('creates new rows and updates existing ones', () => {
    assert.equal(decideSave(sync({ dbId: null, version: 1 }), true), 'post')
    assert.equal(decideSave(sync({ version: 2, savedVersion: 1 }), true), 'put')
  })

  test('does nothing when everything is already saved', () => {
    assert.equal(decideSave(sync({ version: 3, savedVersion: 3 }), true), 'skip')
  })

  test('waits when a request is already running for the row', () => {
    assert.equal(decideSave(sync({ version: 2, isSaving: true }), true), 'wait')
  })

  test('never stores an empty row', () => {
    assert.equal(decideSave(sync({ dbId: null, version: 1 }), false), 'empty')
    assert.equal(decideSave(sync({ version: 2 }), false), 'empty')
  })

  test('a pending timer cannot re-create or overwrite a deleted row', () => {
    // Being deleted: even with unsaved edits, nothing is sent.
    assert.equal(decideSave(sync({ version: 5, isDeleting: true }), true), 'skip')
    assert.equal(
      decideSave(sync({ dbId: null, version: 1, isDeleting: true }), true),
      'skip',
    )
    // Already deleted: its bookkeeping is gone, so the timer finds nothing.
    assert.equal(decideSave(undefined, true), 'skip')
  })
})

describe('decideDelete', () => {
  test('sends DELETE for a saved row', () => {
    assert.equal(decideDelete(sync()), 'send-delete')
    // Even with unsaved edits: the pending save is cancelled instead.
    assert.equal(decideDelete(sync({ version: 4, savedVersion: 2 })), 'send-delete')
  })

  test('removes a never-saved row without contacting the server', () => {
    assert.equal(decideDelete(sync({ dbId: null, version: 1 })), 'remove-locally')
  })

  test('waits for a running create, then deletes the created record', () => {
    assert.equal(decideDelete(sync({ dbId: null, isSaving: true })), 'after-create')
  })

  test('ignores a row that is already being deleted or is gone', () => {
    assert.equal(decideDelete(sync({ isDeleting: true })), 'ignore')
    assert.equal(decideDelete(undefined), 'ignore')
  })

  test('a failed delete can be retried', () => {
    // After a failure the app sets isDeleting back to false.
    const failed = sync({ isDeleting: false })
    assert.equal(decideDelete(failed), 'send-delete')
  })
})

describe('rowsLeft', () => {
  test('lists rows that were selected but are no longer', () => {
    assert.deepEqual(rowsLeft(['a', 'b', 'c'], ['b']), ['a', 'c'])
    assert.deepEqual(rowsLeft(['a'], ['a', 'b']), [])
    assert.deepEqual(rowsLeft([], ['a']), [])
  })
})

describe('planMerge (reloading after logging in again)', () => {
  type Job = { id: number; companyName: string; status?: string }
  type Row = Job & { rowKey: string }

  function localMap(rows: Row[]) {
    return new Map(rows.map((row) => [row.rowKey, row]))
  }

  test('keeps the server order for a fresh load (insertion order after reload)', () => {
    const server: Job[] = [
      { id: 3, companyName: 'First' },
      { id: 1, companyName: 'Second' },
      { id: 2, companyName: 'Third' },
    ]

    const plan = planMerge(server, new Map(), new Map(), {})

    assert.deepEqual(
      plan.rows.map((row) => row.companyName),
      ['First', 'Second', 'Third'],
    )
    assert.deepEqual(plan.newSyncs.map((s) => s.dbId), [3, 1, 2])
    assert.deepEqual(plan.statuses, { 'db-3': 'saved', 'db-1': 'saved', 'db-2': 'saved' })
    assert.deepEqual(plan.rowsToRetry, [])
  })

  test('keeps unsaved local edits and never-saved rows, in order, with no duplicates', () => {
    const server: Job[] = [
      { id: 1, companyName: 'Server A' },
      { id: 2, companyName: 'Server B (old)' },
      { id: 7, companyName: 'Created in this tab' },
    ]
    const local = localMap([
      { rowKey: 'db-1', id: 1, companyName: 'Server A' },
      { rowKey: 'db-2', id: 2, companyName: 'B edited locally' },
      { rowKey: 'new-1', id: 7, companyName: 'Created in this tab' },
      { rowKey: 'new-2', id: -1, companyName: 'Never saved' },
    ])
    const syncs = new Map<string, RowSync>([
      ['db-1', sync({ dbId: 1 })],
      ['db-2', sync({ dbId: 2, version: 3, savedVersion: 2 })],
      ['new-1', sync({ dbId: 7 })],
      ['new-2', sync({ dbId: null, version: 1 })],
    ])

    const plan = planMerge(server, local, syncs, { 'db-2': 'failed' })

    assert.deepEqual(
      plan.rows.map((row) => row.rowKey),
      ['db-1', 'db-2', 'new-1', 'new-2'],
    )
    assert.equal(plan.rows[1].companyName, 'B edited locally')
    assert.deepEqual(plan.statuses, {
      'db-1': 'saved',
      'db-2': 'failed',
      'new-1': 'saved',
      'new-2': 'unsaved',
    })
    assert.deepEqual(plan.rowsToRetry, ['db-2', 'new-2'])
    assert.deepEqual(plan.newSyncs, [])
  })

  test('does not retry a row whose save is still running', () => {
    const local = localMap([{ rowKey: 'new-1', id: -1, companyName: 'X' }])
    const syncs = new Map([['new-1', sync({ dbId: null, isSaving: true })]])

    const plan = planMerge([], local, syncs, {})

    assert.deepEqual(plan.statuses, { 'new-1': 'saving' })
    assert.deepEqual(plan.rowsToRetry, [])
  })

  test('keeps rows that are being deleted, without retrying their save', () => {
    const local = localMap([{ rowKey: 'db-5', id: 5, companyName: 'Going' }])
    const syncs = new Map([['db-5', sync({ dbId: 5, version: 2, isDeleting: true })]])

    const plan = planMerge([{ id: 5, companyName: 'Going' }], local, syncs, {})

    assert.deepEqual(plan.statuses, { 'db-5': 'deleting' })
    assert.deepEqual(plan.rowsToRetry, [])
  })

  test('keeps "Delete failed" on a clean row so it can be retried', () => {
    const local = localMap([{ rowKey: 'db-5', id: 5, companyName: 'X' }])
    const syncs = new Map([['db-5', sync({ dbId: 5 })]])

    const plan = planMerge([{ id: 5, companyName: 'X' }], local, syncs, {
      'db-5': 'deleteFailed',
    })

    assert.deepEqual(plan.statuses, { 'db-5': 'deleteFailed' })
  })

  test('forgets saved rows the server no longer has', () => {
    const local = localMap([{ rowKey: 'db-9', id: 9, companyName: 'Deleted elsewhere' }])
    const syncs = new Map([['db-9', sync({ dbId: 9 })]])

    const plan = planMerge([], local, syncs, { 'db-9': 'saved' })

    assert.deepEqual(plan.rows, [])
    assert.deepEqual(plan.rowsToForget, ['db-9'])
    assert.deepEqual(plan.statuses, {})
  })

  test('leaves out completely empty saved jobs and lists them for deletion', () => {
    const server: Job[] = [
      { id: 1, companyName: 'FedEx' },
      { id: 2, companyName: '', status: 'Not Applied' },
      { id: 3, companyName: '   ' },
      { id: 4, companyName: '', status: 'Applied' }, // only a status: keep
    ]

    const plan = planMerge(server, new Map(), new Map(), {})

    assert.deepEqual(plan.rows.map((row) => row.id), [1, 4])
    assert.deepEqual(plan.emptyJobsToDelete, [2, 3])
    assert.deepEqual(Object.keys(plan.statuses), ['db-1', 'db-4'])
    assert.deepEqual(plan.newSyncs.map((s) => s.dbId), [1, 4])
  })

  test('forgets local bookkeeping for an empty job that is being cleaned up', () => {
    const local = localMap([{ rowKey: 'db-2', id: 2, companyName: '' }])
    const syncs = new Map([['db-2', sync({ dbId: 2 })]])

    const plan = planMerge([{ id: 2, companyName: '' }], local, syncs, { 'db-2': 'saved' })

    assert.deepEqual(plan.rows, [])
    assert.deepEqual(plan.emptyJobsToDelete, [2])
    assert.deepEqual(plan.rowsToForget, ['db-2'])
  })

  test('keeps an empty-on-the-server job that has unsaved local edits', () => {
    const local = localMap([{ rowKey: 'db-2', id: 2, companyName: 'Typed locally' }])
    const syncs = new Map([['db-2', sync({ dbId: 2, version: 2, savedVersion: 1 })]])

    const plan = planMerge([{ id: 2, companyName: '' }], local, syncs, {})

    assert.deepEqual(plan.rows.map((row) => row.companyName), ['Typed locally'])
    assert.deepEqual(plan.emptyJobsToDelete, [])
    assert.deepEqual(plan.rowsToRetry, ['db-2'])
  })
})

describe('planEntryRowPaste (pasting into the Add Job entry row)', () => {
  // The grid's column order: Company, Pay, Location, App Link, Role,
  // Date Applied, Status, Comments / Notes, Recruiter.
  const paste = (text: string, startField: JobField = 'companyName') =>
    planEntryRowPaste(parsePastedTable(text), startField, GRID_FIELDS)

  test('a full 9-column row maps onto the 9 grid columns (no Requirements column)', () => {
    const plan = paste(
      'Google\t$50/hr\tChicago\thttps://example.com\tSWE Intern\t2026-11-02\tApplied\tInterested\tSam Lee',
    )
    assert.deepEqual(plan, {
      kind: 'fill',
      invalidDates: 0,
      values: {
        companyName: 'Google',
        pay: '$50/hr',
        location: 'Chicago',
        jobUrl: 'https://example.com',
        jobTitle: 'SWE Intern',
        dateApplied: '2026-11-02',
        status: 'Applied',
        notes: 'Interested',
        // The 9th value goes to Recruiter, not to a description.
        recruiter: 'Sam Lee',
      },
    })
  })

  test('a 10th pasted column is ignored instead of becoming a description', () => {
    const plan = paste('A\t\t\t\t\t\t\t\tSam\tSome long description')
    assert.equal(plan.kind, 'fill')
    if (plan.kind === 'fill') {
      assert.equal(plan.values.recruiter, 'Sam')
      assert.equal(plan.values.jobDescription, undefined)
    }
  })

  test('a "Requirements" or "Job Description" header column is saved as the description', () => {
    for (const header of ['Requirements', 'Job Description']) {
      const plan = paste(
        [`| Company | ${header} |`, '| --- | --- |', '| Google | Build things<br>Ship them |'].join('\n'),
      )
      assert.deepEqual(plan, {
        kind: 'fill',
        invalidDates: 0,
        values: { companyName: 'Google', jobDescription: 'Build things\nShip them' },
      })
    }
  })

  test('ordinary text for a single field is left to the browser', () => {
    assert.deepEqual(paste('Google'), { kind: 'native' })
    assert.deepEqual(paste('Google\n'), { kind: 'native' })
    assert.deepEqual(paste(''), { kind: 'native' })
  })

  test('one spreadsheet row fills the fields in column order', () => {
    assert.deepEqual(
      paste('Google\t$50/hr\tChicago\thttps://example.com\tSWE Intern\t11/2/2026\tapplied\tInterested\n'),
      {
        kind: 'fill',
        invalidDates: 0,
        values: {
          companyName: 'Google',
          pay: '$50/hr',
          location: 'Chicago',
          jobUrl: 'https://example.com',
          jobTitle: 'SWE Intern',
          dateApplied: '2026-11-02',
          status: 'Applied',
          notes: 'Interested',
        },
      },
    )
  })

  test('pasting into a later field starts from that field', () => {
    const plan = paste('SWE Intern\t2026-11-02', 'jobTitle')
    assert.deepEqual(plan, {
      kind: 'fill',
      invalidDates: 0,
      values: { jobTitle: 'SWE Intern', dateApplied: '2026-11-02' },
    })
  })

  test('empty cells between values keep everything in the right field', () => {
    const plan = paste('Google\t\t\t\tSWE Intern')
    assert.deepEqual(plan, {
      kind: 'fill',
      invalidDates: 0,
      values: {
        companyName: 'Google',
        pay: '',
        location: '',
        jobUrl: '',
        jobTitle: 'SWE Intern',
      },
    })
  })

  test('extra columns past the last field are ignored', () => {
    const plan = paste('Recruiter Sam\textra\tmore', 'recruiter')
    assert.deepEqual(plan, {
      kind: 'fill',
      invalidDates: 0,
      values: { recruiter: 'Recruiter Sam' },
    })
  })

  test('invalid dates are counted and left empty, not stored', () => {
    const plan = paste('Google\t\t\t\t\t02/30/2026')
    assert.equal(plan.kind, 'fill')
    if (plan.kind === 'fill') {
      assert.equal(plan.invalidDates, 1)
      assert.equal(plan.values.dateApplied, undefined)
      assert.equal(plan.values.companyName, 'Google')
    }
  })

  test('several rows become jobs in the spreadsheet order', () => {
    const plan = paste(
      [
        'Google\t$50/hr\tChicago\t\tSWE Intern\t2026-11-02\tApplied',
        'Microsoft\t\tRedmond\t\tPM Intern\t\t',
        'Amazon\t\t\t\t\t\tInterviewing',
      ].join('\n'),
    )

    assert.equal(plan.kind, 'create')
    if (plan.kind === 'create') {
      assert.deepEqual(
        plan.rows.map((row) => row.companyName),
        ['Google', 'Microsoft', 'Amazon'],
      )
      assert.equal(plan.rows[0].dateApplied, '2026-11-02')
      assert.equal(plan.rows[1].location, 'Redmond')
      assert.equal(plan.rows[1].dateApplied, '')
      assert.equal(plan.rows[2].status, 'Interviewing')
      assert.equal(plan.skippedEmptyRows, 0)
    }
  })

  test('completely blank rows are skipped, partial rows are kept', () => {
    const plan = paste(
      ['Google\t\tChicago', '\t\t\t', '  \t\t', 'OnlyCompany', '\t\t\t\t\t\tNot Applied'].join('\n'),
    )

    assert.equal(plan.kind, 'create')
    if (plan.kind === 'create') {
      assert.deepEqual(
        plan.rows.map((row) => row.companyName),
        ['Google', 'OnlyCompany'],
      )
      // The last row only had the default status, so it counts as empty.
      assert.equal(plan.skippedEmptyRows, 3)
    }
  })

  test('a row with only a company name is a valid job', () => {
    const plan = paste('Google\nMicrosoft')
    assert.equal(plan.kind, 'create')
    if (plan.kind === 'create') {
      assert.deepEqual(plan.rows, [{ companyName: 'Google' }, { companyName: 'Microsoft' }])
    }
  })

  test('optional fields can be left out', () => {
    const plan = paste('Google\t\t\t\tSWE\nAcme')
    assert.equal(plan.kind, 'create')
    if (plan.kind === 'create') {
      assert.deepEqual(plan.rows[0], {
        companyName: 'Google',
        pay: '',
        location: '',
        jobUrl: '',
        jobTitle: 'SWE',
      })
    }
  })

  test('invalid dates across several rows are counted', () => {
    const plan = paste('A\t\t\t\t\tnot a date\nB\t\t\t\t\t13/13/2026\nC\t\t\t\t\t1/5/2026')
    assert.equal(plan.kind, 'create')
    if (plan.kind === 'create') {
      assert.equal(plan.invalidDates, 2)
      assert.equal(plan.rows[2].dateApplied, '2026-01-05')
    }
  })

  test('a Markdown table with headers maps values by header name', () => {
    const plan = paste(
      [
        '| Role | Company | Date Applied |',
        '| --- | --- | --- |',
        '| SWE Intern | Google | 2026-11-02 |',
      ].join('\n'),
    )
    assert.deepEqual(plan, {
      kind: 'fill',
      invalidDates: 0,
      values: { jobTitle: 'SWE Intern', companyName: 'Google', dateApplied: '2026-11-02' },
    })
  })
})

describe('convertPastedValue', () => {
  test('converts links, dates and statuses, and trims text', () => {
    assert.equal(convertPastedValue('jobUrl', '[Job](https://x.com/1)', true), 'https://x.com/1')
    assert.equal(convertPastedValue('dateApplied', 'Oct 30, 2026', false), '2026-10-30')
    assert.equal(convertPastedValue('dateApplied', '02/30/2026', false), null)
    assert.equal(convertPastedValue('status', ' interview ', false), 'Interviewing')
    assert.equal(convertPastedValue('status', 'maybe', false), null)
    assert.equal(convertPastedValue('companyName', '  Google ', false), 'Google')
  })
})

describe('createTaskQueue (creating jobs in order)', () => {
  test('runs tasks one at a time in the order they were added', async () => {
    const run = createTaskQueue()
    const order: string[] = []
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    // The first task is the slowest, but must still finish first.
    await Promise.all([
      run(async () => {
        await wait(30)
        order.push('first')
      }),
      run(async () => {
        await wait(5)
        order.push('second')
      }),
      run(async () => {
        order.push('third')
      }),
    ])

    assert.deepEqual(order, ['first', 'second', 'third'])
  })

  test('a failed task does not stop the ones after it', async () => {
    const run = createTaskQueue()
    const failing = run(async () => {
      throw new Error('network down')
    })
    const next = run(async () => 'saved')

    await assert.rejects(failing, /network down/)
    assert.equal(await next, 'saved')
  })
})
