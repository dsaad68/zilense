/* overlay.js — the on-video subtitle overlay UI. Pure DOM (no chrome.* and no
   platform selectors): the engine injects the player element to mount into and the
   three callbacks below, so this file is the reusable renderer for both the
   single-track Phase 1 view and the stacked dual-track Phase 2 view.

     requestSegment(text) -> Promise<[{t,kind,py}]>   (worker `segment`)
     requestHover(word)   -> Promise<resp>            (worker `hover`, for the card)
     onPin(word)          -> void                     (worker `open-panel`)

   The overlay lives in a CLOSED shadow root. content.js's hover/select driver
   reads event.composedPath() to pierce OPEN shadow trees; a closed root is hidden
   from it, so the page's lookup never double-handles our words — the overlay wires
   its own hover/click instead. The host is pointer-events:none (clicks fall
   through to the player); only the words and the (cosmetic) card opt back in. */

import { tokensToRuby, containsHan } from './subs-core.js'

export const HOST_ID = 'mydict-subs-host'
const NATIVE_HIDE_ID = 'mydict-subs-native-hide'

/* applyNativeHide / removeNativeHide — hide the platform's own caption text while
   our overlay stands in for it, and restore it when the feature is turned off
   (reversibility). We keep the native node in the DOM (just hidden) so the Phase 1
   MutationObserver can still scrape the line it renders; only the ink is
   suppressed. Generic + side-effect-scoped to one <style> id, so it's
   unit-testable against a bare document. */
export function applyNativeHide(doc, selector) {
  if (!doc || !selector) return
  let el = doc.getElementById(NATIVE_HIDE_ID)
  if (!el) {
    el = doc.createElement('style')
    el.id = NATIVE_HIDE_ID
    ;(doc.head || doc.documentElement).appendChild(el)
  }
  // visibility:hidden (not display:none) so the player keeps updating the caption
  // text the observer scrapes; visibility:hidden also drops the node from caret
  // hit-testing, so the page's own hover lookup can't grab the now-invisible
  // native caption sitting behind our overlay. pointer-events:none for good measure.
  el.textContent = selector + '{visibility:hidden!important;pointer-events:none!important;}'
}
export function removeNativeHide(doc) {
  const el = doc && doc.getElementById(NATIVE_HIDE_ID)
  if (el) el.remove()
}

const STYLE = `
:host{ all:initial; }
.wrap{
  position:absolute; left:0; right:0; bottom:10%;
  display:flex; flex-direction:column; align-items:center; gap:6px;
  padding:0 6%; pointer-events:none; text-align:center;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
  /* tone palette (the side panel / reader --t1..--t5 paper values) */
  --t1:#e8b84b; --t2:#79c98d; --t3:#7fb4d6; --t4:#ef7d72; --t5:#ccc2b3;
  --sub-bg:rgba(8,8,8,.78);
}
.line{
  display:inline-flex; flex-wrap:wrap; justify-content:center; align-items:flex-end;
  max-width:100%; background:var(--sub-bg); color:#fff; border-radius:8px;
  padding:4px 10px; line-height:1.25;
}
.line.l1{ font-size:clamp(20px,3.4vw,34px); }
.line.l2{ font-size:clamp(15px,2.4vw,24px); color:#f1ece3; }
.line:empty{ display:none; }
.w{ pointer-events:auto; cursor:pointer; border-radius:5px; padding:0 1px; transition:background .1s,color .1s; }
.w:hover{ background:rgba(255,255,255,.16); }
.w.active{ background:rgba(255,255,255,.24); }
.punct{ white-space:pre; }
/* ruby columns: pinyin stacked over each character (ported from reader.css) */
.zr{ display:inline-flex; flex-direction:column; align-items:center; }
.zr .ch{ line-height:1; padding:0 1px; }
.zr .py{
  font-size:.42em; line-height:1.2; font-weight:600; letter-spacing:0;
  margin-bottom:.18em; white-space:nowrap; color:#e7dfd0;
}
.py.tone-1{ color:var(--t1); } .py.tone-2{ color:var(--t2); }
.py.tone-3{ color:var(--t3); } .py.tone-4{ color:var(--t4); } .py.tone-5{ color:var(--t5); }
/* cosmetic hover card (the real detail view is the side panel) */
.card{
  position:absolute; z-index:2; pointer-events:none; max-width:300px;
  background:#fbf7ee; color:#2a2520; border:1px solid #d8ccb5; border-radius:10px;
  box-shadow:0 8px 28px rgba(0,0,0,.35); padding:8px 11px;
  font-size:13px; line-height:1.4; text-align:left; display:none;
}
.card .hw{ font-size:17px; font-weight:600; margin-right:6px; }
.card .hpy{ font-size:13px; font-weight:600; color:#c8443a; }
.card .hd{ color:#6b6258; display:flex; gap:5px; }
.card .hd .n{ color:#9a9082; flex:none; font-variant-numeric:tabular-nums; }
/* settings affordance: a faint glyph button top-right that opens a small menu to
   choose the two languages, toggle pinyin, and opt in to auto-translation */
.ctrl{ position:absolute; top:10px; right:12px; z-index:3; pointer-events:auto;
  display:none; flex-direction:column; align-items:flex-end; gap:6px; }
.gear{ width:30px; height:30px; border-radius:8px; border:none; cursor:pointer;
  background:rgba(8,8,8,.6); color:#fff; font-size:15px; line-height:1; opacity:.5;
  transition:opacity .15s,background .15s; font-family:inherit; }
.gear:hover, .ctrl.open .gear{ opacity:1; background:rgba(8,8,8,.82); }
.menu{ display:none; background:rgba(18,18,18,.95); color:#f1ece3; border-radius:10px;
  padding:10px 12px; min-width:210px; box-shadow:0 8px 28px rgba(0,0,0,.5);
  font-size:12px; text-align:left; }
.ctrl.open .menu{ display:block; }
.menu .mrow{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin:5px 0; }
.menu .mlabel{ color:#cdc6ba; }
.menu select{ max-width:130px; background:#2a2620; color:#f1ece3; border:1px solid #4a4438;
  border-radius:6px; padding:3px 5px; font-size:12px; font-family:inherit; }
.menu input[type=checkbox]{ accent-color:#c8443a; width:15px; height:15px; }
`

