// Shows a Word (.docx) resume the way Word lays it out (pages, margins,
// fonts, tables, spacing, page breaks), using docx-preview in the browser.
// The file is the in-memory copy downloaded with the login token; it's never
// changed or sent anywhere else.
//
// A .docx is untrusted input, so the preview is contained three ways:
//  1. It's drawn inside a sandboxed iframe WITHOUT "allow-scripts": nothing
//     in it can ever run code.
//  2. That iframe's Content Security Policy blocks every network request
//     (styles from the document can't load anything from elsewhere); only
//     the document's own embedded images and fonts, as data: URLs, show.
//  3. After drawing, anything active is removed: embedded HTML parts are
//     never rendered, unsafe links lose their target, and safe links open
//     in a new tab.
// docx-preview is loaded only when a Word file is first previewed.

import {
  DOCX_RENDER_OPTIONS,
  isEmbeddedImageUrl,
  isSafeLinkHref,
} from './docxPreviewPolicy.ts'

export { DOCX_FRAME_DOCUMENT, DOCX_FRAME_SANDBOX } from './docxPreviewPolicy.ts'

// Elements that are never shown in a preview.
const FORBIDDEN_ELEMENTS =
  'script, iframe, frame, frameset, object, embed, applet, form, input, button, textarea, select, link, meta, base, audio, video, source, portal'

// Removes anything active from the drawn document (a second line of
// defence behind the sandbox and the CSP).
export function sanitizeRenderedDocx(root: ParentNode) {
  for (const element of root.querySelectorAll(FORBIDDEN_ELEMENTS)) {
    element.remove()
  }

  for (const element of root.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcset' || name === 'srcdoc' || name === 'formaction') {
        element.removeAttribute(attribute.name)
      }
    }

    if (element.localName === 'a') {
      const href = element.getAttribute('href') ?? ''
      if (isSafeLinkHref(href)) {
        element.setAttribute('target', '_blank')
        element.setAttribute('rel', 'noopener noreferrer')
      } else {
        // javascript:, file:, bookmarks inside the document, anything odd.
        element.removeAttribute('href')
        element.removeAttribute('target')
      }
      continue
    }

    // <img src> and SVG <image href / xlink:href>: embedded images only.
    for (const name of ['src', 'href', 'xlink:href']) {
      const value = element.getAttribute(name)
      if (value !== null && !isEmbeddedImageUrl(value)) {
        element.removeAttribute(name)
      }
    }
  }
}

// Draws the file into the (sandboxed) preview frame's document, then
// cleans the result.
export async function renderDocxInto(frameDocument: Document, file: Blob): Promise<void> {
  const pages = frameDocument.getElementById('docx-pages')
  const styles = frameDocument.getElementById('docx-styles')
  if (!pages || !styles) {
    throw new Error('The preview frame is not ready.')
  }

  const { renderAsync } = await import('docx-preview')
  await renderAsync(file, pages, styles, DOCX_RENDER_OPTIONS)
  sanitizeRenderedDocx(pages)
}

// Empties the preview frame when the preview closes.
export function clearDocxFrame(frameDocument: Document | null | undefined) {
  frameDocument?.getElementById('docx-pages')?.replaceChildren()
  frameDocument?.getElementById('docx-styles')?.replaceChildren()
}
