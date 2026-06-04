/* flashcards.js — the Zilense flashcards page.

   Ported from the standalone trainer's inline script (flashcard/html), with two
   data layers swapped out:
     • the deck is built live — starred words (chrome.storage) or an HSK band
       (the bundled dictionary) — instead of a hardcoded HSK-1 array;
     • progress lives in a single local store (progress.js), no recovery-key
       login.
   The round + results UI/logic is unchanged: cards are { id, w, p, m }. */

import { loadDict, lookup, allHskSenses } from '../lib/dict.js'
import { loadState } from '../lib/storage.js'
import { toAnkiTsv } from '../lib/anki.js'
import * as Progress from './progress.js'

// ─── Theme ──────────────────────────────────────────────────────
const THEME_KEY = 'zilense.flashcards.theme'
// Anti-flash: apply the saved theme as soon as this module runs (the inline
// <head> script that used to do this is blocked by the extension's CSP, which
// forbids inline scripts — this bundled module is 'self', so it's allowed).
try {
  if (localStorage.getItem(THEME_KEY) === 'dark') {
    document.documentElement.dataset.theme = 'dark'
  }
} catch (e) {}
function applyTheme(dark) {
  const html = document.documentElement
  if (dark) html.dataset.theme = 'dark'
  else delete html.dataset.theme
  updateToggleLabel()
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme !== 'dark'
  applyTheme(dark)
  try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light') } catch (e) {}
}
function updateToggleLabel() {
  const dark = document.documentElement.dataset.theme === 'dark'
  document.querySelectorAll('.theme-toggle .label').forEach((el) => {
    el.textContent = dark ? 'Dark' : 'Light'
  })
}

// ─── Screen routing ─────────────────────────────────────────────
function show(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'))
  document.getElementById('screen-' + name).classList.add('active')
  window.scrollTo({ top: 0, behavior: 'instant' })
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.screen.active .seg-pill').forEach(updateSegIndicator)
    })
  })
}

// ─── Sliding seg-pill indicator ─────────────────────────────────
function updateSegIndicator(seg) {
  const checked = seg.querySelector('input[type="radio"]:checked')
  if (!checked) { seg.dataset.ready = 'false'; return }
  const label = checked.closest('label')
  if (!label || label.offsetWidth === 0) { seg.dataset.ready = 'false'; return }
  seg.style.setProperty('--ind-top', label.offsetTop + 'px')
  seg.style.setProperty('--ind-left', label.offsetLeft + 'px')
  seg.style.setProperty('--ind-width', label.offsetWidth + 'px')
  seg.style.setProperty('--ind-height', label.offsetHeight + 'px')
  seg.dataset.ready = 'true'
}
function initSegIndicators() {
  document.querySelectorAll('.seg-pill').forEach((seg) => {
    seg.dataset.ready = 'false'
    seg.querySelectorAll('input[type="radio"]').forEach((input) => {
      input.addEventListener('change', () => updateSegIndicator(seg))
    })
    updateSegIndicator(seg)
  })
}
let segResizeTimer = 0
addEventListener('resize', () => {
  clearTimeout(segResizeTimer)
  segResizeTimer = setTimeout(() => {
    document.querySelectorAll('.seg-pill').forEach(updateSegIndicator)
  }, 60)
})

// ─── Toast ──────────────────────────────────────────────────────
let toastTimer = 0
function toast(msg, kind) {
  const el = document.getElementById('toast')
  el.className = 'toast show' + (kind ? ' ' + kind : '')
  el.textContent = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 1100)
}

// ─── Small file-download helper (Blob + <a download>) ───────────
function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
function dateStr() { return new Date().toISOString().slice(0, 10) }

// ============================================================
// DECK BUILDING
// ============================================================
// A card is { id, w, p, m }: id (== the word) keys progress; w/p/m drive the UI.
let ALL = [] // the current deck

// turn a simplified word into a card by looking it up in the dictionary. For an
// HSK-band deck, prefer the meaning(s) from that band's vocab list (a word can sit
// in several bands with a different gloss in each), falling back to the generic
// dictionary definition when the word carries no HSK sense at that band.
// merge POS strings ("verb; noun" + "noun") into a deduped "verb; noun"
function joinPos(list) {
  const out = []
  for (const p of list) {
    for (const part of String(p || '').split(';').map((x) => x.trim()).filter(Boolean)) {
      if (!out.includes(part)) out.push(part)
    }
  }
  return out.join('; ')
}

