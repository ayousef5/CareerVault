// Unit tests for the resume requests, with fetch replaced by a fake.
// Run with: npm test
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { fetchResumeFile, fetchResumeLibrary } from './resumesApi.ts'

type Call = { url: string; init: RequestInit | undefined }

// These modules use the global fetch, so swap it for each test.
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

describe('resumesApi', () => {
  test('loads the Resume Library with the login token', async () => {
    respondWith(() => Response.json([]))

    const result = await fetchResumeLibrary('token-1')

    assert.deepEqual(result, { ok: true, status: 200, data: [] })
    assert.equal(calls[0].url, 'http://localhost:5231/api/resumes/uploads')
    assert.equal(calls[0].init?.method, 'GET')
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer token-1')
  })

  test('reports an expired login when loading the Library', async () => {
    respondWith(() => new Response(null, { status: 401 }))

    const result = await fetchResumeLibrary('old-token')

    assert.equal(result.ok, false)
    assert.equal(result.status, 401)
  })

  test('downloads a file as a Blob with the login token', async () => {
    respondWith(() => new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } }))

    const result = await fetchResumeFile(7, 't')

    assert.equal(calls[0].url, 'http://localhost:5231/api/resume-versions/7/file')
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer t')
    assert.equal(result.ok && result.data.type, 'application/pdf')
  })
})
