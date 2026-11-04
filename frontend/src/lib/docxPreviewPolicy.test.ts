// Unit tests for the Word preview's safety settings. (Drawing itself needs
// a browser; see sanitizeRenderedDocx / renderDocxInto in docxPreview.ts.) Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  DOCX_FRAME_DOCUMENT,
  DOCX_FRAME_SANDBOX,
  DOCX_PREVIEW_CSP,
  DOCX_RENDER_OPTIONS,
  isEmbeddedImageUrl,
  isSafeLinkHref,
} from './docxPreviewPolicy.ts'

describe('the Word preview frame', () => {
  test('is sandboxed without scripts, forms or top-level navigation', () => {
    const flags = DOCX_FRAME_SANDBOX.split(' ')

    assert.ok(!flags.includes('allow-scripts'))
    assert.ok(!flags.includes('allow-forms'))
    assert.ok(!flags.some((flag) => flag.startsWith('allow-top-navigation')))
    // Needed so CareerVault can draw into it, and so safe links open in a new tab.
    assert.ok(flags.includes('allow-same-origin'))
    assert.ok(flags.includes('allow-popups'))
  })

  test('its policy blocks every network request and every script', () => {
    const directives = DOCX_PREVIEW_CSP.split(';').map((part) => part.trim())

    assert.ok(directives.includes("default-src 'none'"))
    assert.ok(directives.includes('img-src data:'))
    assert.ok(directives.includes('font-src data:'))
    assert.ok(directives.includes("base-uri 'none'"))
    assert.ok(!/script-src|connect-src|https?:|\*|unsafe-eval/.test(DOCX_PREVIEW_CSP))
  })

  test('its page carries the policy and contains no scripts', () => {
    assert.ok(DOCX_FRAME_DOCUMENT.includes(`<meta http-equiv="Content-Security-Policy" content="${DOCX_PREVIEW_CSP}">`))
    assert.ok(!/<script/i.test(DOCX_FRAME_DOCUMENT))
    // Separate containers for styles and pages, so the policy is never removed.
    assert.ok(DOCX_FRAME_DOCUMENT.includes('id="docx-styles"'))
    assert.ok(DOCX_FRAME_DOCUMENT.includes('id="docx-pages"'))
  })
})

describe('docx-preview settings', () => {
  test('look like Word: pages, page breaks, real sizes, fonts, headers and footers', () => {
    assert.equal(DOCX_RENDER_OPTIONS.inWrapper, true)
    assert.equal(DOCX_RENDER_OPTIONS.breakPages, true)
    assert.equal(DOCX_RENDER_OPTIONS.ignoreLastRenderedPageBreak, false)
    assert.equal(DOCX_RENDER_OPTIONS.ignoreWidth, false)
    assert.equal(DOCX_RENDER_OPTIONS.ignoreHeight, false)
    assert.equal(DOCX_RENDER_OPTIONS.ignoreFonts, false)
    assert.equal(DOCX_RENDER_OPTIONS.renderHeaders, true)
    assert.equal(DOCX_RENDER_OPTIONS.renderFooters, true)
  })

  test('never render embedded HTML parts and leave no blob: URLs behind', () => {
    // docx-preview would put embedded HTML in an unsandboxed iframe.
    assert.equal(DOCX_RENDER_OPTIONS.renderAltChunks, false)
    assert.equal(DOCX_RENDER_OPTIONS.useBase64URL, true)
    assert.equal(DOCX_RENDER_OPTIONS.experimental, false)
  })
})

describe('isSafeLinkHref', () => {
  test('allows web and email links', () => {
    for (const href of ['https://janedoe.dev', 'http://example.com/a', 'mailto:jane@example.com', ' HTTPS://X.COM ']) {
      assert.equal(isSafeLinkHref(href), true, href)
    }
  })

  test('refuses scripts, files, data and in-document bookmarks', () => {
    for (const href of ['javascript:alert(1)', ' JavaScript:alert(1)', 'vbscript:x', 'data:text/html,<b>', 'file:///etc/passwd', '#_Toc1', '', 'ftp://x']) {
      assert.equal(isSafeLinkHref(href), false, href)
    }
  })
})

describe('isEmbeddedImageUrl', () => {
  test('allows only images embedded in the document', () => {
    assert.equal(isEmbeddedImageUrl('data:image/png;base64,iVBORw0KGgo='), true)
    for (const url of ['https://tracker.example/pixel.gif', 'blob:http://localhost/x', 'data:text/html,<script>', 'javascript:x', '//evil.example/a.png']) {
      assert.equal(isEmbeddedImageUrl(url), false, url)
    }
  })
})
