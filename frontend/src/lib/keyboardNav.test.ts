// Unit tests for keyboard rules. Run with: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { arrowDelta, arrowMovesCell, entryRowMove } from './keyboardNav.ts'

describe('arrowDelta', () => {
  test('gives the step for each arrow key', () => {
    assert.deepEqual(arrowDelta('ArrowLeft'), { row: 0, col: -1 })
    assert.deepEqual(arrowDelta('ArrowRight'), { row: 0, col: 1 })
    assert.deepEqual(arrowDelta('ArrowUp'), { row: -1, col: 0 })
    assert.deepEqual(arrowDelta('ArrowDown'), { row: 1, col: 0 })
  })

  test('is null for other keys', () => {
    assert.equal(arrowDelta('a'), null)
    assert.equal(arrowDelta('Home'), null)
  })
})

describe('arrowMovesCell (while editing a cell)', () => {
  test('after typing over a cell, arrows move to the next cell', () => {
    assert.equal(arrowMovesCell('enter', 'ArrowLeft'), true)
    assert.equal(arrowMovesCell('enter', 'ArrowRight'), true)
    assert.equal(arrowMovesCell('enter', 'ArrowDown'), true)
  })

  test('after F2 or a double-click, arrows move the text cursor', () => {
    assert.equal(arrowMovesCell('edit', 'ArrowLeft'), false)
    assert.equal(arrowMovesCell('edit', 'ArrowRight'), false)
  })

  test('other keys always edit the text', () => {
    assert.equal(arrowMovesCell('enter', 'Home'), false)
    assert.equal(arrowMovesCell('enter', 'x'), false)
  })
})

describe('entryRowMove (the Add Job entry row)', () => {
  const text = (start: number, end: number, length: number) => ({
    kind: 'text' as const,
    selectionStart: start,
    selectionEnd: end,
    length,
  })

  test('left at the start of a text box goes to the previous field', () => {
    assert.equal(entryRowMove('ArrowLeft', text(0, 0, 5)), 'previous')
    assert.equal(entryRowMove('ArrowLeft', text(0, 0, 0)), 'previous')
  })

  test('right at the end of a text box goes to the next field', () => {
    assert.equal(entryRowMove('ArrowRight', text(5, 5, 5)), 'next')
    assert.equal(entryRowMove('ArrowRight', text(0, 0, 0)), 'next')
  })

  test('inside the text, left and right move the cursor normally', () => {
    assert.equal(entryRowMove('ArrowLeft', text(2, 2, 5)), null)
    assert.equal(entryRowMove('ArrowRight', text(2, 2, 5)), null)
  })

  test('with text selected, left and right just collapse the selection', () => {
    assert.equal(entryRowMove('ArrowLeft', text(0, 5, 5)), null)
    assert.equal(entryRowMove('ArrowRight', text(0, 5, 5)), null)
  })

  test('down in a text box goes into the grid', () => {
    assert.equal(entryRowMove('ArrowDown', text(2, 2, 5)), 'down')
  })

  test('dropdowns move with left/right but keep up/down for choosing', () => {
    const select = { kind: 'select' as const, selectionStart: null, selectionEnd: null, length: 0 }
    assert.equal(entryRowMove('ArrowLeft', select), 'previous')
    assert.equal(entryRowMove('ArrowRight', select), 'next')
    assert.equal(entryRowMove('ArrowDown', select), null)
  })

  test('date inputs keep all their arrow keys', () => {
    const date = { kind: 'date' as const, selectionStart: null, selectionEnd: null, length: 0 }
    assert.equal(entryRowMove('ArrowLeft', date), null)
    assert.equal(entryRowMove('ArrowRight', date), null)
    assert.equal(entryRowMove('ArrowDown', date), null)
  })
})
