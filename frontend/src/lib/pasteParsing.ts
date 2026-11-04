// Helpers for turning spreadsheet clipboard text (from Excel or Google
// Sheets) into CareerVault values. They're kept in their own file, with no
// React code, so they can be unit-tested on their own (see
// pasteParsing.test.ts).

// The possible statuses a job application can have.
// These match the status values used by the backend.
export type ApplicationStatus =
  | 'Not Applied'
  | 'Applied'
  | 'Interviewing'
  | 'Offer'
  | 'Rejected'

// The choices shown in the Status dropdown.
export const statusOptions: ApplicationStatus[] = [
  'Not Applied',
  'Applied',
  'Interviewing',
  'Offer',
  'Rejected',
]

// ---------- Clipboard tables ----------

// Splits clipboard text from Excel or Google Sheets into rows of cells.
// Cells are separated by tabs and rows by line breaks. A cell that itself
// contains a tab, line break or quote arrives wrapped in "quotes".
export function parseClipboardTable(text: string): string[][] {
  // Some apps put an invisible "byte order mark" at the very start.
  const input = text.startsWith('﻿') ? text.slice(1) : text

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (inQuotes) {
      if (char === '"' && input[i + 1] === '"') {
        // "" inside quotes means one real quote character.
        cell += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        cell += char
      }
    } else if (char === '"' && cell === '') {
      inQuotes = true
    } else if (char === '\t') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      // Treat Windows "\r\n" line endings as a single line break.
      if (char === '\r' && input[i + 1] === '\n') {
        i++
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  // The last row usually has no line break after it.
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

// Turns a cell value into clipboard text, adding quotes when needed so
// Excel and Google Sheets keep it as a single cell.
export function toClipboardCell(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

// ---------- Markdown tables ----------

// Splits one Markdown table line into trimmed cells on "|". An escaped
// "\|" stays as a "|" inside the cell. Optional leading and trailing pipes
// are removed, and "<br>" becomes a line break.
function splitMarkdownRow(line: string): string[] {
  let content = line.trim()
  if (content.startsWith('|')) {
    content = content.slice(1)
  }
  if (content.endsWith('|') && !content.endsWith('\\|')) {
    content = content.slice(0, -1)
  }

  const cells: string[] = []
  let cell = ''

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    if (char === '\\' && content[i + 1] === '|') {
      cell += '|'
      i++
    } else if (char === '|') {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell)

  return cells.map((value) => value.replace(/<br\s*\/?>/gi, '\n').trim())
}

// True for the line under a Markdown header, e.g. "| --- | :---: | ---: |".
function isMarkdownSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))
}

// Splits text into its non-blank lines.
function getLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== '')
}

// Decides whether pasted text is a Markdown table rather than ordinary
// spreadsheet data. To avoid splitting a normal value such as "A | B", it
// only counts as Markdown when there are no tabs and either every line is
// wrapped in pipes ("| a | b |") or there's a "| --- |" separator line.
export function isMarkdownTable(text: string): boolean {
  if (text.includes('\t')) {
    return false
  }

  const lines = getLines(text).map((line) => line.trim())
  if (lines.length === 0) {
    return false
  }

  const everyLineWrappedInPipes = lines.every(
    (line) => line.length > 1 && line.startsWith('|') && line.endsWith('|'),
  )
  const hasSeparatorRow = lines.some((line) =>
    isMarkdownSeparatorRow(splitMarkdownRow(line)),
  )

  return (
    everyLineWrappedInPipes ||
    (hasSeparatorRow && lines.every((line) => line.includes('|')))
  )
}

// ---------- Header-aware pasting ----------

// The CareerVault fields a pasted column can be matched to. These are the
// same names the backend uses.
export type PasteField =
  | 'companyName'
  | 'pay'
  | 'location'
  | 'jobUrl'
  | 'jobTitle'
  | 'dateApplied'
  | 'status'
  | 'notes'
  | 'jobDescription'
  | 'recruiter'