function toCard(w, band) {
  const e = lookup(w)
  let m = '', pos = ''
  if (band && e && e.hskSenses) {
    const label = band === 7 ? '7-9' : String(band)
    const at = e.hskSenses.filter((s) => String(s.lvl) === label)
    m = at.map((s) => s.def).filter(Boolean).slice(0, 2).join('; ')
    pos = joinPos(at.map((s) => s.pos))
  }
  if (!m) m = e ? (e.defs || []).slice(0, 2).join('; ') : ''
  if (!pos) pos = e ? (e.pos || '') : ''
  return { id: w, w, p: e ? e.pinyin : '', m, pos }
}

// one flashcard for a single HSK sense. Meaning, pinyin and POS all come straight
// from the HSK vocab list (the `s` sense); CC-CEDICT is only a pinyin fallback for
// the rare sense whose list row had no pinyin. `idx` is the sense's position among
// the word's picked senses — null when the word contributes a single card, so its
// id stays the plain word.
function senseCard(w, s, idx, ambig) {
  return {
    id: idx == null ? w : `${w}#${idx}`,
    w,
    p: s.py || (lookup(w)?.pinyin ?? ''),
    m: s.def,
    pos: s.pos || '',
    ambig, // word has more than one meaning in this deck → POS shown on the front to disambiguate
  }
}

// band rank of a sense's level ('7-9' -> 7)
function senseRank(s) { return s.lvl === '7-9' ? 7 : Number(s.lvl) }

// build the deck for a deck value: 'starred' or 'hsk1'..'hsk7' (7 ⇒ 7–9).
// HSK decks are built ENTIRELY from the HSK vocab lists (no CC-CEDICT gating), one
// CARD PER SENSE — a word with two meanings at a band (花 [verb] spend / [noun]
// flower) becomes two cards — so the deck size equals the vocab list's row count.
// `setup.scope` picks 'exact' (senses at just this level) or 'cumulative' (every
// sense up to this level).
async function buildDeck(deckId) {
  if (deckId === 'starred') {
    const { saved } = await loadState()
    return saved.map((w) => toCard(w))
  }
  const band = Number(String(deckId).replace('hsk', '')) || 1
  const exactLabel = band === 7 ? '7-9' : String(band)
  const senses = allHskSenses()
  const cards = []
  for (const w of Object.keys(senses)) {
    const picked = senses[w].filter((s) =>
      setup.scope === 'cumulative' ? senseRank(s) <= band : String(s.lvl) === exactLabel
    )
    // multiCard → the word yields >1 card (needs unique ids). posAmbig → those
    // cards differ in POS, so showing the POS on the front actually disambiguates
    // which meaning is being asked (花 verb/noun yes; 得 particle/particle no).
    const multiCard = picked.length > 1
    const posAmbig = new Set(picked.map((s) => s.pos || '')).size > 1
    picked.forEach((s, i) => cards.push(senseCard(w, s, multiCard ? i : null, posAmbig)))
  }
  return cards
}

async function selectDeck(deckId) {
  setup.deck = deckId
  // the level-scope choice only applies to HSK decks
  document.getElementById('scope-control').hidden = deckId === 'starred'
  ALL = await buildDeck(deckId)
  goHome()
}

function deckBandLabel() {
  return setup.deck === 'hsk7' ? '7–9' : setup.deck.replace('hsk', '')
}
function refreshDeckHint() {
  const el = document.getElementById('deck-hint')
  if (setup.deck === 'starred') {
    el.textContent = ALL.length
      ? `${ALL.length} starred word${ALL.length > 1 ? 's' : ''}`
      : 'No starred words yet — star words in the dictionary, or pick an HSK level'
  } else {
    const scope = setup.scope === 'cumulative' ? `up to HSK ${deckBandLabel()}` : `HSK ${deckBandLabel()}`
    el.textContent = `${ALL.length} words ${setup.scope === 'cumulative' ? '' : 'in '}${scope}`
  }
}

