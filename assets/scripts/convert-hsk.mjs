/* convert-hsk.mjs — one-off: turn the messy HSK spreadsheets in
   assets/hsk-vocab/ into one clean, committed JSON:
     word -> { lvl, pos, senses: [{ lvl, pos, def, py }, ...] }
   `lvl`/`pos` are the primary (lowest-band) reading for the meta badge; `senses`
   lists ONE entry per source row — nothing is collapsed. A word that appears in
   more than one level's list is kept at each level with that list's own meaning (so
   flashcards can show it in every band it belongs to); a word like 会 with two
   meanings at one level keeps both ([verb] "can", [noun] "meeting"); and rows that
   share a level and gloss but differ in POS each survive. Each sense carries its own
   level + POS, sorted by level then first appearance. The total sense count for a
   band therefore equals that file's row count.

   The files are .xlsx (OOXML zip) despite the .xls extension. We read the two
   relevant parts with the `unzip` CLI and parse them directly — no spreadsheet
   library, and (importantly) nothing here runs during the normal build:
   build-dict.mjs only consumes the JSON this produces.

   A word's HSK band is the FILE it sits in: HSK-1-vocab.xls … HSK-6-vocab.xls and
   the advanced HSK-7-9-vocab.xls. So a word listed in more than one file (e.g. 会 in
   both HSK-1 and HSK-3) is recorded at each of those bands, with that file's own
   gloss — we do NOT read the band out of the per-row 所在等级 cell (column E), which
   mixes YCT / old-HSK / multiple New-HSK tags and would collapse such words.

   Columns per sheet: A 词语(word) · B 拼音(pinyin) · C 翻译(gloss) · D 词性(POS) · E 所在等级 · F 是否标记
   We read A (word), B (tone-marked pinyin -> `py`), C (gloss -> `def`) and D (POS).
   The POS cell holds Chinese abbreviations like "动、名" which we map to English
   ("verb; noun"). The 翻译 cell is the concise official English gloss ("to love",
   "cup; glass; mug"). Column E is not used (the band comes from the filename).

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

/* HSK 3.0 band from a vocab filename, as a rank 1–7 (7 = the combined 7–9 advanced
   band), or null for an unrecognized file. The file IS the authoritative band:
   HSK-1-vocab.xls … HSK-6-vocab.xls, HSK-7-9-vocab.xls. */
function fileBand(name) {
  const m = name.match(/HSK-(\d+(?:-\d+)?)-vocab/i)
  if (!m) return null
  if (m[1] === '7-9') return 7 // the combined advanced band
  const n = +m[1]
  return n >= 1 && n <= 6 ? n : null
}

// rank 1–6 -> number; rank 7 -> the "7-9" band label
const bandLabel = (rank) => (rank <= 6 ? rank : '7-9')

function parseSheet(xml, shared, into, rank) {
  for (const row of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    if (row[1] === '1') continue // header
    let word = null, py = '', def = '', pos = ''
    for (const c of row[2].matchAll(/<c\s+r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const col = c[1]
      if (col !== 'A' && col !== 'B' && col !== 'C' && col !== 'D') continue
      const tMatch = c[2].match(/\bt="([^"]+)"/)
      const val = cellValue(c[3], tMatch ? tMatch[1] : null, shared)
      if (col === 'A') word = val.trim()
      else if (col === 'B') py = val.trim()
      else if (col === 'C') def = val.trim()
      else if (col === 'D') pos = val
    }
    if (!word || !def) continue
    // the row's band is the file it came from (passed in as `rank`). We keep one
    // sense PER ROW with no collapsing, so every line in every list survives: a word
    // listed in several files is kept at each band, and rows sharing a band+gloss but
    // differing in POS each survive instead of one overwriting the other. The per-
    // band sense count therefore equals the file's row count. `_r` is the numeric
    // rank for sorting; `_o` the first-seen order for a stable tiebreak. Both
    // stripped before writing.
    let w = into[word]
    if (!w) into[word] = w = { senses: [] }
    w.senses.push({ _r: rank, _o: w.senses.length, lvl: bandLabel(rank), pos: mapPos(pos), def, py })
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
    const rank = fileBand(f)
    if (rank === null) {
      console.warn(`[convert-hsk] skipping ${f}: filename has no HSK band (expected HSK-<level>-vocab.xls)`)
      continue
    }
    const path = join(srcDir, f)
    const shared = parseSharedStrings(unzipPart(path, 'xl/sharedStrings.xml'))
    parseSheet(unzipPart(path, 'xl/worksheets/sheet1.xml'), shared, map, rank)
  }

  // sort keys for a stable, diff-friendly committed file; level-sort each word's
  // sense list and lift the lowest sense as the primary
  const sorted = {}
  for (const k of Object.keys(map).sort()) {
    const senses = map[k].senses.sort((a, b) => a._r - b._r || a._o - b._o)
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
