/* content.js — on-page lookup driver. Runs on every page and drives the side
   panel from the cursor:
     • hover  -> longest dictionary WORD starting at the character under the
                 cursor (新闻 -> the 2-char word "news"). The forward run is
                 collected ACROSS adjacent text nodes, so a word split over
                 inline elements (新<span>闻</span>) still matches. The service
                 worker owns a dictionary copy, resolves the match, and returns
                 how many characters to highlight + the popup data — so hover works
                 whether or not the side panel is open.
     • click  -> PIN that word: the panel locks onto it and hover stops changing
                 it. Click the pinned word again (or click empty space) to unpin;
                 click another word to re-pin.
     • select -> look up the highlighted run; the live selection also locks hover.

   Highlighting uses the CSS Custom Highlight API (no DOM mutation). See
   content.css for ::highlight styles.

   Note: chrome.sidePanel.open() needs a user gesture, so hover can't auto-open
   the panel — open it once (toolbar icon / right-click), then it updates live. */

import { isHanChar, normalizeSelection, shouldLookupSelection, charAt, matchWords } from './content-core.js'
import { htmlToParas, fallbackParas } from './reader-extract.js'
import { collectForward, textOf } from './word-walk.js'
import { initSubs } from './subs/index.js'
// NOTE: @mozilla/readability is NOT imported at the top. This content script runs
// on <all_urls> with all_frames:true, so a static import would make every page and
// embedded frame parse ~110 KB of extraction code it almost never uses. Instead it
// is dynamically imported on first Reader-mode open (see extractArticle), keeping
// it in a separate on-demand chunk.

let selecting = false
let rafPending = false
let lastNode = null
let lastIndex = -1
let pinned = null // { positions: [{node, offset}, …] } for the locked word, or null
let hoverWord = null // { positions, len } currently under the cursor (for the pin hotkey)
let hoverDisabled = false // this site is in the user's "disable hover" list
let hskLevel = 0 // current "highlight HSK ≤ N" level on this page (0 = off)
let hskNames = [] // CSS highlight names currently set for the HSK overlay
let hskGen = 0 // bumped on every clear so an in-flight chunked scan can cancel
const hskWordCache = new Map() // level -> [word, rank][] from the service worker

// live copy of the relevant panel settings (kept in sync via chrome.storage)
let settings = { accent: '#c8443a', pinKey: 'p', inlinePopup: true, hskFirst: false, dark: false }

// shadow roots crossed by an event's path — passed to the caret API so hover /
// selection can pierce open shadow trees (web components). Must be read during
// dispatch (composedPath() is empty afterwards), so callers grab it synchronously.
function shadowRootsFromPath(e) {
  const path = e && e.composedPath ? e.composedPath() : []
  const roots = []
  for (const n of path) if (n instanceof ShadowRoot) roots.push(n)
  return roots
}

// caret node/offset under a screen point. caretPositionFromPoint is the standard
// API and (in current Chrome) accepts a shadowRoots option to descend into open
// shadow trees; older Chrome falls back to caretRangeFromPoint (no shadow).
function caretAt(x, y, shadowRoots) {
  if (document.caretPositionFromPoint) {
    const p = shadowRoots && shadowRoots.length
      ? document.caretPositionFromPoint(x, y, { shadowRoots })
      : document.caretPositionFromPoint(x, y)
    if (p) return { node: p.offsetNode, offset: p.offset }
  }
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y)
    if (r) return { node: r.startContainer, offset: r.startOffset }
  }
  return null
}

// resolve the character under a screen point to { node, index, char }
function charAtPoint(x, y, shadowRoots) {
  const c = caretAt(x, y, shadowRoots)
  if (!c) return null
  const { node, offset } = c
  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  const text = node.data
  // prefer the char to the right of the caret, fall back to the one on the left
  let idx = -1
  if (offset < text.length && isHanChar(charAt(text, offset))) idx = offset
  else if (offset > 0 && isHanChar(charAt(text, offset - 1))) idx = offset - 1
  if (idx < 0) return null
  return { node, index: idx, char: charAt(text, idx) }
}

const canHighlight = () => 'highlights' in CSS && typeof Highlight !== 'undefined'

