import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { segmentText } from '../src/lib/dict-core.js'
import { tokensToRuby, containsHan, parseJson3, cueAt, pickTracks, json3Url } from '../src/content/subs/subs-core.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
let DB
before(() => { DB = JSON.parse(readFileSync(resolve(__dirname, '../src/data/cedict.json'), 'utf8')) })

// ---- ruby render model -------------------------------------------------------

test('tokensToRuby: a word token becomes per-character {c, py, tone} columns', () => {
  const model = tokensToRuby([{ t: '你好', kind: 'word', py: 'nǐ hǎo' }])
  assert.equal(model.length, 1)
  assert.equal(model[0].kind, 'word')
  assert.equal(model[0].word, '你好')
  assert.deepEqual(model[0].chars, [
    { c: '你', py: 'nǐ', tone: 3 },
    { c: '好', py: 'hǎo', tone: 3 },
  ])
})

test('tokensToRuby: punct tokens pass straight through (latin, spaces, marks)', () => {
  const model = tokensToRuby([
    { t: '中', kind: 'char', py: 'zhōng' },
    { t: ',', kind: 'punct' },
    { t: ' ', kind: 'punct' },
    { t: 'A', kind: 'punct' },
  ])
  assert.deepEqual(model[0].chars, [{ c: '中', py: 'zhōng', tone: 1 }])
  assert.deepEqual(model.slice(1), [
    { kind: 'punct', text: ',' },
    { kind: 'punct', text: ' ' },
    { kind: 'punct', text: 'A' },
  ])
})

test('tokensToRuby: a word with no pinyin yields tone 0 (no color) per char', () => {
  const model = tokensToRuby([{ t: '〇', kind: 'char', py: '' }])
  assert.deepEqual(model[0].chars, [{ c: '〇', py: '', tone: 0 }])
})

test('containsHan: detects Chinese, rejects latin-only', () => {
  assert.equal(containsHan('你好'), true)
  assert.equal(containsHan('Hello world'), false)
  assert.equal(containsHan('mixed 中 text'), true)
  assert.equal(containsHan(''), false)
})

// ---- full subtitle line: segment + pinyin + ruby model -----------------------

test('subtitle line pipeline: segment + pinyin + ruby for a Chinese line', () => {
  const model = tokensToRuby(segmentText(DB, '我喜欢学习中文'))
  // every Han token is a word/char with per-character syllables; reconstructs input
  const text = model.map((m) => (m.kind === 'punct' ? m.text : m.chars.map((c) => c.c).join(''))).join('')
  assert.equal(text, '我喜欢学习中文')
  const xihuan = model.find((m) => m.word === '喜欢')
  assert.ok(xihuan, '喜欢 is segmented as one clickable word')
  assert.equal(xihuan.chars.length, 2)
  assert.ok(xihuan.chars[0].py.startsWith('xǐ'), 'pinyin is tone-marked')
  assert.ok(xihuan.chars[0].tone >= 1 && xihuan.chars[0].tone <= 5, 'tone class derived')
})

test('subtitle line pipeline: mixed Chinese/Latin keeps latin as plain punct', () => {
  const model = tokensToRuby(segmentText(DB, '你好 World'))
  const nihao = model.find((m) => m.word === '你好')
  assert.ok(nihao && nihao.chars.length === 2, '你好 rubied')
  // "World" survives as five punct tokens (one per latin letter) + a space
  const plain = model.filter((m) => m.kind === 'punct').map((m) => m.text).join('')
  assert.equal(plain, ' World')
})

// ---- cue parsing + time-window selection (Phase 2) ---------------------------

const J3 = {
  events: [
    { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '你好' }] },
    { tStartMs: 1000, dDurationMs: 1500, segs: [{ utf8: '世界' }] },
    { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: '再见' }] }, // gap 2.5s..5s
    { tStartMs: 6000, segs: [{ utf8: '\n' }] }, // whitespace-only -> dropped
  ],
}

test('parseJson3: builds sorted second-based cues, drops empty events', () => {
  const cues = parseJson3(J3)
  assert.equal(cues.length, 3, 'the newline-only event is dropped')
  assert.deepEqual(cues[0], { start: 0, end: 1, text: '你好' })
  assert.deepEqual(cues[1], { start: 1, end: 2.5, text: '世界' })
  assert.deepEqual(cues[2], { start: 5, end: 6, text: '再见' })
})

