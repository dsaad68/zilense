/* engine.js — the on-video subtitle runtime. Loaded on demand by index.js only on
   a supported video page with the feature ON, so the all-frames content bundle
   never pays for it. It owns the overlay lifecycle, the native-caption hide, and
   two ways of feeding the overlay:

     Phase 1 (scrape): a MutationObserver reads whatever single track the player is
       already showing and re-renders it with pinyin + clickable words.
     Phase 2 (dual): on YouTube it asks the MAIN-world hook for the caption track
       list, fetches TWO real tracks (json3 timedtext, same-origin on youtube.com —
       no host permission, no machine translation unless the user opts in), and
       syncs both cue lists to the video clock. Falls back to scrape when a video
       has fewer than two usable tracks (we never synthesize a second line).

   All dictionary work is delegated to the service worker exactly as the reader
   does it: `segment` for tokens+pinyin, `hover` for the card / live panel sync,
   `open-panel` to pin a clicked word. The content script keeps no dictionary copy. */

import { createOverlay, applyNativeHide, removeNativeHide } from './overlay.js'
import { detectPlatform } from './platforms.js'
import { parseJson3, cueAt, pickTracks, json3Url } from './subs-core.js'
import { saveSubsPrefs } from '../../lib/storage.js'

// ---- worker bridge (same messages the reader/content driver use) ------------
function requestSegment(text) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'segment', paras: [text] }, (resp) => {
        if (chrome.runtime.lastError || !resp || !Array.isArray(resp.paras)) { resolve([]); return }
        resolve(resp.paras[0] || [])
      })
    } catch (e) { resolve([]) }
  })
}
function requestHover(word) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'hover', text: word }, (resp) =>
        resolve(chrome.runtime.lastError ? null : (resp || null)))
    } catch (e) { resolve(null) }
  })
}
function onPin(q) {
  if (!q) return
  try { chrome.runtime.sendMessage({ type: 'open-panel', q }, () => void chrome.runtime.lastError) } catch (e) {}
}

const ENSURE_MS = 700 // re-attach cadence (SPA nav, captions toggled, player swap)
const MAX_ACQ_TRIES = 6 // bounded dual-track probes per video (~4s) so a 1-track or
//                         no-caption video isn't re-requested on every ensure tick
const EV_REQ = 'zilense-subs-yt-req' // -> MAIN-world hook
const EV_TRACKS = 'zilense-subs-yt-tracks' // <- MAIN-world hook
const EV_TT = 'zilense-subs-yt-timedtext' // <- MAIN-world hook: a captured timedtext URL

// ask the MAIN-world hook for the caption track list; resolve with the parsed reply
// or null on timeout. One-shot listener per call.
function requestYtTracks(timeoutMs = 1500) {
  return new Promise((resolve) => {
    let done = false
    const finish = (val) => { if (done) return; done = true; document.removeEventListener(EV_TRACKS, onReply); resolve(val) }
    const onReply = (e) => { try { finish(JSON.parse(e.detail)) } catch (err) { finish(null) } }
    document.addEventListener(EV_TRACKS, onReply)
    try { document.dispatchEvent(new CustomEvent(EV_REQ)) } catch (e) {}
    setTimeout(() => finish(null), timeoutMs)
  })
}

// fetch + parse one track into a cue list. SAME-ORIGIN ONLY: we refuse to fetch a
// cross-origin timedtext URL so the feature never needs a host permission (a
// youtube-nocookie embed's tracks live on a different origin — those stay Phase 1).
async function fetchCues(baseUrl, tlang) {
  const url = json3Url(baseUrl, tlang)
  if (!url) return []
  try {
    if (new URL(url).origin !== location.origin) return [] // refuse cross-origin
    const r = await fetch(url, { credentials: 'omit' })
    if (!r.ok) return []
    return parseJson3(await r.json())
  } catch (e) { return [] }
}

// opt-in console diagnostics: set `localStorage.zilenseSubsDebug = '1'` on the video
// page and reload, then watch the console for `[zilense subs]` lines explaining why
// dual did or didn't engage. Off (silent) otherwise.
const DEBUG = (() => {
  try { return typeof localStorage !== 'undefined' && !!localStorage.getItem('zilenseSubsDebug') } catch (e) { return false }
})()
const dbg = (...a) => { if (DEBUG) { try { console.info('[zilense subs]', ...a) } catch (e) {} } }

