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

// CedPane (names & proper nouns by Silas S. Brown, public domain) is a SECOND
// dictionary source merged in below. It is fetched ONCE at build time and cached
// as a compact JSON that is committed, so every later build/test is deterministic
// and needs no network (just like the committed makemeahanzi-derived char data).
// No runtime fetch and no new host permission are involved.
const cedpaneCacheFile = resolve(root, 'assets/cedpane/cedpane.json')
const CEDPANE_URL = 'https://raw.githubusercontent.com/ssb22/CedPane/master/cedpane.tsv'

// Parse CedPane's tab-separated source (columns: Word, Simplified, Traditional,
// Pinyin, Yale, IPA) into compact [simp, trad, pinyin, def] records, dropping the
// Cantonese-Yale and English-IPA columns we don't use. `trad` is '' when it equals
// the simplified form (matching how CC-CEDICT senses omit an identical trad). The
// pinyin is already tone-marked (CedPane ships diacritics, not numbered pinyin).
// Sorted so the cache — and therefore the merge — is deterministic and re-runnable.
function parseCedpane(tsv) {
  const out = []
  const lines = tsv.split('\n')
  for (let i = 1; i < lines.length; i++) { // row 0 is the column header
    const ln = lines[i]
    if (!ln) continue
    const col = ln.split('\t')
    const def = (col[0] || '').trim()
    const simp = (col[1] || '').trim()
    const trad = (col[2] || '').trim()
    const pinyin = (col[3] || '').trim()
    if (!simp || !def || !pinyin) continue
    out.push([simp, trad && trad !== simp ? trad : '', pinyin, def])
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0))
  return out
}

// Load the CedPane records: prefer the committed cache (offline, deterministic);
// only when it is absent do we do a one-time BUILD-TIME download and write the
// cache. A missing source (no cache + no network) is non-fatal — the build still
// produces a valid CC-CEDICT-only index, exactly like the HSK/char data paths.
async function loadCedpaneRecords() {
  try {
    const cached = JSON.parse(await readFile(cedpaneCacheFile, 'utf8'))
    if (Array.isArray(cached.entries)) return cached.entries
  } catch {}
  try {
    const res = await fetch(CEDPANE_URL)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const records = parseCedpane(await res.text())
    await mkdir(dirname(cedpaneCacheFile), { recursive: true })
    await writeFile(
      cedpaneCacheFile,
      JSON.stringify({ source: 'CedPane', url: CEDPANE_URL, license: 'Public domain (Unlicense)', count: records.length, entries: records })
    )
    console.log(`[build-dict] fetched CedPane (${records.length} records) -> ${cedpaneCacheFile}`)
    return records
  } catch (e) {
    console.warn('[build-dict] CedPane source unavailable (no cache + fetch failed) — skipping proper-noun merge: ' + e.message)
    return []
  }
}

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

  // ---- CedPane proper nouns (names, places, brands) -----------------------
  // Merge CedPane as a second source, but ONLY for simplified forms CC-CEDICT
  // does not already cover, and never for a form that is already someone's
  // traditional source — so every existing simplified AND traditional lookup is
  // byte-for-byte unchanged. Each merged sense gets a proper-noun flag (1 at
  // index 4: [pinyin, defs, measures, trad, proper]); dict-core reads that flag
  // to keep names from outranking everyday words (a name homograph never beats
  // the common word). A few CedPane forms collide with CC-CEDICT and are skipped.
  const cedpane = await loadCedpaneRecords()
  const cedpaneKeys = new Set()
  let cedpaneSenses = 0
  for (const [simp, trad, pinyin, def] of cedpane) {
    if (entries[simp] && !cedpaneKeys.has(simp)) continue // CC-CEDICT simplified entry wins
    if (tradToSimp[simp] && !cedpaneKeys.has(simp)) continue // don't shadow a trad->simp redirect
    const sense = [pinyin, [def], 0, trad || 0, 1]
    if (entries[simp]) entries[simp].push(sense) // another sense for a multi-reading name
    else { entries[simp] = [sense]; cedpaneKeys.add(simp) }
    cedpaneSenses++
  }
  // map each merged name's traditional form to its simplified key (first wins;
  // never over an existing simplified entry or an existing mapping)
  for (const [simp, trad] of cedpane) {
    if (!trad || !cedpaneKeys.has(simp)) continue
    if (!tradToSimp[trad] && !entries[trad]) tradToSimp[trad] = simp
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
      // An HSK word is common vocabulary, not a name. If a word exists ONLY
      // because of the CedPane merge, clear its proper-noun flag so search ranks
      // it like any other HSK word instead of demoting it as a proper noun.
      const senses = entries[word]
      if (senses.every((s) => s[4] === 1)) for (const s of senses) s.length = 4
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
  await writeFile(outFile, JSON.stringify({ entries, tradToSimp, hsk, pos, hskSenses, chars, charGloss, count, cedpane: cedpaneKeys.size }))
  // also emit the HSK map on its own so the worker's highlight path stays light
  await writeFile(hskOutFile, JSON.stringify(hsk))

  console.log(
    `[build-dict] HSK level+POS attached to ${hskCount} entries; ${charCount} chars with decomposition\n` +
    `[build-dict] CedPane proper nouns merged: ${cedpaneKeys.size} keys (${cedpaneSenses} senses)\n` +
    `[build-dict] ${tradCount} traditional forms mapped to simplified\n` +
    `[build-dict] wrote ${outFile}\n` +
      `  ${all.length} CC-CEDICT lines + CedPane -> ${count} simplified keys`
  )
}

main().catch((err) => {
  console.error('[build-dict] failed:', err)
  process.exit(1)
})