// Header names we recognise for each field. Keys are lowercase with all
// spaces and punctuation removed, so "Comments / Notes", "comments-notes"
// and "CommentsNotes" all become "commentsnotes".
const HEADER_ALIASES: Record<string, PasteField> = {
  company: 'companyName',
  companyname: 'companyName',
  employer: 'companyName',
  organization: 'companyName',
  organisation: 'companyName',

  pay: 'pay',
  salary: 'pay',
  compensation: 'pay',
  payrate: 'pay',
  wage: 'pay',
  rate: 'pay',

  location: 'location',
  city: 'location',

  applink: 'jobUrl',
  applicationlink: 'jobUrl',
  applylink: 'jobUrl',
  joblink: 'jobUrl',
  joburl: 'jobUrl',
  jobposting: 'jobUrl',
  postinglink: 'jobUrl',
  link: 'jobUrl',
  url: 'jobUrl',

  role: 'jobTitle',
  jobtitle: 'jobTitle',
  title: 'jobTitle',
  position: 'jobTitle',

  dateapplied: 'dateApplied',
  applieddate: 'dateApplied',
  applicationdate: 'dateApplied',
  appliedon: 'dateApplied',
  date: 'dateApplied',

  status: 'status',
  applicationstatus: 'status',
  stage: 'status',

  commentsnotes: 'notes',
  notescomments: 'notes',
  comments: 'notes',
  comment: 'notes',
  notes: 'notes',
  note: 'notes',

  requirements: 'jobDescription',
  jobdescription: 'jobDescription',
  description: 'jobDescription',
  qualifications: 'jobDescription',

  recruiter: 'recruiter',
  recruitername: 'recruiter',
  recruitercontact: 'recruiter',
}

// Matches one header name (e.g. "Date Applied", "App link", "COMPANY")
// to a CareerVault field, or returns null if it isn't recognised.
export function matchHeaderToField(header: string): PasteField | null {
  const key = header.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return HEADER_ALIASES[key] ?? null
}

// Matches every header in a row to a field. Unrecognised headers get null,
// so their values are skipped instead of landing in an unrelated column.
// If two headers match the same field, only the first one is used.
export function mapHeaderRow(headers: string[]): (PasteField | null)[] {
  const used = new Set<PasteField>()

  return headers.map((header) => {
    const field = matchHeaderToField(header)
    if (field === null || used.has(field)) {
      return null
    }
    used.add(field)
    return field
  })
}

// True when a row looks like column names rather than data: at least two
// filled-in cells, and every filled-in cell is a header we recognise.
function looksLikeHeaderRow(cells: string[]): boolean {
  const filled = cells.filter((cell) => cell !== '')
  return (
    filled.length >= 2 &&
    filled.every((cell) => matchHeaderToField(cell) !== null)
  )
}

// Splits a Markdown table into its header (if it has one) and data rows.
// Empty cells are kept so later values stay in the right columns, and
// separator lines ("| --- |") are skipped.
//
// The header is the line directly above the first separator line. Tables
// without a separator line count as having a header only when their first
// line is made up entirely of recognised column names.
export function splitMarkdownTable(text: string): {
  header: string[] | null
  rows: string[][]
} {
  const lines = getLines(text).map(splitMarkdownRow)

  let headerIndex = lines.findIndex(
    (_cells, i) => i + 1 < lines.length && isMarkdownSeparatorRow(lines[i + 1]),
  )
  if (headerIndex === -1 && lines.length > 0 && looksLikeHeaderRow(lines[0])) {
    headerIndex = 0
  }

  const rows = lines.filter(
    (cells, i) => i !== headerIndex && !isMarkdownSeparatorRow(cells),
  )

  return { header: headerIndex === -1 ? null : lines[headerIndex], rows }
}

// The data rows of a Markdown table (header and separator lines removed).
export function parseMarkdownTable(text: string): string[][] {
  return splitMarkdownTable(text).rows
}

