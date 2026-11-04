// Unit tests for choosing the API address. Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { API_BASE_URL, LOCAL_API_BASE_URL, resolveApiBaseUrl } from './config.ts'

describe('resolveApiBaseUrl', () => {
  test('uses the configured production address', () => {
    assert.equal(
      resolveApiBaseUrl('https://careervault-api.example.azurecontainerapps.io'),
      'https://careervault-api.example.azurecontainerapps.io',
    )
  })

  test('drops trailing slashes and spaces, so request URLs stay clean', () => {
    assert.equal(resolveApiBaseUrl(' https://api.example.com/ '), 'https://api.example.com')
    assert.equal(resolveApiBaseUrl('https://api.example.com///'), 'https://api.example.com')
  })

  test('falls back to the local API when nothing is set', () => {
    assert.equal(resolveApiBaseUrl(undefined), LOCAL_API_BASE_URL)
    assert.equal(resolveApiBaseUrl(''), LOCAL_API_BASE_URL)
    assert.equal(resolveApiBaseUrl('   '), LOCAL_API_BASE_URL)
  })

  test('local development (and these tests) use http://localhost:5231', () => {
    assert.equal(LOCAL_API_BASE_URL, 'http://localhost:5231')
    assert.equal(API_BASE_URL, LOCAL_API_BASE_URL)
  })
})