// ============================================================
// HOME / SETUP
// ============================================================
const setup = {
  deck: 'starred',
  scope: 'exact', // 'exact' (just this level) | 'cumulative' (up to this level) — HSK decks only
  source: 'all', // 'all' | 'unseen' | 'wrong-recent' | 'wrong-ever'
  size: 20, // number | 'all'
  qmode: 'character',
  pinyin: true,
  pos: false, // show part of speech with the meaning
  order: 'random',
}

function refreshHomeStats() {
  const s = Progress.stats(ALL)
  document.getElementById('hs-seen').textContent = s.seen
  document.getElementById('hs-correct').textContent = s.correct
  document.getElementById('hs-wrong').textContent = s.wrong
  document.getElementById('hs-unseen').textContent = s.unseen
  document.getElementById('hs-acc').textContent = s.reviews ? s.accuracy + ' %' : '— %'
}

function effectiveSourceType() { return setup.source }
function poolSize() { return Progress.filter(ALL, effectiveSourceType()).length }

function refreshPoolHelp() {
  const n = poolSize()
  const labels = {
    all: 'words available',
    unseen: 'unseen words available',
    'wrong-recent': 'recently missed available',
    'wrong-ever': 'ever-missed available',
  }
  document.getElementById('pool-count').textContent = `${n} ${labels[effectiveSourceType()] || 'words available'}`
  refreshSummary()
}

function refreshSummary() {
  const n = poolSize()
  const sizeShown = setup.size === 'all' ? n : Math.min(setup.size, n)
  const direction = setup.qmode === 'character' ? 'character → meaning' : 'meaning → character'
  const orderTxt = setup.order === 'random' ? 'random' : 'sequential'
  const pinyinTxt = setup.qmode === 'character' && setup.pinyin ? ' · pinyin on top' : ''
  document.getElementById('round-summary').innerHTML =
    `<strong>${sizeShown} cards</strong> · ${orderTxt} order · ${direction}${pinyinTxt}`
  document.getElementById('start-btn').disabled = n === 0
}

function goHome() {
  show('home')
  refreshDeckHint()
  refreshHomeStats()
  refreshPoolHelp()
}

// Deck — custom dropdown (themed replacement for the native <select>)
function initDeckDropdown() {
  const dd = document.getElementById('deck-dd')
  const btn = document.getElementById('deck-dd-btn')
  const menu = document.getElementById('deck-dd-menu')
  const labelEl = document.getElementById('deck-dd-label')
  const opts = [...menu.querySelectorAll('.dropdown-opt')]
  let activeIdx = 0

  function setActive(i) {
    activeIdx = (i + opts.length) % opts.length
    opts.forEach((o, j) => o.classList.toggle('active', j === activeIdx))
    opts[activeIdx].scrollIntoView({ block: 'nearest' })
  }
  function isOpen() { return menu.classList.contains('open') }
  function open() {
    menu.classList.add('open'); btn.setAttribute('aria-expanded', 'true')
    const sel = opts.findIndex((o) => o.getAttribute('aria-selected') === 'true')
    setActive(sel < 0 ? 0 : sel)
    menu.focus()
    document.addEventListener('pointerdown', onDocDown, true)
  }
  function close() {
    menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', onDocDown, true)
  }
  function onDocDown(e) { if (!dd.contains(e.target)) close() }
  function choose(opt) {
    opts.forEach((o) => o.setAttribute('aria-selected', String(o === opt)))
    labelEl.textContent = opt.textContent
    close(); btn.focus()
    selectDeck(opt.dataset.value)
  }

  btn.addEventListener('click', () => (isOpen() ? close() : open()))
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
  })
  opts.forEach((o) => o.addEventListener('click', () => choose(o)))
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); btn.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(opts.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(opts[activeIdx]) }
  })
}
initDeckDropdown()
// Level scope (HSK decks): rebuild the deck for the new exact/cumulative choice
document.querySelectorAll('input[name="scope"]').forEach((r) => {
  r.addEventListener('change', async () => {
    setup.scope = r.value
    ALL = await buildDeck(setup.deck)
    goHome()
  })
})
// Source pool radios
document.querySelectorAll('input[name="source"]').forEach((r) => {
  r.addEventListener('change', () => { setup.source = r.value; refreshPoolHelp() })
})
// Size chips
document.querySelectorAll('.size-chip').forEach((c) => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.size-chip').forEach((x) => x.setAttribute('aria-pressed', 'false'))
    c.setAttribute('aria-pressed', 'true')
    document.getElementById('size-custom').value = ''
    setup.size = c.dataset.size === 'all' ? 'all' : parseInt(c.dataset.size, 10)
    refreshSummary()
  })
})
document.getElementById('size-custom').addEventListener('input', (e) => {
  const n = parseInt(e.target.value, 10)
  if (Number.isFinite(n) && n > 0) {
    document.querySelectorAll('.size-chip').forEach((x) => x.setAttribute('aria-pressed', 'false'))
    setup.size = n
  }
  refreshSummary()
})
// Question mode / order / pinyin
document.querySelectorAll('input[name="qmode"]').forEach((r) => {
  r.addEventListener('change', () => { setup.qmode = r.value; refreshSummary() })
})
document.querySelectorAll('input[name="order"]').forEach((r) => {
  r.addEventListener('change', () => { setup.order = r.value; refreshSummary() })
})
document.getElementById('setup-pinyin').addEventListener('change', (e) => {
  setup.pinyin = e.target.checked
  refreshSummary()
})
document.getElementById('setup-pos').addEventListener('change', (e) => {
  setup.pos = e.target.checked
  refreshSummary()
})
// Start round
document.getElementById('start-btn').addEventListener('click', () => startRound())

