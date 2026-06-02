import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { buildIndex, wordsContainingChar } from '../src/lib/dict-core.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
let DB, INDEX

before(() => {
  DB = JSON.parse(readFileSync(resolve(__dirname, '../src/data/cedict.json'), 'utf8'))
  INDEX = buildIndex(DB)
})

test('charIndex: indexes which keys contain a character', () => {
  const keys = INDEX.charIndex.get('学')
  assert.ok(Array.isArray(keys) && keys.length > 0, 'expected keys containing 学')
  assert.ok(keys.includes('学习'), '学习 should be indexed under 学')
})

test('wordsContainingChar: returns the word family, excluding the bare char', () => {
  const fam = wordsContainingChar(DB, INDEX, '学', { exclude: '学' })
  assert.ok(fam.length > 0, 'expected words containing 学')
  assert.ok(fam.every((w) => w.q !== '学'), 'must not include the bare character')
  assert.ok(fam.every((w) => [...w.q].length >= 2), 'words only (length >= 2)')
  assert.ok(fam.some((w) => w.q === '学习'), '学习 should be in the family')
  // preview shape used by the UI rows
  const w = fam[0]
  assert.ok(typeof w.pinyin === 'string' && Array.isArray(w.defs), 'preview row shape')
})

test('wordsContainingChar: common (HSK) words rank ahead of rare ones', () => {
  const fam = wordsContainingChar(DB, INDEX, '学', { exclude: '学', limit: 30 })
  const xuexiIdx = fam.findIndex((w) => w.q === '学习')
  assert.ok(xuexiIdx >= 0 && xuexiIdx < 10, '学习 (HSK1) should rank near the top')
})

test('wordsContainingChar: caps the result count', () => {
  const fam = wordsContainingChar(DB, INDEX, '人', { exclude: '人', limit: 5 })
  assert.ok(fam.length <= 5, 'respects the limit')
})

test('wordsContainingChar: missing char / no index -> empty', () => {
  assert.deepEqual(wordsContainingChar(DB, INDEX, ''), []) // private-use char, never a key
  assert.deepEqual(wordsContainingChar(DB, null, '学'), [])
})
