/* service-worker.js — opens the side panel, wires the right-click lookup, and
   answers on-page hover lookups. The worker owns a copy of the dictionary so the
   content script's hover highlight + inline popup work whether or not the side
   panel is open (the panel can't answer when it's closed). The worker also
   relays the hovered word to the panel so an open panel still displays it. */

import { setPendingLookup, stashReaderArticle, takeReaderArticle, clearReaderArticle } from '../lib/storage.js'
import cedictUrl from '../data/cedict.json?url'
import hskWordsUrl from '../data/hsk-words.json?url'
import * as core from '../lib/dict-core.js'

// Lazy dictionary load — fetched on the first hover and kept while the worker is
// alive (MV3 may evict it when idle; the next hover reloads). We only need DB for
// segmentLongest + lookup, so we skip the search-index build the panel does.
// This is the FULL ~14 MB dictionary: the hover path needs `entries` to produce
// the inline popup's definitions, so the worker keeping its own copy (separate
// from the panel's) is intentional — it lets hover work when the panel is closed.
// The HSK-highlight path does NOT need entries; it loads loadHskWords() instead.
let DB = null
let dbPromise = null
function loadDB() {
  if (DB) return Promise.resolve(DB)
  if (!dbPromise) {
    dbPromise = fetch(cedictUrl)
      .then((r) => { if (!r.ok) throw new Error('cedict.json HTTP ' + r.status); return r.json() })
      .then((d) => (DB = d))
      .catch((e) => { dbPromise = null; throw e })
  }
  return dbPromise
}

// Lazy HSK word→level map — a small standalone asset (~141 KB) so "highlight HSK
// ≤ N" never forces a full cedict.json parse. Wrapped as { hsk } because that's
// the only field core.hskWordsUpTo reads.
let hskDB = null
let hskPromise = null
function loadHskWords() {
  if (hskDB) return Promise.resolve(hskDB)
  if (!hskPromise) {
    hskPromise = fetch(hskWordsUrl)
      .then((r) => { if (!r.ok) throw new Error('hsk-words.json HTTP ' + r.status); return r.json() })
      .then((hsk) => (hskDB = { hsk }))
      .catch((e) => { hskPromise = null; throw e })
  }
  return hskPromise
}

// Hover lookup: the content script sends the forward run of characters under the
// cursor; we segment the longest word, look it up, and reply with how many chars
// to highlight + the pinyin/defs for the inline popup. Also push the word to the
// panel (no-op if it's closed) so an open panel keeps updating live on hover.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'hover' || typeof msg.text !== 'string') return
  loadDB()
    .then((db) => {
      const m = core.segmentLongest(db, msg.text)
      if (!m || !m.word) { sendResponse({ word: '', len: 1 }); return }
      const e = core.lookup(db, m.word)
      sendResponse({
        ...m,
        pinyin: e ? e.pinyin : '',
        gloss: e ? e.defs[0] : '', // kept for back-compat
        defs: e ? e.defs.slice(0, 6) : [],
        hskSenses: e && e.hskSenses ? e.hskSenses : [], // [{lvl,pos,def}] official HSK glosses
      })
      chrome.runtime.sendMessage({ type: 'show', q: m.word }, () => void chrome.runtime.lastError)
    })
    .catch(() => sendResponse({ word: '', len: 1 }))
  return true // async sendResponse — keep the channel open
})

// The content script asks for every HSK word up to a level so it can highlight
// them on the page (the "highlight HSK ≤ N" toolbar action). This only needs the
// small HSK map, so load that — not the full dictionary. Reply with [word, rank].
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'hsk-words') return
  loadHskWords()
    .then((db) => sendResponse({ words: core.hskWordsUpTo(db, msg.level | 0) }))
    .catch(() => sendResponse({ words: [] }))
  return true // async sendResponse
})

// Reader mode: the reader iframe sends the page's extracted paragraphs and asks
// the worker to segment each into word/char/punct tokens with tone-marked pinyin
// (for the ruby above each character), so the reader never needs its own copy of
// the dictionary. Same greedy segmentLongest + lookup the side panel uses
// (App.jsx). Hardened because the reader page is web-accessible and could be fed a
// crafted payload: the input is validated and
// hard-capped BEFORE any dictionary work, segmentation walks an index over a
// bounded code-point window (no O(n²) join-the-rest), and we yield to the event
// loop every few paragraphs so a long article can't starve hover/HSK messages.
const SEG_MAX_PARAS = 400 // paragraphs segmented per request
const SEG_MAX_CP = 4000 // code points considered per paragraph (rest truncated)
const SEG_WINDOW = 12 // segmentLongest only inspects this many leading code points
const SEG_YIELD_EVERY = 20 // paragraphs between event-loop yields

const yieldToLoop = () => new Promise((r) => setTimeout(r, 0))