// ─── Data row · Anki export / JSON export / import / reset ──────
// "Export starred → Anki" always exports the STARRED words, whatever deck is
// currently selected (the requested feature is specifically for starred words).
async function exportAnki() {
  const { saved } = await loadState()
  if (!saved.length) { toast('No starred words to export', 'wrong'); return }
  downloadText(`zilense-anki-${dateStr()}.txt`, toAnkiTsv(saved.map(toCard)), 'text/plain')
  toast(`Exported ${saved.length} cards`, 'ok')
}
document.getElementById('anki-btn').addEventListener('click', exportAnki)

document.getElementById('export-btn').addEventListener('click', () => {
  downloadText(`zilense-flashcards-${dateStr()}.json`, Progress.exportJson(), 'application/json')
  toast('Progress exported', 'ok')
})
document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-input').click()
})
document.getElementById('import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return
  const text = await file.text()
  e.target.value = '' // allow re-importing the same file
  if (!confirm('Importing will replace your flashcard progress. Continue?')) return
  const result = Progress.importJson(text)
  if (result.ok) {
    toast(`Imported ${result.count} cards`, 'ok')
    refreshHomeStats()
    refreshPoolHelp()
  } else {
    toast('Import failed: ' + result.error, 'wrong')
  }
})
document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('Reset all flashcard progress? This cannot be undone.')) return
  Progress.reset()
  refreshHomeStats()
  refreshPoolHelp()
  toast('Progress reset', '')
})

// ============================================================
// ROUND
// ============================================================
const round = {
  cards: [],
  index: 0,
  marks: [], // parallel array: 'correct' | 'wrong' | undefined
  revealed: false,
}

function startRound(customCards) {
  const cards = customCards || Progress.buildRound(ALL, {
    source: effectiveSourceType(),
    size: setup.size === 'all' ? null : setup.size,
    order: setup.order,
  })
  if (cards.length === 0) {
    toast('Pool is empty — pick a different deck or source', 'wrong')
    return
  }
  round.cards = cards
  round.index = 0
  round.marks = new Array(cards.length)
  round.revealed = false
  document.getElementById('round-meta').textContent =
    `${cards.length} cards · ${effectiveSourceType().replace('-', ' ')}`
  show('round')
  renderRound()
}

function setAll(selector, text) {
  document.querySelectorAll(selector).forEach((el) => { el.textContent = text })
}

