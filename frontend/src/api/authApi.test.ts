// Unit tests for the login / registration error messages, with fetch
// replaced by a fake. Run with: npm test
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { login, register, TOO_MANY_ATTEMPTS } from './authApi.ts'

const realFetch = globalThis.fetch
let urls: string[] = []

function respondWith(status: number) {
  urls = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input))
    return new Response(null, { status })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('authApi errors', () => {
  test('too many attempts (429) says to wait, for login and registration', async () => {
    respondWith(429)
    await assert.rejects(login('jane@example.com', 'x'), { message: TOO_MANY_ATTEMPTS })
    await assert.rejects(register('jane@example.com', 'x'), { message: TOO_MANY_ATTEMPTS })
  })

  test('a wrong password or refused registration keeps the usual messages', async () => {
    respondWith(401)
    await assert.rejects(login('jane@example.com', 'x'), { message: 'Login failed. Check your email and password.' })

    respondWith(400)
    await assert.rejects(register('jane@example.com', 'x'), { message: 'Registration failed. Check your information.' })
  })

  test('calls the API’s auth endpoints', async () => {
    respondWith(401)
    await login('jane@example.com', 'x').catch(() => {})

    assert.equal(urls[0], 'http://localhost:5231/api/auth/login?useCookies=false')
  })
})
