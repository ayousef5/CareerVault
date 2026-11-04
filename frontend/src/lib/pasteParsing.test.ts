// Unit tests for the paste helpers. Run with: npm test
// (Uses Node's built-in test runner, so no extra packages are needed.)
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  extractLinkUrl,
  isMarkdownTable,
  mapHeaderRow,
  matchHeaderToField,
  normalizeStatus,
  parseClipboardTable,
  parseMarkdownTable,
  parsePastedDate,
  parsePastedTable,
  stripMarkdownLinks,
  toClipboardCell,
  toIsoDate,
} from './pasteParsing.ts'

describe('parsePastedDate', () => {
  test('accepts YYYY-MM-DD', () => {
    assert.equal(parsePastedDate('2026-10-30'), '2026-10-30')
    assert.equal(parsePastedDate('2026-1-5'), '2026-01-05')
    assert.equal(parsePastedDate('2026/10/30'), '2026-10-30')
  })

  test('accepts MM/DD/YYYY and M/D/YYYY', () => {
    assert.equal(parsePastedDate('10/30/2026'), '2026-10-30')
    assert.equal(parsePastedDate('01/05/2026'), '2026-01-05')
    assert.equal(parsePastedDate('1/5/2026'), '2026-01-05')
    assert.equal(parsePastedDate('10-30-2026'), '2026-10-30')
  })

  test('accepts MM/DD/YY as 20YY', () => {
    assert.equal(parsePastedDate('10/30/26'), '2026-10-30')
    assert.equal(parsePastedDate('1/5/26'), '2026-01-05')
  })

  test('reads D/M/YYYY only when the first number cannot be a month', () => {
    assert.equal(parsePastedDate('30/10/2026'), '2026-10-30')
    // Ambiguous: read as US month/day.
    assert.equal(parsePastedDate('05/10/2026'), '2026-05-10')
  })

  test('accepts month names', () => {
    assert.equal(parsePastedDate('Oct 30, 2026'), '2026-10-30')
    assert.equal(parsePastedDate('October 30, 2026'), '2026-10-30')
    assert.equal(parsePastedDate('october 30 2026'), '2026-10-30')
    assert.equal(parsePastedDate('Sept. 3, 2026'), '2026-09-03')
    assert.equal(parsePastedDate('Oct 30th, 2026'), '2026-10-30')
    assert.equal(parsePastedDate('30 Oct 2026'), '2026-10-30')
    assert.equal(parsePastedDate('30-Oct-2026'), '2026-10-30')
    assert.equal(parsePastedDate('30-Oct-26'), '2026-10-30')
  })

  test('ignores weekdays, times and odd spacing from spreadsheets', () => {
    assert.equal(parsePastedDate('Thu, Oct 30, 2026'), '2026-10-30')
    assert.equal(parsePastedDate('Friday 10/30/2026'), '2026-10-30')
    assert.equal(parsePastedDate('10/30/2026 12:00:00 AM'), '2026-10-30')
    assert.equal(parsePastedDate('10/30/2026 0:00'), '2026-10-30')
    assert.equal(parsePastedDate('2026-10-30T00:00:00Z'), '2026-10-30')
    assert.equal(parsePastedDate('  10/30/2026 \r'), '2026-10-30')
    // Non-breaking space, as Google Sheets sometimes copies.
    assert.equal(parsePastedDate('Oct 30, 2026'), '2026-10-30')
  })

  test('handles leap years', () => {
    assert.equal(parsePastedDate('02/29/2028'), '2028-02-29')
    assert.equal(parsePastedDate('02/29/2026'), null)
  })

  test('rejects dates that do not exist', () => {
    assert.equal(parsePastedDate('02/30/2026'), null)
    assert.equal(parsePastedDate('04/31/2026'), null)
    assert.equal(parsePastedDate('13/13/2026'), null)
    assert.equal(parsePastedDate('0/10/2026'), null)
    assert.equal(parsePastedDate('2026-13-01'), null)
    assert.equal(parsePastedDate('2026-02-30'), null)
    assert.equal(parsePastedDate('Feb 30, 2026'), null)
  })

  test('returns null for empty or non-date text (so nothing is overwritten)', () => {
    assert.equal(parsePastedDate(''), null)
    assert.equal(parsePastedDate('   '), null)
    assert.equal(parsePastedDate('hello'), null)
    assert.equal(parsePastedDate('10/30'), null)
    assert.equal(parsePastedDate('Octember 30, 2026'), null)
    assert.equal(parsePastedDate('Ma 30, 2026'), null)
    assert.equal(parsePastedDate('46325'), null)
    assert.equal(parsePastedDate('10/30/1850'), null)
  })
})