function segmentPara(db, p) {
  const out = []
  const cps = [...String(p)].slice(0, SEG_MAX_CP) // code points, astral-safe + capped
  let i = 0
  while (i < cps.length) {
    const ch = cps[i]
    if (!core.HAN.test(ch)) { out.push({ t: ch, kind: 'punct' }); i++; continue }
    // segmentLongest reads at most SEG_WINDOW leading code points, so only join
    // that window instead of the whole remaining paragraph (the O(n²) hot path)
    const seg = core.segmentLongest(db, cps.slice(i, i + SEG_WINDOW).join(''))
    const word = seg ? seg.word : ch
    const e = core.lookup(db, word)
    out.push({ t: word, kind: [...word].length > 1 ? 'word' : 'char', py: e ? e.pinyin : '' })
    i += seg ? seg.len : 1
  }
  return out
}

// Reader article hand-off: the content script extracts the article and
// asks the worker to stash it; the worker (a trusted context) writes it to
// chrome.storage.session under a random nonce and returns the nonce, which the
// content script puts in the reader iframe's URL hash. The reader reads it back via
// storage.session — the host page is never trusted to deliver the article.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'reader-stash') return
  stashReaderArticle(msg.article || {})
    .then((nonce) => sendResponse({ nonce }))
    .catch(() => sendResponse({ nonce: '' }))
  return true // async sendResponse
})

// The reader page fetches its stashed article back through the worker (not by
// reading session storage from its framed context, and never from a parent
// postMessage). The nonce came in the reader's own URL hash; takeReaderArticle is
// one-use, so a replayed nonce yields nothing.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'reader-article' || typeof msg.nonce !== 'string') return
  takeReaderArticle(msg.nonce)
    .then((article) => sendResponse({ article: article || null }))
    .catch(() => sendResponse({ article: null }))
  return true // async sendResponse
})

// the content script aborted an open after stashing (reader closed mid-stash);
// drop the orphaned article now rather than waiting for the TTL sweep
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'reader-clear' || typeof msg.nonce !== 'string') return
  clearReaderArticle(msg.nonce)
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'segment' || !Array.isArray(msg.paras)) return
  // validate + hard-cap the payload before touching the dictionary
  const input = msg.paras.slice(0, SEG_MAX_PARAS).filter((p) => typeof p === 'string')
  loadDB()
    .then(async (db) => {
      const paras = []
      for (let n = 0; n < input.length; n++) {
        paras.push(segmentPara(db, input[n]))
        if ((n + 1) % SEG_YIELD_EVERY === 0) await yieldToLoop() // don't starve other messages
      }
      sendResponse({ paras })
    })
    .catch(() => sendResponse({ paras: [] }))
  return true // async sendResponse
})

// The toolbar icon opens an action popup (src/popup) rather than the panel
// directly — its "Open side panel" button calls sidePanel.open() from its own
// user gesture. (Pin-to-open and the context menu below open the panel too.)

const MENU_ID = 'mydict-lookup'
const READER_MENU_ID = 'mydict-reader'
const PDF_MENU_ID = 'mydict-pdf'

// the bundled PDF.js viewer page, with the target PDF URL in the hash (see
// src/pdfviewer/target.js). Shared by the context menu and the in-page PDF toast.
const pdfViewerUrl = (pdfUrl) =>
  chrome.runtime.getURL('src/pdfviewer/index.html') + '#file=' + encodeURIComponent(pdfUrl)

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Look up “%s” in Zilense',
    contexts: ['selection'],
  })
  // Open the current page in Reader mode (the content script extracts the article
  // and injects the reader overlay). Offered on the page and on a selection.
  chrome.contextMenus.create({
    id: READER_MENU_ID,
    title: 'Open in Zilense Reader',
    contexts: ['page', 'selection'],
  })
  // Open a PDF (the current page, or a right-clicked PDF link) in the bundled
  // viewer where hover works. Restricted to .pdf URLs. Cross-origin fetch needs
  // host access, which the viewer requests on demand (a content script / worker
  // can't); until granted the viewer shows a one-click "Allow & open". Re-created
  // on every onInstalled (idempotent across updates).
  chrome.contextMenus.create({
    id: PDF_MENU_ID,
    title: 'Open this PDF in Zilense',
    contexts: ['page', 'link'],
    documentUrlPatterns: ['*://*/*.pdf', 'file://*/*.pdf'],
    targetUrlPatterns: ['*://*/*.pdf', 'file://*/*.pdf'],
  })
})