// highlight the first `len` collected positions (range may span nodes)
function setHighlight(name, positions, len) {
  if (!canHighlight() || !positions.length) return
  const a = positions[0]
  const b = positions[Math.min(len, positions.length) - 1]
  try {
    const range = document.createRange()
    range.setStart(a.node, a.offset)
    range.setEnd(b.node, b.offset + (b.size || 1))
    CSS.highlights.set(name, new Highlight(range))
  } catch (e) {}
}
function clearHighlight(name) {
  if ('highlights' in CSS) CSS.highlights.delete(name)
}

// clear the hover token AND forget the last-hovered char, so moving back onto
// the same character re-triggers the highlight (otherwise the lastNode/lastIndex
// early-return would suppress it)
function clearHover() {
  clearHighlight('mydict-tok')
  lastNode = null
  lastIndex = -1
  hoverWord = null
  hidePopup()
}

// is there an active (non-collapsed) text selection right now?
function hasSelection() {
  const s = window.getSelection ? window.getSelection() : null
  return !!(s && !s.isCollapsed && String(s).trim())
}

// selected text, preferring a selection inside an open shadow root (whose
// selection window.getSelection() can't see) when the event crossed one
function selectionText(shadowRoots) {
  for (const root of shadowRoots || []) {
    if (root.getSelection) {
      const s = root.getSelection()
      if (s && String(s).trim()) return String(s).trim()
    }
  }
  const s = window.getSelection ? window.getSelection() : null
  return s ? String(s).trim() : ''
}

function lookup(q) {
  if (!q) return
  try {
    chrome.runtime.sendMessage({ type: 'lookup', q }, () => void chrome.runtime.lastError)
  } catch (e) { /* extension context invalidated — ignore */ }
}

// ask the panel for the longest word at the cursor; cb(positions, len). The panel
// also displays the word as a side effect of the 'hover' message.
function resolveWord(node, index, cb) {
  const { text, positions } = collectForward(node, index)
  if (!text) { cb(positions, 0, null); return }
  try {
    chrome.runtime.sendMessage({ type: 'hover', text }, (resp) => {
      const len = (chrome.runtime.lastError || !resp)
        ? 1
        : Math.max(1, Math.min(resp.len | 0 || 1, positions.length))
      cb(positions, len, chrome.runtime.lastError ? null : resp)
    })
  } catch (e) { cb(positions, 1, null) }
}

// pin the word resolved at a hit (shared by click, Alt-click, and the hotkey)
function pinAt(hit) {
  resolveWord(hit.node, hit.index, (positions, len) => pinWord(positions, len))
}
function pinWord(positions, len) {
  if (!positions || !positions.length) return
  clearHover()
  pinned = { positions: positions.slice(0, len) }
  setHighlight('mydict-pin', positions, len)
  drawPinBox(positions, len)
  // Pinning is a deliberate lookup AND a user gesture (click / Alt-click / hotkey),
  // so route it through the service worker: it opens the side panel if closed and
  // shows/records the pinned word (hover alone is neither recorded nor opening).
  try {
    chrome.runtime.sendMessage({ type: 'open-panel', q: textOf(positions, len) }, () => void chrome.runtime.lastError)
  } catch (e) { /* extension context invalidated — ignore */ }
}

function unpin() {
  pinned = null
  clearHighlight('mydict-pin')
  removePinBox()
}

document.addEventListener('mousemove', (e) => {
  if (hoverDisabled) return // hover turned off for this site (selection/pin still work)
  if (selecting) return
  if (pinned) return // locked onto a clicked word — ignore hover
  if (hasSelection()) { clearHover(); return }
  if (rafPending) return
  rafPending = true
  // grab coords + shadow roots now (composedPath() is empty inside the rAF)
  const x = e.clientX, y = e.clientY
  const roots = shadowRootsFromPath(e)
  requestAnimationFrame(() => {
    rafPending = false
    if (pinned || hasSelection()) { clearHover(); return }
    const hit = charAtPoint(x, y, roots)
    if (!hit) { clearHover(); return }
    if (hit.node === lastNode && hit.index === lastIndex) return
    lastNode = hit.node; lastIndex = hit.index
    resolveWord(hit.node, hit.index, (positions, len, resp) => {
      setHighlight('mydict-tok', positions, len)
      hoverWord = positions.length ? { positions, len } : null
      if (settings.inlinePopup) showPopup(x, y, resp)
    })
  })
}, { passive: true })

