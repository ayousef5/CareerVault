// Calls POST /api/jobs/extract, which reads job details from a job posting
// link. It never saves anything; the user reviews the result and clicks Add.
import { API_BASE_URL } from './config.ts'

const EXTRACT_URL = `${API_BASE_URL}/api/jobs/extract`

// What the backend sends back. Fields it couldn't find are null.
export type ExtractedJobResponse = {
  url: string
  companyName: string | null
  jobTitle: string | null
  location: string | null
  pay: string | null
  jobDescription: string | null
  recruiter: string | null
}

export type ExtractionResult =
  | { kind: 'success'; job: ExtractedJobResponse }
  // The login token is missing or expired.
  | { kind: 'unauthorized' }
  // Anything else; "message" is safe to show to the user.
  | { kind: 'failed'; message: string }

const FALLBACK_MESSAGE =
  "The job posting couldn't be read. Please enter the details manually."

// Asks the backend to read the posting at "url". "fetchFn" can be swapped
// out in tests.
export async function extractJobFromUrl(
  url: string,
  token: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<ExtractionResult> {
  let response: Response
  try {
    response = await fetchFn(EXTRACT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url }),
    })
  } catch {
    return {
      kind: 'failed',
      message: "Couldn't reach CareerVault. Check your connection and try again.",
    }
  }

  if (response.status === 401) {
    return { kind: 'unauthorized' }
  }

  if (!response.ok) {
    return { kind: 'failed', message: (await readProblemDetail(response)) ?? FALLBACK_MESSAGE }
  }

  const job = parseExtractedJob(await readJson(response))
  return job ? { kind: 'success', job } : { kind: 'failed', message: FALLBACK_MESSAGE }
}

// The friendly "detail" text from the backend's error response, if any.
async function readProblemDetail(response: Response): Promise<string | null> {
  const body = await readJson(response)
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    const detail = body.detail
    if (typeof detail === 'string' && detail.trim() !== '') {
      // Never show a huge or odd message.
      return detail.trim().slice(0, 300)
    }
  }
  return null
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

// Checks that the response has the expected shape (each field text or
// null), so nothing unexpected reaches the form.
export function parseExtractedJob(body: unknown): ExtractedJobResponse | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }

  const record = body as Record<string, unknown>
  const text = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : null)

  const url = text('url')
  if (url === null) {
    return null
  }

  return {
    url,
    companyName: text('companyName'),
    jobTitle: text('jobTitle'),
    location: text('location'),
    pay: text('pay'),
    jobDescription: text('jobDescription'),
    recruiter: text('recruiter'),
  }
}