// build the ruby/plain DOM for one Han word token, with its click + hover wiring
function buildWord(model, prefs, handlers) {
  const span = document.createElement('span')
  span.className = 'w ' + model.kind
  span.dataset.q = model.word
  if (prefs.pinyin) {
    for (const ch of model.chars) {
      const col = document.createElement('span'); col.className = 'zr'
      const py = document.createElement('span')
      py.className = 'py' + (prefs.tones && ch.tone ? ' tone-' + ch.tone : '')
      py.textContent = ch.py || ' '
      const c = document.createElement('span'); c.className = 'ch'; c.textContent = ch.c
      col.append(py, c)
      span.appendChild(col)
    }
  } else {
    span.textContent = model.word
  }
  span.addEventListener('mouseenter', (e) => handlers.enter(model.word, span, e))
  span.addEventListener('mouseleave', () => handlers.leave())
  span.addEventListener('click', (e) => { e.stopPropagation(); handlers.click(model.word, span) })
  return span
}

// render a ruby model into a line element (clearing it first)
function paintRuby(lineEl, model, prefs, handlers) {
  lineEl.textContent = ''
  for (const part of model) {
    if (part.kind === 'punct') {
      const s = document.createElement('span'); s.className = 'punct'; s.textContent = part.text
      lineEl.appendChild(s)
    } else {
      lineEl.appendChild(buildWord(part, prefs, handlers))
    }
  }
}

