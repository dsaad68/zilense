import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { collectForward, textOf, MAX_WORD } from '../src/content/word-walk.js'

/* Hover word-collection walk. collectForward uses the live `document`, a
   TreeWalker, and NodeFilter, so we register happy-dom's globals for this file and
   unregister after — keeping the DOM environment contained to these tests. */
before(() => GlobalRegistrator.register())
after(() => GlobalRegistrator.unregister())

// the first text node inside a freshly-built <p>
function paragraph(html) {
  document.body.innerHTML = `<p id="t">${html}</p>`
  return document.getElementById('t')
}

test('collectForward: collects a run of Han and stops at the first non-Han char', () => {
  const p = paragraph('新闻很好 hello')
  const { text, positions } = collectForward(p.firstChild, 0)
  assert.equal(text, '新闻很好', 'stops at the space before "hello"')
  assert.equal(positions.length, 4)
  assert.equal(positions[0].size, 1, 'BMP CJK chars are one UTF-16 unit')
})

test('collectForward: walks forward ACROSS adjacent text nodes (word split by inline markup)', () => {
  // 新<span>闻</span>联播 — the word spans three text nodes in two elements
  const p = paragraph('新<span>闻</span>联播。')
  const { text, positions } = collectForward(p.firstChild, 0)
  assert.equal(text, '新闻联播', 'collected across the <span> boundary')
  // the characters resolve to different nodes, proving the walk crossed elements
  assert.notEqual(positions[0].node, positions[1].node)
})

test('collectForward: starting on a non-Han char returns nothing', () => {
  const p = paragraph(', 你好')
  const { text, positions } = collectForward(p.firstChild, 0)
  assert.equal(text, '')
  assert.equal(positions.length, 0)
})

test('collectForward: never collects more than MAX_WORD characters', () => {
  const p = paragraph('中'.repeat(MAX_WORD + 8))
  const { text, positions } = collectForward(p.firstChild, 0)
  assert.equal(positions.length, MAX_WORD)
  assert.equal([...text].length, MAX_WORD)
})

test('collectForward: honors a non-zero start index into the text node', () => {
  const p = paragraph('英文你好')
  // start at index 2 (the "你"), skipping the leading "英文"
  const { text } = collectForward(p.firstChild, 2)
  assert.equal(text, '你好')
})

test('textOf: reconstructs the word from positions, including across text nodes', () => {
  const p = paragraph('新<span>闻</span>联播')
  const { positions } = collectForward(p.firstChild, 0)
  assert.equal(textOf(positions, positions.length), '新闻联播')
  // `len` truncates the reconstructed word to the first N characters
  assert.equal(textOf(positions, 2), '新闻')
  assert.equal(textOf(positions, 0), '')
})

test('textOf: len beyond the collected length is clamped', () => {
  const p = paragraph('你好')
  const { positions } = collectForward(p.firstChild, 0)
  assert.equal(textOf(positions, 99), '你好')
})