document.addEventListener('mousedown', () => {
  selecting = true
  clearHover()
}, { passive: true })

document.addEventListener('mouseup', (e) => {
  selecting = false
  const roots = shadowRootsFromPath(e)
  const sel = selectionText(roots)

  // drag-selection: normalize (strip surrounding punctuation) and look it up;
  // the live selection itself locks hover
  if (shouldLookupSelection(sel)) {
    unpin()
    lookup(normalizeSelection(sel))
    return
  }

  // plain click: pin / unpin the word at the click point
  const hit = charAtPoint(e.clientX, e.clientY, roots)
  if (!hit) { if (pinned) unpin(); return } // clicked empty/non-Chinese → unpin
  const onPinned = pinned && pinned.positions.some(
    (p) => p.node === hit.node && p.offset === hit.index)
  if (onPinned) { unpin(); return } // clicking the pinned word releases it

  pinAt(hit)
}, { passive: true })

// Alt/Option-click pins a word WITHOUT following a link — capture-phase and
// non-passive so we can preventDefault the navigation that a plain click on a
// hyperlinked word would otherwise trigger.
document.addEventListener('click', (e) => {
  if (!e.altKey || e.button !== 0) return
  const roots = shadowRootsFromPath(e)
  const hit = charAtPoint(e.clientX, e.clientY, roots)
  if (!hit) return
  e.preventDefault()
  e.stopPropagation()
  pinAt(hit)
}, true)

// Hover-pin hotkey: with a word under the cursor (and focus not in an editable
// field), pressing the configured key pins it — works on links with no click.
document.addEventListener('keydown', (e) => {
  const key = (settings.pinKey || 'p').toLowerCase()
  if (!key || e.ctrlKey || e.metaKey || e.altKey) return
  if ((e.key || '').toLowerCase() !== key) return
  const ae = document.activeElement
  if (ae && (ae.isContentEditable || /^(input|textarea|select)$/i.test(ae.tagName || ''))) return
  if (!hoverWord) return
  e.preventDefault()
  pinWord(hoverWord.positions, hoverWord.len)
}, true)

/* Optional inline mini-popup — a tiny on-page card near the cursor with the
   hovered word, its pinyin, and a short gloss, gated by settings.inlinePopup. It
   lives in a shadow root so page CSS can't touch it; the side panel stays the
   full detail view. */
