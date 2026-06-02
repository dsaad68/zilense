import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMeaningGroups } from '../src/sidepanel/meanings.js'

// a fully-populated entry: 1 HSK sense, 3 CC-CEDICT defs, 2 alternate readings
const FULL = {
  q: '会',
  defs: ['can', 'meeting', 'to be able to'],
  hskSenses: [{ lvl: 1, pos: 'verb', def: 'can; to be able to' }],
  alts: [
    { pinyin: 'kuài', defs: ['to balance an account'] },
    { pinyin: 'huì', defs: ['moment'] },
  ],
}

test('hskFirst=true → HSK, CC-CEDICT, Other with continuous numbering', () => {
  const g = buildMeaningGroups(FULL, true)
  assert.deepEqual(g.map((x) => x.kind), ['hsk', 'cc', 'alt'])
  assert.deepEqual(g.map((x) => x.label), ['HSK', 'CC-CEDICT', 'Other'])
  // numbering runs 1,2,3,4,5,6 → starts at 1 / 2 / 5
  assert.deepEqual(g.map((x) => x.start), [1, 2, 5])
  assert.deepEqual(g.map((x) => x.count), [1, 3, 2])
})

test('hskFirst=false → CC-CEDICT, HSK, Other with continuous numbering', () => {
  const g = buildMeaningGroups(FULL, false)
  assert.deepEqual(g.map((x) => x.kind), ['cc', 'hsk', 'alt'])
  assert.deepEqual(g.map((x) => x.label), ['CC-CEDICT', 'HSK', 'Other'])
  // CC-CEDICT 1,2,3 → HSK 4 → Other 5,6
  assert.deepEqual(g.map((x) => x.start), [1, 4, 5])
})

test('Other (alts) always comes last, regardless of hskFirst', () => {
  assert.equal(buildMeaningGroups(FULL, true).at(-1).kind, 'alt')
  assert.equal(buildMeaningGroups(FULL, false).at(-1).kind, 'alt')
})

test('empty groups are dropped', () => {
  const ccOnly = { defs: ['water', 'river'] }
  const g = buildMeaningGroups(ccOnly, true)
  assert.deepEqual(g.map((x) => x.kind), ['cc'])
  assert.equal(g[0].start, 1)
  assert.equal(g[0].count, 2)
})

test('HSK-only entry numbers from 1', () => {
  const hskOnly = { hskSenses: [{ lvl: 2, def: 'to study' }, { lvl: 2, def: 'to learn' }] }
  const g = buildMeaningGroups(hskOnly, false) // hskFirst false, but no CC-CEDICT
  assert.deepEqual(g.map((x) => x.kind), ['hsk'])
  assert.equal(g[0].start, 1)
  assert.equal(g[0].count, 2)
})

test('no meanings → no groups', () => {
  assert.deepEqual(buildMeaningGroups({ q: '中' }, true), [])
  assert.deepEqual(buildMeaningGroups(null, false), [])
})