describe('toIsoDate', () => {
  test('pads month and day', () => {
    assert.equal(toIsoDate(2026, 1, 5), '2026-01-05')
  })

  test('rejects impossible dates', () => {
    assert.equal(toIsoDate(2026, 2, 30), null)
    assert.equal(toIsoDate(2026, 0, 10), null)
  })
})

describe('normalizeStatus', () => {
  test('accepts every real status in any capitalisation', () => {
    assert.equal(normalizeStatus('Not Applied'), 'Not Applied')
    assert.equal(normalizeStatus('applied'), 'Applied')
    assert.equal(normalizeStatus('INTERVIEWING'), 'Interviewing')
    assert.equal(normalizeStatus('offer'), 'Offer')
    assert.equal(normalizeStatus('Rejected'), 'Rejected')
  })

  test('ignores extra spaces, punctuation and emoji', () => {
    assert.equal(normalizeStatus('  Applied  '), 'Applied')
    assert.equal(normalizeStatus('Applied ✅'), 'Applied')
    assert.equal(normalizeStatus('not-applied'), 'Not Applied')
    assert.equal(normalizeStatus('Offer!'), 'Offer')
    assert.equal(normalizeStatus('Applied\r'), 'Applied')
  })

  test('maps clear variations to existing statuses', () => {
    assert.equal(normalizeStatus('Submitted'), 'Applied')
    assert.equal(normalizeStatus('Interview'), 'Interviewing')
    assert.equal(normalizeStatus('Phone Screen'), 'Interviewing')
    assert.equal(normalizeStatus('Final round'), 'Interviewing')
    assert.equal(normalizeStatus('Offer received'), 'Offer')
    assert.equal(normalizeStatus('Rejection'), 'Rejected')
    assert.equal(normalizeStatus('Not selected'), 'Rejected')
    assert.equal(normalizeStatus("Haven't applied"), 'Not Applied')
    assert.equal(normalizeStatus('Wishlist'), 'Not Applied')
  })

  test('returns null for empty, unknown or ambiguous text', () => {
    assert.equal(normalizeStatus(''), null)
    assert.equal(normalizeStatus('   '), null)
    assert.equal(normalizeStatus('In Progress'), null)
    assert.equal(normalizeStatus('Pending'), null)
    assert.equal(normalizeStatus('Declined'), null)
    assert.equal(normalizeStatus('Ghosted'), null)
    assert.equal(normalizeStatus('Maybe'), null)
  })
})

describe('parseClipboardTable', () => {
  test('splits tab-separated rows from Excel or Google Sheets', () => {
    assert.deepEqual(
      parseClipboardTable(
        'Microsoft\t$45/hr\t10/30/2026\tApplied\r\nGoogle\t$50/hr\tOct 30, 2026\tinterview\r\n',
      ),
      [
        ['Microsoft', '$45/hr', '10/30/2026', 'Applied'],
        ['Google', '$50/hr', 'Oct 30, 2026', 'interview'],
      ],
    )
  })

  test('keeps empty cells in place', () => {
    assert.deepEqual(parseClipboardTable('a\t\tc\n\tb\t'), [
      ['a', '', 'c'],
      ['', 'b', ''],
    ])
  })

  test('reads quoted cells containing line breaks and quotes', () => {
    assert.deepEqual(parseClipboardTable('"line 1\nline 2"\t"say ""hi"""\tplain'), [
      ['line 1\nline 2', 'say "hi"', 'plain'],
    ])
  })

  test('ignores a leading byte order mark', () => {
    assert.deepEqual(parseClipboardTable('﻿Applied'), [['Applied']])
  })

  test('round-trips through toClipboardCell', () => {
    const value = 'say "hi"\nthere'
    assert.deepEqual(parseClipboardTable(`${toClipboardCell(value)}\tx`), [
      [value, 'x'],
    ])
  })
})

