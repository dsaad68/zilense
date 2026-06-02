/* convert-hsk.mjs — one-off: turn the messy HSK spreadsheets in
   assets/hsk-vocab/ into one clean, committed JSON:
     word -> { lvl, pos, senses: [{ lvl, pos, def }, ...] }
   `lvl`/`pos` are the primary (lowest-band) reading for the meta badge; `senses`
   lists every DISTINCT official gloss the word carries (a word like 会 has both
   [verb] "can" and [noun] "meeting"), each with its own level + POS, sorted by
   level then first appearance.

   The files are .xlsx (OOXML zip) despite the .xls extension. We read the two
   relevant parts with the `unzip` CLI and parse them directly — no spreadsheet
   library, and (importantly) nothing here runs during the normal build:
   build-dict.mjs only consumes the JSON this produces.

   Columns per sheet: A 词语(word) · B 拼音 · C 翻译(gloss) · D 词性(POS) · E 所在等级(level) · F 是否标记
   The level cell looks like "YCT4,HSK3,New HSK2,New HSK4"; we keep the smallest
   `New HSK<n>` and ignore rows with no New HSK tag. The POS cell (词性) holds
   Chinese abbreviations like "动、名" which we map to English ("verb; noun"). The
   翻译 cell is the concise official English gloss ("to love", "cup; glass; mug").

   Run:  npm run convert:hsk   (re-run only when hsk-vocab/*.xls change) */

// Chinese part-of-speech abbreviations -> English
const POS_MAP = {
  名: 'noun', 动: 'verb', 形: 'adjective', 副: 'adverb', 代: 'pronoun',
  数: 'numeral', 量: 'measure word', 介: 'preposition', 连: 'conjunction',
  助: 'particle', 叹: 'interjection', 拟声: 'onomatopoeia', 助动: 'auxiliary verb',
  能愿: 'auxiliary verb', 区别: 'attributive', 方位: 'locative noun',
  数量: 'numeral-measure', 前缀: 'prefix', 后缀: 'suffix', 词缀: 'affix',
  习语: 'idiom', 成语: 'idiom', 短语: 'phrase', 代词: 'pronoun',
}

// "动、名" / "动，名" / "动/名" -> "verb; noun"
function mapPos(raw) {
  if (!raw) return ''
  const parts = raw.split(/[、，,/／]+/).map((p) => p.trim()).filter(Boolean)
  const out = []
  for (const p of parts) {
    const en = POS_MAP[p]
    if (en && !out.includes(en)) out.push(en)
  }
  return out.join('; ')
}

import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..') // assets/scripts -> repo root
const srcDir = resolve(root, 'assets/hsk-vocab')
const outFile = join(srcDir, 'hsk-data.json')

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&') // last, so we don't double-decode

function unzipPart(file, part) {
  // -p streams the entry to stdout; large maxBuffer for the big sheet
  return execFileSync('unzip', ['-p', file, part], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

// sharedStrings.xml -> array of cell strings (concatenating rich-text runs)
function parseSharedStrings(xml) {
  const out = []
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = ''
    for (const t of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1]
    out.push(decode(text))
  }
  return out
}

// resolve one <c> cell to its string value (shared-string or literal)
function cellValue(cellXml, type, shared) {
  const v = cellXml.match(/<v>([\s\S]*?)<\/v>/)
  if (type === 's' && v) return shared[+v[1]] ?? ''
  if (type === 'inlineStr') {
    const is = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/)
    return is ? decode(is[1]) : ''
  }
  return v ? decode(v[1]) : ''
}

/* HSK 3.0 band for a 所在等级 string, as a rank 1–7 (7 = the combined 7–9
   advanced band), or null. Bands 1–6 come from "New HSK<n>"; the advanced band
   is tagged "HSK7-9" (no "New" prefix — old HSK 2.0 had no 7–9, so it can only be
   3.0). We return the LOWEST band the word appears at. */
function hskBand(levelStr) {
  let min = null
  for (const m of levelStr.matchAll(/New HSK(\d+)/g)) {
    const n = +m[1]
    if (min === null || n < min) min = n
  }
  if (min !== null) return min // introduced at a 1–6 band
  if (/HSK7-9/.test(levelStr)) return 7 // advanced-only word → 7–9 band
  return null
}

// rank 1–6 -> number; rank 7 -> the "7-9" band label
const bandLabel = (rank) => (rank <= 6 ? rank : '7-9')

function parseSheet(xml, shared, into) {
  for (const row of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    if (row[1] === '1') continue // header
    let word = null, def = '', pos = '', level = null
    for (const c of row[2].matchAll(/<c\s+r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const col = c[1]
      if (col !== 'A' && col !== 'C' && col !== 'D' && col !== 'E') continue
      const tMatch = c[2].match(/\bt="([^"]+)"/)
      const val = cellValue(c[3], tMatch ? tMatch[1] : null, shared)
      if (col === 'A') word = val.trim()
      else if (col === 'C') def = val.trim()
      else if (col === 'D') pos = val
      else if (col === 'E') level = val
    }
    if (!word || !def || !level) continue
    const rank = hskBand(level)
    if (rank === null) continue
    // collect one sense PER DISTINCT MEANING (keyed by gloss), keeping the lowest
    // band that meaning appears at. `_r` is the numeric rank for sorting; `_o` the
    // first-seen order for a stable tiebreak. Both stripped before writing.
    let w = into[word]
    if (!w) into[word] = w = { senses: new Map() }
    const prev = w.senses.get(def)
    if (!prev) w.senses.set(def, { _r: rank, _o: w.senses.size, lvl: bandLabel(rank), pos: mapPos(pos), def })
    else if (rank < prev._r) { prev._r = rank; prev.lvl = bandLabel(rank); if (!prev.pos) prev.pos = mapPos(pos) }
  }
}

function main() {
  const files = readdirSync(srcDir).filter((f) => /\.xls$/i.test(f))
  if (!files.length) {
    console.error('[convert-hsk] no .xls files in hsk-vocab/')
    process.exit(1)
  }

  const map = Object.create(null)
  for (const f of files) {
    const path = join(srcDir, f)
    const shared = parseSharedStrings(unzipPart(path, 'xl/sharedStrings.xml'))
    parseSheet(unzipPart(path, 'xl/worksheets/sheet1.xml'), shared, map)
  }

  // sort keys for a stable, diff-friendly committed file; flatten each word's
  // sense Map to a level-sorted array and lift the lowest sense as the primary
  const sorted = {}
  for (const k of Object.keys(map).sort()) {
    const senses = [...map[k].senses.values()].sort((a, b) => a._r - b._r || a._o - b._o)
    const primary = senses[0]
    sorted[k] = {
      lvl: primary.lvl,
      pos: primary.pos,
      senses: senses.map(({ _r, _o, ...s }) => s),
    }
  }

  writeFileSync(outFile, JSON.stringify(sorted))

  const total = Object.keys(sorted).length
  const dist = {}
  let multi = 0, senseCount = 0
  for (const v of Object.values(sorted)) {
    dist[v.lvl] = (dist[v.lvl] || 0) + 1
    senseCount += v.senses.length
    if (v.senses.length > 1) multi++
  }
  console.log(`[convert-hsk] ${files.length} files -> ${total} words with a New HSK level`)
  console.log('[convert-hsk] per level (primary):', JSON.stringify(dist))
  console.log(`[convert-hsk] ${senseCount} senses total; ${multi} words have >1 distinct HSK meaning`)
  console.log(`[convert-hsk] wrote ${outFile}`)
}

main()
