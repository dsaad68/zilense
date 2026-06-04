/* convert-chars.mjs — one-off: build character decomposition data (radical,
   components, stroke count, short glosses) from the open makemeahanzi dataset.

   Sources (JSONL, auto-downloaded to char-data/ if missing; .txt are gitignored):
     • dictionary.txt — { character, definition, decomposition (IDS), radical }
     • graphics.txt   — { character, strokes:[…] }  (only the stroke COUNT is kept)

   Output (committed): char-data/char-data.json
     { chars: { "好": { r:"女", c:["女","子"], s:6 }, … },
       gloss: { "好":"good", "女":"woman", … } }   // short gloss for radicals/components

   The short gloss comes from each character's own makemeahanzi definition, so the
   radical's meaning and component glosses share one source — no separate table.

   Run:  npm run convert:chars   (re-run only to refresh from makemeahanzi) */

import { existsSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..') // assets/scripts -> repo root
const dir = resolve(root, 'assets/char-data')
const BASE = 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/'

async function ensure(name) {
  const path = join(dir, name)
  if (existsSync(path)) return path
  console.log(`[convert-chars] downloading ${name} …`)
  const res = await fetch(BASE + name)
  if (!res.ok) throw new Error(`download ${name}: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path))
  return path
}

// IDS operators ⿰…⿿ that join components in a decomposition string
const isIds = (cp) => cp >= 0x2ff0 && cp <= 0x2fff
// character that can be a component (CJK + radical/supplement blocks)
const isComponent = (cp) =>
  (cp >= 0x2e80 && cp <= 0x2fdf) || (cp >= 0x3400 && cp <= 0x9fff) ||
  (cp >= 0xf900 && cp <= 0xfaff)

// makemeahanzi "definitions" that aren't actually English meanings — gugyeol /
// transliteration placeholders for rare stroke-form glyphs. Dropped so we don't
// render noise like "kwukyel" under a component.
const JUNK_GLOSS = new Set(['kwukyel'])

const shortGloss = (def) => {
  if (!def) return ''
  const g = def.split(/[,;]/)[0].trim()
  return JUNK_GLOSS.has(g) ? '' : g
}

// component characters in the decomposition, excluding the radical itself (shown
// separately) and the character itself
function components(decomp, self, radical) {
  const out = []
  if (!decomp) return out
  for (const ch of decomp) {
    const cp = ch.codePointAt(0)
    if (ch === self || ch === radical || isIds(cp) || !isComponent(cp)) continue
    if (!out.includes(ch)) out.push(ch)
  }
  return out.slice(0, 6)
}

async function main() {
  const dictPath = await ensure('dictionary.txt')
  const gfxPath = await ensure('graphics.txt')

  // stroke counts: char -> number of strokes
  const strokes = Object.create(null)
  for (const line of readFileSync(gfxPath, 'utf8').split('\n')) {
    if (!line) continue
    try {
      const o = JSON.parse(line)
      if (o.character && Array.isArray(o.strokes)) strokes[o.character] = o.strokes.length
    } catch {}
  }

  const chars = Object.create(null)
  const gloss = Object.create(null)
  for (const line of readFileSync(dictPath, 'utf8').split('\n')) {
    if (!line) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    const c = o.character
    if (!c || [...c].length !== 1) continue
    const g = shortGloss(o.definition)
    if (g) gloss[c] = g
    chars[c] = {
      r: o.radical || '',
      c: components(o.decomposition, c, o.radical),
      s: strokes[c] || undefined,
    }
  }

  const sortObj = (obj) => {
    const o = {}
    for (const k of Object.keys(obj).sort()) o[k] = obj[k]
    return o
  }
  writeFileSync(join(dir, 'char-data.json'), JSON.stringify({ chars: sortObj(chars), gloss: sortObj(gloss) }))
  console.log(`[convert-chars] ${Object.keys(chars).length} chars, ${Object.keys(gloss).length} glosses, ${Object.keys(strokes).length} stroke counts`)
  console.log(`[convert-chars] wrote ${join(dir, 'char-data.json')}`)
}

main().catch((e) => { console.error('[convert-chars]', e); process.exit(1) })
