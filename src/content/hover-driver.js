/* hover-driver.js — the on-page lookup driver, factored out of content.js so it
   can run in BOTH places that need cursor-driven hover:
     • the all-pages content script (content.js), and
     • the bundled PDF.js viewer page (src/pdfviewer), whose text layer is real DOM.

   It is DOM-and-messaging only — it attaches mouse/key listeners, resolves the
   character/word under the cursor via the caret API, asks the service worker to
   segment+look up the word (the worker owns the dictionary), and paints the CSS
   Custom Highlight + inline popup + pin box. It does NOT depend on being a content
   script: chrome.runtime messaging and chrome.storage work the same on an
   extension page, which is why the PDF viewer can reuse it unchanged.

   Driving behaviour:
     • hover  -> longest dictionary WORD starting at the character under the cursor
                 (新闻 -> the 2-char word "news"), collected ACROSS adjacent text
                 nodes so a word split over inline elements (新<span>闻</span>) — or
                 over two PDF.js text-layer spans — still matches.
     • click  -> PIN that word (the panel locks onto it); click it again / empty
                 space to unpin.
     • select -> look up the highlighted run; the live selection also locks hover.

   Call initHoverDriver() once. It returns { destroy, clearHover }:
     • destroy()    — removes every listener (used by tests and teardown).
     • clearHover() — clears the live hover token + popup (content.js calls this
                      when the site is added to the hover-disabled list).

   Options:
     • allowDisable — optional () => boolean. When it returns true the driver is
                      fully inert — hover, click/Alt-click/hotkey pin, AND selection
                      lookup all stop. content.js passes its combined per-site +
                      global-master predicate; the PDF viewer omits it (our own page
                      is never "disabled"). */

import { isHanChar, normalizeSelection, shouldLookupSelection, charAt } from './content-core.js'
import { collectForward, textOf } from './word-walk.js'

const SETTINGS_KEY = 'mydict.settings'