// Pinning a word in the page asks the worker to open the side panel (if closed)
// and show the word. sidePanel.open() needs a user gesture; pinning is one, and
// the activation carries through this message, so open() must run synchronously
// here (don't await anything before it). Then stash the query and ONLY message
// the panel directly AFTER that write resolves — so a cold panel that mounts and
// calls takePendingLookup() always sees the pinned word, and an already-open
// panel gets the direct 'lookup'. Awaiting the write removes the earlier race
// where the direct message could fire before the pending value was visible.
function dispatchPanel(tabId, q) {
  if (tabId != null) {
    chrome.sidePanel.open({ tabId }).catch((e) => console.error('[mydict] sidePanel.open', e))
  }
  if (q) {
    setPendingLookup(q).then(() =>
      chrome.runtime.sendMessage({ type: 'lookup', q }, () => void chrome.runtime.lastError),
    )
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'open-panel') return
  const q = (msg.q || '').trim()
  // Page-hover pins carry sender.tab. The Reader iframe is an extension page
  // embedded in the tab, which Chrome normally also populates sender.tab for — but
  // that hasn't been browser-verified, so fall back to
  // the active tab if it's missing. The sender.tab path runs sidePanel.open()
  // synchronously to preserve the click's user activation; the fallback can still
  // deliver the lookup to an already-open panel even if open() needs a gesture.
  if (sender.tab && sender.tab.id != null) { dispatchPanel(sender.tab.id, q); return }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
    dispatchPanel(tabs && tabs[0] && tabs[0].id, q),
  )
})

// Open the dictionary in a detached, chromeless popup window — the "app-like"
// mode. Single-instance: the window id is remembered in session storage, so a
// repeat trigger focuses the existing window instead of opening another (with a
// stale-id fallback for a window the user has since closed). chrome.windows.create
// needs no user gesture, so both the toolbar menu (via the 'open-window' message)
// and the keyboard command can drive this from here — one source of truth for the
// window's size and single-instance behavior. ?mode=window tells App.jsx to draw
// its own brand header, since a popup window has no side-panel bar to supply one.
async function openDictWindow() {
  try {
    const { panelWindowId } = await chrome.storage.session.get('panelWindowId')
    if (panelWindowId != null) {
      try {
        await chrome.windows.get(panelWindowId) // throws if it was closed
        await chrome.windows.update(panelWindowId, { focused: true })
        return
      } catch {
        // stale id — the window is gone; fall through and open a fresh one
      }
    }
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('src/sidepanel/index.html') + '?mode=window',
      type: 'popup',
      width: 420,
      height: 680,
    })
    await chrome.storage.session.set({ panelWindowId: win.id })
  } catch (e) {
    console.error('[mydict] open window', e)
  }
}

// The toolbar menu's "Open in window" button delegates here (rather than calling
// chrome.windows.create itself) so the single-instance logic lives in one place.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'open-window') return
  openDictWindow()
})

// Keyboard shortcuts (manifest `commands`). Open-window goes through the shared
// opener above; open-side-panel runs sidePanel.open() for the active tab — the
// command invocation is the user gesture sidePanel.open() requires.
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-window') { openDictWindow(); return }
  if (command === 'open-side-panel') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const id = tabs && tabs[0] && tabs[0].id
      if (id == null) return
      chrome.sidePanel.open({ tabId: id }).catch((e) => console.error('[mydict] sidePanel.open', e))
    })
  }
})

// the in-page PDF toast (content script on a native PDF tab) asks the worker to
// reopen this tab's PDF in the bundled viewer. sender.tab.id is always available;
// the toast passes the PDF's URL (its own location.href).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'open-pdf') return
  const url = (msg.url || '').trim()
  const tabId = sender.tab && sender.tab.id
  if (url && tabId != null) chrome.tabs.update(tabId, { url: pdfViewerUrl(url) })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return
  // Reader mode: tell the tab's content script to extract + open the reader.
  if (info.menuItemId === READER_MENU_ID) {
    if (tab.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: 'reader-open' }, () => void chrome.runtime.lastError)
    }
    return
  }
  // PDF: navigate the tab to the bundled viewer for the right-clicked PDF (a link
  // URL) or the current PDF page.
  if (info.menuItemId === PDF_MENU_ID) {
    const pdfUrl = info.linkUrl || info.pageUrl
    if (pdfUrl && tab.id != null) chrome.tabs.update(tab.id, { url: pdfViewerUrl(pdfUrl) })
    return
  }
  if (info.menuItemId !== MENU_ID) return
  const q = (info.selectionText || '').trim()
  // Stash the query BEFORE opening so a cold panel (listener not yet registered)
  // still picks it up on mount via takePendingLookup(). Then also message the
  // panel directly — the fast path when it's already open.
  if (q) await setPendingLookup(q)
  try {
    await chrome.sidePanel.open({ tabId: tab.id })
  } catch (e) {
    console.error('[mydict] sidePanel.open', e)
  }
  if (q) chrome.runtime.sendMessage({ type: 'lookup', q }, () => void chrome.runtime.lastError)
})