// The result of reading pasted text.
export type PastedTable = {
  // The data rows, each a list of cells.
  rows: string[][]
  // True if the text was a Markdown table (affects how links are cleaned up).
  isMarkdown: boolean
  // When the table had a recognised header row: the field each source
  // column belongs to (null = unrecognised, so skip it). When this is null,
  // values are pasted by position starting at the selected cell.
  fields: (PasteField | null)[] | null
}

// Reads pasted text as either a Markdown table or tab-separated
// spreadsheet data, whichever it is.
export function parsePastedTable(text: string): PastedTable {
  if (!isMarkdownTable(text)) {
    return { rows: parseClipboardTable(text), isMarkdown: false, fields: null }
  }

  const { header, rows } = splitMarkdownTable(text)

  // Use the header only if at least one of its names was recognised.
  // Otherwise the header row is still skipped and values go by position.
  const fields = header ? mapHeaderRow(header) : null
  const hasKnownHeader = fields !== null && fields.some((field) => field !== null)

  return { rows, isMarkdown: true, fields: hasKnownHeader ? fields : null }
}

// ---------- Markdown links ----------

// Matches [text](url) and [text](url "title").
const MARKDOWN_LINK = /\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/
const MARKDOWN_LINKS = new RegExp(MARKDOWN_LINK.source, 'g')

// Matches <https://...> style links.
const ANGLE_LINK = /<(https?:\/\/[^\s>]+)>/i
const ANGLE_LINKS = new RegExp(ANGLE_LINK.source, 'gi')

// For the App Link column: pulls the URL out of "[FedEx Job](https://...)"
// or "<https://...>". Plain text (e.g. a bare URL) is returned trimmed.
export function extractLinkUrl(text: string): string {
  const trimmed = text.trim()
  const link = trimmed.match(MARKDOWN_LINK) ?? trimmed.match(ANGLE_LINK)
  if (!link) {
    return trimmed
  }
  // [text](url) captures the URL second; <url> captures it first.
  return link[2] ?? link[1]
}

// For every other column: keeps a link's visible text and drops the URL,
// so "[FedEx Job](https://...)" becomes "FedEx Job".
export function stripMarkdownLinks(text: string): string {
  return text.replace(MARKDOWN_LINKS, '$1').replace(ANGLE_LINKS, '$1')
}

// ---------- Dates ----------

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

// Turns a month name such as "Oct", "Sept" or "October" into 1-12,
// or null if it isn't a month.
function parseMonthName(name: string): number | null {
  const lower = name.toLowerCase()
  if (lower.length < 3) {
    return null
  }

  const index = MONTH_NAMES.findIndex((month) => month.startsWith(lower))
  return index === -1 ? null : index + 1
}

// Two-digit years are treated as 20xx (e.g. "26" → 2026).
function toFullYear(year: string): number {
  return year.length === 2 ? 2000 + Number(year) : Number(year)
}

// Builds a "YYYY-MM-DD" date, the format the backend expects. Returns null
// for dates that don't exist, such as February 30.
export function toIsoDate(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1900 ||
    year > 2100
  ) {
    return null
  }

  // Date.UTC rolls bad dates over (Feb 30 → Mar 2), so check it didn't.
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