export function initHoverDriver(opts = {}) {
  const allowDisable = typeof opts.allowDisable === 'function' ? opts.allowDisable : null
  // "disabled here" = the caller's predicate says so (site in the disabled list, or
  // the global master switch is off). When true the WHOLE driver goes inert: hover,
  // click/Alt-click/hotkey pinning, AND selection lookup. (Previously only hover was
  // gated, so a click on a disabled site still opened the panel.)
  const isDisabled = () => !!(allowDisable && allowDisable())
  // optional predicate (node) => boolean. When true for the text node under the
  // cursor, the visual overlays (hover token highlight + pin box) are NOT painted —
  // the popup and panel lookup still work. The PDF viewer uses this for OCR'd
  // (scanned) pages, where the synthesized text layer doesn't align pixel-perfectly
  // with the page image, so a highlight box would sit slightly off the glyphs.
  const suppressHighlight = typeof opts.suppressHighlight === 'function' ? opts.suppressHighlight : null
  const noPaint = (positions) => !!(suppressHighlight && positions && positions[0] && suppressHighlight(positions[0].node))

  let selecting = false
  let rafPending = false
  let lastNode = null
  let lastIndex = -1
  let pinned = null // { positions: [{node, offset}, …] } for the locked word, or null
  let hoverWord = null // { positions, len } currently under the cursor (for the pin hotkey)

  // live copy of the relevant panel settings (kept in sync via chrome.storage)
  const settings = { accent: '#c8443a', pinKey: 'p', inlinePopup: true, hskFirst: false, dark: false }

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
    // skip the visual pin overlay on imprecise (OCR) layers; the panel still opens
    if (!noPaint(positions)) {
      setHighlight('mydict-pin', positions, len)
      drawPinBox(positions, len)
    }
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

  function onMouseMove(e) {
    if (isDisabled()) return // extension off here — no hover
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
        if (!noPaint(positions)) setHighlight('mydict-tok', positions, len)
        hoverWord = positions.length ? { positions, len } : null
        if (settings.inlinePopup) showPopup(x, y, resp)
      })
    })
  }

  function onMouseDown() {
    selecting = true
    clearHover()
  }

  function onMouseUp(e) {
    selecting = false
    if (isDisabled()) return // extension off here — no pin, no selection lookup
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
  }

  // Alt/Option-click pins a word WITHOUT following a link — capture-phase and
  // non-passive so we can preventDefault the navigation that a plain click on a
  // hyperlinked word would otherwise trigger.
  function onAltClick(e) {
    if (isDisabled()) return // extension off here
    if (!e.altKey || e.button !== 0) return
    const roots = shadowRootsFromPath(e)
    const hit = charAtPoint(e.clientX, e.clientY, roots)
    if (!hit) return
    e.preventDefault()
    e.stopPropagation()
    pinAt(hit)
  }

  // Hover-pin hotkey: with a word under the cursor (and focus not in an editable
  // field), pressing the configured key pins it — works on links with no click.
  function onKeyDown(e) {
    if (isDisabled()) return // extension off here — hotkey pin disabled
    const key = (settings.pinKey || 'p').toLowerCase()
    if (!key || e.ctrlKey || e.metaKey || e.altKey) return
    if ((e.key || '').toLowerCase() !== key) return
    const ae = document.activeElement
    if (ae && (ae.isContentEditable || /^(input|textarea|select)$/i.test(ae.tagName || ''))) return
    if (!hoverWord) return
    e.preventDefault()
    pinWord(hoverWord.positions, hoverWord.len)
  }

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
      // part-of-speech, serif italic + gray like the side panel (only on multi-sense
      // rows); serif stack mirrors the panel's --font-en
      '.hsk .pos{flex:none;font-family:"Source Serif 4",Georgia,"Times New Roman",serif;' +
      'font-style:italic;color:var(--p-ink3,#9a9082)}' +
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
      row.append(tag)
      // multi-sense rows show the POS first, italic + gray, like the side panel
      if (multi && s.pos) {
        const pos = document.createElement('span'); pos.className = 'pos'; pos.textContent = s.pos
        row.append(pos)
      }
      const txt = document.createElement('span'); txt.textContent = s.def
      row.append(txt)
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

  function onScroll() { if (pinState) positionPinBox(); hidePopup() }
  function onResize() { if (pinState) positionPinBox() }

  /* Accent-colored highlights — the on-page hover/pin colors follow the panel's
     accent setting so the highlight matches the chosen UI color (e.g. Jade green).
     We read the stored accent and inject an author stylesheet that overrides the
     ::highlight() rules from content.css; storage.onChanged keeps it live when the
     user picks a different swatch. content.css still carries the default color, so
     highlighting works before this resolves and in contexts without storage. */
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

  // sync the panel settings the driver cares about: accent (highlights + pin box),
  // pinKey (hotkey), and inlinePopup (mini-popup on/off)
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

  function onStorageChanged(changes, area) {
    if (area !== 'local') return
    if (changes[SETTINGS_KEY]) applySettings(changes[SETTINGS_KEY].newValue)
  }

  // wire listeners
  document.addEventListener('mousemove', onMouseMove, { passive: true })
  document.addEventListener('mousedown', onMouseDown, { passive: true })
  document.addEventListener('mouseup', onMouseUp, { passive: true })
  document.addEventListener('click', onAltClick, true)
  document.addEventListener('keydown', onKeyDown, true)
  // keep the pinned box aligned through scroll/resize; hide the popup on scroll
  window.addEventListener('scroll', onScroll, { passive: true, capture: true })
  window.addEventListener('resize', onResize, { passive: true })

  // initial settings + live updates (accent/pinKey/inlinePopup/etc.)
  try {
    chrome.storage?.local.get([SETTINGS_KEY], (got) => {
      if (chrome.runtime.lastError) return
      applySettings(got && got[SETTINGS_KEY])
    })
    chrome.storage?.onChanged.addListener(onStorageChanged)
  } catch (e) { /* no chrome.storage (e.g. tests) — content.css default applies */ }

  function destroy() {
    document.removeEventListener('mousemove', onMouseMove, { passive: true })
    document.removeEventListener('mousedown', onMouseDown, { passive: true })
    document.removeEventListener('mouseup', onMouseUp, { passive: true })
    document.removeEventListener('click', onAltClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('scroll', onScroll, { passive: true, capture: true })
    window.removeEventListener('resize', onResize, { passive: true })
    try { chrome.storage?.onChanged.removeListener(onStorageChanged) } catch (e) {}
    clearHover()
    unpin()
  }

  return { destroy, clearHover, unpin }
}
