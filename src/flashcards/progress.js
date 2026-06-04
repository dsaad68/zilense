// progress.js · flashcard progress for the Zilense extension page.
//
// Adapted from the standalone trainer's users.js, with the multi-user
// recovery-key layer removed: a browser extension is already per-profile, so
// there's a single progress store. Cards are keyed by the word itself (a card's
// id IS the Han word), so a word reviewed via the "Starred" deck and via an
// "HSK" deck shares one record.
//
// Storage layout (localStorage key  zilense.flashcards.progress):
//   {
//     "schemaVersion": 1,
//     "cards": {
//       "<word>": { correct:int, wrong:int, last:epoch-ms,
//                   lastResult:"correct"|"wrong", recent:[…] }  // ring buffer · 8 max
//     }
//   }
//
// Every read is guarded — a corrupt/non-JSON entry falls back to an empty store
// rather than throwing.

const KEY = 'zilense.flashcards.progress'
const MAX_RECENT = 8
const SCHEMA = 1

function _readRaw() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (e) {
    return null // corrupt entry — caller treats as missing
  }
}

export function load() {
  const raw = _readRaw()
  if (!raw || typeof raw !== 'object') return {}
  if (raw.schemaVersion === SCHEMA && raw.cards && typeof raw.cards === 'object') {
    return raw.cards
  }
  // Unknown/legacy shape: a wrapped {cards} or the bare cards map.
  return raw.cards && typeof raw.cards === 'object' ? raw.cards : raw
}

export function save(cards) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ schemaVersion: SCHEMA, cards: cards || {} }))
  } catch (e) { /* quota / privacy mode — ignore */ }
}

// a card's id is the word string, so the storage key is just that
function id(word) { return String(word.id) }

export function mark(word, result /* 'correct' | 'wrong' */) {
  const data = load()
  const k = id(word)
  if (!data[k]) data[k] = { correct: 0, wrong: 0, last: 0, lastResult: '', recent: [] }
  if (result === 'correct') data[k].correct++
  else if (result === 'wrong') data[k].wrong++
  data[k].last = Date.now()
  data[k].lastResult = result
  data[k].recent = (data[k].recent || []).concat(result).slice(-MAX_RECENT)
  save(data)
  return data[k]
}

export function get(word) {
  const data = load()
  return data[id(word)] || { correct: 0, wrong: 0, last: 0, lastResult: '', recent: [] }
}

// ─── Filters & round building ──────────────────────────────────────
export function filter(deck, type) {
  if (type === 'all' || !type) return deck.slice()
  const data = load()
  return deck.filter(function (w) {
    const s = data[id(w)]
    const seen = s && (s.correct + s.wrong) > 0
    if (type === 'unseen')     return !seen
    if (type === 'seen')       return seen
    if (type === 'wrong-ever') return seen && s.wrong > 0
    if (type === 'wrong-recent') {
      if (!seen) return false
      return (s.recent || []).slice(-3).indexOf('wrong') !== -1
    }
    if (type === 'correct')    return seen && s.correct > s.wrong && s.lastResult === 'correct'
    return true
  })
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function buildRound(deck, opts) {
  let pool = filter(deck, opts.source)
  if (pool.length === 0) return []
  if (opts.order !== 'sequential') pool = shuffle(pool.slice())
  if (opts.size && opts.size < pool.length) pool = pool.slice(0, opts.size)
  return pool
}

// ─── Aggregate stats ───────────────────────────────────────────────
export function stats(deck) {
  const data = load()
  let seen = 0, correct = 0, wrong = 0, totalMarks = 0, totalWrong = 0
  deck.forEach(function (w) {
    const s = data[id(w)]
    if (!s) return
    const n = s.correct + s.wrong
    if (n === 0) return
    seen++
    totalMarks += n
    totalWrong += s.wrong
    if (s.correct > s.wrong) correct++
    else if (s.wrong > 0)    wrong++
  })
  return {
    total: deck.length,
    seen,
    unseen: deck.length - seen,
    correct,
    wrong,
    reviews: totalMarks,
    accuracy: totalMarks ? Math.round((100 * (totalMarks - totalWrong)) / totalMarks) : 0,
  }
}

export function reset() { save({}) }

// ─── Export / import ───────────────────────────────────────────────
export function exportJson() {
  return JSON.stringify({
    schemaVersion: SCHEMA,
    exportedAt: new Date().toISOString(),
    cards: load(),
  }, null, 2)
}

// Returns { ok, count, error? }. Replaces the store on success. Accepts the v1
// wrapper or a bare cards map. Keys are word strings (not numeric ids), so any
// non-empty key is accepted.
export function importJson(text) {
  let parsed
  try { parsed = JSON.parse(text) }
  catch (e) { return { ok: false, error: 'invalid JSON' } }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'expected an object' }
  let cards
  if (parsed.schemaVersion === SCHEMA && parsed.cards) cards = parsed.cards
  else if (parsed.cards && typeof parsed.cards === 'object') cards = parsed.cards
  else cards = parsed
  const valid = {}
  let count = 0
  for (const k in cards) {
    if (!k) continue
    const c = cards[k]
    if (!c || typeof c !== 'object') continue
    valid[k] = {
      correct: Number(c.correct) || 0,
      wrong: Number(c.wrong) || 0,
      last: Number(c.last) || 0,
      lastResult: (c.lastResult === 'correct' || c.lastResult === 'wrong') ? c.lastResult : '',
      recent: Array.isArray(c.recent)
        ? c.recent.filter((x) => x === 'correct' || x === 'wrong').slice(-MAX_RECENT)
        : [],
    }
    count++
  }
  save(valid)
  return { ok: true, count }
}