test('cueAt: picks the cue for a time, returns null in gaps and out of range', () => {
  const cues = parseJson3(J3)
  assert.equal(cueAt(cues, 0.5).cue.text, '你好')
  assert.equal(cueAt(cues, 1.0).cue.text, '世界', 'boundary belongs to the next cue')
  assert.equal(cueAt(cues, 3.5), null, 'in the 2.5s..5s gap -> nothing')
  assert.equal(cueAt(cues, 5.5).cue.text, '再见')
  assert.equal(cueAt(cues, 99), null, 'past the last cue -> nothing')
  assert.equal(cueAt([], 1), null)
})

test('cueAt: the hint index fast-path agrees with a cold scan', () => {
  const cues = parseJson3(J3)
  const cold = cueAt(cues, 1.2)
  const warm = cueAt(cues, 1.2, 0) // advancing from cue 0
  assert.equal(warm.cue.text, cold.cue.text)
  assert.equal(warm.idx, cold.idx)
})

test('cueAt: overlapping cues -> the freshest started one wins', () => {
  const overlap = [
    { start: 0, end: 4, text: 'long' },
    { start: 1, end: 2, text: 'short' },
  ]
  assert.equal(cueAt(overlap, 1.5).cue.text, 'short', 'newer overlapping cue is shown')
  assert.equal(cueAt(overlap, 3).cue.text, 'long', 'after the short one ends, the long one resumes')
})

// ---- track selection (Phase 2) ----------------------------------------------

test('pickTracks: prefers a human Chinese track for line 1, a different one for line 2', () => {
  const tracks = [
    { lang: 'en', name: 'English', kind: '' },
    { lang: 'zh-Hans', name: 'Chinese', kind: '' },
    { lang: 'fr', name: 'French', kind: '' },
  ]
  const { line1, line2 } = pickTracks(tracks, {})
  assert.equal(line1.lang, 'zh-Hans', 'Chinese floats to the annotated line')
  assert.ok(line2 && line2.lang !== 'zh-Hans', 'a second, different track fills line 2')
})

test('pickTracks: explicit language choices are honored', () => {
  const tracks = [
    { lang: 'en', name: 'English', kind: '' },
    { lang: 'zh-Hans', name: 'Chinese', kind: '' },
    { lang: 'ja', name: 'Japanese', kind: '' },
  ]
  const { line1, line2 } = pickTracks(tracks, { lang1: 'zh-Hans', lang2: 'ja' })
  assert.equal(line1.lang, 'zh-Hans')
  assert.equal(line2.lang, 'ja')
})

test('json3Url: asks for json3, optionally a machine translation, keeps base params', () => {
  const base = 'https://www.youtube.com/api/timedtext?v=abc&lang=zh-Hans&signature=xyz'
  const u = new URL(json3Url(base))
  assert.equal(u.searchParams.get('fmt'), 'json3')
  assert.equal(u.searchParams.get('lang'), 'zh-Hans', 'original params preserved')
  assert.equal(u.searchParams.get('signature'), 'xyz')
  assert.equal(u.searchParams.get('tlang'), null, 'no translation by default')
  // tlang requests YouTube's own machine translation (opt-in)
  assert.equal(new URL(json3Url(base, 'en')).searchParams.get('tlang'), 'en')
  assert.equal(json3Url(''), '', 'missing base -> empty')
})

test('pickTracks: ASR and auto-translation each gated by their own opt-in', () => {
  const tracks = [
    { lang: 'zh-Hans', name: 'Chinese', kind: '' },
    { lang: 'en', name: 'English (auto-generated)', kind: 'asr' },
    { lang: 'ja', name: 'Japanese (auto)', kind: 'auto' },
  ]
  const off = pickTracks(tracks, {})
  assert.equal(off.line1.lang, 'zh-Hans')
  assert.equal(off.line2, null, 'default is human tracks only -> no eligible second')

  // allowAsr admits the ASR track but NOT the auto-translation one
  const asr = pickTracks(tracks, { allowAsr: true })
  assert.ok(asr.line2 && asr.line2.kind === 'asr', 'ASR fills line 2 when allowAsr')

  // allowAutoTranslation admits the auto-translation track but NOT the ASR one
  const trans = pickTracks(tracks, { allowAutoTranslation: true })
  assert.ok(trans.line2 && trans.line2.kind === 'auto', 'auto-translation fills line 2 when allowAutoTranslation')

  // the two opt-ins are independent: ASR on, translation off -> the 'auto' track stays excluded
  const onlyAsr = pickTracks([
    { lang: 'zh-Hans', name: 'Chinese', kind: '' },
    { lang: 'ja', name: 'Japanese (auto)', kind: 'auto' },
  ], { allowAsr: true })
  assert.equal(onlyAsr.line2, null, 'allowAsr must not admit an auto-translation track')
})