function renderRound() {
  const card = round.cards[round.index]

  // Last-result badge · same on both faces
  const stat = Progress.get(card)
  const totalMarks = stat.correct + stat.wrong
  let resCls = 'none', resText = ''
  if (totalMarks > 0) {
    resCls = stat.lastResult === 'wrong' ? 'wrong' : 'correct'
    resText = `${stat.correct}✓ ${stat.wrong}✗`
  }
  document.querySelectorAll('.card .result').forEach((el) => {
    el.classList.remove('none', 'correct', 'wrong')
    el.classList.add(resCls)
    el.textContent = resText
  })

  // Pinyin on top · character mode + toggle on
  const showPinyinTop = setup.qmode === 'character' && setup.pinyin
  document.querySelectorAll('.card .pinyin').forEach((el) => {
    el.textContent = card.p || ''
    el.classList.toggle('hidden', !showPinyinTop)
  })

  // Part of speech. The "Show POS" toggle controls the ANSWER (back) face. On the
  // QUESTION (front) face it is shown only for words that have more than one meaning
  // in this deck, so you know which sense the card is asking for.
  const showPosBack = setup.pos && !!card.pos
  const showPosFront = !!card.ambig && !!card.pos

  // Front face · question
  const qChar = document.getElementById('q-text-char')
  const qMean = document.getElementById('q-text-mean')
  const qCharPos = document.getElementById('q-char-pos')
  if (setup.qmode === 'character') {
    qChar.textContent = card.w; qChar.hidden = false; qMean.hidden = true
    qCharPos.textContent = card.pos || ''; qCharPos.hidden = !showPosFront
  } else {
    document.getElementById('q-text-mean-text').textContent = card.m
    const qPos = document.getElementById('q-text-pos')
    qPos.textContent = card.pos || ''; qPos.hidden = !showPosFront
    qMean.hidden = false; qChar.hidden = true; qCharPos.hidden = true
  }

  // Back face · answer
  document.getElementById('a-char').textContent = card.w
  document.getElementById('a-pinyin').textContent = card.p || ''
  document.getElementById('a-mean-text').textContent = card.m
  const aPos = document.getElementById('a-pos')
  aPos.textContent = card.pos || ''; aPos.hidden = !showPosBack
  document.getElementById('a-char').style.display = ''
  document.getElementById('a-mean').style.display = ''
  document.getElementById('a-pinyin').style.display = showPinyinTop ? 'none' : ''

  // Progress + counter
  setAll('.card .progress', `${round.index + 1} / ${round.cards.length}`)
  setAll('.card .card-counter', `Card ${round.index + 1}`)

  // Hint · only after the card is marked, pointing at the next-card key
  const marked = round.marks[round.index]
  let hint = ''
  if (marked === 'correct') hint = 'Marked Got it ✓ — press space for next'
  else if (marked === 'wrong') hint = 'Marked Missed it ✗ — press space for next'
  setAll('.card .hint', hint)

  document.getElementById('card').classList.toggle('revealed', round.revealed)
  document.getElementById('reveal-btn').textContent = round.revealed ? 'Hide' : 'Reveal'
}

function reveal() { round.revealed = true; renderRound() }
function toggleReveal() { round.revealed = !round.revealed; renderRound() }

function snapToNewCard(updateState) {
  const cardEl = document.getElementById('card')
  cardEl.classList.add('no-flip')
  updateState()
  round.revealed = false
  renderRound()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { cardEl.classList.remove('no-flip') })
  })
}
function nextCard() {
  if (round.index >= round.cards.length - 1) return finishRound()
  if (round.revealed) {
    const cardEl = document.getElementById('card')
    cardEl.classList.add('flipping-next')
    round.revealed = false
    cardEl.classList.remove('revealed')
    document.getElementById('reveal-btn').textContent = 'Reveal'
    setTimeout(() => { round.index++; renderRound() }, 350)
    setTimeout(() => { cardEl.classList.remove('flipping-next') }, 750)
  } else {
    snapToNewCard(() => { round.index++ })
  }
}
function markCard(result, advance) {
  if (round.marks[round.index]) {
    toast('Already marked — press space for next', '')
    return
  }
  if (!round.revealed) round.revealed = true
  const card = round.cards[round.index]
  Progress.mark(card, result)
  round.marks[round.index] = result
  toast(result === 'correct' ? 'Got it ✓' : 'Missed it ✗', result === 'correct' ? 'ok' : 'wrong')
  renderRound()
  if (advance) setTimeout(nextCard, 450)
}

