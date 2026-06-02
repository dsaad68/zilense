/* build-dict.mjs — parse the CC-CEDICT data that the `cc-cedict` package
   downloads on install into a compact index bundled with the extension.

   Source: node_modules/cc-cedict/data/all.js
     export default { all: RawEntry[], classifierLookup: [trad, simp, pinyin][] }
     RawEntry = [traditional, simplified, pinyin, meanings(string|string[]),
                 variantIndices[], classifierIndices[]]   // e[4]=variants, e[5]=classifiers

   Output: src/data/cedict.json
     { entries: { "<simplified>": [ [pinyinNumbered, [defs...], measures|0, trad?], ... ] },
       tradToSimp: { "<traditional>": "<simplified>" },   // input normalization
       hsk, pos, hskSenses, chars, charGloss,
       count: <number of simplified keys> }
     Each sense carries its own traditional form (index 3, when it differs from
     the simplified key) so a traditional lookup surfaces the matching reading.

   We key by simplified form. A simplified form can map to several CC-CEDICT
   lines (homographs / multiple readings); each becomes one sense tuple. */

import { writeFile, mkdir, access, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..') // assets/scripts -> repo root
const dataSrc = resolve(root, 'node_modules/cc-cedict/data/all.js')
const hskSrc = resolve(root, 'assets/hsk-vocab/hsk-data.json')
const charSrc = resolve(root, 'assets/char-data/char-data.json')
const outDir = resolve(root, 'src/data')
const outFile = resolve(outDir, 'cedict.json')
// small standalone HSK word→level map (~141 KB) so the service worker's
// "highlight HSK ≤ N" path can load it WITHOUT parsing the full ~14 MB cedict.json
const hskOutFile = resolve(outDir, 'hsk-words.json')

async function main() {
  try {
    await access(dataSrc)
  } catch {
    console.error(
      '[build-dict] Cannot find node_modules/cc-cedict/data/all.js.\n' +
        '  Run `npm install` first (cc-cedict downloads its data on postinstall).'
    )
    process.exit(1)
  }

  const mod = await import(pathToFileURL(dataSrc).href)
  const data = mod.default || mod
  const all = data.all || []
  const classifierLookup = data.classifierLookup || []

  // simplified -> array of sense tuples [pinyin, defs[], measureWords[]|0, trad?]
  const entries = Object.create(null)
  // traditional -> simplified, for EVERY traditional form (input normalization).
  // CC-CEDICT keys by line, so one simplified form can have several traditional
  // sources (發/髮 -> 发, 台灣/臺灣 -> 台湾, 鍾/鐘 -> 钟); each must resolve.
  const tradToSimp = Object.create(null)

  for (const e of all) {
    const traditional = e[0]
    const simplified = e[1]
    if (!simplified) continue
    const pinyin = e[2] || ''
    const meaningsRaw = e[3]
    const defs = Array.isArray(meaningsRaw)
      ? meaningsRaw
      : meaningsRaw
        ? [meaningsRaw]
        : []

    // resolve classifier indices (e[5]) -> "汉字 pinyin" measure-word labels
    const clIdx = e[5] || []
    const measures = []
    for (const idx of clIdx) {
      const cl = classifierLookup[idx]
      if (!cl) continue
      const simp = cl[1] || cl[0]
      const py = cl[2] || ''
      measures.push(py ? `${simp} ${py}` : simp)
    }

    // [pinyin, defs, measures|0, trad?] — trad is recorded PER SENSE so a
    // traditional lookup can surface the matching reading (髮 -> 发 "hair", not
    // 發 "to send out"). 0 is a placeholder keeping trad at a fixed index 3.
    const sense = [pinyin, defs]
    if (measures.length) sense[2] = measures
    if (traditional && traditional !== simplified) {
      if (sense.length < 3) sense[2] = 0
      sense[3] = traditional
      if (!tradToSimp[traditional]) tradToSimp[traditional] = simplified // first wins
    }
    if (entries[simplified]) entries[simplified].push(sense)
    else entries[simplified] = [sense]
  }

  // never let a traditional form redirect away from a real simplified entry of
  // the same shape (some characters are both their own simplified entry and
  // another word's traditional source); lookups of those resolve to themselves.
  for (const trad of Object.keys(tradToSimp)) {
    if (entries[trad]) delete tradToSimp[trad]
  }

  // merge HSK level + POS + official gloss (word -> {lvl,pos,def}), keeping only
  // words we can look up. Source is the committed assets/hsk-vocab/hsk-data.json
  // (derived from the HSK 3.0 lists by `npm run convert:hsk`); build still works
  // without it.
  const hsk = Object.create(null) // word -> primary level (1–6 or "7-9")
  const pos = Object.create(null) // word -> "verb; noun" (primary reading)
  const hskSenses = Object.create(null) // word -> [{lvl,pos,def}] (all HSK glosses)
  let hskCount = 0
  try {
    const all = JSON.parse(await readFile(hskSrc, 'utf8'))
    for (const [word, info] of Object.entries(all)) {
      if (!entries[word]) continue
      hsk[word] = info.lvl
      if (info.pos) pos[word] = info.pos
      if (info.senses && info.senses.length) hskSenses[word] = info.senses
      hskCount++
    }
  } catch {
    console.warn('[build-dict] assets/hsk-vocab/hsk-data.json not found — skipping HSK level/POS/gloss (committed data file is missing; run `npm run convert:hsk` to regenerate)')
  }

  // character decomposition: radical / components / stroke count + short glosses
  // (from makemeahanzi via `npm run convert:chars`). Optional like HSK.
  let chars = Object.create(null)
  let charGloss = Object.create(null)
  let charCount = 0
  try {
    const cd = JSON.parse(await readFile(charSrc, 'utf8'))
    chars = cd.chars || {}
    charGloss = cd.gloss || {}
    charCount = Object.keys(chars).length
  } catch {
    console.warn('[build-dict] char-data/char-data.json not found — skipping radical/components (run `npm run convert:chars`)')
  }

  const count = Object.keys(entries).length
  const tradCount = Object.keys(tradToSimp).length
  await mkdir(outDir, { recursive: true })
  await writeFile(outFile, JSON.stringify({ entries, tradToSimp, hsk, pos, hskSenses, chars, charGloss, count }))
  // also emit the HSK map on its own so the worker's highlight path stays light
  await writeFile(hskOutFile, JSON.stringify(hsk))

  console.log(
    `[build-dict] HSK level+POS attached to ${hskCount} entries; ${charCount} chars with decomposition\n` +
    `[build-dict] ${tradCount} traditional forms mapped to simplified\n` +
    `[build-dict] wrote ${outFile}\n` +
      `  ${all.length} CC-CEDICT lines -> ${count} simplified keys`
  )
}

main().catch((err) => {
  console.error('[build-dict] failed:', err)
  process.exit(1)
})
