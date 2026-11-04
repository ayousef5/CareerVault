// Unit tests for job display helpers. Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  countWords,
  describeLength,
  formatDisplayDate,
  getSafeUrl,
  getStatusClass,
} from './jobDisplay.ts'

describe('countWords / describeLength', () => {
  test('counts words in a description', () => {
    assert.equal(countWords(null), 0)
    assert.equal(countWords('   '), 0)
    assert.equal(countWords('Build things.\n\n• Ship them'), 5)
    assert.equal(describeLength('one'), '1 word')
    assert.equal(describeLength('a '.repeat(1240)), '1,240 words')
  })
})

describe('getSafeUrl', () => {
  test('keeps http and https links', () => {
    assert.equal(getSafeUrl('https://example.com/job/1'), 'https://example.com/job/1')
    assert.equal(getSafeUrl('http://example.com'), 'http://example.com/')
  })

  test('adds https:// to links saved without it', () => {
    assert.equal(getSafeUrl(' careers.google.com/jobs/1 '), 'https://careers.google.com/jobs/1')
  })

  test('rejects empty and unsafe links', () => {
    assert.equal(getSafeUrl(null), null)
    assert.equal(getSafeUrl('   '), null)
    assert.equal(getSafeUrl('javascript:alert(1)'), null)
    assert.equal(getSafeUrl('not a url with spaces'), null)
  })
})

describe('getStatusClass', () => {
  test('turns a status into a CSS class name', () => {
    assert.equal(getStatusClass('Not Applied'), 'status-not-applied')
    assert.equal(getStatusClass('Interviewing'), 'status-interviewing')
  })
})

describe('formatDisplayDate', () => {
  test('formats a saved date without shifting the day', () => {
    assert.equal(formatDisplayDate('2026-11-02'), 'Nov 2, 2026')
    assert.equal(formatDisplayDate('2026-01-31'), 'Jan 31, 2026')
  })

  test('returns null for empty or unreadable dates', () => {
    assert.equal(formatDisplayDate(null), null)
    assert.equal(formatDisplayDate(''), null)
    assert.equal(formatDisplayDate('11/02/2026'), null)
  })
})