describe('Markdown tables', () => {
  // The exact row from the bug report.
  const fedExRow =
    '| FedEx | 25/hr | Memphis, TN | [FedEx Job](https://careers.fedex.com/example) | Intern - Information Technology | | | 10/25/2026 |'

  test('splits a Markdown row into separate cells, keeping empty ones', () => {
    assert.deepEqual(parsePastedTable(fedExRow), {
      isMarkdown: true,
      fields: null,
      rows: [
        [
          'FedEx',
          '25/hr',
          'Memphis, TN',
          '[FedEx Job](https://careers.fedex.com/example)',
          'Intern - Information Technology',
          '',
          '',
          '10/25/2026',
        ],
      ],
    })
  })

  test('supports multiple rows and skips separator and header rows', () => {
    const table = [
      '| Company | Pay | Location |',
      '| :--- | :---: | ---: |',
      '| FedEx | 25/hr | Memphis, TN |',
      '| Google | $50/hr | Chicago, IL |',
    ].join('\n')

    assert.deepEqual(parseMarkdownTable(table), [
      ['FedEx', '25/hr', 'Memphis, TN'],
      ['Google', '$50/hr', 'Chicago, IL'],
    ])
  })

  test('skips separator rows written with plain dashes', () => {
    assert.deepEqual(parseMarkdownTable('|---|---|\n| a | b |'), [['a', 'b']])
  })

  test('works without leading and trailing pipes when there is a separator row', () => {
    const table = 'Company | Pay\n--- | ---\nFedEx | 25/hr\r\nGoogle | $50/hr'
    assert.equal(isMarkdownTable(table), true)
    assert.deepEqual(parseMarkdownTable(table), [
      ['FedEx', '25/hr'],
      ['Google', '$50/hr'],
    ])
  })

  test('keeps escaped pipes and turns <br> into a line break', () => {
    assert.deepEqual(parseMarkdownTable('| a \\| b | line 1<br>line 2 |'), [
      ['a | b', 'line 1\nline 2'],
    ])
  })

  test('ignores blank lines between rows', () => {
    assert.deepEqual(parseMarkdownTable('| a | b |\n\n| c | d |\n'), [
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  test('does not treat normal spreadsheet data as Markdown', () => {
    assert.equal(isMarkdownTable('FedEx\t25/hr\tMemphis, TN'), false)
    assert.equal(isMarkdownTable('| a |\t| b |'), false)
    assert.equal(isMarkdownTable('Pay | negotiable'), false)
    assert.equal(isMarkdownTable('just text'), false)
    assert.equal(isMarkdownTable(''), false)
    assert.deepEqual(parsePastedTable('FedEx\t25/hr'), {
      isMarkdown: false,
      fields: null,
      rows: [['FedEx', '25/hr']],
    })
  })
})

describe('Markdown links', () => {
  test('extractLinkUrl pulls the URL out for the App Link column', () => {
    assert.equal(
      extractLinkUrl('[FedEx Job](https://careers.fedex.com/example)'),
      'https://careers.fedex.com/example',
    )
    assert.equal(
      extractLinkUrl('[Job](https://example.com/a "Title")'),
      'https://example.com/a',
    )
    assert.equal(extractLinkUrl('<https://example.com/b>'), 'https://example.com/b')
    assert.equal(extractLinkUrl(' https://example.com/c '), 'https://example.com/c')
    assert.equal(extractLinkUrl(''), '')
  })

  test('stripMarkdownLinks keeps only the link text in other columns', () => {
    assert.equal(stripMarkdownLinks('[FedEx Job](https://x.com/1)'), 'FedEx Job')
    assert.equal(
      stripMarkdownLinks('See [one](https://a.com) and <https://b.com>'),
      'See one and https://b.com',
    )
    assert.equal(stripMarkdownLinks('no links here'), 'no links here')
  })
})

describe('header-aware Markdown pasting', () => {
  test('matches header names, ignoring case, spacing and punctuation', () => {
    assert.equal(matchHeaderToField('Company'), 'companyName')
    assert.equal(matchHeaderToField('  PAY '), 'pay')
    assert.equal(matchHeaderToField('App Link'), 'jobUrl')
    assert.equal(matchHeaderToField('app-link'), 'jobUrl')
    assert.equal(matchHeaderToField('Role'), 'jobTitle')
    assert.equal(matchHeaderToField('Job Title'), 'jobTitle')
    assert.equal(matchHeaderToField('Date Applied'), 'dateApplied')
    assert.equal(matchHeaderToField('date_applied'), 'dateApplied')
    assert.equal(matchHeaderToField('Status'), 'status')
    assert.equal(matchHeaderToField('Comments / Notes'), 'notes')
    assert.equal(matchHeaderToField('Comments/Notes'), 'notes')
    assert.equal(matchHeaderToField('Requirements'), 'jobDescription')
    assert.equal(matchHeaderToField('Recruiter'), 'recruiter')
    assert.equal(matchHeaderToField('Location'), 'location')
  })

  test('returns null for unrecognised headers', () => {
    assert.equal(matchHeaderToField('Favourite colour'), null)
    assert.equal(matchHeaderToField(''), null)
    assert.equal(matchHeaderToField('Hiring Manager'), null)
  })

  test('maps a header row, skipping unknown and repeated headers', () => {
    assert.deepEqual(mapHeaderRow(['Role', 'Mystery', 'Company', 'Notes', 'Comments']), [
      'jobTitle',
      null,
      'companyName',
      'notes',
      null,
    ])
  })

  test('maps values by header when the source column order differs', () => {
    const table = [
      '| Role | Company | Date Applied | Status | App Link |',
      '| --- | :---: | --- | ---: | --- |',
      '| Intern - IT | FedEx | 10/25/2026 | Applied | [FedEx Job](https://careers.fedex.com/example) |',
      '| SWE Intern | Google | | | |',
    ].join('\n')

    assert.deepEqual(parsePastedTable(table), {
      isMarkdown: true,
      fields: ['jobTitle', 'companyName', 'dateApplied', 'status', 'jobUrl'],
      rows: [
        [
          'Intern - IT',
          'FedEx',
          '10/25/2026',
          'Applied',
          '[FedEx Job](https://careers.fedex.com/example)',
        ],
        ['SWE Intern', 'Google', '', '', ''],
      ],
    })
  })

  test('unrecognised header columns are mapped to null (skipped)', () => {
    const table = '| Company | Vibes | Pay |\n|---|---|---|\n| FedEx | great | 25/hr |'
    assert.deepEqual(parsePastedTable(table).fields, ['companyName', null, 'pay'])
  })

  test('recognises a header row even without a separator line', () => {
    const table = '| Company | Role |\n| FedEx | Intern |'
    assert.deepEqual(parsePastedTable(table), {
      isMarkdown: true,
      fields: ['companyName', 'jobTitle'],
      rows: [['FedEx', 'Intern']],
    })
  })

  test('does not mistake a data row for a header without a separator', () => {
    const table = '| FedEx | Intern |\n| Google | SWE |'
    assert.deepEqual(parsePastedTable(table), {
      isMarkdown: true,
      fields: null,
      rows: [
        ['FedEx', 'Intern'],
        ['Google', 'SWE'],
      ],
    })
  })

  test('falls back to position when no header names are recognised', () => {
    const table = '| Firma | Gehalt |\n|---|---|\n| FedEx | 25/hr |'
    assert.deepEqual(parsePastedTable(table), {
      isMarkdown: true,
      fields: null,
      rows: [['FedEx', '25/hr']],
    })
  })

  test('a header with no data rows produces no rows', () => {
    assert.deepEqual(parsePastedTable('| Company | Pay |\n|---|---|').rows, [])
  })

  test('tab-separated data is never header-mapped', () => {
    assert.equal(parsePastedTable('Company\tPay\nFedEx\t25/hr').fields, null)
  })
})
