/* dict-core.js — pure dictionary logic over a loaded DB object. No bundler- or
   browser-specific imports, so it runs in plain Node and is unit-testable.
   dict.js wraps these with the fetched-once DB; tests load cedict.json from disk.

   DB shape: { entries:{ "<simplified>":[[pinyinNum,[defs],[measures?]],…] },
               hsk:{word:level}, pos:{word:"verb; noun"},
               chars:{char:{r,c:[…],s}}, charGloss:{char:"gloss"} } */

import { toDiacritics, toToneless } from './pinyin.js'

// Unicode-aware Han matcher (matches a string containing any Han character).
// Replaces a hand-rolled BMP range that also caught Hangul/emoji surrogate halves.
export const HAN = /\p{Script=Han}/u

// short gloss for a radical/component character (from makemeahanzi)
export function compMeaning(db, c) {
  return (db && db.charGloss && db.charGloss[c]) || ''
}

// normalize a (possibly traditional) form to its simplified key, so lookup /
// search / hover all work on traditional pages (中國 -> 中国, 學習 -> 学习)
export function toSimp(db, q) {
  return (db && db.tradToSimp && db.tradToSimp[q]) || q
}

// a measure-word label is "汉字 pinyinNum" (e.g. "只 zhi1"); tone-mark the pinyin
function measureToneMarks(m) {
  const sp = m.indexOf(' ')
  return sp < 0 ? m : m.slice(0, sp) + ' ' + toDiacritics(m.slice(sp + 1))
}

// rank a reading's value as the *primary* sense for plain simplified input
// (lower = better lead for a learner). Only used when the user didn't ask for a
// specific traditional form; that case is handled separately. Tiers:
//   3  all defs are cross-references ("variant of …" / "see …") — 台灣→"variant
//      of 臺灣" sinks below the real "Taiwan" reading
//   2  all defs are just a surname — 鍾→"surname Zhong" sinks
//   1  a real meaning, but it still flags itself a variant of another char —
//      鍾→"cup … variant of 鐘" sinks below 鐘→"bell; clock" (which has no xref)
//   0  a self-contained real meaning
function sensePenalty(g) {
  const defs = g.defs || []
  if (!defs.length) return 4
  const xref = (d) => /\bvariant of\b/i.test(d) || /^see\b/i.test(d)
  const surname = (d) => /^surname\s/i.test(d)
  if (defs.every(xref)) return 3
  if (defs.every(surname)) return 2
  if (defs.some(xref)) return 1
  return 0
}

// group a key's raw senses by reading. Each sense tuple is
// [pinyinNum, defs, measures|0, trad?]. We key by pinyin AND traditional form, so
// homographs that share a reading but differ in traditional source — and meaning
// — stay distinct (e.g. 面: miàn "face", 麵→miàn "noodles"; 钟: 鍾 "cup" vs 鐘
// "bell"). For the common case (one traditional form per reading) this groups
// exactly as grouping by pinyin alone would.
export function groupSenses(senses) {
  const groups = []
  for (const s of senses) {
    const pyNum = s[0]
    const trad = s[3]
    let g = groups.find((x) => x.pyNum === pyNum && x.trad === trad)
    if (!g) {
      g = { pyNum, pinyin: toDiacritics(pyNum), defs: [], measures: [], trad }
      groups.push(g)
    }
    for (const d of s[1] || []) g.defs.push(d)
    if (s[2]) for (const m of s[2]) g.measures.push(measureToneMarks(m))
  }
  return groups
}

