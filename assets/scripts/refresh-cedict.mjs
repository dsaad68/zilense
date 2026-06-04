/* refresh-cedict.mjs — update the vendored CC-CEDICT source.

   The extension is built from a pinned, committed copy of the raw CC-CEDICT
   export at assets/cedict/cedict_ts.u8 (so builds are reproducible and need no
   network). Run this script to deliberately pull a newer CC-CEDICT release from
   MDBG and overwrite the vendored file, then commit the change and rebuild:

     npm run refresh:cedict
     npm run build:dict       # regenerate src/data/cedict.json
     git add assets/cedict/cedict_ts.u8 && git commit -m "Update vendored CC-CEDICT"

   This is the ONLY place the dictionary touches the network, and only when you
   explicitly run it — never at install or build time. */

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const CEDICT_ZIP_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip'
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')
const outFile = resolve(root, 'assets/cedict/cedict_ts.u8')

// unzipper is a transitive dep available in node_modules; resolve it lazily so a
// missing install gives a clear message instead of an import crash.
let unzipper
try {
  unzipper = (await import('unzipper')).default || (await import('unzipper'))
} catch {
  // fall back to the system `unzip` via a temp file if the package is absent
  unzipper = null
}

async function main() {
  console.log(`[refresh-cedict] downloading ${CEDICT_ZIP_URL}`)
  const res = await fetch(CEDICT_ZIP_URL)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  const zipBuf = Buffer.from(await res.arrayBuffer())

  let u8
  if (unzipper) {
    const dir = await unzipper.Open.buffer(zipBuf)
    const file = dir.files.find((f) => f.path === 'cedict_ts.u8')
    if (!file) throw new Error('cedict_ts.u8 not found in the downloaded ZIP')
    u8 = (await file.buffer()).toString('utf8')
  } else {
    const require = createRequire(import.meta.url)
    const { execFileSync } = require('node:child_process')
    const tmp = resolve(root, 'assets/cedict/.cedict.zip')
    await writeFile(tmp, zipBuf)
    u8 = execFileSync('unzip', ['-p', tmp, 'cedict_ts.u8']).toString('utf8')
    const { rm } = await import('node:fs/promises')
    await rm(tmp)
  }

  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, u8)
  const version = (u8.match(/#! date=(\S+)/) || [])[1] || 'unknown'
  const entries = (u8.match(/#! entries=(\d+)/) || [])[1] || '?'
  console.log(`[refresh-cedict] wrote ${outFile}\n  CC-CEDICT date=${version}, entries=${entries}`)
  // touch a friendly hint if the file is unchanged
  try {
    const prev = await readFile(outFile, 'utf8')
    if (prev === u8) console.log('[refresh-cedict] (content unchanged from what was already vendored)')
  } catch {}
}

main().catch((err) => {
  console.error('[refresh-cedict] failed:', err.message)
  process.exit(1)
})
