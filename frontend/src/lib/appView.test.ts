// Unit tests for page selection. Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { hashForView, viewFromHash } from './appView.ts'

describe('viewFromHash', () => {
  test('recognises the Resume Library', () => {
    assert.equal(viewFromHash('#/resumes'), 'resumes')
    assert.equal(viewFromHash('#/resumes/'), 'resumes')
  })

  test('recognises My Applications', () => {
    assert.equal(viewFromHash('#/applications'), 'applications')
  })

  test('shows the dashboard for anything else', () => {
    for (const hash of ['', '#', '#/', '#/unknown', '#/resumes-old', 'resumes']) {
      assert.equal(viewFromHash(hash), 'dashboard', hash)
    }
  })

  test('round-trips every page', () => {
    assert.equal(viewFromHash(hashForView('resumes')), 'resumes')
    assert.equal(viewFromHash(hashForView('dashboard')), 'dashboard')
    assert.equal(viewFromHash(hashForView('applications')), 'applications')
  })
})
