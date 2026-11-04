// Unit tests for the extraction API call, with fetch replaced by a fake.
// Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { extractJobFromUrl, parseExtractedJob } from './jobExtractionApi.ts'

type Call = { url: string; init: RequestInit | undefined }

// A fake fetch that records calls and answers with the given response.
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return respond()
  }) as typeof fetch
  return { fn, calls }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const fullJob = {
  url: 'https://jobs.example.com/1',
  companyName: 'Initech',
  jobTitle: 'Platform Engineer',
  location: 'Denver, CO',
  pay: '$120,000/yr',
  jobDescription: 'Run the platform.\n\nOn call sometimes.',
  recruiter: 'Sam Lee',
}

describe('extractJobFromUrl', () => {
  test('sends the link with the login token and returns every field', async () => {
    const { fn, calls } = fakeFetch(() => json(200, fullJob))

    const result = await extractJobFromUrl('https://jobs.example.com/1', 'token-123', fn)

    assert.deepEqual(result, { kind: 'success', job: fullJob })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'http://localhost:5231/api/jobs/extract')
    assert.equal(calls[0].init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { url: 'https://jobs.example.com/1' })
    assert.equal(
      (calls[0].init?.headers as Record<string, string>).Authorization,
      'Bearer token-123',
    )
  })

  test('only reads: the only request is the extract call (nothing is saved)', async () => {
    const { fn, calls } = fakeFetch(() => json(200, fullJob))

    await extractJobFromUrl('https://jobs.example.com/1', 'token', fn)

    assert.deepEqual(
      calls.map((call) => `${call.init?.method} ${call.url}`),
      ['POST http://localhost:5231/api/jobs/extract'],
    )
  })

  test('keeps fields the backend could not find as null (partial results)', async () => {
    const { fn } = fakeFetch(() =>
      json(200, { url: 'https://x.com/j', companyName: 'Acme', jobTitle: 'Chef', location: null }),
    )

    const result = await extractJobFromUrl('https://x.com/j', 't', fn)

    assert.deepEqual(result, {
      kind: 'success',
      job: {
        url: 'https://x.com/j',
        companyName: 'Acme',
        jobTitle: 'Chef',
        location: null,
        pay: null,
        jobDescription: null,
        recruiter: null,
      },
    })
  })

  test('reports an expired login as unauthorized', async () => {
    const { fn } = fakeFetch(() => new Response(null, { status: 401 }))

    assert.deepEqual(await extractJobFromUrl('https://x.com/j', 'old', fn), { kind: 'unauthorized' })
  })

  test("shows the backend's friendly message when extraction fails", async () => {
    const { fn } = fakeFetch(() =>
      json(502, { title: 'Bad Gateway', detail: "The job site doesn't allow automatic reading." }),
    )

    assert.deepEqual(await extractJobFromUrl('https://x.com/j', 't', fn), {
      kind: 'failed',
      message: "The job site doesn't allow automatic reading.",
    })
  })

  test('falls back to a general message when the error has no details', async () => {
    const { fn } = fakeFetch(() => new Response('<html>oops</html>', { status: 500 }))

    const result = await extractJobFromUrl('https://x.com/j', 't', fn)

    assert.equal(result.kind, 'failed')
    if (result.kind === 'failed') {
      assert.match(result.message, /couldn't be read/)
    }
  })

  test('handles a network failure', async () => {
    const fn = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch

    const result = await extractJobFromUrl('https://x.com/j', 't', fn)

    assert.equal(result.kind, 'failed')
  })

  test('treats an unexpected response body as a failure', async () => {
    const { fn } = fakeFetch(() => json(200, ['not', 'a', 'job']))

    assert.equal((await extractJobFromUrl('https://x.com/j', 't', fn)).kind, 'failed')
  })
})

describe('parseExtractedJob', () => {
  test('ignores fields of the wrong type', () => {
    assert.deepEqual(parseExtractedJob({ url: 'https://x.com', companyName: 42, pay: { a: 1 } }), {
      url: 'https://x.com',
      companyName: null,
      jobTitle: null,
      location: null,
      pay: null,
      jobDescription: null,
      recruiter: null,
    })
  })

  test('rejects a body without a url', () => {
    assert.equal(parseExtractedJob({ companyName: 'Acme' }), null)
    assert.equal(parseExtractedJob(null), null)
  })
})
