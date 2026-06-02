import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toDiacritics, romanizeToDiacritics, toToneless, syllableTone } from '../src/lib/pinyin.js'

test('toDiacritics: numbered syllables -> tone marks', () => {
  assert.equal(toDiacritics('ni3 hao3'), 'nǐ hǎo')
  assert.equal(toDiacritics('Zhong1 guo2'), 'Zhōng guó') // proper-noun caps preserved
  assert.equal(toDiacritics('de5'), 'de') // neutral tone: no mark
  assert.equal(toDiacritics('lu:3'), 'lǚ') // u: -> ü
  assert.equal(toDiacritics('xue2 xi2'), 'xué xí')
})

test('romanizeToDiacritics: full sentences with joined syllables + punctuation', () => {
  assert.equal(romanizeToDiacritics('Wo3 zai4 Zhong1guo2.'), 'Wǒ zài Zhōngguó.')
  assert.equal(romanizeToDiacritics('Ta1 shi4 lao3shi1.'), 'Tā shì lǎoshī.')
  assert.equal(romanizeToDiacritics('Ni3 hao3 ma5?'), 'Nǐ hǎo ma?')
})

test('toToneless: strip tones/spaces for fuzzy search', () => {
  assert.equal(toToneless('ni3 hao3'), 'nihao')
  assert.equal(toToneless('Zhong1 guo2'), 'zhongguo')
})

test('syllableTone: tone number from a marked syllable', () => {
  assert.equal(syllableTone('hǎo'), 3)
  assert.equal(syllableTone('guó'), 2)
  assert.equal(syllableTone('Zhōng'), 1)
  assert.equal(syllableTone('zài'), 4)
  assert.equal(syllableTone('de'), 5) // neutral
  assert.equal(syllableTone('lǜ'), 4) // ü
  assert.equal(syllableTone('a'), 5) // unmarked -> neutral
})

test('toDiacritics: edge cases (empty, v->ü, neutral, caps, multi-syllable)', () => {
  assert.equal(toDiacritics(''), '')
  assert.equal(toDiacritics('lv4'), 'lǜ') // v is an alt spelling of ü
  assert.equal(toDiacritics('a5'), 'a') // neutral tone, vowel-only
  assert.equal(toDiacritics('A1'), 'Ā') // uppercase vowel keeps case
  assert.equal(toDiacritics('peng2 you5'), 'péng you')
})

test('romanizeToDiacritics: empty + passthrough of non-pinyin', () => {
  assert.equal(romanizeToDiacritics(''), '')
  assert.equal(romanizeToDiacritics('—'), '—') // no syllable to convert
})

test('toToneless: handles ü spellings and case', () => {
  assert.equal(toToneless('lu:3'), 'lu')
  assert.equal(toToneless('Zhong1'), 'zhong')
})