let popupHost = null, popupCard = null
function ensurePopup() {
  if (popupHost) return
  popupHost = document.createElement('div')
  popupHost.id = 'mydict-popup-host'
  popupHost.style.cssText =
    'all:initial;position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;display:none;'
  const root = popupHost.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent =
    '.card{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'background:var(--p-bg,#fbf7ee);color:var(--p-ink,#2a2520);' +
    'border:1px solid var(--p-border,#d8ccb5);border-radius:10px;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.18);padding:8px 11px;max-width:280px;font-size:13px;line-height:1.4}' +
    '.head{margin-bottom:3px}' +
    '.w{font-size:17px;font-weight:600;margin-right:6px}' +
    '.py{font-size:13px;color:var(--mydict-accent,#c8443a);font-weight:600}' +
    '.gl{display:flex;gap:5px;color:var(--p-ink2,#6b6258)}' +
    '.gl .n{color:var(--p-ink3,#9a9082);font-variant-numeric:tabular-nums;flex:none}' +
    '.hsk{display:flex;gap:6px;align-items:baseline;margin-top:3px;color:var(--p-ink2,#6b6258)}' +
    '.hsk .tag{flex:none;font-size:9px;font-weight:700;letter-spacing:.04em;white-space:nowrap;' +
    'color:var(--mydict-accent,#c8443a);border:1px solid var(--mydict-accent,#c8443a);border-radius:4px;padding:1px 5px}' +
    // divider before whichever section comes second (CC-CEDICT defs or HSK glosses)
    '.divide{margin-top:7px;padding-top:7px;border-top:1px solid var(--p-border,#d8ccb5)}'
  popupCard = document.createElement('div')
  popupCard.className = 'card'
  root.appendChild(style)
  root.appendChild(popupCard)
  ;(document.body || document.documentElement).appendChild(popupHost)
}
// match the side panel's warm "paper" surface, honoring its light/dark theme
function applyPopupTheme() {
  if (!popupHost) return
  const t = settings.dark
    ? { bg: '#2c2822', ink: '#ece3d2', ink2: '#b3a896', ink3: '#877d6d', border: '#453f33' }
    : { bg: '#fbf7ee', ink: '#2a2520', ink2: '#6b6258', ink3: '#9a9082', border: '#d8ccb5' }
  const s = popupHost.style // custom props cross the shadow boundary into the card
  s.setProperty('--p-bg', t.bg)
  s.setProperty('--p-ink', t.ink)
  s.setProperty('--p-ink2', t.ink2)
  s.setProperty('--p-ink3', t.ink3)
  s.setProperty('--p-border', t.border)
  s.setProperty('--mydict-accent', settings.accent)
}
function showPopup(x, y, resp) {
  const word = resp && resp.word
  const defs = resp && resp.defs && resp.defs.length ? resp.defs : (resp && resp.gloss ? [resp.gloss] : [])
  if (!word || !defs.length) { hidePopup(); return }
  ensurePopup()
  applyPopupTheme()
  popupCard.textContent = ''
  const head = document.createElement('div'); head.className = 'head'
  const w = document.createElement('span'); w.className = 'w'; w.lang = 'zh'; w.textContent = word
  const py = document.createElement('span'); py.className = 'py'; py.textContent = resp.pinyin || ''
  head.append(w, py)
  popupCard.append(head)

  // CC-CEDICT defs: each sense on its own line (numbered when there's more than one)
  const defRows = defs.map((d, i) => {
    const gl = document.createElement('div'); gl.className = 'gl'
    if (defs.length > 1) {
      const n = document.createElement('span'); n.className = 'n'; n.textContent = (i + 1) + '.'
      gl.appendChild(n)
    }
    const txt = document.createElement('span'); txt.textContent = d
    gl.appendChild(txt)
    return gl
  })

  // official HSK gloss(es): each tagged with its HSK level (repeated same-level tags
  // hidden but width-preserved so meanings align); multi-sense rows show [pos] first
  const senses = (resp.hskSenses && resp.hskSenses.length) ? resp.hskSenses : []
  const multi = senses.length > 1
  let prevLvl = null
  const hskRows = senses.map((s) => {
    const row = document.createElement('div'); row.className = 'hsk'
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'HSK ' + s.lvl
    if (s.lvl === prevLvl) tag.style.visibility = 'hidden'
    prevLvl = s.lvl
    const txt = document.createElement('span')
    txt.textContent = (multi && s.pos ? '[' + s.pos + '] ' : '') + s.def
    row.append(tag, txt)
    return row
  })

  // order the two sections per the "Show HSK meaning first" setting; the second
  // section gets a divider above it
  const hskOnTop = settings.hskFirst && hskRows.length
  const first = hskOnTop ? hskRows : defRows
  const second = hskOnTop ? defRows : hskRows
  first.forEach((r) => popupCard.append(r))
  if (second.length) {
    second[0].classList.add('divide')
    second.forEach((r) => popupCard.append(r))
  }
  popupHost.style.display = 'block'
  // position below-right of the cursor, flipping to stay on-screen
  const pad = 14
  const pw = popupHost.offsetWidth, ph = popupHost.offsetHeight
  let px = x + pad, py2 = y + pad
  if (px + pw > window.innerWidth - 4) px = x - pad - pw
  if (py2 + ph > window.innerHeight - 4) py2 = y - pad - ph
  popupHost.style.left = Math.max(4, px) + 'px'
  popupHost.style.top = Math.max(4, py2) + 'px'
}
function hidePopup() { if (popupHost) popupHost.style.display = 'none' }

/* Pinned-word overlay — the CSS Custom Highlight API can't draw rounded corners,
   a drop shadow, or the gold "pinned" dot, so we paint ONE positioned box over the
   pinned word: an accent pill (rounded + shadow) with the word in white matching
   the page font, plus a gold dot at the corner. One element, no DOM wrapping. */
let pinHost = null, pinPill = null, pinText = null, pinState = null
function ensurePinBox() {
  if (pinHost) return
  pinHost = document.createElement('div')
  pinHost.id = 'mydict-pin-host'
  pinHost.style.cssText =
    'all:initial;position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none;display:none;'
  const root = pinHost.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent =
    '.pill{position:absolute;display:flex;align-items:center;justify-content:center;box-sizing:border-box;' +
    'border-radius:4px;color:#fff;white-space:nowrap;padding:0 2px;' +
    'box-shadow:0 2px 0 var(--mydict-shadow,rgba(178,58,46,.4))}' +
    '.dot{position:absolute;top:-2px;right:-1px;width:5px;height:5px;border-radius:50%;' +
    'background:#f0c419;border:1px solid #fff}'
  pinPill = document.createElement('div'); pinPill.className = 'pill'
  pinText = document.createElement('span'); pinText.lang = 'zh'
  const dot = document.createElement('div'); dot.className = 'dot'
  pinPill.append(pinText, dot)
  root.appendChild(style); root.appendChild(pinPill)
  ;(document.body || document.documentElement).appendChild(pinHost)
}
function pinnedRange(positions, len) {
  const a = positions[0]
  const b = positions[Math.min(len, positions.length) - 1]
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset + (b.size || 1))
  return range
}
function drawPinBox(positions, len) {
  if (!positions || !positions.length) return
  ensurePinBox()
  pinState = { positions, len }
  // match the page font so the overlaid text aligns over the original
  const el = positions[0].node.parentElement
  if (el) {
    const cs = getComputedStyle(el)
    pinPill.style.fontFamily = cs.fontFamily
    pinPill.style.fontSize = cs.fontSize
    pinPill.style.fontWeight = cs.fontWeight
    pinPill.style.letterSpacing = cs.letterSpacing
  }
  pinText.textContent = textOf(positions, len)
  recolorPinBox()
  positionPinBox()
  pinHost.style.display = 'block'
}
function positionPinBox() {
  if (!pinState || !pinPill) return
  const r = pinnedRange(pinState.positions, pinState.len).getBoundingClientRect()
  if (!r || (!r.width && !r.height)) return
  const padX = 2
  pinPill.style.left = (r.left - padX) + 'px'
  pinPill.style.top = r.top + 'px'
  pinPill.style.width = (r.width + padX * 2) + 'px'
  pinPill.style.height = r.height + 'px'
}
function recolorPinBox() {
  if (!pinPill) return
  pinPill.style.background = settings.accent
  pinPill.style.setProperty('--mydict-shadow', hexToRgba(settings.accent, 0.4))
}
function removePinBox() { pinState = null; if (pinHost) pinHost.style.display = 'none' }

