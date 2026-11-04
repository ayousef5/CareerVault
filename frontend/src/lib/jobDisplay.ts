// Small helpers for showing job data, shared by the grid and the
// application details view. No React code, so they can be unit-tested
// (see jobDisplay.test.ts).

// Returns a safe http/https link, or null if there's no usable URL.
export function getSafeUrl(url: string | null): string | null {
  if (url === null || url.trim() === '') {
    return null
  }

  const trimmed = url.trim()

  // Add "https://" if the URL was saved without it, e.g. "careers.google.com/...".
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  // Only allow real web links. This blocks things like "javascript:" links.
  try {
    const parsed = new URL(withProtocol)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.href
      : null
  } catch {
    return null
  }
}

// Turns a status like "Not Applied" into a CSS class like "status-not-applied".
export function getStatusClass(status: string): string {
  return `status-${status.toLowerCase().replace(/\s+/g, '-')}`
}

// Shows a saved "YYYY-MM-DD" date as e.g. "Nov 2, 2026". Returns null for
// an empty or unreadable date.
export function formatDisplayDate(date: string | null): string | null {
  const match = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return null
  }

  // Built from the parts (not parsed as UTC), so the day never shifts
  // because of the user's time zone.
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return value.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// The number of words in a text (0 for empty or missing).
export function countWords(text: string | null): number {
  const trimmed = text?.trim() ?? ''
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

// A short label for a job description button: "1,240 words" or "1 word".
export function describeLength(text: string | null): string {
  const words = countWords(text)
  return `${words.toLocaleString('en-US')} ${words === 1 ? 'word' : 'words'}`
}
