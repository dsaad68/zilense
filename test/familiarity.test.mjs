import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getFamiliarity,
  setFamiliarityState,
  bumpFamiliarity,
  loadFamiliarity,
  saveFamiliarity,
  DEFAULT_FAMILIARITY,
} from '../src/lib/storage.js'

const FAMILIARITY_KEY = 'mydict.familiarity'

// in-memory localStorage stub: storage.js has no `chrome` global under node, so
// loadFamiliarity / saveFamiliarity deterministically take the localStorage branch.
function stubLocalStorage(initial) {
  const store = new Map(initial ? Object.entries(initial) : [])
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  return store
}

test('getFamiliarity: an absent word defaults to "new" without writing', () => {
  const map = {}
  assert.deepEqual(getFamiliarity(map, '你好'), DEFAULT_FAMILIARITY)
  assert.deepEqual(getFamiliarity(map, '你好'), { state: 'new', seen: 0, lastSeen: 0 })
  assert.deepEqual(map, {}, 'reading a missing word does not add it')
  // a null / undefined map is tolerated
  assert.deepEqual(getFamiliarity(null, '你好'), DEFAULT_FAMILIARITY)
})

test('getFamiliarity: corrupted entries fall back gracefully', () => {
  const map = {
    a: 'not-an-object',
    b: { state: 'bogus', seen: -3, lastSeen: 'x' },
    c: { state: 'known', seen: 4.9, lastSeen: 123 },
  }
  assert.deepEqual(getFamiliarity(map, 'a'), { state: 'new', seen: 0, lastSeen: 0 })
  assert.deepEqual(getFamiliarity(map, 'b'), { state: 'new', seen: 0, lastSeen: 0 })
  // valid-ish entry: state kept, seen floored, lastSeen kept
  assert.deepEqual(getFamiliarity(map, 'c'), { state: 'known', seen: 4, lastSeen: 123 })
})

test('bumpFamiliarity: increments seen, stamps lastSeen, preserves state, is pure', () => {
  const map = {}
  const m1 = bumpFamiliarity(map, '中国', 1000)
  assert.deepEqual(m1['中国'], { state: 'new', seen: 1, lastSeen: 1000 })
  assert.deepEqual(map, {}, 'input map is not mutated')

  const m2 = bumpFamiliarity(m1, '中国', 2000)
  assert.deepEqual(m2['中国'], { state: 'new', seen: 2, lastSeen: 2000 })
  assert.equal(m1['中国'].seen, 1, 'previous map is unchanged')
})

test('bumpFamiliarity: never auto-promotes a user-set state', () => {
  let map = setFamiliarityState({}, '学习', 'known')
  map = bumpFamiliarity(map, '学习', 5)
  map = bumpFamiliarity(map, '学习', 6)
  assert.equal(map['学习'].state, 'known', 'lookups must not change the state the user chose')
  assert.equal(map['学习'].seen, 2)
  assert.equal(map['学习'].lastSeen, 6)
})

test('setFamiliarityState: sets state, keeps seen/lastSeen, coerces unknown -> new, is pure', () => {
  const seen = bumpFamiliarity({}, '猫', 42) // seen:1, lastSeen:42, state:new
  const learning = setFamiliarityState(seen, '猫', 'learning')
  assert.deepEqual(learning['猫'], { state: 'learning', seen: 1, lastSeen: 42 })
  assert.equal(seen['猫'].state, 'new', 'input map is not mutated')

  const coerced = setFamiliarityState({}, '猫', 'wat')
  assert.equal(coerced['猫'].state, 'new')
  // a falsy word is a no-op
  assert.deepEqual(setFamiliarityState({ x: 1 }, '', 'known'), { x: 1 })
})

test('familiarity: state transitions persist across save/load', async () => {
  stubLocalStorage()
  let map = await loadFamiliarity()
  assert.deepEqual(map, {}, 'empty store reads as no familiarity')
  map = bumpFamiliarity(map, '你好', 100)
  map = setFamiliarityState(map, '你好', 'known')
  await saveFamiliarity(map)

  const reloaded = await loadFamiliarity()
  assert.deepEqual(getFamiliarity(reloaded, '你好'), { state: 'known', seen: 1, lastSeen: 100 })
})

test('loadFamiliarity: missing / corrupt / wrong-type values read as empty', async () => {
  stubLocalStorage()
  assert.deepEqual(await loadFamiliarity(), {})
  stubLocalStorage({ [FAMILIARITY_KEY]: 'not json' })
  assert.deepEqual(await loadFamiliarity(), {})
  stubLocalStorage({ [FAMILIARITY_KEY]: '[1,2,3]' }) // an array is not a valid map
  assert.deepEqual(await loadFamiliarity(), {})
})

test('saveFamiliarity: only writes mydict.familiarity, leaving other mydict.* keys intact', async () => {
  const store = stubLocalStorage({
    'mydict.saved': JSON.stringify(['你好']),
    'mydict.settings': JSON.stringify({ dark: true }),
  })
  await saveFamiliarity(bumpFamiliarity({}, '你好', 7))
  // the saved deck and settings are untouched
  assert.deepEqual(JSON.parse(store.get('mydict.saved')), ['你好'])
  assert.deepEqual(JSON.parse(store.get('mydict.settings')), { dark: true })
  // and exactly one new key was written
  assert.ok(store.has(FAMILIARITY_KEY))
  assert.deepEqual(JSON.parse(store.get(FAMILIARITY_KEY))['你好'], { state: 'new', seen: 1, lastSeen: 7 })
})