// keep the pinned box aligned through scroll/resize; hide the popup on scroll
window.addEventListener('scroll', () => { if (pinState) positionPinBox(); hidePopup() }, { passive: true, capture: true })
window.addEventListener('resize', () => { if (pinState) positionPinBox() }, { passive: true })

/* "Highlight HSK ≤ N" — a one-shot, current-page action from the toolbar popup.
   We ask the service worker for the HSK word list (cached per level), greedy
   longest-match each text node against it, and paint the matches with the CSS
   Highlight API: one highlight (single color) or one per band (color by level).
   Cleared by level 0, and naturally gone on reload since the script re-injects.

   The scan is CHUNKED across idle callbacks (a single synchronous pass could
   freeze a long article — ~10.9k words × every text node), CANCELLABLE via the
   hskGen token (changing level / clearing aborts an in-flight scan), and CAPPED
   so a pathological page can't generate unbounded ranges. Highlights are added
   incrementally so matches paint as they're found. Light-DOM only: open shadow
   roots are intentionally NOT scanned here (hover lookup does pierce them, but a
   page-wide shadow walk is out of scope for this one-shot action). */
function clearHskHighlight() {
  hskGen++ // cancel any chunked scan still in flight
  for (const name of hskNames) clearHighlight(name)
  hskNames = []
}

