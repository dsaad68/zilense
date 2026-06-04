/* pinyin.js — convert CC-CEDICT numbered pinyin ("ni3 hao3", "lu:3", "Zhong1")
   into tone-marked pinyin ("nǐ hǎo", "lǚ", "Zhōng"), plus tone helpers used for
   the panel's per-syllable tone coloring. */

// tone-mark glyphs indexed [tone-1][vowel], vowels order: a e i o u ü
const MARKS = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
}

// convert one numbered syllable -> tone-marked syllable
function syllable(raw) {
  if (!raw) return raw
  // pull a trailing tone digit (1-5; 0/5 = neutral, no mark)
  const m = raw.match(/^([A-Za-zü:]+)([0-5])?$/)
  if (!m) return raw.replace(/u:/g, 'ü').replace(/U:/g, 'Ü')
  let body = m[1]
  const tone = m[2] ? parseInt(m[2], 10) : 0
  // normalize ü spellings (CC-CEDICT writes "u:"; some sources use "v")
  body = body.replace(/u:/g, 'ü').replace(/U:/g, 'Ü').replace(/v/g, 'ü').replace(/V/g, 'Ü')
  if (tone === 0 || tone === 5) return body

  // tone-placement rule: a > e > (ou -> o) > last vowel
  const lower = body.toLowerCase()
  let idx = -1
  if (lower.includes('a')) idx = lower.indexOf('a')
  else if (lower.includes('e')) idx = lower.indexOf('e')
  else if (lower.includes('ou')) idx = lower.indexOf('o')
  else {
    for (let i = lower.length - 1; i >= 0; i--) {
      if ('aeiouü'.includes(lower[i])) { idx = i; break }
    }
  }
  if (idx < 0) return body

  const target = body[idx]
  const key = target.toLowerCase()
  const marked = MARKS[key] ? MARKS[key][tone - 1] : target
  const cased = target === target.toUpperCase() ? marked.toUpperCase() : marked
  return body.slice(0, idx) + cased + body.slice(idx + 1)
}

// "ni3 hao3" -> "nǐ hǎo"  (preserves spacing; passes non-pinyin tokens through)
export function toDiacritics(numbered) {
  if (!numbered) return ''
  return String(numbered)
    .split(/\s+/)
    .map(syllable)
    .join(' ')
}

// Convert a whole numbered-pinyin *string* (e.g. Tatoeba's "Wo3 zai4 Zhong1guo2.")
// to tone marks. Unlike toDiacritics it tolerates syllables joined without spaces
// and surrounding punctuation, converting each "letters+tone" run in place.
export function romanizeToDiacritics(roman) {
  if (!roman) return ''
  return String(roman).replace(/[A-Za-zü:]+[1-5]/g, (m) => syllable(m))
}

// strip a numbered-pinyin string down to plain ascii letters for fuzzy search
export function toToneless(numbered) {
  return String(numbered)
    .replace(/u:/g, 'u')
    .replace(/[0-5]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

// ---- tone coloring (operates on tone-marked syllables) -------------------
const TONE_GROUPS = ['āēīōūǖ', 'áéíóúǘ', 'ǎěǐǒǔǚ', 'àèìòùǜ']
export function syllableTone(syl) {
  for (const ch of String(syl)) {
    for (let t = 0; t < 4; t++) if (TONE_GROUPS[t].includes(ch)) return t + 1
  }
  return 5
}
