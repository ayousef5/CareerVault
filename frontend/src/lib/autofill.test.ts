// Unit tests for filling the Add Job row from a job posting.
// Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ExtractedJobResponse } from '../api/jobExtractionApi.ts'
import { EMPTY_NEW_JOB } from './jobRows.ts'
import {
  applyAutofill,
  createSingleFlight,
  describeAutofill,
  isLikelyJobUrl,
  planRowAutofill,
} from './autofill.ts'

describe('isLikelyJobUrl', () => {
  test('accepts complete http(s) job links', () => {
    assert.equal(isLikelyJobUrl('https://job-boards.greenhouse.io/acme/jobs/1'), true)
    assert.equal(isLikelyJobUrl('  http://careers.example.co.uk/role?id=5 '), true)
  })

  test('ignores partial typing and anything that is not a web link', () => {
    for (const text of ['', 'https://', 'https://goo', 'careers.example.com/job', 'ftp://example.com/x', 'https://exa mple.com', 'not a url']) {
      assert.equal(isLikelyJobUrl(text), false, text)
    }
  })
})

describe('planRowAutofill (jobs already in the grid)', () => {
  const extracted = {
    url: 'https://jobs.example.com/1',
    companyName: 'Initech',
    jobTitle: 'Platform Engineer',
    location: 'Denver, CO',
    pay: '$120,000/yr',
    jobDescription: 'Run the platform.',
    recruiter: null,
  }

  test('fills only the empty fields of the row', () => {
    const plan = planRowAutofill(
      { companyName: 'My Co', jobTitle: '', location: null, jobUrl: 'https://jobs.example.com/1', status: 'Applied' },
      extracted,
    )

    assert.deepEqual(plan.values, {
      jobTitle: 'Platform Engineer',
      location: 'Denver, CO',
      pay: '$120,000/yr',
      jobDescription: 'Run the platform.',
    })
    assert.deepEqual(plan.filled, ['jobTitle', 'location', 'pay', 'jobDescription'])
  })

  test('never replaces an existing description, status, date or notes', () => {
    const plan = planRowAutofill(
      { jobDescription: 'Mine', status: 'Interviewing', dateApplied: '2026-11-01', notes: 'Call Sam' },
      extracted,
    )
    assert.equal(plan.values.jobDescription, undefined)
    assert.equal(plan.values.status, undefined)
    assert.equal(plan.values.dateApplied, undefined)
    assert.equal(plan.values.notes, undefined)
  })

  test('changes nothing when everything is already filled', () => {
    const full = {
      companyName: 'A', jobTitle: 'B', location: 'C', pay: 'D', jobDescription: 'E', recruiter: 'F', jobUrl: 'G',
    }
    assert.deepEqual(planRowAutofill(full, extracted), { values: {}, filled: [] })
  })
})

const URL_ONLY = { ...EMPTY_NEW_JOB, jobUrl: 'https://jobs.example.com/1' }

const fullJob: ExtractedJobResponse = {
  url: 'https://jobs.example.com/1',
  companyName: 'Initech',
  jobTitle: 'Platform Engineer',
  location: 'Denver, CO',
  pay: '$120,000/yr',
  jobDescription: 'Run the platform.\n\nOn call sometimes.',
  recruiter: 'Sam Lee',
}

const emptyJob: ExtractedJobResponse = {
  url: 'https://jobs.example.com/1',
  companyName: null,
  jobTitle: null,
  location: null,
  pay: null,
  jobDescription: null,
  recruiter: null,
}