document.getElementById('card').addEventListener('click', (e) => {
  if (e.target.closest('button')) return
  toggleReveal()
})
document.getElementById('reveal-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleReveal() })
document.getElementById('btn-correct').addEventListener('click', (e) => { e.stopPropagation(); markCard('correct', true) })
document.getElementById('btn-wrong').addEventListener('click', (e) => { e.stopPropagation(); markCard('wrong', true) })
document.getElementById('abandon-btn').addEventListener('click', () => finishRound())

addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return
  if (!document.getElementById('screen-round').classList.contains('active')) return
  if ((e.key === ' ' || e.code === 'Space') && e.shiftKey) {
    e.preventDefault()
    markCard('wrong')
  } else if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault()
    if (!round.revealed) reveal()
    else if (!round.marks[round.index]) markCard('correct')
    else nextCard()
  } else if (e.key === 'Backspace') {
    e.preventDefault()
    markCard('wrong')
  }
})

// ============================================================
// RESULTS
// ============================================================
function finishRound() {
  const okList = []
  const wrongList = []
  round.cards.forEach((c, i) => {
    if (round.marks[i] === 'correct') okList.push(c)
    else if (round.marks[i] === 'wrong') wrongList.push(c)
  })
  const marked = okList.length + wrongList.length
  const pct = marked ? Math.round((100 * okList.length) / marked) : 0

  document.getElementById('r-correct').textContent = okList.length
  document.getElementById('r-total').textContent = round.cards.length
  document.getElementById('r-pct').textContent = marked ? pct + ' %' : '— %'

  let headline = 'Nice work.'
  if (marked === 0) headline = 'Round abandoned.'
  else if (pct >= 90) headline = 'Excellent.'
  else if (pct >= 75) headline = 'Solid run.'
  else if (pct >= 50) headline = 'Keep going.'
  else if (pct > 0) headline = 'These need another pass.'
  document.getElementById('r-headline').textContent = headline
  document.getElementById('r-subhead').textContent =
    marked === 0 ? 'No marks recorded this round.'
                 : `${okList.length} of ${marked} marked cards correct on this pass.`

  function renderList(elId, emptyId, items) {
    const ul = document.getElementById(elId)
    const empty = document.getElementById(emptyId)
    ul.innerHTML = ''
    if (items.length === 0) { ul.hidden = true; empty.hidden = false; return }
    ul.hidden = false; empty.hidden = true
    items.forEach((c) => {
      const li = document.createElement('li')
      const word = document.createElement('span'); word.className = 'word'; word.textContent = c.w
      const py = document.createElement('span'); py.className = 'py'; py.textContent = c.p || ''
      word.appendChild(py)
      const meaning = document.createElement('span'); meaning.className = 'meaning'; meaning.textContent = c.m || ''
      li.appendChild(word)
      li.appendChild(meaning)
      ul.appendChild(li)
    })
  }
  renderList('r-ok-list', 'r-ok-empty', okList)
  renderList('r-wrong-list', 'r-wrong-empty', wrongList)

  document.getElementById('again-btn').disabled = wrongList.length === 0
  round._wrongSet = wrongList

  show('results')
}

document.getElementById('again-btn').addEventListener('click', () => {
  if (!round._wrongSet || round._wrongSet.length === 0) return
  startRound(round._wrongSet.slice())
})
document.getElementById('new-btn').addEventListener('click', () => goHome())
document.getElementById('home-btn').addEventListener('click', () => goHome())
document.getElementById('results-home-btn').addEventListener('click', () => goHome())

// ============================================================
// BOOT
// ============================================================
document.querySelector('.theme-toggle').addEventListener('click', toggleTheme)
updateToggleLabel()

;(async function boot() {
  try {
    await loadDict()
  } catch (e) {
    console.error('[zilense] loadDict', e)
    document.getElementById('loading-title').textContent = 'Could not load the dictionary'
    document.getElementById('loading-sub').textContent = 'Reload the page to try again.'
    return
  }
  // Seed the page theme from the extension's dark setting the first time only;
  // after that the page's own toggle (THEME_KEY) wins.
  try {
    if (localStorage.getItem(THEME_KEY) == null) {
      const { settings } = await loadState()
      applyTheme(!!settings.dark)
    }
  } catch (e) {}
  initSegIndicators()
  const initialOpt = document.querySelector('#deck-dd-menu .dropdown-opt[aria-selected="true"]')
  await selectDeck(initialOpt ? initialOpt.dataset.value : 'starred')
})()
