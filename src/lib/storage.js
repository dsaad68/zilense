/* storage.js — chrome.storage.local wrapper for the saved deck and panel
   settings (replaces the prototype's localStorage). Falls back to localStorage
   when chrome.storage is unavailable (e.g. running the panel outside an
   extension during plain `vite preview`). */

const SAVED_KEY = 'mydict.saved'
const SETTINGS_KEY = 'mydict.settings'
const HISTORY_KEY = 'mydict.history'
const DISABLED_KEY = 'mydict.disabledSites'
const PENDING_KEY = 'mydict.pendingLookup'
const READER_KEY = 'mydict.reader'
const SUBS_KEY = 'mydict.subs'

const HISTORY_MAX = 100 // cap recent lookups so the list stays bounded

export const DEFAULT_SETTINGS = {
  accent: '#c8443a',
  hanFont: 'sans', // 'sans' | 'serif'
  toneColors: true,
  showTrad: true, // show the traditional form (繁) beside simplified headwords
  inlinePopup: true, // show a small on-page popup near the hovered word
  pinKey: 'p', // press this key while hovering a word to pin it (works on links)
  hskFirst: false, // show the official HSK gloss above the CC-CEDICT defs
  hskColorByLevel: false, // "highlight HSK ≤ N": color matches by band vs one color
  dark: false,
}

const hasChrome =
  typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local

function getLocal(keys) {
  return new Promise((res) => chrome.storage.local.get(keys, res))
}
function setLocal(obj) {
  return new Promise((res) => chrome.storage.local.set(obj, res))
}

export async function loadState() {
  if (hasChrome) {
    const got = await getLocal([SAVED_KEY, SETTINGS_KEY, HISTORY_KEY])
    return {
      saved: Array.isArray(got[SAVED_KEY]) ? got[SAVED_KEY] : [],
      settings: { ...DEFAULT_SETTINGS, ...(got[SETTINGS_KEY] || {}) },
      history: Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : [],
    }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]')
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return {
      saved: Array.isArray(saved) ? saved : [],
      settings: { ...DEFAULT_SETTINGS, ...settings },
      history: Array.isArray(history) ? history : [],
    }
  } catch {
    return { saved: [], settings: { ...DEFAULT_SETTINGS }, history: [] }
  }
}

export async function saveSaved(saved) {
  if (hasChrome) return setLocal({ [SAVED_KEY]: saved })
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)) } catch {}
}

export async function saveHistory(history) {
  if (hasChrome) return setLocal({ [HISTORY_KEY]: history })
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)) } catch {}
}

/* prepend a deliberate lookup to the recent-history list: newest first, drop an
   immediate duplicate of the same word, and cap the length. Returns a new array
   (callers feed it straight into setHistory / saveHistory). `t` is a timestamp. */
export function pushHistory(history, q, t) {
  if (!q) return history
  const rest = history.filter((h) => h.q !== q)
  return [{ q, t: t || 0 }, ...rest].slice(0, HISTORY_MAX)
}

/* Per-site hover disable. The toolbar popup adds/removes the current hostname
   here; the content script reads it and skips its hover path on listed sites
   (selection + pinning still work). Stored as a plain hostname array under the
   mydict.* namespace. */