// lookup(db, q) -> normalized entry, or null. Traditional input is normalized to
// its simplified key; the original traditional form is surfaced as `trad`.
export function lookup(db, q) {
  if (!db || q == null) return null
  const input = String(q).trim()
  q = toSimp(db, input)
  const senses = db.entries[q]
  if (!senses || !senses.length) return null

  const groups = groupSenses(senses)
  // if the input was a specific traditional form, surface the reading that
  // actually uses it (髮 -> the fà "hair" sense, not the fā "send out" sense)
  if (input !== q) {
    const i = groups.findIndex((g) => g.trad === input)
    if (i > 0) groups.unshift(groups.splice(i, 1)[0])
  } else if (groups.length > 1) {
    // plain simplified input: float the reading with a real meaning above a
    // variant/see-also or surname-only reading (台湾 -> "Taiwan", not "variant of
    // 臺灣"; 钟 -> bell/clock, not surname Zhōng). Array.sort is stable in V8, so
    // ties keep CC-CEDICT order.
    groups.sort((a, b) => sensePenalty(a) - sensePenalty(b))
  }
  const primary = groups[0]
  const type = [...q].length > 1 ? 'word' : 'char'
  const chars = type === 'word' ? [...q].filter((c) => HAN.test(c)) : null
  // traditional form for display: the one belonging to the primary reading
  const trad = primary.trad && primary.trad !== q ? primary.trad : undefined

  // single-character decomposition (radical / components / stroke count)
  let radical, components, strokes
  if (type === 'char' && db.chars && db.chars[q]) {
    const cd = db.chars[q]
    if (cd.r) radical = { char: cd.r, meaning: compMeaning(db, cd.r) }
    if (cd.c && cd.c.length) components = cd.c
    if (cd.s) strokes = cd.s
  }

  return {
    q,
    trad,
    type,
    chars,
    pinyin: primary.pinyin,
    pinyinNum: primary.pyNum,
    defs: primary.defs,
    measures: primary.measures,
    alts: groups.slice(1), // additional readings (different tone/meaning)
    hsk: db.hsk ? db.hsk[q] : undefined,
    pos: db.pos ? db.pos[q] : undefined,
    hskSenses: db.hskSenses ? db.hskSenses[q] : undefined, // [{lvl,pos,def}] official HSK glosses

    radical,
    components,
    strokes,
  }
}

/* segmentLongest(db, text) — greedy longest-match from the START of `text`
   (a forward run of Chinese characters under the cursor). Returns the longest
   prefix that's a dictionary entry, e.g. "新闻..." -> { word:"新闻", len:2 },
   falling back to the first character. Drives hover word detection. */
export function segmentLongest(db, text, maxLen = 12) {
  if (!db || !text) return null
  const chars = [...text] // code points, so astral CJK isn't split
  const max = Math.min(chars.length, maxLen)
  for (let len = max; len >= 2; len--) {
    const cand = chars.slice(0, len).join('')
    // match simplified entries directly, or traditional runs via tradToSimp
    if (db.entries[cand] || (db.tradToSimp && db.tradToSimp[cand])) return { word: cand, len }
  }
  return { word: chars[0], len: 1 }
}

// small object for result rows (avoids full normalization while scanning)
function preview(db, key) {
  const primary = db.entries[key][0]
  return {
    q: key,
    pinyin: toDiacritics(primary[0]),
    defs: (primary[1] || []).slice(0, 2),
    hsk: db.hsk ? db.hsk[key] : undefined,
  }
}

// HSK-level tiebreak: lower sorts first, so common HSK words (esp. 1–3) float
// above rare non-HSK characters that merely match the substring. 7-9 -> 7,
// non-HSK -> 50.
function hskPenalty(db, key) {
  const lvl = db.hsk && db.hsk[key]
  if (lvl == null) return 50
  const n = lvl === '7-9' ? 7 : Number(lvl)
  return Number.isFinite(n) ? n : 50
}

// a band label (1–6 or "7-9") as a numeric rank 1–7; the advanced 7–9 band -> 7
export function hskRank(lvl) {
  if (lvl == null) return null
  const n = lvl === '7-9' ? 7 : Number(lvl)
  return Number.isFinite(n) ? n : null
}

/* hskWordsUpTo(db, maxRank) — every HSK word whose band rank is <= maxRank, as
   [word, rank] pairs (rank 1–7; the 7–9 band is rank 7). Powers the on-page
   "highlight all HSK words up to level N" action; reuses the db.hsk map. */