// don't descend into non-content elements or the extension's own shadow hosts
const HSK_SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'])
function hskSkip(el) {
  return !el || HSK_SKIP_TAGS.has(el.tagName) || el.id === 'mydict-popup-host' || el.id === 'mydict-pin-host'
}

const HSK_MAX_RANGES = 20000 // safety cap so a huge page can't flood ranges
const HSK_NODES_PER_SLICE = 250 // text nodes processed before yielding to idle
const hskIdle = (cb) =>
  typeof requestIdleCallback === 'function'
    ? requestIdleCallback(cb, { timeout: 500 })
    : setTimeout(() => cb({ timeRemaining: () => 0 }), 0)

// walk the page's text nodes in idle slices, greedy longest-match each against
// the HSK word set, and add matches to a live Highlight per bucket (single
// color, or one per band). Aborts if hskGen changed; stops at the range cap.
function scanAndHighlight(words, colorByLevel) {
  if (!canHighlight() || !words.length) return
  const rank = new Map(words) // word -> band rank
  let maxLen = 1
  for (const [w] of words) if (w.length > maxLen) maxLen = w.length

  const gen = hskGen
  const highlights = new Map() // name -> live Highlight (registered once)
  const addRange = (name, range) => {
    let h = highlights.get(name)
    if (!h) {
      h = new Highlight()
      highlights.set(name, h)
      hskNames.push(name)
      try { CSS.highlights.set(name, h) } catch (e) {}
    }
    h.add(range)
  }

  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      hskSkip(n.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  let node = walker.nextNode()
  let total = 0
  let capped = false

  const slice = (deadline) => {
    if (gen !== hskGen) return // superseded by a newer level / clear
    let processed = 0
    while (node) {
      // greedy longest-match the HSK words in this text node (pure core), then
      // paint each hit as a Range
      for (const m of matchWords(node.data, rank, maxLen)) {
        const range = document.createRange()
        range.setStart(node, m.start)
        range.setEnd(node, m.start + m.len)
        addRange(colorByLevel ? 'mydict-hsk-' + m.rank : 'mydict-hsk', range)
        if (++total >= HSK_MAX_RANGES) { capped = true; break }
      }
      node = walker.nextNode()
      if (capped) break
      if (++processed >= HSK_NODES_PER_SLICE ||
          (deadline && deadline.timeRemaining && deadline.timeRemaining() < 2)) break
    }
    if (gen !== hskGen) return
    if (node && !capped) hskIdle(slice) // more to do — yield then resume
    else if (capped) console.warn('[mydict] HSK highlight capped at ' + HSK_MAX_RANGES + ' matches on this large page')
  }
  hskIdle(slice)
}

function applyHskHighlight(level, colorByLevel) {
  clearHskHighlight() // bumps hskGen, cancelling any in-flight scan
  hskLevel = level | 0
  if (hskLevel <= 0) return
  const cached = hskWordCache.get(hskLevel)
  if (cached) { scanAndHighlight(cached, colorByLevel); return }
  // capture the generation + level this request belongs to AFTER clearHskHighlight
  // so a slow response for an older level can't paint after the user switched: the
  // word list still caches, but we only scan if nothing has superseded this request.
  const gen = hskGen
  const requested = hskLevel
  try {
    chrome.runtime.sendMessage({ type: 'hsk-words', level: requested }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.words) return
      hskWordCache.set(requested, resp.words)
      if (gen === hskGen && hskLevel === requested) scanAndHighlight(resp.words, colorByLevel)
    })
  } catch (e) { /* extension context invalidated — ignore */ }
}

/* Reader mode — the toolbar popup / context menu asks this page to open a clean
   reading overlay. We extract the page's main article with Mozilla Readability
   (the Firefox Reader View engine), then inject a full-screen extension-page
   iframe (src/reader/index.html) over the page and hand it the extracted text via
   postMessage. The iframe is a chrome-extension:// document, so it's isolated from
   page CSS, has the bundled fonts, and talks to the worker/side panel itself.

   The extracted article is NOT handed to the iframe over postMessage: while the
   reader is open its parent window is this host page, so a hostile page could forge
   an article message. Instead the worker stashes the article in extension-only
   chrome.storage.session under a random nonce and the reader reads it back via that
   nonce (passed in the iframe URL hash) — the page is never in the trust path.

   Only the TOP frame opens the reader (chrome.tabs.sendMessage broadcasts to every
   frame); subframes ignore it. */
