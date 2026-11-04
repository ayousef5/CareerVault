// Unit tests for resume file rules. Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  checkResumeFile,
  DOCX_TYPE,
  fileTypeLabel,
  formatFileSize,
  formatUploadDate,
  canPreview,
  isDocx,
  isPdf,
  MAX_RESUME_BYTES,
  PDF_TYPE,
  uploadErrorMessage,
} from './resumeFiles.ts'

describe('checkResumeFile', () => {
  test('accepts PDF and Word files in any letter case', () => {
    assert.equal(checkResumeFile({ name: 'cv.pdf', size: 1000 }), null)
    assert.equal(checkResumeFile({ name: 'CV.DOCX', size: 1000 }), null)
    assert.equal(checkResumeFile({ name: 'my.final.cv.pdf', size: MAX_RESUME_BYTES }), null)
  })

  test('refuses other types', () => {
    for (const name of ['cv.doc', 'cv.txt', 'cv', 'pdf', 'cv.pdf.exe', 'cv.docm']) {
      assert.equal(
        checkResumeFile({ name, size: 1000 }),
        'Only PDF and Word (.docx) files can be uploaded.',
        name,
      )
    }
  })

  test('refuses empty and oversized files', () => {
    assert.equal(checkResumeFile({ name: 'cv.pdf', size: 0 }), 'The file is empty.')
    assert.equal(
      checkResumeFile({ name: 'cv.pdf', size: MAX_RESUME_BYTES + 1 }),
      'The file is larger than 10 MB.',
    )
  })
})

describe('uploadErrorMessage', () => {
  test("prefers the backend's message", () => {
    assert.equal(uploadErrorMessage(400, 'Only PDF files.'), 'Only PDF files.')
  })

  test('explains common failures without a message', () => {
    assert.equal(uploadErrorMessage(413), 'The file is larger than 10 MB.')
    assert.match(uploadErrorMessage(0), /connection/)
    assert.match(uploadErrorMessage(500), /Couldn't upload/)
  })
})

describe('labels', () => {
  test('names the file type', () => {
    assert.equal(fileTypeLabel(PDF_TYPE), 'PDF')
    assert.equal(fileTypeLabel(DOCX_TYPE), 'Word')
    assert.equal(fileTypeLabel('text/plain'), 'File')
    assert.equal(isPdf(PDF_TYPE), true)
    assert.equal(isPdf(DOCX_TYPE), false)
    assert.equal(isDocx(DOCX_TYPE), true)
    assert.equal(isDocx(PDF_TYPE), false)
    assert.equal(canPreview(PDF_TYPE), true)
    assert.equal(canPreview(DOCX_TYPE), true)
    assert.equal(canPreview('text/plain'), false)
  })

  test('formats file sizes', () => {
    assert.equal(formatFileSize(523), '523 B')
    assert.equal(formatFileSize(48_213), '47 KB')
    assert.equal(formatFileSize(2_400_000), '2.3 MB')
  })

  test('formats upload dates', () => {
    assert.equal(formatUploadDate('2026-11-03T12:00:00+00:00'), 'Nov 3, 2026')
    assert.equal(formatUploadDate('not a date'), '')
  })
})
