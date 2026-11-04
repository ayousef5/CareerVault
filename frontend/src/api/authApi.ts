// Account requests (ASP.NET Identity's /api/auth endpoints) and the login
// token, which is kept in sessionStorage for the current browser tab.
import { apiRequest } from './apiClient.ts'
import { API_BASE_URL } from './config.ts'

const AUTH_URL = `${API_BASE_URL}/api/auth`
const TOKEN_KEY = 'accessToken'

// Shown when the API's rate limit refuses another attempt (HTTP 429).
export const TOO_MANY_ATTEMPTS = 'Too many attempts. Please wait a minute and try again.'

// The current login token, or null when logged out.
export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

// Register a new account.
export async function register(email: string, password: string) {
  const response = await fetch(`${AUTH_URL}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  if (response.status === 429) {
    throw new Error(TOO_MANY_ATTEMPTS)
  }
  if (!response.ok) {
    throw new Error('Registration failed. Check your information.')
  }
}

// Log in and save the returned access token.
export async function login(email: string, password: string) {
  const response = await fetch(`${AUTH_URL}/login?useCookies=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  if (response.status === 429) {
    throw new Error(TOO_MANY_ATTEMPTS)
  }
  if (!response.ok) {
    throw new Error('Login failed. Check your email and password.')
  }

  const data = (await response.json()) as { accessToken: string }

  sessionStorage.setItem(TOKEN_KEY, data.accessToken)
}

// Log out by removing the stored token.
export function logout() {
  sessionStorage.removeItem(TOKEN_KEY)
}

// Asks the backend which account the token belongs to. Returns the email
// in lowercase, or null if it can't be found out.
export async function fetchAccountEmail(token: string | null): Promise<string | null> {
  const result = await apiRequest<{ email?: unknown }>('/api/auth/manage/info', {
    token,
    readJson: true,
  })
  if (!result.ok) {
    return null
  }
  return typeof result.data.email === 'string' ? result.data.email.toLowerCase() : null
}