export function createEngine(adapter) {
  let overlay = null
  let observer = null
  let observedRoot = null
  let ensureTimer = 0
  let rafPending = false
  let prefs = { pinyin: true, tones: true, dual: true, lang1: '', lang2: '', allowAsr: false, allowAutoTranslation: false }
  let running = false
  let onNav = null

  let mode = 'scrape' // 'scrape' (Phase 1) | 'dual' (Phase 2)
  let acquiring = false
  let acqVideo = null // the video id the current acquire attempts belong to
  let acqTries = 0 // attempts spent on acqVideo (bounded by MAX_ACQ_TRIES)
  let cues1 = [], cues2 = []
  let idx1 = -1, idx2 = -1
  let syncRaf = 0
  let trackList = null // { tracks, targets } from the hook, for the picker
  let curLang1 = '', curLang2 = '' // languages currently displayed (for the picker)
  let lastTT = '' // the most recent timedtext URL the player itself fetched (hook
  //                capture), used as a fallback when a track's baseUrl goes stale
  let onTT = null // EV_TT listener handle (added in start, removed in stop)

  // dual track fetching is same-origin youtube.com only (the desktop watch page);
  // m.youtube.com / nocookie embeds keep Phase 1 scraping
  const canFetch = () => /^(www\.)?youtube\.com$/i.test(location.hostname)

  // ---- scrape mode (Phase 1) --------------------------------------------------
  function syncFromDom() {
    if (!overlay) return
    const root = adapter.getCaptionRoot()
    overlay.setLine1(root ? adapter.readActiveText(root) : '')
  }
  const scheduleSync = () => {
    if (rafPending) return
    rafPending = true
    requestAnimationFrame(() => { rafPending = false; if (running && mode === 'scrape') syncFromDom() })
  }
  function attachObserver(root) {
    if (observer && observedRoot === root) return
    detachObserver()
    observedRoot = root
    if (!root) return
    observer = new MutationObserver(scheduleSync)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    scheduleSync()
  }
  function detachObserver() {
    if (observer) { observer.disconnect(); observer = null }
    observedRoot = null
  }

  // ---- dual mode (Phase 2) ----------------------------------------------------
  // resolve the two display tracks from the list + prefs. All the selection logic
  // (Chinese on top, the chosen/English second line, dual-implies-auto, and machine
  // translation) lives in the pure pickTracks helper; targets carry the languages
  // YouTube can auto-translate into. A line may be a real track or a translation
  // descriptor { lang, baseUrl, tlang }.
  function resolveLines(list, p) {
    const { line1, line2 } = pickTracks(list.tracks || [], p, list.targets || [])
    return { l1: line1, l2: line2 }
  }

  // build a json3 fetch URL from the URL the player ITSELF fetched (captured by the
  // hook). That URL carries the valid pot/signature params that a bare
  // captionTracks[].baseUrl now lacks — YouTube increasingly returns an empty body
  // for the raw baseUrl — so we reuse the captured URL and just swap fmt/lang/tlang.
  // For a translation we keep the player's signed source and only add &tlang; for a
  // specific real track we set &lang (works because lang/tlang aren't in the
  // signature). Returns '' when nothing has been captured yet (captions still off).
  function playerCueUrl(track) {
    if (!lastTT) return ''
    try {
      const u = new URL(lastTT, location.origin)
      u.searchParams.set('fmt', 'json3')
      if (track.tlang) u.searchParams.set('tlang', track.tlang)
      else { u.searchParams.set('lang', track.lang); u.searchParams.delete('tlang') }
      return u.toString()
    } catch (e) { return '' }
  }

  // load one line's cues: prefer the player-derived URL (valid pot/signature), fall
  // back to the raw baseUrl. Same-origin is enforced inside fetchCues.
  async function loadCues(track) {
    let cues = []
    const viaPlayer = playerCueUrl(track)
    if (viaPlayer) { cues = await fetchCues(viaPlayer, ''); dbg('loadCues viaPlayer', track.lang, track.tlang || '', '→', cues.length) }
    if (!cues.length) { cues = await fetchCues(track.baseUrl, track.tlang); dbg('loadCues baseUrl', track.lang, track.tlang || '', '→', cues.length) }
    return cues
  }

  async function acquireDual(videoId) {
    if (acquiring) return
    acquiring = true
    // bail if a newer SPA navigation happened while we were awaiting (so we never
    // enter dual with the previous video's cues)
    const stale = () => !running || (adapter.getVideoId && adapter.getVideoId() !== videoId)
    try {
      const list = await requestYtTracks()
      if (stale()) return
      if (!list || !Array.isArray(list.tracks) || !list.tracks.length) { dbg('no tracks from hook → stay scrape'); return }
      if (typeof list.timedtext === 'string' && list.timedtext) lastTT = list.timedtext
      trackList = { tracks: list.tracks, targets: Array.isArray(list.targets) ? list.targets : [] }
      dbg('tracks', list.tracks.map((t) => t.lang + (t.kind ? ':' + t.kind : '')).join(','),
        '| targets', (list.targets || []).length, '| capturedURL', !!lastTT)
      const { l1, l2 } = resolveLines(trackList, prefs)
      dbg('resolved top', l1 && (l1.lang + (l1.tlang ? '→' + l1.tlang : '')), '| bottom', l2 && (l2.lang + (l2.tlang ? '→' + l2.tlang : '')))
      // the dual VIEW needs two lines; with only one usable track we leave Phase 1
      // scraping in place (we never synthesize a second line), but still offer the
      // language picker so the user can pick a (real or, if opted in, auto) second.
      if (!l1 || !l2) { dbg('only one line resolved → stay scrape'); acqTries = MAX_ACQ_TRIES; renderControls(l1 ? l1.lang : '', l2 ? l2.lang : ''); return }
      const [c1, c2] = await Promise.all([loadCues(l1), loadCues(l2)])
      if (stale()) return
      // the dual view shows TWO synced lines; if either track came back empty we
      // can't honestly render it, so we stay in Phase 1 scrape (and retry up to the
      // cap) rather than hide the native captions behind a single-line overlay.
      if (!c1.length || !c2.length) { dbg('a line had no cues (top', c1.length, 'bottom', c2.length, ') → stay scrape; turn YouTube captions ON if off'); return }
      cues1 = c1; cues2 = c2; idx1 = -1; idx2 = -1
      enterDual()
      dbg('ENTER DUAL', l1.lang, '/', l2.lang + (l2.tlang ? '(translated)' : ''))
      renderControls(l1.lang, l2.lang)
    } finally { acquiring = false }
  }

  function renderControls(lang1, lang2) {
    if (!overlay) return
    curLang1 = lang1; curLang2 = lang2
    overlay.setControls(trackList ? {
      tracks: trackList.tracks, targets: trackList.targets,
      lang1, lang2,
      // dual implies auto, so the picker lists ASR + translation languages too
      allowAsr: prefs.allowAsr || prefs.dual, allowAutoTranslation: prefs.allowAutoTranslation || prefs.dual,
      // persist the change; it round-trips storage -> index -> setPrefs, which
      // re-picks + re-fetches, so storage stays the single source of truth
      onChange: (patch) => saveSubsPrefs(patch),
    } : null)
  }

  function enterDual() {
    mode = 'dual'
    detachObserver() // stop scraping; the cue clock drives the lines now
    if (overlay) overlay.clear()
    startSync()
  }
  function exitDual() {
    stopSync()
    mode = 'scrape'
    cues1 = []; cues2 = []; idx1 = -1; idx2 = -1
    if (overlay) { overlay.clear(); overlay.setControls(null) }
  }

  function startSync() {
    stopSync()
    const tick = () => {
      if (!running || mode !== 'dual') return
      const v = adapter.getVideo()
      if (v) {
        const t = v.currentTime || 0
        const r1 = cueAt(cues1, t, idx1)
        if (r1) { if (r1.idx !== idx1) { idx1 = r1.idx; overlay.setLine1(r1.cue.text) } }
        else if (idx1 !== -1) { idx1 = -1; overlay.setLine1('') }
        const r2 = cueAt(cues2, t, idx2)
        if (r2) { if (r2.idx !== idx2) { idx2 = r2.idx; overlay.setLine2(r2.cue.text) } }
        else if (idx2 !== -1) { idx2 = -1; overlay.setLine2('') }
      }
      syncRaf = requestAnimationFrame(tick)
    }
    syncRaf = requestAnimationFrame(tick)
  }
  function stopSync() { if (syncRaf) { cancelAnimationFrame(syncRaf); syncRaf = 0 } }

  // ---- shared lifecycle -------------------------------------------------------
  // mount the overlay in the (current) player, hide native captions, and — in
  // scrape mode — watch the caption container. Cheap + idempotent; the timer makes
  // SPA navigation and caption toggles self-heal.
  function ensure() {
    if (!running) return
    const player = adapter.getPlayer()
    if (!player) return
    if (overlay && overlay.host.parentNode !== player) player.appendChild(overlay.host)
    applyNativeHide(document, adapter.nativeHideSelector)
    if (mode === 'scrape') {
      attachObserver(adapter.getCaptionRoot())
      // try to upgrade to the dual view, when the platform + prefs allow same-origin
      // track fetching, with a bounded number of attempts per video
      if (adapter.supportsDual && prefs.dual && canFetch() && adapter.getVideo()) {
        const vid = (adapter.getVideoId && adapter.getVideoId()) || 'x'
        if (vid !== acqVideo) { acqVideo = vid; acqTries = 0 } // new video -> fresh attempts
        if (acqTries < MAX_ACQ_TRIES && !acquiring) { acqTries++; acquireDual(vid) }
      }
    }
  }

  function start(p) {
    if (running) return
    running = true
    prefs = { ...prefs, ...(p || {}) }
    overlay = createOverlay({ requestSegment, requestHover, onPin })
    overlay.setPrefs(prefs)
    // YouTube swaps the video without a reload — reset to scrape and let ensure()
    // re-find the player + re-acquire tracks for the new video
    onNav = () => { acqVideo = null; trackList = null; if (mode === 'dual') exitDual(); else if (overlay) overlay.clear(); observedRoot = null; ensure() }
    document.addEventListener('yt-navigate-finish', onNav)
    // keep the freshest player-fetched timedtext URL around as a stale-baseUrl fallback
    onTT = (e) => { if (e && typeof e.detail === 'string' && e.detail) lastTT = e.detail }
    document.addEventListener(EV_TT, onTT)
    ensure()
    ensureTimer = setInterval(ensure, ENSURE_MS)
  }

  function setPrefs(p) {
    const prev = prefs
    prefs = { ...prefs, ...(p || {}) }
    if (overlay) overlay.setPrefs(prefs)
    const langChanged =
      prev.lang1 !== prefs.lang1 || prev.lang2 !== prefs.lang2 ||
      prev.dual !== prefs.dual ||
      prev.allowAsr !== prefs.allowAsr || prev.allowAutoTranslation !== prefs.allowAutoTranslation
    if (langChanged) {
      acqVideo = null // re-pick + re-fetch on the next ensure
      if (mode === 'dual') exitDual()
      ensure()
    } else if (mode === 'dual') {
      renderControls(curLang1, curLang2) // pinyin/tones toggle: keep the picker in sync
    }
  }

  function stop() {
    running = false
    if (ensureTimer) { clearInterval(ensureTimer); ensureTimer = 0 }
    stopSync()
    detachObserver()
    mode = 'scrape'; acqVideo = null; acqTries = 0; trackList = null; lastTT = ''
    cues1 = []; cues2 = []; idx1 = -1; idx2 = -1
    if (onNav) { document.removeEventListener('yt-navigate-finish', onNav); onNav = null }
    if (onTT) { document.removeEventListener(EV_TT, onTT); onTT = null }
    removeNativeHide(document) // restore the platform's own captions (reversibility)
    if (overlay) { overlay.destroy(); overlay = null }
  }

  return { start, stop, setPrefs }
}

// detect the current platform and return a controller, or null if this host has no
// adapter. index.js calls this after its own cheap hostname pre-filter.
export function attach() {
  const adapter = detectPlatform()
  return adapter ? createEngine(adapter) : null
}