let readerFrame = null
let prevHtmlOverflow = ''

async function extractArticle() {
  let title = document.title || ''
  let subtitle = '', source = '', paras = []
  try {
    // load the extractor on demand (kept out of the all-frames content bundle)
    const { Readability } = await import('@mozilla/readability')
    // Readability mutates the document it's given, so always pass a clone
    const art = new Readability(document.cloneNode(true)).parse()
    if (art) {
      title = art.title || title
      subtitle = art.byline || ''
      source = art.siteName || ''
      paras = htmlToParas(art.content, new DOMParser())
    }
  } catch (e) { /* import failed or unparseable — fall through to the <p> fallback */ }
  if (!paras.length) paras = fallbackParas(document)
  return {
    title: title || location.hostname,
    subtitle,
    source: source || location.hostname,
    host: location.hostname,
    kicker: '',
    meta: paras.length ? paras.length + ' paragraphs' : '',
    paras,
    empty: !paras.length,
  }
}

// stash the extracted article with the worker; resolves to a one-use nonce (or '')
function stashArticle(article) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'reader-stash', article }, (resp) =>
        resolve(chrome.runtime.lastError ? '' : (resp && resp.nonce) || ''),
      )
    } catch (e) { resolve('') }
  })
}

async function openReader() {
  if (window.top !== window) return // only the top frame hosts the overlay
  if (readerFrame) return // already open
  readerFrame = true // claim the slot synchronously so a double-trigger can't race the await
  let article
  try {
    article = await extractArticle()
  } catch (e) { readerFrame = null; return }
  if (readerFrame !== true) return // closed while extracting
  // hand the article to the reader via extension-only session storage, not the
  // page-visible postMessage channel; the nonce addresses it in the URL hash
  const nonce = await stashArticle(article)
  if (readerFrame !== true) {
    // closed while stashing — drop the now-orphaned stash instead of leaking it
    if (nonce) { try { chrome.runtime.sendMessage({ type: 'reader-clear', nonce }, () => void chrome.runtime.lastError) } catch (e) {} }
    return
  }
  const frame = document.createElement('iframe')
  frame.id = 'mydict-reader-frame'
  frame.src = chrome.runtime.getURL('src/reader/index.html') + (nonce ? '#' + encodeURIComponent(nonce) : '')
  // explicit !important so a page's own `iframe {…}` rules can't hide/shrink it
  frame.style.cssText =
    'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;' +
    'border:0!important;margin:0!important;padding:0!important;display:block!important;' +
    'z-index:2147483647!important;background:transparent!important;color-scheme:normal!important;'
  ;(document.documentElement || document.body).appendChild(frame)
  readerFrame = frame
  prevHtmlOverflow = document.documentElement.style.overflow
  document.documentElement.style.overflow = 'hidden' // freeze the page behind it
}

function closeReader() {
  if (!readerFrame) return
  if (readerFrame !== true) readerFrame.remove() // `true` = still extracting, no element yet
  readerFrame = null
  document.documentElement.style.overflow = prevHtmlOverflow || ''
}

// the reader iframe posts back to its parent (this content script) only to request
// a close — the article now flows through session storage, not postMessage, so
// there's no article message to send. Still validate it's our frame.
window.addEventListener('message', (e) => {
  const d = e.data
  if (!d || typeof d.type !== 'string' || d.type.indexOf('mydict-reader') !== 0) return
  if (!readerFrame || readerFrame === true || e.source !== readerFrame.contentWindow) return // only our frame
  if (d.type === 'mydict-reader-close') closeReader()
})

// receive selection forwarded from the background context-menu action, plus the
// toolbar popup's HSK-highlight commands / status query and the reader-open action
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return
  if (msg.type === 'lookup-selection') {
    const sel = window.getSelection ? String(window.getSelection()).trim() : ''
    if (shouldLookupSelection(sel)) lookup(normalizeSelection(sel))
    return
  }
  if (msg.type === 'hsk-highlight') {
    applyHskHighlight(msg.level | 0, !!msg.colorByLevel)
    return
  }
  if (msg.type === 'hsk-status') {
    sendResponse({ level: hskLevel })
    return true
  }
  if (msg.type === 'reader-open') {
    openReader()
    return
  }
})