export function hskWordsUpTo(db, maxRank) {
  const out = []
  if (!db || !db.hsk || !maxRank) return out
  for (const word of Object.keys(db.hsk)) {
    const rank = hskRank(db.hsk[word])
    if (rank != null && rank <= maxRank) out.push([word, rank])
  }
  return out
}

/* hskWordsAtBand(db, band) — every HSK word in exactly ONE band, as [word, rank]
   pairs (band 1–6, or 7 for the advanced 7–9 set). Unlike hskWordsUpTo this is
   not cumulative — it powers the flashcards "study HSK level N" decks, where each
   level is its own deck rather than everything up to N. */
export function hskWordsAtBand(db, band) {
  const out = []
  if (!db || !db.hsk || !band) return out
  for (const word of Object.keys(db.hsk)) {
    if (hskRank(db.hsk[word]) === band) out.push([word, band])
  }
  return out
}

/* matchRank(db, key, q, qp) — how well `key` matches the (non-Han) query, as
   [rank, defLen], or null. Lower rank is better: 0 = exact def / exact toneless
   pinyin, 1 = whole-word def token (or pinyin prefix), 2 = def prefix / pinyin
   contains, 3 = def substring. `defLen` is the length of the matched English
   definition (999 for a pinyin-only match) — used as a centrality tiebreak so a
   short on-point gloss ("hello; hi" for 你好) outranks a qualified one ("hello
   (when answering the phone)" for 喂). Short english queries (<=2 chars) require
   a whole-word def match so "a"/"to"/"the" don't drag in substring noise. */
function matchRank(db, key, q, qp) {
  const senses = db.entries[key]
  const shortQ = q.length <= 2
  let best = -1
  let bestDefLen = 999
  // english definitions
  for (const s of senses) {
    for (const d of s[1] || []) {
      const dl = d.toLowerCase()
      let r = -1
      if (shortQ) {
        if (dl.split(/[^a-z0-9]+/).includes(q)) r = dl === q ? 0 : 1
      } else if (dl.includes(q)) {
        r = dl === q ? 0 : dl.split(/[^a-z0-9]+/).includes(q) ? 1 : dl.startsWith(q) ? 2 : 3
      }
      if (r >= 0 && (best < 0 || r < best || (r === best && dl.length < bestDefLen))) {
        best = r
        bestDefLen = dl.length
      }
    }
  }
  // toneless pinyin: an exact reading match (zhong -> 中) is a strong, common hit
  for (const s of senses) {
    const tl = toToneless(s[0])
    const r = tl === qp ? 0 : tl.startsWith(qp) ? 1 : tl.includes(qp) ? 2 : -1
    if (r >= 0 && (best < 0 || r < best)) { best = r; bestDefLen = 999 }
  }
  return best < 0 ? null : [best, bestDefLen]
}

/* buildIndex(db) — build inverted indexes ONCE (called from loadDict, during the
   panel's "Loading dictionary…" state) so per-keystroke search no longer scans
   all ~121k keys. Mirrors how the Zhongwen extension ships a precomputed index,
   except we compute it client-side from the bundled data (no asset-size growth):
     pinyinMap   : toneless reading -> [keys]      (+ sorted pinyinVocab)
     englishMap  : definition token -> [keys]      (+ sorted englishVocab)
     charIndex   : single hanzi    -> [keys] containing it
   Sorted vocab arrays let us binary-search a query prefix; the maps then expand
   matched tokens into a small candidate set that searchEntries ranks. */
