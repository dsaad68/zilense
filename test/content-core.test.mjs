import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isHanChar, normalizeSelection, shouldLookupSelection, charAt, matchWords } from '../src/content/content-core.js'

test('isHanChar: Chinese yes; Hangul / kana / emoji / latin no', () => {
  assert.equal(isHanChar('中'), true)
  assert.equal(isHanChar('学'), true)
  assert.equal(isHanChar('가'), false) // Korean Hangul
  assert.equal(isHanChar('ぁ'), false) // Japanese hiragana
  assert.equal(isHanChar('😀'), false) // emoji (astral)
  assert.equal(isHanChar('a'), false)
  assert.equal(isHanChar(''), false)
  assert.equal(isHanChar(undefined), false)
})

test('isHanChar: astral CJK Extension B counts as Han', () => {
  assert.equal(isHanChar('𠀀'), true) // U+20000, surrogate pair in JS
})

test('normalizeSelection: strips surrounding punctuation/brackets/whitespace', () => {
  assert.equal(normalizeSelection('「学习」'), '学习')
  assert.equal(normalizeSelection('你好!'), '你好')
  assert.equal(normalizeSelection('  中文  '), '中文')
  assert.equal(normalizeSelection('“中国”，'), '中国')
  assert.equal(normalizeSelection('hello'), '') // no Han at all
  assert.equal(normalizeSelection(''), '')
})

test('normalizeSelection: keeps an interior run intact', () => {
  // leading/trailing trimmed, inner text (incl. non-Han) preserved between Han
  assert.equal(normalizeSelection('!学A习?'), '学A习')
})

test('shouldLookupSelection: needs Han and must be short enough', () => {
  assert.equal(shouldLookupSelection('你好'), true)
  assert.equal(shouldLookupSelection('「学习」'), true) // normalized then measured
  assert.equal(shouldLookupSelection('hello world'), false) // no Han
  assert.equal(shouldLookupSelection('一二三四五六七八九十一二三四五六七'), false) // 17 chars > 16
  assert.equal(shouldLookupSelection(''), false)
})

test('charAt: reads the whole code point, stepping back from a low surrogate', () => {
  assert.equal(charAt('你好', 0), '你')
  assert.equal(charAt('你好', 1), '好')
  // '𠀀' is U+20000 — two UTF-16 units; either index resolves to the whole char
  const astral = 'a𠀀b'
  assert.equal(charAt(astral, 0), 'a')
  assert.equal(charAt(astral, 1), '𠀀') // high surrogate
  assert.equal(charAt(astral, 2), '𠀀') // low surrogate → steps back to the pair
  assert.equal(charAt(astral, 3), 'b')
})

// rank map mirrors the worker's [word, band] payload (lower band = more common)
const RANK = new Map([
  ['中', 1], ['中国', 1], ['人', 1], ['中国人', 2], ['学习', 2], ['你好', 1],
])
const MAXLEN = 3

test('matchWords: greedy longest-match wins (中国人, not 中 / 中国)', () => {
  const m = matchWords('中国人', RANK, MAXLEN)
  assert.deepEqual(m, [{ start: 0, len: 3, rank: 2 }])
})

test('matchWords: advances past a hit and skips non-Han between words', () => {
  // "你好，中国！" — two words separated by punctuation
  const m = matchWords('你好，中国！', RANK, MAXLEN)
  assert.deepEqual(m, [
    { start: 0, len: 2, rank: 1 }, // 你好
    { start: 3, len: 2, rank: 1 }, // 中国 (index 3: after 你好 + the comma)
  ])
})

test('matchWords: a char with no word match is skipped, not emitted', () => {
  // 喝 is not in RANK; 学习 is. Only the known word is returned.
  const m = matchWords('喝学习', RANK, MAXLEN)
  assert.deepEqual(m, [{ start: 1, len: 2, rank: 2 }])
})

test('matchWords: empty text / empty rank / zero maxLen yield nothing', () => {
  assert.deepEqual(matchWords('', RANK, MAXLEN), [])
  assert.deepEqual(matchWords('中国', new Map(), MAXLEN), [])
  assert.deepEqual(matchWords('中国', RANK, 0), [])
})