export async function loadDisabledSites() {
  if (hasChrome) {
    const got = await getLocal([DISABLED_KEY])
    return Array.isArray(got[DISABLED_KEY]) ? got[DISABLED_KEY] : []
  }
  try {
    const v = JSON.parse(localStorage.getItem(DISABLED_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

export async function saveDisabledSites(list) {
  if (hasChrome) return setLocal({ [DISABLED_KEY]: list })
  try { localStorage.setItem(DISABLED_KEY, JSON.stringify(list)) } catch {}
}

/* Toggle a hostname in the disabled-sites list: add it if absent, remove it if
   present. Pure (returns a new array) so it's unit-testable; falsy host is a
   no-op. */
export function toggleSite(list, host) {
  if (!host) return list
  return list.includes(host) ? list.filter((h) => h !== host) : [...list, host]
}

export async function saveSettings(settings) {
  if (hasChrome) return setLocal({ [SETTINGS_KEY]: settings })
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch {}
}

/* Merge a partial settings change into whatever is CURRENTLY stored, instead of
   spreading a snapshot read earlier. The toolbar popup loads settings once on
   open, so writing `{ ...snapshot, field }` for each control would revert other
   fields the snapshot didn't know about — another popup control, or a change the
   side panel made while the popup was open. Read-modify-write here keeps every
   field current. Returns the merged settings. */
export async function saveSettingsPatch(patch) {
  if (hasChrome) {
    const got = await getLocal([SETTINGS_KEY])
    const merged = { ...DEFAULT_SETTINGS, ...(got[SETTINGS_KEY] || {}), ...patch }
    await setLocal({ [SETTINGS_KEY]: merged })
    return merged
  }
  let current = {}
  try { current = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } catch {}
  const merged = { ...DEFAULT_SETTINGS, ...current, ...patch }
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)) } catch {}
  return merged
}

/* Reader-mode appearance preferences, kept separate from the dictionary settings
   (different surface, different lifecycle) but in the same mydict.* namespace and
   the same chrome.storage.local the rest of the extension uses — the design
   prototype persisted these under raw localStorage 'mydict.reader'. Same
   read-modify-write merge as saveSettingsPatch so toggling one control never
   clobbers another. */
export const READER_DEFAULTS = {
  font: 'sans', // 'sans' | 'serif'  (Noto Sans SC / Noto Serif SC)
  size: 24, // body text px (18–60)
  width: 'medium', // 'narrow' | 'medium' | 'wide'  column width
  theme: 'paper', // 'paper' | 'sepia' | 'dark'
  pinyin: true, // show ruby pinyin above each character
  tones: true, // color the pinyin by tone
}

export async function loadReaderPrefs() {
  if (hasChrome) {
    const got = await getLocal([READER_KEY])
    return { ...READER_DEFAULTS, ...(got[READER_KEY] || {}) }
  }
  try {
    return { ...READER_DEFAULTS, ...JSON.parse(localStorage.getItem(READER_KEY) || '{}') }
  } catch {
    return { ...READER_DEFAULTS }
  }
}

export async function saveReaderPrefs(patch) {
  if (hasChrome) {
    const got = await getLocal([READER_KEY])
    const merged = { ...READER_DEFAULTS, ...(got[READER_KEY] || {}), ...patch }
    await setLocal({ [READER_KEY]: merged })
    return merged
  }
  let current = {}
  try { current = JSON.parse(localStorage.getItem(READER_KEY) || '{}') } catch {}
  const merged = { ...READER_DEFAULTS, ...current, ...patch }
  try { localStorage.setItem(READER_KEY, JSON.stringify(merged)) } catch {}
  return merged
}

/* Dual-subtitle preferences. The on-video subtitle overlay (pinyin + clickable
   words, and the two-track view) is OFF by default and independently toggleable
   from the dictionary itself, so it lives under its own mydict.subs key rather
   than mixing into mydict.settings. Same read-modify-write merge as the reader so
   toggling one control never clobbers another. `lang1`/`lang2` hold the two
   chosen caption language codes for the Phase 2 dual-track view (empty = auto:
   the displayed track for line 1, none for line 2). */
export const SUBS_DEFAULTS = {
  enabled: false, // master switch for the whole subtitle feature
  pinyin: true, // ruby pinyin above the Chinese line
  tones: true, // color the pinyin by tone
  dual: true, // when two tracks are available, show both stacked
  lang1: '', // preferred language code for the top (annotated) line
  lang2: '', // preferred language code for the bottom line
  // the two machine-track opt-ins, split so the user can accept one without the
  // other: ASR is YouTube's auto-SPEECH-recognition captions; autoTranslation is
  // its machine translation of a track into another language. Both default off
  // (human-authored tracks only).
  allowAsr: false,
  allowAutoTranslation: false,
}

/* migrateSubs(obj) — fold the legacy single `allowAuto` flag (which conflated ASR
   and auto-translation) into the two split flags, so an existing opt-in survives the
   rename. Only applies when the new keys aren't already stored. Returns a clean
   object without the legacy key. */
function migrateSubs(obj) {
  const o = { ...obj }
  if ('allowAuto' in o) {
    if (!('allowAsr' in o)) o.allowAsr = !!o.allowAuto
    if (!('allowAutoTranslation' in o)) o.allowAutoTranslation = !!o.allowAuto
    delete o.allowAuto
  }
  return o
}

export async function loadSubsPrefs() {
  if (hasChrome) {
    const got = await getLocal([SUBS_KEY])
    return { ...SUBS_DEFAULTS, ...migrateSubs(got[SUBS_KEY] || {}) }
  }
  try {
    return { ...SUBS_DEFAULTS, ...migrateSubs(JSON.parse(localStorage.getItem(SUBS_KEY) || '{}')) }
  } catch {
    return { ...SUBS_DEFAULTS }
  }
}

export async function saveSubsPrefs(patch) {
  if (hasChrome) {
    const got = await getLocal([SUBS_KEY])
    const merged = { ...SUBS_DEFAULTS, ...migrateSubs(got[SUBS_KEY] || {}), ...patch }
    await setLocal({ [SUBS_KEY]: merged })
    return merged
  }
  let current = {}
  try { current = JSON.parse(localStorage.getItem(SUBS_KEY) || '{}') } catch {}
  const merged = { ...SUBS_DEFAULTS, ...migrateSubs(current), ...patch }
  try { localStorage.setItem(SUBS_KEY, JSON.stringify(merged)) } catch {}
  return merged
}

/* Pending context-menu lookup. The service worker stashes the selected text here
   when it opens the panel, so a cold panel (whose message listener isn't ready
   yet) still picks the query up on mount — no fragile fixed-delay sendMessage.
   Prefers chrome.storage.session (cleared when the browser session ends). */
const session =
  typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session
    ? chrome.storage.session
    : typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
      ? chrome.storage.local
      : null

export async function setPendingLookup(q) {
  if (!session || !q) return
  await new Promise((res) => session.set({ [PENDING_KEY]: { q, t: 1 } }, res))
}

/* Reader article hand-off. The Reader page is web-accessible, and while it's open
   its parent window is the host page — so trusting a parent→iframe postMessage for
   the article means a hostile page could forge one. Instead the (trusted) service
   worker stashes the content-script-extracted article in chrome.storage.session
   under a random nonce; the nonce travels in the iframe URL hash and the Reader
   page fetches it back through the worker. The host page can neither read nor write
   extension session storage, so it's out of the trust path entirely.

   Each stash is wrapped as { a: article, t: timestamp } and is read-once. Because a
   stash can be orphaned (the iframe never loads, crashes, or is closed before it
   fetches), every new stash first sweeps any entry older than READER_ART_TTL, and a
   take past the TTL is treated as missing — so a failed open can't leave an article
   sitting in session storage until the browser closes. */
const READER_ART_PREFIX = 'mydict.reader.article.'
const READER_ART_TTL = 5 * 60 * 1000 // 5 min — far longer than the read happens after

// drop stashed articles older than the TTL (or any malformed/legacy entries)
async function sweepReaderArticles(now) {
  if (!session) return
  const all = await new Promise((res) => session.get(null, res))
  const stale = Object.keys(all || {}).filter((k) => {
    if (!k.startsWith(READER_ART_PREFIX)) return false
    const rec = all[k]
    return !rec || typeof rec.t !== 'number' || now - rec.t > READER_ART_TTL
  })
  if (stale.length) await new Promise((res) => session.remove(stale, res))
}

export async function stashReaderArticle(article) {
  if (!session) return ''
  const now = Date.now()
  await sweepReaderArticles(now) // clear orphaned stashes from earlier failed opens
  const nonce =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'r' + now + Math.random().toString(36).slice(2)
  await new Promise((res) => session.set({ [READER_ART_PREFIX + nonce]: { a: article || {}, t: now } }, res))
  return nonce
}

export async function takeReaderArticle(nonce) {
  if (!session || !nonce) return null
  const key = READER_ART_PREFIX + nonce
  const got = await new Promise((res) => session.get([key], res))
  const rec = got && got[key]
  if (rec) await new Promise((res) => session.remove(key, res)) // read-once
  if (!rec || typeof rec.t !== 'number' || Date.now() - rec.t > READER_ART_TTL) return null
  return rec.a || null
}

// explicit cleanup when an open is aborted after stashing but before the iframe
// can fetch (e.g. the reader was closed mid-stash) — so it isn't left for the sweep
export async function clearReaderArticle(nonce) {
  if (!session || !nonce) return
  await new Promise((res) => session.remove(READER_ART_PREFIX + nonce, res))
}

export async function takePendingLookup() {
  if (!session) return null
  const got = await new Promise((res) => session.get([PENDING_KEY], res))
  const pending = got && got[PENDING_KEY]
  if (!pending) return null
  await new Promise((res) => session.remove(PENDING_KEY, res)) // read-once
  return pending.q || null
}