// Turns a pasted date into "YYYY-MM-DD". Returns null when the cell is
// empty or isn't a real date, so the paste leaves the existing date alone.
//
// Supported (with or without a leading weekday such as "Thu, " and a
// trailing time such as " 12:00:00 AM"):
//   YYYY-MM-DD, YYYY/MM/DD          2026-10-30
//   M/D/YYYY, MM/DD/YYYY, M/D/YY    10/30/2026, 1/5/2026, 10/30/26
//   D/M/YYYY, only when the first number can't be a month   30/10/2026
//   Month D, YYYY                   Oct 30, 2026 / October 30 2026 / Oct 30th, 2026
//   D Month YYYY, D-Mon-YY          30 Oct 2026 / 30-Oct-2026 / 30-Oct-26
export function parsePastedDate(text: string): string | null {
  let value = text
    // Non-breaking spaces (common from Google Sheets) become normal spaces.
    .replace(/\s+/g, ' ')
    .trim()

  if (value === '') {
    return null
  }

  // Drop a leading weekday, e.g. "Thu, Oct 30, 2026" or "Thursday 10/30/2026".
  value = value.replace(
    /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,? /i,
    '',
  )

  // Drop a trailing time, e.g. "10/30/2026 12:00:00 AM" or "2026-10-30T00:00:00Z".
  value = value.replace(
    /[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?( ?[ap]\.?m\.?)?( ?(z|utc|gmt|[+-]\d{2}:?\d{2}))?$/i,
    '',
  )

  // Drop ordinal endings: "30th" → "30".
  value = value.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1')

  // YYYY-MM-DD (also with / or .)
  let match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (match) {
    return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]))
  }

  // M/D/YYYY or M/D/YY (also with - or .), as US spreadsheets show dates.
  match = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/)
  if (match) {
    const first = Number(match[1])
    const second = Number(match[2])
    const year = toFullYear(match[3])

    // If the first number can't be a month (e.g. 30/10/2026), the only
    // possible reading is day/month/year.
    if (first > 12 && second <= 12) {
      return toIsoDate(year, second, first)
    }
    return toIsoDate(year, first, second)
  }

  // Month D, YYYY — e.g. "Oct 30, 2026", "October 30 2026", "Sept. 30, 2026"
  match = value.match(/^([a-z]+)\.? (\d{1,2}),? (\d{4}|\d{2})$/i)
  if (match) {
    const month = parseMonthName(match[1])
    return month === null
      ? null
      : toIsoDate(toFullYear(match[3]), month, Number(match[2]))
  }

  // D Month YYYY or D-Mon-YY — e.g. "30 Oct 2026", "30-Oct-2026", "30-Oct-26"
  match = value.match(/^(\d{1,2})[ -]([a-z]+)\.?,?[ -](\d{4}|\d{2})$/i)
  if (match) {
    const month = parseMonthName(match[2])
    return month === null
      ? null
      : toIsoDate(toFullYear(match[3]), month, Number(match[1]))
  }

  return null
}

// ---------- Statuses ----------

// Other ways people write each status, in lowercase with punctuation
// removed. Only clear-cut wordings are listed. Ambiguous ones such as
// "in progress", "pending" or "declined" (which could mean either side
// declined) are deliberately left out.
const STATUS_ALIASES: Record<string, ApplicationStatus> = {
  // Not Applied
  'not applied': 'Not Applied',
  'not yet applied': 'Not Applied',
  'haven t applied': 'Not Applied',
  'have not applied': 'Not Applied',
  'to apply': 'Not Applied',
  'not started': 'Not Applied',
  saved: 'Not Applied',
  wishlist: 'Not Applied',

  // Applied
  applied: 'Applied',
  submitted: 'Applied',
  'application submitted': 'Applied',
  'application sent': 'Applied',
  'application received': 'Applied',

  // Interviewing
  interviewing: 'Interviewing',
  interview: 'Interviewing',
  interviews: 'Interviewing',
  interviewed: 'Interviewing',
  'interview scheduled': 'Interviewing',
  'phone screen': 'Interviewing',
  'phone interview': 'Interviewing',
  'technical interview': 'Interviewing',
  onsite: 'Interviewing',
  'on site': 'Interviewing',
  'final round': 'Interviewing',

  // Offer
  offer: 'Offer',
  offered: 'Offer',
  'offer received': 'Offer',
  'got offer': 'Offer',
  'offer accepted': 'Offer',

  // Rejected
  rejected: 'Rejected',
  rejection: 'Rejected',
  'not selected': 'Rejected',
  'not moving forward': 'Rejected',
  'no offer': 'Rejected',
}

// Turns a pasted status into one of the real CareerVault statuses.
// Ignores capitals, extra spaces and punctuation or emoji ("applied ✅").
// Returns null when the text is empty or doesn't clearly match a status,
// so the paste leaves the existing status alone.
export function normalizeStatus(text: string): ApplicationStatus | null {
  const key = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  if (key === '') {
    return null
  }

  return STATUS_ALIASES[key] ?? null
}