/* Accent-colored highlights — the on-page hover/pin colors follow the panel's
   accent setting so the highlight matches the chosen UI color (e.g. Jade green).
   We read the stored accent and inject an author stylesheet that overrides the
   ::highlight() rules from content.css; storage.onChanged keeps it live when the
   user picks a different swatch. content.css still carries the default color, so
   highlighting works before this resolves and in contexts without storage. */
const SETTINGS_KEY = 'mydict.settings'
const DISABLED_KEY = 'mydict.disabledSites' // hostnames where hover is turned off

function hexToRgba(hex, a) {
  const n = hex.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

// re-register any active highlights so an already-visible hover/pin repaints with
// the new color immediately (rewriting the stylesheet alone doesn't restyle a
// highlight that's already registered)
function repaintHighlights() {
  if (!('highlights' in CSS)) return
  for (const name of ['mydict-tok', 'mydict-pin']) {
    const h = CSS.highlights.get(name)
    if (h) { CSS.highlights.delete(name); CSS.highlights.set(name, h) }
  }
}

let hlStyleEl = null
function applyAccent(accent) {
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return // keep content.css default
  if (!hlStyleEl) {
    hlStyleEl = document.createElement('style')
    hlStyleEl.id = 'mydict-hl-accent'
    ;(document.head || document.documentElement).appendChild(hlStyleEl)
  }
  // hover: soft tint of the accent with accent-colored text; pin: solid accent.
  // !important so the override always beats the content.css default regardless of
  // content-script stylesheet injection order.
  hlStyleEl.textContent =
    `::highlight(mydict-tok){background-color:${hexToRgba(accent, 0.22)}!important;color:${accent}!important;}` +
    `::highlight(mydict-pin){background-color:${accent}!important;color:#fff!important;}`
  repaintHighlights()
}

// sync the panel settings the content script cares about: accent (highlights +
// pin box), pinKey (hotkey), and inlinePopup (mini-popup on/off)
function applySettings(s) {
  if (!s) return
  if (typeof s.pinKey === 'string' && s.pinKey) settings.pinKey = s.pinKey.toLowerCase()
  if (typeof s.inlinePopup === 'boolean') {
    settings.inlinePopup = s.inlinePopup
    if (!settings.inlinePopup) hidePopup()
  }
  if (typeof s.hskFirst === 'boolean') settings.hskFirst = s.hskFirst
  if (typeof s.dark === 'boolean') {
    settings.dark = s.dark
    applyPopupTheme() // restyle a live popup to match the panel's theme
  }
  if (typeof s.accent === 'string' && /^#[0-9a-f]{6}$/i.test(s.accent)) {
    settings.accent = s.accent
    applyAccent(s.accent)
    recolorPinBox()
  }
}

// recompute whether hover is disabled for this site; clear any live highlight/
// popup when it flips on so it disappears without needing another mousemove
function applyDisabledSites(list) {
  const next = Array.isArray(list) && list.includes(location.hostname)
  if (next && !hoverDisabled) clearHover()
  hoverDisabled = next
}

try {
  chrome.storage?.local.get([SETTINGS_KEY, DISABLED_KEY], (got) => {
    if (chrome.runtime.lastError) return
    applySettings(got && got[SETTINGS_KEY])
    applyDisabledSites(got && got[DISABLED_KEY])
  })
  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes[SETTINGS_KEY]) applySettings(changes[SETTINGS_KEY].newValue)
    if (changes[DISABLED_KEY]) applyDisabledSites(changes[DISABLED_KEY].newValue)
  })
} catch (e) { /* no chrome.storage (e.g. tests) — content.css default applies */ }

// Subtitle overlay (pinyin + clickable words on supported video sites). Self-gates
// on a hostname check and the mydict.subs setting, so this is a no-op on every
// other page; the heavy engine is dynamically imported only when it activates.
initSubs()
