// Unit tests for a job's resume: upload / remove results and the Resume
// Library's display. Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  applicationLabel,
  describeApplications,
  interpretResumeResult,
  NOT_ATTACHED,
  parseLibraryFiles,
} from './jobResume.ts'
import type { JobApplication } from '../types/job.ts'
import type { AttachedResume, LibraryFile } from '../types/resume.ts'

const attached: AttachedResume = {
  versionId: 21,
  originalFileName: 'Jane CV.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  uploadedAt: '2026-11-03T10:00:00Z',
}

function job(resume: AttachedResume | null): JobApplication {
  return {
    id: 4,
    companyName: 'Google',
    jobTitle: 'SWE Intern',
    location: null,
    jobUrl: null,
    dateApplied: null,
    status: 'Applied',
    notes: null,
    jobDescription: null,
    pay: null,
    recruiter: null,
    resumeVersionId: resume?.versionId ?? null,
    resume,
  }
}

function libraryFile(storedFileId: number, name: string, applications: LibraryFile['applications']): LibraryFile {
  return {
    storedFileId,
    versionId: storedFileId * 10,
    originalFileName: name,
    uploadedAt: '2026-11-03T10:00:00Z',
    contentType: 'application/pdf',
    sizeBytes: 2048,
    applications,
  }
}

const google = { jobId: 1, companyName: 'Google', jobTitle: 'SWE Intern' }
const microsoft = { jobId: 2, companyName: 'Microsoft', jobTitle: 'AI Intern' }
const shure = { jobId: 3, companyName: 'Shure', jobTitle: 'Data Intern' }

describe('interpretResumeResult', () => {
  test('an upload (or replacement) gives the resume the server saved', () => {
    assert.deepEqual(interpretResumeResult({ ok: true, status: 200, data: job(attached) }, 'upload'), {
      kind: 'saved',
      resumeVersionId: 21,
      resume: attached,
    })
  })

  test('a removal gives no resume', () => {
    assert.deepEqual(interpretResumeResult({ ok: true, status: 200, data: job(null) }, 'remove'), {
      kind: 'saved',
      resumeVersionId: null,
      resume: null,
    })
  })

  test('an expired login is reported as such (for upload and remove)', () => {
    assert.deepEqual(interpretResumeResult({ ok: false, status: 401 }, 'upload'), { kind: 'expired' })
    assert.deepEqual(interpretResumeResult({ ok: false, status: 401 }, 'remove'), { kind: 'expired' })
  })

  test('a deleted (or someone else’s) application is "no longer exists"', () => {
    const change = interpretResumeResult({ ok: false, status: 404 }, 'upload')
    assert.equal(change.kind, 'failed')
    assert.match(change.kind === 'failed' ? change.message : '', /no longer exists/)
  })

  test('a refused file shows the backend’s own message', () => {
    assert.deepEqual(
      interpretResumeResult({ ok: false, status: 400, message: 'The file is empty.' }, 'upload'),
      { kind: 'failed', message: 'The file is empty.' },
    )
    assert.deepEqual(interpretResumeResult({ ok: false, status: 413 }, 'upload'), {
      kind: 'failed',
      message: 'The file is larger than 10 MB.',
    })
  })

  test('a network failure asks to check the connection', () => {
    for (const action of ['upload', 'remove'] as const) {
      const change = interpretResumeResult({ ok: false, status: 0 }, action)
      assert.match(change.kind === 'failed' ? change.message : '', /Check your connection/)
    }
    const removeFailed = interpretResumeResult({ ok: false, status: 500 }, 'remove')
    assert.match(removeFailed.kind === 'failed' ? removeFailed.message : '', /Couldn't remove the resume/)
  })
})

describe('Resume Library display', () => {
  test('one file used by several applications lists every company and role', () => {
    const shared = libraryFile(1, 'cv.pdf', [google, microsoft])

    assert.deepEqual(describeApplications(shared), ['Google · SWE Intern', 'Microsoft · AI Intern'])
  })

  test('a file that is not attached says so', () => {
    assert.deepEqual(describeApplications(libraryFile(1, 'old.pdf', [])), [NOT_ATTACHED])
    assert.equal(NOT_ATTACHED, 'Not attached to an application.')
  })

  test('blank company or role names still read clearly', () => {
    assert.equal(applicationLabel({ jobId: 9, companyName: ' ', jobTitle: '' }), 'Unknown company · Untitled role')
  })

  test('after replacing one application’s shared resume, the Library shows both files correctly', () => {
    // Google and Microsoft shared cv.pdf; Google's resume is then replaced.
    const before = parseLibraryFiles([libraryFile(1, 'cv.pdf', [google, microsoft])])
    const after = parseLibraryFiles([
      libraryFile(2, 'cv-google.pdf', [google]),
      libraryFile(1, 'cv.pdf', [microsoft]),
    ])

    assert.deepEqual(before.map(describeApplications), [['Google · SWE Intern', 'Microsoft · AI Intern']])
    assert.deepEqual(after.map((file) => [file.originalFileName, describeApplications(file)]), [
      ['cv-google.pdf', ['Google · SWE Intern']],
      ['cv.pdf', ['Microsoft · AI Intern']],
    ])
  })

  test('after removing one application’s resume, others using the same file keep it', () => {
    // Removed from Google; Microsoft and Shure still use the file.
    const after = parseLibraryFiles([libraryFile(1, 'cv.pdf', [microsoft, shure])])

    assert.equal(after.length, 1)
    assert.deepEqual(describeApplications(after[0]), ['Microsoft · AI Intern', 'Shure · Data Intern'])
  })
})

describe('parseLibraryFiles', () => {
  test('keeps well-formed entries, with their applications', () => {
    const files = [libraryFile(1, 'cv.pdf', [google]), libraryFile(2, 'old.pdf', [])]

    assert.deepEqual(parseLibraryFiles(files), files)
  })

  test('drops malformed entries and applications instead of showing them', () => {
    const parsed = parseLibraryFiles([
      { storedFileId: 1 },
      'nonsense',
      null,
      { ...libraryFile(3, 'cv.pdf', []), applications: [google, { jobId: 'x' }, null] },
    ])

    assert.equal(parsed.length, 1)
    assert.deepEqual(parsed[0].applications, [google])
  })

  test('anything that is not a list gives an empty Library', () => {
    assert.deepEqual(parseLibraryFiles({ files: [] }), [])
    assert.deepEqual(parseLibraryFiles(null), [])
  })

  test('never passes on unexpected extra fields (like where a file is stored)', () => {
    const [file] = parseLibraryFiles([{ ...libraryFile(1, 'cv.pdf', []), storageKey: 'user/abc' }])

    assert.equal('storageKey' in file, false)
  })
})
