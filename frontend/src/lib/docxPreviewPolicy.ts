// The Word preview's safety settings and URL rules, kept apart from the
// drawing code (docxPreview.ts) so they can be unit-tested without a
// browser. See docxPreview.ts for how they fit together.

// The iframe's sandbox: no scripts, no forms, no top-level navigation.
// "allow-same-origin" lets CareerVault draw the document into it; popups
// let safe links open in a new tab.
export const DOCX_FRAME_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox'

// Nothing may be loaded from anywhere: only inline styles and the
// document's own embedded images and fonts (data: URLs).
export const DOCX_PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

// The empty page the document is drawn into. Its styles and pages each go
// in their own container, so the policy in <head> is never touched.
export const DOCX_FRAME_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${DOCX_PREVIEW_CSP}">
<style>html, body { margin: 0; background: #f1f3f6; } body { font: 14px system-ui, sans-serif; color: #6b7280; }</style>
</head>
<body><div id="docx-styles"></div><div id="docx-pages"><p style="padding: 40px 20px; text-align: center">Loading preview…</p></div></body>
</html>`

// docx-preview settings: as close to Word as it gets, with nothing that can
// load or run anything.
export const DOCX_RENDER_OPTIONS = {
  // Look like Word: grey background, white pages, real page sizes/margins.
  inWrapper: true,
  breakPages: true,
  // Break pages where Word last did (it saves these in the file), not only
  // at explicit page breaks.
  ignoreLastRenderedPageBreak: false,
  ignoreWidth: false,
  ignoreHeight: false,
  ignoreFonts: false,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  // Never render embedded HTML parts ("altChunks"): docx-preview would put
  // them in an unsandboxed iframe.
  renderAltChunks: false,
  // Images and fonts as data: URLs, so no blob: URLs are left behind.
  useBase64URL: true,
  // Off: it measures layout using the main page.
  experimental: false,
  renderComments: false,
  renderChanges: false,
} as const

// Links that may stay clickable (opened in a new tab).
export function isSafeLinkHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim())
}

// Images may only be the document's own (data: URLs, never remote).
export function isEmbeddedImageUrl(url: string): boolean {
  return /^data:image\//i.test(url.trim())
}
