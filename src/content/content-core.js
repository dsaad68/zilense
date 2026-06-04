/* content-core.js — pure helpers for the on-page lookup driver. No DOM access,
   so they run in plain Node and are unit-tested. content.js imports them; the
   CRXJS build bundles this into the content script. */

// A single Chinese character. \p{Script=Han} is Unicode-aware, so it matches
// CJK Unified Ideographs and the extension blocks (incl. astral CJK Ext-B)
// while rejecting Hangul, kana, and emoji — unlike a hand-rolled BMP range that
// accidentally caught surrogate halves. Accepts a string; tests its first code
// point so an astral character passed whole still matches.
const HAN_RE = /\p{Script=Han}/u
const HAN_RE_G = /\p{Script=Han}/gu // global variant for matchAll
export function isHanChar(ch) {
  if (!ch) return false
  const cp = String(ch).codePointAt(0)
  return HAN_RE.test(String.fromCodePoint(cp))
}

// Trim everything outside the Han run: leading/trailing whitespace, punctuation,
// brackets, quotes — e.g. "「学习」" -> "学习", "你好!" -> "你好", "  中文 " -> "中文".
// Keeps the inner run intact (including any interior non-Han, which callers may
// still segment). Returns '' if there's no Han at all.
export function normalizeSelection(text) {
  const s = String(text || '')
  let start = -1, end = -1
  for (const m of s.matchAll(HAN_RE_G)) {
    if (start < 0) start = m.index
    end = m.index + m[0].length
  }
  return start < 0 ? '' : s.slice(start, end)
}

// Should a selection be sent for lookup? Must contain Han and be short enough to
// be a word/phrase rather than a paragraph grab.
export function shouldLookupSelection(text, maxLen = 16) {
  const norm = normalizeSelection(text)
  return !!norm && [...norm].length <= maxLen
}

// The full character (code point) covering UTF-16 index `i` — steps back onto the
// high surrogate when `i` lands on a low surrogate, so an astral CJK Ext-B char
// isn't read as a broken half.
export function charAt(text, i) {
  const code = text.charCodeAt(i)
  if (code >= 0xdc00 && code <= 0xdfff && i > 0) i -= 1 // low surrogate → step back
  return String.fromCodePoint(text.codePointAt(i))
}

// Greedy longest-match every dictionary word in `text`. `rank` is a word→band Map
// and `maxLen` is the longest word length to try; returns matches in order as
// { start, len, rank } (UTF-16 indices into `text`), advancing past each hit and
// skipping non-Han. This is the pure core of the on-page "highlight HSK ≤ N" scan
// (content.js wraps each match in a Range); kept here so the matching algorithm is
// unit-testable without the DOM/Highlight machinery.
export function matchWords(text, rank, maxLen) {
  const s = String(text || '')
  const max = maxLen | 0
  const out = []
  if (!rank || max < 1) return out
  for (let i = 0; i < s.length; ) {
    if (!isHanChar(charAt(s, i))) { i += 1; continue }
    let hit = 0, hitRank = 0
    for (let len = Math.min(max, s.length - i); len >= 1; len--) {
      const r = rank.get(s.substr(i, len))
      if (r != null) { hit = len; hitRank = r; break }
    }
    if (!hit) { i += 1; continue }
    out.push({ start: i, len: hit, rank: hitRank })
    i += hit
  }
  return out
}