describe('applyAutofill', () => {
  test('fills every field the posting had', () => {
    const outcome = applyAutofill(URL_ONLY, fullJob)

    assert.deepEqual(outcome.form, {
      ...URL_ONLY,
      companyName: 'Initech',
      jobTitle: 'Platform Engineer',
      location: 'Denver, CO',
      pay: '$120,000/yr',
      recruiter: 'Sam Lee',
      jobDescription: 'Run the platform.\n\nOn call sometimes.',
    })
    assert.deepEqual(outcome.kept, [])
  })

  test('partial results only fill what was found', () => {
    const outcome = applyAutofill(URL_ONLY, { ...emptyJob, companyName: 'Acme', jobTitle: 'Chef' })

    assert.equal(outcome.form.companyName, 'Acme')
    assert.equal(outcome.form.jobTitle, 'Chef')
    assert.equal(outcome.form.location, '')
    assert.equal(outcome.form.pay, '')
    assert.deepEqual(outcome.filled, ['companyName', 'jobTitle'])
  })

  test('an empty result changes nothing', () => {
    const outcome = applyAutofill(URL_ONLY, emptyJob)

    assert.deepEqual(outcome.form, URL_ONLY)
    assert.deepEqual(outcome.filled, [])
  })

  test("keeps values the user already typed and reports them", () => {
    const typed = { ...URL_ONLY, companyName: 'My Company', pay: '30/hr' }

    const outcome = applyAutofill(typed, fullJob)

    assert.equal(outcome.form.companyName, 'My Company')
    assert.equal(outcome.form.pay, '30/hr')
    assert.equal(outcome.form.jobTitle, 'Platform Engineer')
    assert.deepEqual(outcome.kept, ['companyName', 'pay'])
  })

  test('keeps a description the user already entered', () => {
    const typed = { ...URL_ONLY, jobDescription: 'My own notes about the role' }

    const outcome = applyAutofill(typed, fullJob)

    assert.equal(outcome.form.jobDescription, 'My own notes about the role')
    assert.ok(outcome.kept.includes('jobDescription'))
  })

  test('never changes Date Applied, Status or Comments / Notes', () => {
    const typed = { ...URL_ONLY, dateApplied: '2026-11-02', status: 'Applied', notes: 'Referral' }

    const outcome = applyAutofill(typed, fullJob)

    assert.equal(outcome.form.dateApplied, '2026-11-02')
    assert.equal(outcome.form.status, 'Applied')
    assert.equal(outcome.form.notes, 'Referral')

    // Also when they're empty: autofill doesn't set them.
    const fromEmpty = applyAutofill(URL_ONLY, fullJob)
    assert.equal(fromEmpty.form.dateApplied, '')
    assert.equal(fromEmpty.form.status, 'Not Applied')
    assert.equal(fromEmpty.form.notes, '')
  })

  test("keeps the user's link and fills the link only if it was empty", () => {
    const typed = { ...EMPTY_NEW_JOB, jobUrl: 'jobs.example.com/1' }
    assert.equal(applyAutofill(typed, fullJob).form.jobUrl, 'jobs.example.com/1')
    assert.deepEqual(applyAutofill(typed, fullJob).kept.includes('jobUrl'), false)

    assert.equal(applyAutofill(EMPTY_NEW_JOB, fullJob).form.jobUrl, 'https://jobs.example.com/1')
  })

  test('ignores blank extracted values', () => {
    const outcome = applyAutofill(URL_ONLY, { ...emptyJob, companyName: '   ' })
    assert.equal(outcome.form.companyName, '')
  })
})

describe('describeAutofill', () => {
  test('explains when nothing could be read', () => {
    assert.match(describeAutofill(applyAutofill(URL_ONLY, emptyJob)), /enter them manually/)
  })

  test('lists filled and kept fields, and mentions the description', () => {
    const message = describeAutofill(applyAutofill({ ...URL_ONLY, pay: '30/hr' }, fullJob))

    assert.match(message, /Filled in Company, Role, Location, Recruiter, Job description/)
    assert.match(message, /Kept your own Pay/)
    assert.match(message, /full description is saved/)
    assert.match(message, /click Add/)
  })

  test('says so when everything was already filled in', () => {
    const typed = { ...URL_ONLY, companyName: 'Mine' }
    const message = describeAutofill(applyAutofill(typed, { ...emptyJob, companyName: 'Theirs' }))
    assert.match(message, /your values were kept/)
  })
})

describe('createSingleFlight (no duplicate extraction requests)', () => {
  test('ignores new calls while one is running', async () => {
    const flight = createSingleFlight()
    let calls = 0
    let finish = () => {}
    const task = () =>
      new Promise<string>((resolve) => {
        calls += 1
        finish = () => resolve('done')
      })

    const first = flight.run(task)
    assert.equal(flight.isBusy, true)
    assert.equal(await flight.run(task), null)
    assert.equal(calls, 1)

    finish()
    assert.equal(await first, 'done')
    assert.equal(flight.isBusy, false)

    // Once finished, a new request can run.
    const again = flight.run(task)
    finish()
    assert.equal(await again, 'done')
    assert.equal(calls, 2)
  })

  test('is free again after a failed request', async () => {
    const flight = createSingleFlight()
    await assert.rejects(flight.run(async () => {
      throw new Error('boom')
    }))
    assert.equal(flight.isBusy, false)
  })
})
