// Unit tests for the shared API request helper, with fetch replaced by a fake.
// Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { apiRequest } from './apiClient.ts'

type Call = { url: string; init: RequestInit | undefined }

function fakeFetch(respond: () => Response) {
  const calls: Call[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return respond()
  }) as typeof fetch
  return { fn, calls }
}

describe('apiRequest', () => {
  test('sends the token and a JSON body, and reads a JSON response', async () => {
    const { fn, calls } = fakeFetch(() => Response.json({ id: 7 }, { status: 201 }))

    const result = await apiRequest<{ id: number }>(
      '/api/jobs',
      { method: 'POST', token: 'abc', body: { companyName: 'Acme' }, readJson: true },
      fn,
    )

    assert.deepEqual(result, { ok: true, status: 201, data: { id: 7 } })
    assert.equal(calls[0].url, 'http://localhost:5231/api/jobs')
    assert.equal(calls[0].init?.method, 'POST')
    assert.equal(calls[0].init?.body, '{"companyName":"Acme"}')
    assert.deepEqual(calls[0].init?.headers, {
      'Content-Type': 'application/json',
      Authorization: 'Bearer abc',
    })
  })

  test('sends no body or Content-Type for a GET or DELETE', async () => {
    const { fn, calls } = fakeFetch(() => new Response(null, { status: 204 }))

    const result = await apiRequest('/api/jobs/3', { method: 'DELETE', token: 't' }, fn)

    assert.deepEqual(result, { ok: true, status: 204, data: undefined })
    assert.equal(calls[0].init?.body, undefined)
    assert.deepEqual(calls[0].init?.headers, { Authorization: 'Bearer t' })
  })

  test('reports error statuses without throwing', async () => {
    const { fn } = fakeFetch(() => new Response('nope', { status: 401 }))

    assert.deepEqual(await apiRequest('/api/jobs', { token: null }, fn), { ok: false, status: 401 })
  })

  test('reports a network failure as status 0', async () => {
    const fn = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch

    assert.deepEqual(await apiRequest('/api/jobs', { token: 't' }, fn), { ok: false, status: 0 })
  })

  test('sends a FormData body as-is, letting the browser set the multipart type', async () => {
    const { fn, calls } = fakeFetch(() => Response.json({ id: 1 }, { status: 201 }))
    const form = new FormData()
    form.append('name', 'CV')

    await apiRequest('/api/resumes', { method: 'POST', token: 't', body: form, readJson: true }, fn)

    assert.equal(calls[0].init?.body, form)
    // No Content-Type: the browser adds "multipart/form-data; boundary=…".
    assert.deepEqual(calls[0].init?.headers, { Authorization: 'Bearer t' })
  })

  test('reads a file response as a Blob', async () => {
    const { fn } = fakeFetch(
      () => new Response('%PDF-1.7', { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
    )

    const result = await apiRequest<Blob>('/api/resume-versions/1/file', { token: 't', readBlob: true }, fn)

    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.data.type, 'application/pdf')
      assert.equal(await result.data.text(), '%PDF-1.7')
    }
  })

  test("passes on the backend's validation message", async () => {
    const { fn } = fakeFetch(() =>
      Response.json(
        { title: 'One or more validation errors occurred.', errors: { file: ['Only PDF and Word (.docx) files can be uploaded.'] } },
        { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    )

    assert.deepEqual(await apiRequest('/api/resumes', { token: 't' }, fn), {
      ok: false,
      status: 400,
      message: 'Only PDF and Word (.docx) files can be uploaded.',
    })
  })

  test("passes on a problem's detail message", async () => {
    const { fn } = fakeFetch(() =>
      Response.json({ detail: 'The job site took too long.' }, { status: 504 }),
    )

    assert.deepEqual(await apiRequest('/api/x', { token: 't' }, fn), {
      ok: false,
      status: 504,
      message: 'The job site took too long.',
    })
  })

  test('has no message when the error body is not JSON or is empty', async () => {
    const { fn } = fakeFetch(() => new Response(null, { status: 413 }))

    assert.deepEqual(await apiRequest('/api/resumes', { token: 't' }, fn), { ok: false, status: 413 })
  })

  test('treats an unreadable success body as a failure', async () => {
    const { fn } = fakeFetch(() => new Response('not json', { status: 200 }))

    assert.deepEqual(
      await apiRequest('/api/jobs', { token: 't', readJson: true }, fn),
      { ok: false, status: 200 },
    )
  })
})