export function buildIndex(db) {
  const pinyinMap = new Map()
  const englishMap = new Map()
  const charIndex = new Map()
  const add = (map, k, key) => {
    let arr = map.get(k)
    if (!arr) map.set(k, (arr = []))
    arr.push(key)
  }
  for (const key of Object.keys(db.entries)) {
    for (const ch of key) {
      let arr = charIndex.get(ch)
      if (!arr) charIndex.set(ch, (arr = []))
      if (arr[arr.length - 1] !== key) arr.push(key)
    }
    const py = new Set()
    const tok = new Set()
    for (const s of db.entries[key]) {
      const tl = toToneless(s[0])
      if (tl) py.add(tl)
      for (const d of s[1] || []) {
        for (const t of d.toLowerCase().split(/[^a-z0-9]+/)) if (t) tok.add(t)
      }
    }
    for (const tl of py) add(pinyinMap, tl, key)
    for (const t of tok) add(englishMap, t, key)
  }
  const pinyinVocab = [...pinyinMap.keys()].sort()
  const englishVocab = [...englishMap.keys()].sort()
  return { pinyinMap, pinyinVocab, englishMap, englishVocab, charIndex }
}

/* wordsContainingChar(db, index, char, { exclude, limit }) — the "word family":
   multi-character entries that contain `char`, ranked by HSK level (common words
   first) then by length (shorter first). Reuses the prebuilt charIndex (char ->
   keys containing it). Excludes the bare single character and `exclude` (the word
   being viewed). Returns preview rows like searchEntries. */
export function wordsContainingChar(db, index, char, { exclude, limit = 30 } = {}) {
  if (!db || !index || !char) return []
  const keys = index.charIndex.get(char)
  if (!keys) return []
  const hits = []
  for (const key of keys) {
    if (key === char || key === exclude) continue
    if ([...key].length < 2) continue // words only, not the bare character
    hits.push([hskPenalty(db, key), key.length, key])
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : 1))
  return hits.slice(0, limit).map((h) => preview(db, h[2]))
}

// collect every key whose token starts with `prefix` (binary-search the sorted
// vocab for the lower bound, then walk while the prefix still matches)
function collectPrefix(vocab, map, prefix, out) {
  let lo = 0
  let hi = vocab.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (vocab[mid] < prefix) lo = mid + 1
    else hi = mid
  }
  for (let i = lo; i < vocab.length && vocab[i].startsWith(prefix); i++) {
    for (const k of map.get(vocab[i])) out.add(k)
  }
}

/* searchEntries(db, index, query) — index-driven candidate generation + the same
   ranking (match-quality > HSK level > definition centrality > shortest). Returns
   up to `limit` preview rows. `index` comes from buildIndex(); pass null to no-op. */
export function searchEntries(db, index, query, limit = 30) {
  if (!db || !index) return []
  const q = String(query).trim().toLowerCase()
  if (!q) return []

  const hits = [] // [rank, hskPenalty, defLen, keyLen, key]

  if (HAN.test(query)) {
    const raw = toSimp(db, query.trim()) // normalize a fully-traditional query
    // candidates = keys containing the rarest character of the query, then a
    // substring filter — far smaller than the full key set
    let postings = null
    for (const ch of raw) {
      const arr = index.charIndex.get(ch)
      if (!arr) { postings = null; break }
      if (!postings || arr.length < postings.length) postings = arr
    }
    if (postings) {
      for (const key of postings) {
        if (key.includes(raw)) {
          const rank = key === raw ? 0 : key.startsWith(raw) ? 1 : 2
          hits.push([rank, hskPenalty(db, key), 0, key.length, key])
        }
      }
    }
  } else {
    const qp = q.replace(/\s+/g, '')
    const cand = new Set()
    // english: whole-word for tiny queries; whole-word + prefix otherwise
    const exact = index.englishMap.get(q)
    if (exact) for (const k of exact) cand.add(k)
    if (q.length > 2) collectPrefix(index.englishVocab, index.englishMap, q, cand)
    // pinyin: exact + prefix readings (zhong -> 中, zhongguo, …)
    collectPrefix(index.pinyinVocab, index.pinyinMap, qp, cand)
    for (const key of cand) {
      const m = matchRank(db, key, q, qp)
      if (m) hits.push([m[0], hskPenalty(db, key), m[1], key.length, key])
    }
  }

  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3])
  return hits.slice(0, limit).map((h) => preview(db, h[4]))
}
