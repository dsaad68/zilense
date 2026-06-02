import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toggleSite,
  saveSettingsPatch,
  DEFAULT_SETTINGS,
  saveReaderPrefs,
  loadReaderPrefs,
  READER_DEFAULTS,
} from '../src/lib/storage.js'

const SETTINGS_KEY = 'mydict.settings'
const READER_KEY = 'mydict.reader'

// in-memory localStorage stub: storage.js has no `chrome` global under node, so
// saveSettingsPatch deterministically takes the localStorage branch — the same
// read-modify-write merge it uses in the chrome branch.
function stubLocalStorage(initial) {
  const store = new Map(initial ? Object.entries(initial) : [])
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  return store
}

test('toggleSite: adds a hostname when absent', () => {
  assert.deepEqual(toggleSite([], 'example.com'), ['example.com'])
  assert.deepEqual(toggleSite(['a.com'], 'b.com'), ['a.com', 'b.com'])
})

test('toggleSite: removes a hostname when present', () => {
  assert.deepEqual(toggleSite(['example.com'], 'example.com'), [])
  assert.deepEqual(toggleSite(['a.com', 'b.com'], 'a.com'), ['b.com'])
})

test('toggleSite: leaves other hosts untouched and returns a new array', () => {
  const list = ['a.com', 'b.com']
  const next = toggleSite(list, 'c.com')
  assert.deepEqual(next, ['a.com', 'b.com', 'c.com'])
  assert.deepEqual(list, ['a.com', 'b.com'], 'input array is not mutated')
})

test('toggleSite: a falsy host is a no-op', () => {
  const list = ['a.com']
  assert.equal(toggleSite(list, ''), list)
  assert.equal(toggleSite(list, undefined), list)
})

test('saveSettingsPatch: two sequential patches both persist (no clobber)', async () => {
  // mirrors the toolbar popup toggling two switches in one session: each call
  // must merge onto the CURRENT stored settings, not a stale snapshot.
  const store = stubLocalStorage()
  await saveSettingsPatch({ inlinePopup: false })
  await saveSettingsPatch({ hskColorByLevel: true })
  const got = JSON.parse(store.get(SETTINGS_KEY))
  assert.equal(got.inlinePopup, false, 'first patch survives the second write')
  assert.equal(got.hskColorByLevel, true, 'second patch is applied')
  // untouched fields keep their defaults
  assert.equal(got.pinKey, DEFAULT_SETTINGS.pinKey)
})

test('saveSettingsPatch: merges onto existing stored settings', async () => {
  const store = stubLocalStorage({ [SETTINGS_KEY]: JSON.stringify({ accent: '#123456' }) })
  const merged = await saveSettingsPatch({ dark: true })
  assert.equal(merged.accent, '#123456', 'pre-existing field is preserved')
  assert.equal(merged.dark, true, 'patch is applied')
  assert.deepEqual(JSON.parse(store.get(SETTINGS_KEY)), merged)
})

test('reader prefs: loadReaderPrefs returns defaults when nothing is stored', async () => {
  stubLocalStorage()
  assert.deepEqual(await loadReaderPrefs(), READER_DEFAULTS)
})

test('reader prefs: two sequential patches both persist (no clobber)', async () => {
  // mirrors toggling two controls in the reader's Aa menu in one session — each
  // save must merge onto the CURRENT stored prefs, not a stale snapshot.
  const store = stubLocalStorage()
  await saveReaderPrefs({ theme: 'dark' })
  await saveReaderPrefs({ font: 'serif' })
  const got = JSON.parse(store.get(READER_KEY))
  assert.equal(got.theme, 'dark', 'first patch survives the second write')
  assert.equal(got.font, 'serif', 'second patch is applied')
  assert.equal(got.size, READER_DEFAULTS.size, 'untouched field keeps its default')
})

test('reader prefs: loadReaderPrefs merges stored over defaults', async () => {
  stubLocalStorage({ [READER_KEY]: JSON.stringify({ size: 30, width: 'wide' }) })
  const p = await loadReaderPrefs()
  assert.equal(p.size, 30, 'stored field wins')
  assert.equal(p.width, 'wide')
  assert.equal(p.pinyin, READER_DEFAULTS.pinyin, 'unstored field falls back to default')
})
