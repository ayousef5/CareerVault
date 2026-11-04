// The one place that talks HTTP to the CareerVault API: adds the login
// token, sends JSON or a form (file uploads), and turns the response into a
// simple typed result.
import { API_BASE_URL } from './config.ts'

// The outcome of an API request. "status" is the HTTP status code, or 0 if
// the request never reached the server (e.g. the network is down).
// "message" is the friendly error text the backend sent, if any.
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message?: string }

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  // The login token (null when logged out; the server will answer 401).
  token: string | null
  // Sent as JSON, or as a multipart form when it's a FormData (uploads).
  body?: unknown
  // Read the response body as JSON (otherwise "data" is undefined).
  readJson?: boolean
  // Read the response body as a file (Blob) instead.
  readBlob?: boolean
}

export async function apiRequest<T = undefined>(
  path: string,
  { method = 'GET', token, body, readJson = false, readBlob = false }: RequestOptions,
  fetchFn: typeof fetch = fetch,
): Promise<ApiResult<T>> {
  const isForm = body instanceof FormData

  let response: Response
  try {
    response = await fetchFn(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        // For a FormData body the browser sets the multipart Content-Type
        // (with its boundary) itself, so it must not be set here.
        ...(body === undefined || isForm ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    })
  } catch {
    return { ok: false, status: 0 }
  }

  if (!response.ok) {
    const message = await readErrorMessage(response)
    return message === undefined
      ? { ok: false, status: response.status }
      : { ok: false, status: response.status, message }
  }

  if (!readJson && !readBlob) {
    return { ok: true, status: response.status, data: undefined as T }
  }

  try {
    // The API's response shapes are described by the T types (types/).
    const data = readBlob ? await response.blob() : await response.json()
    return { ok: true, status: response.status, data: data as T }
  } catch {
    // A success status with an unreadable body counts as a failure.
    return { ok: false, status: response.status }
  }
}

// The first friendly message in a backend error response: a validation
// problem ({ errors: { file: ["…"] } }) or a problem's "detail".
async function readErrorMessage(response: Response): Promise<string | undefined> {
  const type = response.headers.get('Content-Type') ?? ''
  if (!type.includes('json')) {
    return undefined
  }

  try {
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) {
      return undefined
    }

    const problem = body as { errors?: unknown; detail?: unknown }
    if (typeof problem.errors === 'object' && problem.errors !== null) {
      for (const messages of Object.values(problem.errors)) {
        if (Array.isArray(messages) && typeof messages[0] === 'string') {
          return messages[0]
        }
      }
    }
    return typeof problem.detail === 'string' && problem.detail.trim() !== ''
      ? problem.detail
      : undefined
  } catch {
    return undefined
  }
}
