import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseCedict } from '../assets/scripts/cedict-parse.mjs'

/* Guards assets/scripts/cedict-parse.mjs — the parser that turns the vendored raw
   CC-CEDICT source (assets/cedict/cedict_ts.u8) into the { all, classifierLookup }
   shape build-dict.mjs consumes. These run on hand-written lines (fast, no rebuild)
   plus a header invariant on the real vendored file, so a parser tweak or a
   `npm run refresh:cedict` can't silently regress the dictionary. */

const __dirname = dirname(fileURLToPath(import.meta.url))
const VENDORED = resolve(__dirname, '../assets/cedict/cedict_ts.u8')

// parse a single CC-CEDICT line and return its entry (all[0]), or undefined
function entryOf(line) {
  return parseCedict(line).all[0]
}

test('parse: extracts traditional, simplified, and raw numbered pinyin', () => {
  const e = entryOf('傳統 传统 [chuan2 tong3] /tradition/convention/')
  assert.equal(e[0], '傳統')
  assert.equal(e[1], '传统')
  assert.equal(e[2], 'chuan2 tong3') // pinyin kept in numbered form, verbatim
})

test('parse: a single meaning is stored as a string, multiple as an array', () => {
  const one = entryOf('你好 你好 [ni3 hao3] /hello/')
  assert.equal(one[3], 'hello') // string, not ['hello']

  const many = entryOf('傳統 传统 [chuan2 tong3] /tradition/convention/')
  assert.deepEqual(many[3], ['tradition', 'convention'])
})

test('parse: traditional === simplified when the line has no variant', () => {
  const e = entryOf('你好 你好 [ni3 hao3] /hello/')
  assert.equal(e[0], e[1])
})

test('parse: classifiers move out of meanings into classifierLookup', () => {
  const { all, classifierLookup } = parseCedict('書 书 [shu1] /book/CL:本[ben3]/')
  const e = all[0]
  // the CL: note is stripped from the visible meanings (only "book" remains)
  assert.equal(e[3], 'book')
  // one classifier index recorded at field 5, resolving to [simp, trad, pinyin]
  assert.equal(e[5].length, 1)
  assert.deepEqual(classifierLookup[e[5][0]], ['本', '本', 'ben3'])
})

test('parse: an identical classifier across lines is deduped to one index', () => {
  const { all, classifierLookup } = parseCedict(
    '書 书 [shu1] /book/CL:本[ben3]/\n本子 本子 [ben3 zi5] /notebook/CL:本[ben3]/'
  )
  assert.equal(classifierLookup.length, 1, 'shared CL:本[ben3] should be stored once')
  assert.equal(all[0][5][0], all[1][5][0], 'both lines reference the same classifier index')
})

test('parse: comment, blank, and malformed lines are skipped', () => {
  const { all } = parseCedict(
    [
      '# CC-CEDICT',
      '#! version=1',
      '',
      '   ',
      'not a valid line',
      '你好 你好 [ni3 hao3] /hello/',
    ].join('\n')
  )
  assert.equal(all.length, 1, 'only the one well-formed line should survive')
  assert.equal(all[0][1], '你好')
})

test('parse: a bare "variant of …" note (the whole meaning) is dropped', () => {
  // when the entire definition is just a variant pointer it leaves no visible
  // meaning, but the entry itself is still emitted
  const e = entryOf('X X [a1] /variant of 大/')
  assert.deepEqual(e[3], [])
  assert.equal(e[1], 'X')
})

test('parse: a real definition containing "(in)variant of" is KEPT', () => {
  // this is the edge case where the upstream cc-cedict package erroneously drops
  // the meaning; our parser keeps it. Lock that in.
  const e = entryOf('上同調 上同调 [shang4 tong2 diao4] /cohomology (invariant of a topological space in math.)/')
  assert.equal(e[3], 'cohomology (invariant of a topological space in math.)')
})

test('vendored source: present and parses to its declared entry count', () => {
  assert.ok(existsSync(VENDORED), 'assets/cedict/cedict_ts.u8 must be committed')
  const text = readFileSync(VENDORED, 'utf8')
  // header sanity: the pinned export advertises its format + entry count
  assert.match(text, /#! format=ts/, 'expected a CC-CEDICT ts-format header')
  const declared = Number((text.match(/#! entries=(\d+)/) || [])[1])
  assert.ok(declared > 100000, `header entry count looks wrong: ${declared}`)
  // the number of parsed entries must match the header — catches a botched refresh
  const { all } = parseCedict(text)
  assert.equal(all.length, declared, `parsed ${all.length} entries but header declares ${declared}`)
})
