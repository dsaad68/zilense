/* content.js — the all-pages content script. The cursor-driven hover/pin/select
   lookup lives in the shared hover-driver (so the bundled PDF.js viewer can reuse
   it); this file initializes that driver and keeps the host-page-only extras that
   the viewer does NOT want:
     • per-site "disable hover" toggle,
     • the one-shot "Highlight HSK ≤ N" page scan,
     • Reader mode (extract the article, inject the reader iframe),
     • the chrome.runtime.onMessage listener for the popup / context-menu actions.

   Highlighting uses the CSS Custom Highlight API (no DOM mutation). See
   content.css for ::highlight styles.

   Note: chrome.sidePanel.open() needs a user gesture, so hover can't auto-open
   the panel — open it once (toolbar icon / right-click), then it updates live. */

import { normalizeSelection, shouldLookupSelection, matchWords } from './content-core.js'
import { htmlToParas, fallbackParas } from './reader-extract.js'
import { initHoverDriver } from './hover-driver.js'
import { initSubs } from './subs/index.js'
// NOTE: @mozilla/readability is NOT imported at the top. This content script runs
// on <all_urls> with all_frames:true, so a static import would make every page and
// embedded frame parse ~110 KB of extraction code it almost never uses. Instead it
// is dynamically imported on first Reader-mode open (see extractArticle), keeping
// it in a separate on-demand chunk.

let hoverDisabled = false // this site is in the user's "disable on this site" list
let extEnabled = true // global master switch (settings.enabled); off = inert everywhere
let hskLevel = 0 // current "highlight HSK ≤ N" level on this page (0 = off)
let hskNames = [] // CSS highlight names currently set for the HSK overlay
let hskGen = 0 // bumped on every clear so an in-flight chunked scan can cancel
const hskWordCache = new Map() // level -> [word, rank][] from the service worker

// the cursor-driven hover/pin/select machinery (shared with the PDF viewer). It
// owns the highlight + popup + pin box. We pass a COMBINED disable predicate so the
// whole on-page lookup (hover, click-to-pin, and selection) goes off when either
// this site is disabled or the extension's global master switch is turned off.
const hover = initHoverDriver({ allowDisable: () => hoverDisabled || !extEnabled })

function lookup(q) {
  if (!q) return
  try {
    chrome.runtime.sendMessage({ type: 'lookup', q }, () => void chrome.runtime.lastError)
  } catch (e) { /* extension context invalidated — ignore */ }
}

const canHighlight = () => 'highlights' in CSS && typeof Highlight !== 'undefined'
function clearHighlight(name) {
  if ('highlights' in CSS) CSS.highlights.delete(name)
}

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

/* Turning the lookup off — two layers, both driven from the toolbar popup:
     • per-site: this hostname is in mydict.disabledSites, or
     • global:   the master switch mydict.settings.enabled is false.
   Either makes the shared driver inert (hover + click-to-pin + selection all stop);
   when one flips ON we also clear any live highlight / popup / pin so it disappears
   immediately without needing another mousemove. */
const DISABLED_KEY = 'mydict.disabledSites' // hostnames where lookup is turned off
const SETTINGS_KEY = 'mydict.settings' // holds the global `enabled` master switch

function applyDisabledSites(list) {
  const next = Array.isArray(list) && list.includes(location.hostname)
  if (next && !hoverDisabled) { hover.clearHover(); hover.unpin() }
  hoverDisabled = next
}

function applyEnabled(settings) {
  const next = !(settings && settings.enabled === false) // absent/true = enabled
  if (!next && extEnabled) { hover.clearHover(); hover.unpin() } // master just turned off
  extEnabled = next
}

try {
  chrome.storage?.local.get([DISABLED_KEY, SETTINGS_KEY], (got) => {
    if (chrome.runtime.lastError) return
    applyDisabledSites(got && got[DISABLED_KEY])
    applyEnabled(got && got[SETTINGS_KEY])
  })
  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes[DISABLED_KEY]) applyDisabledSites(changes[DISABLED_KEY].newValue)
    if (changes[SETTINGS_KEY]) applyEnabled(changes[SETTINGS_KEY].newValue)
  })
} catch (e) { /* no chrome.storage (e.g. tests) — extension stays enabled */ }

/* PDF prompt toast — when you navigate to a PDF, Chrome shows it in its native
   viewer, which has no hoverable text. This content script DOES run on that PDF
   tab's top frame (document.contentType === 'application/pdf'), so we surface a
   small, dismissible toast offering to reopen the PDF in Zilense's bundled viewer
   (real text layer → hover, lookup, selection; scanned PDFs get OCR). Top frame
   only; once dismissed it stays hidden for that page. Clicking "Open" asks the
   service worker to navigate this tab to the viewer. */
const PDF_TOAST_DISMISSED = 'mydict.pdfToastDismissed'
function maybeShowPdfToast() {
  if (window.top !== window) return // only the top frame, not embedded PDFs
  if (document.contentType !== 'application/pdf') return // only native PDF tabs
  try { if (sessionStorage.getItem(PDF_TOAST_DISMISSED)) return } catch (e) {}

  const host = document.createElement('div')
  host.id = 'mydict-pdf-toast-host'
  host.style.cssText =
    'all:initial;position:fixed;left:0;right:0;bottom:18px;z-index:2147483647;' +
    'display:flex;justify-content:center;pointer-events:none;'
  const root = host.attachShadow({ mode: 'open' })
  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  const t = dark
    ? { bg: '#2c2822', ink: '#ece3d2', ink3: '#b3a896', border: '#453f33' }
    : { bg: '#fbf7ee', ink: '#2a2520', ink3: '#9a9082', border: '#d8ccb5' }
  const style = document.createElement('style')
  style.textContent =
    '.toast{pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:92vw;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13.5px;' +
    `color:${t.ink};background:${t.bg};border:1px solid ${t.border};border-radius:12px;` +
    'padding:10px 12px 10px 14px;box-shadow:0 8px 30px rgba(0,0,0,.28)}' +
    '.msg{line-height:1.4}.msg b{font-weight:700}' +
    '.open{flex:none;font:inherit;font-weight:700;color:#fff;background:#c8443a;border:none;' +
    'border-radius:8px;padding:7px 13px;cursor:pointer}.open:hover{filter:brightness(1.06)}' +
    `.x{flex:none;font:inherit;color:${t.ink3};background:none;border:none;font-size:15px;` +
    'line-height:1;cursor:pointer;padding:4px 2px}'
  const card = document.createElement('div'); card.className = 'toast'
  const msg = document.createElement('div'); msg.className = 'msg'
  msg.innerHTML = '📄&nbsp; Open this PDF in <b>Zilense</b> to hover &amp; look up Chinese.'
  const open = document.createElement('button'); open.className = 'open'; open.textContent = 'Open in Zilense'
  const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', 'Dismiss')
  open.addEventListener('click', () => {
    try { chrome.runtime.sendMessage({ type: 'open-pdf', url: location.href }, () => void chrome.runtime.lastError) } catch (e) {}
  })
  x.addEventListener('click', () => {
    try { sessionStorage.setItem(PDF_TOAST_DISMISSED, '1') } catch (e) {}
    host.remove()
  })
  card.append(msg, open, x)
  root.append(style, card)
  ;(document.body || document.documentElement).appendChild(host)
}
maybeShowPdfToast()

// Subtitle overlay (pinyin + clickable words on supported video sites). Self-gates
// on a hostname check and the mydict.subs setting, so this is a no-op on every
// other page; the heavy engine is dynamically imported only when it activates.
initSubs()
