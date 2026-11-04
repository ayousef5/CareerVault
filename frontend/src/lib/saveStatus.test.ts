// Unit tests for the save-status summary. Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { hasUnsavedWork, summarizeSaveStatuses } from './saveStatus.ts'

describe('summarizeSaveStatuses', () => {
  test('shows nothing before any row has a status', () => {
    assert.deepEqual(summarizeSaveStatuses({}), { status: null, text: '' })
  })

  test('says everything is saved when it is', () => {
    assert.deepEqual(summarizeSaveStatuses({ a: 'saved', b: 'saved' }), {
      status: 'saved',
      text: 'All changes saved',
    })
  })

  test('failures win over everything else and are counted', () => {
    assert.deepEqual(summarizeSaveStatuses({ a: 'failed', b: 'saving', c: 'failed' }), {
      status: 'failed',
      text: 'Save failed (2 rows)',
    })
    assert.equal(summarizeSaveStatuses({ a: 'deleteFailed' }).text, 'Delete failed (1 row)')
    assert.equal(
      summarizeSaveStatuses({ a: 'failed', b: 'deleteFailed' }).text,
      'Save/delete failed (2 rows)',
    )
  })

  test('saving or deleting comes next', () => {
    assert.deepEqual(summarizeSaveStatuses({ a: 'saving', b: 'unsaved' }), {
      status: 'saving',
      text: 'Saving…',
    })
    assert.deepEqual(summarizeSaveStatuses({ a: 'deleting' }), {
      status: 'saving',
      text: 'Deleting…',
    })
  })

  test('then unsaved changes and empty rows', () => {
    assert.equal(summarizeSaveStatuses({ a: 'unsaved', b: 'saved' }).text, 'Unsaved changes')
    assert.equal(
      summarizeSaveStatuses({ a: 'empty', b: 'saved' }).text,
      'Empty row (deleted when you leave it)',
    )
  })
})

describe('hasUnsavedWork', () => {
  test('is true while anything is not confirmed saved', () => {
    assert.equal(hasUnsavedWork({}), false)
    assert.equal(hasUnsavedWork({ a: 'saved' }), false)
    assert.equal(hasUnsavedWork({ a: 'saved', b: 'saving' }), true)
    assert.equal(hasUnsavedWork({ a: 'deleteFailed' }), true)
  })
})
