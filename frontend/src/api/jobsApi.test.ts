// Unit tests for the job requests, with fetch replaced by a fake where
// needed. Run with: npm test
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { removeJobResume, toRequestBody, uploadJobResume } from './jobsApi.ts'
import type { JobApplication } from '../types/job.ts'

const resume = {
  versionId: 12,
  originalFileName: 'cv.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1000,
  uploadedAt: '2026-11-01T10:00:00Z',
}

const job: JobApplication = {
  id: 4,
  companyName: 'Google',
  jobTitle: 'SWE Intern',
  location: null,
  jobUrl: 'https://careers.example.com/1',
  dateApplied: '2026-11-01',
  status: 'Applied',
  notes: 'Referred',
  jobDescription: 'Build things.',
  pay: null,
  recruiter: null,
  resumeVersionId: 12,
  resume,
}

type Call = { url: string; init: RequestInit | undefined }

const realFetch = globalThis.fetch
let calls: Call[] = []

function respondWith(response: () => Response) {
  calls = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return response()
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('toRequestBody (autosave)', () => {
  test('sends the whole job but never anything about its resume', () => {
    const body = toRequestBody(job)

    assert.deepEqual(body, {
      companyName: 'Google',
      jobTitle: 'SWE Intern',
      location: null,
      jobUrl: 'https://careers.example.com/1',
      dateApplied: '2026-11-01',
      status: 'Applied',
      notes: 'Referred',
      jobDescription: 'Build things.',
      pay: null,
      recruiter: null,
    })
    // So an autosave can never change or remove the attachment.
    assert.equal('resumeVersionId' in body, false)
    assert.equal('resume' in body, false)
  })
})

describe('uploadJobResume / removeJobResume', () => {
  test('uploads the file as a form to that job, with the login token', async () => {
    respondWith(() => Response.json(job))
    const file = new File(['%PDF-1.7'], 'cv.pdf', { type: 'application/pdf' })

    const result = await uploadJobResume(4, file, 'token-1')

    assert.equal(calls[0].url, 'http://localhost:5231/api/jobs/4/resume')
    assert.equal(calls[0].init?.method, 'PUT')
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer token-1')
    const form = calls[0].init?.body as FormData
    assert.equal((form.get('file') as File).name, 'cv.pdf')
    assert.equal(result.ok && result.data.resume?.versionId, 12)
  })

  test('removes the resume from that job', async () => {
    respondWith(() => Response.json({ ...job, resumeVersionId: null, resume: null }))

    const result = await removeJobResume(4, 't')

    assert.equal(calls[0].url, 'http://localhost:5231/api/jobs/4/resume')
    assert.equal(calls[0].init?.method, 'DELETE')
    assert.equal(result.ok && result.data.resume, null)
  })

  test('passes on an expired login and the backend message for a refused file', async () => {
    respondWith(() => new Response(null, { status: 401 }))
    assert.equal((await uploadJobResume(4, new File(['x'], 'cv.pdf'), 'old')).status, 401)

    respondWith(() =>
      Response.json(
        { errors: { file: ['Only PDF and Word (.docx) files can be uploaded.'] } },
        { status: 400 },
      ),
    )
    const refused = await uploadJobResume(4, new File(['x'], 'cv.pdf'), 't')
    assert.deepEqual(refused, {
      ok: false,
      status: 400,
      message: 'Only PDF and Word (.docx) files can be uploaded.',
    })
  })
})