export function createOverlay({ requestSegment, requestHover, onPin }) {
  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:60;'
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style'); style.textContent = STYLE
  const wrap = document.createElement('div'); wrap.className = 'wrap'
  const l1 = document.createElement('div'); l1.className = 'line l1'; l1.lang = 'zh'
  const l2 = document.createElement('div'); l2.className = 'line l2'
  const card = document.createElement('div'); card.className = 'card'
  wrap.append(l1, l2, card)

  // settings affordance (populated by setControls in the dual-track path)
  const ctrl = document.createElement('div'); ctrl.className = 'ctrl'
  const gear = document.createElement('button'); gear.className = 'gear'; gear.textContent = '字'
  gear.title = 'Subtitle languages'; gear.setAttribute('aria-label', 'Subtitle settings')
  const menu = document.createElement('div'); menu.className = 'menu'
  ctrl.append(gear, menu)
  gear.addEventListener('click', () => ctrl.classList.toggle('open'))

  root.append(style, wrap, ctrl)

  let prefs = { pinyin: true, tones: true }
  let seg1 = 0 // invalidates a stale async segment when the line changed again
  let hoverSeq = 0 // invalidates a stale hover response after the mouse moved on
  let lastL1 = '' // last raw text rendered on line 1 (skip redundant re-segments)
  let lastL2 = ''

  const showCard = (resp, anchor) => {
    if (!resp || !resp.word || !((resp.defs && resp.defs.length) || resp.pinyin)) { hideCard(); return }
    card.textContent = ''
    const head = document.createElement('div')
    const w = document.createElement('span'); w.className = 'hw'; w.lang = 'zh'; w.textContent = resp.word
    const py = document.createElement('span'); py.className = 'hpy'; py.textContent = resp.pinyin || ''
    head.append(w, py); card.appendChild(head)
    const defs = (resp.defs && resp.defs.length ? resp.defs : (resp.gloss ? [resp.gloss] : [])).slice(0, 3)
    defs.forEach((d, i) => {
      const row = document.createElement('div'); row.className = 'hd'
      if (defs.length > 1) { const n = document.createElement('span'); n.className = 'n'; n.textContent = (i + 1) + '.'; row.appendChild(n) }
      const t = document.createElement('span'); t.textContent = d; row.appendChild(t)
      card.appendChild(row)
    })
    card.style.display = 'block'
    // place the card above the hovered word, clamped to the wrap's width
    const wr = wrap.getBoundingClientRect()
    const ar = anchor.getBoundingClientRect()
    let left = ar.left - wr.left + ar.width / 2 - card.offsetWidth / 2
    left = Math.max(0, Math.min(left, wr.width - card.offsetWidth))
    card.style.left = left + 'px'
    card.style.bottom = (wr.bottom - ar.top + 8) + 'px'
  }
  const hideCard = () => { card.style.display = 'none' }

  const handlers = {
    enter(word, span, _e) {
      span.classList.add('active')
      const seq = ++hoverSeq
      Promise.resolve(requestHover ? requestHover(word) : null).then((resp) => {
        if (seq !== hoverSeq) return // moved on
        showCard(resp, span)
      })
    },
    leave() { hoverSeq++; hideCard(); for (const el of root.querySelectorAll('.w.active')) el.classList.remove('active') },
    click(word) { hideCard(); if (onPin) onPin(word) },
  }

  // line 1 — the annotated line. Han text is segmented (worker) then rubied;
  // non-Han text is shown plainly (so the same setter works for any language).
  async function setLine1(text) {
    const t = String(text || '').trim()
    if (t === lastL1) return
    lastL1 = t
    const myGen = ++seg1
    if (!t) { l1.textContent = ''; hideCard(); return }
    if (!containsHan(t)) { l1.textContent = t; return } // non-Chinese line: show plainly
    let tokens = []
    try { tokens = (await requestSegment(t)) || [] } catch (e) { tokens = [] }
    if (myGen !== seg1) return // line changed while we were segmenting
    if (!tokens.length) { l1.textContent = t; return }
    paintRuby(l1, tokensToRuby(tokens), prefs, handlers)
  }

  function setLine2(text) {
    const t = String(text || '').trim()
    if (t === lastL2) return
    lastL2 = t
    l2.textContent = t
  }

  function setPrefs(next) {
    prefs = { ...prefs, ...next }
    // re-render line 1 so a pinyin/tone toggle takes effect immediately
    const t = lastL1; lastL1 = ' '; setLine1(t)
  }

  // build the language <select> options: every real caption track, then (only when
  // the user has opted into machine translation) the languages YouTube can
  // auto-translate into that aren't already a real track. value = language code.
  function fillLangSelect(sel, tracks, targets, allowAuto, selected, withNone) {
    sel.textContent = ''
    if (withNone) { const o = document.createElement('option'); o.value = ''; o.textContent = 'None'; sel.appendChild(o) }
    const seen = new Set()
    for (const t of tracks) {
      seen.add(t.lang)
      const o = document.createElement('option'); o.value = t.lang
      o.textContent = t.name + (t.kind === 'asr' ? ' (auto)' : '')
      sel.appendChild(o)
    }
    if (allowAuto) for (const tg of targets) {
      if (seen.has(tg.lang)) continue
      const o = document.createElement('option'); o.value = tg.lang
      o.textContent = tg.name + ' (YouTube auto-translation)'
      sel.appendChild(o)
    }
    sel.value = selected || (sel.options[0] ? sel.options[0].value : '')
  }

  /* setControls(opts) — show/refresh the language picker. opts.tracks empty/absent
     (the Phase 1 scrape path) hides the gear entirely. Otherwise it renders the two
     language selects + the pinyin and auto-translation toggles, reflecting the
     CURRENTLY displayed selection (lang1/lang2 resolved by the engine), and calls
     opts.onChange(patch) when the user changes anything. */
  function setControls(opts) {
    const o = opts || {}
    if (!o.tracks || !o.tracks.length) { ctrl.style.display = 'none'; return }
    ctrl.style.display = 'flex'
    menu.textContent = ''
    const tracks = o.tracks, targets = o.targets || []
    const mk = (labelText, node) => {
      const row = document.createElement('div'); row.className = 'mrow'
      const l = document.createElement('span'); l.className = 'mlabel'; l.textContent = labelText
      row.append(l, node); menu.appendChild(row); return row
    }
    const top = document.createElement('select')
    fillLangSelect(top, tracks, targets, o.allowAuto, o.lang1, false)
    top.addEventListener('change', () => o.onChange && o.onChange({ lang1: top.value }))
    mk('Top', top)

    const bottom = document.createElement('select')
    fillLangSelect(bottom, tracks, targets, o.allowAuto, o.lang2, true)
    bottom.addEventListener('change', () => o.onChange && o.onChange({ lang2: bottom.value }))
    mk('Bottom', bottom)

    const py = document.createElement('input'); py.type = 'checkbox'; py.checked = prefs.pinyin !== false
    py.addEventListener('change', () => o.onChange && o.onChange({ pinyin: py.checked }))
    mk('Pinyin', py)

    const auto = document.createElement('input'); auto.type = 'checkbox'; auto.checked = !!o.allowAuto
    auto.addEventListener('change', () => o.onChange && o.onChange({ allowAuto: auto.checked }))
    mk('Allow auto-translation', auto)
  }

  function clear() { lastL1 = ''; lastL2 = ''; l1.textContent = ''; l2.textContent = ''; hideCard() }

  function destroy() { hoverSeq++; seg1++; host.remove() }

  return { host, setLine1, setLine2, setPrefs, setControls, clear, destroy }
}
