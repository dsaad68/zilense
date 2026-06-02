/* copy-notices.mjs — postbuild: copy the license + attribution files into dist/
   so the packaged extension (the .zip uploaded to the Chrome Web Store) carries
   the required notices. Runs automatically after `npm run build` (postbuild).

   Copies:
     LICENSE                  -> dist/LICENSE
     THIRD-PARTY-NOTICES.md   -> dist/THIRD-PARTY-NOTICES.md
     licenses/*               -> dist/licenses/*   (verbatim upstream license texts)

   The side panel links to dist/THIRD-PARTY-NOTICES.md via chrome.runtime.getURL,
   so these must be present in the build output, not just the repo root. */

import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..') // assets/scripts -> repo root
const dist = resolve(root, 'dist')

async function main() {
  if (!existsSync(dist)) {
    console.error('[copy-notices] dist/ not found — run `npm run build` first')
    process.exit(1)
  }

  await copyFile(resolve(root, 'LICENSE'), resolve(dist, 'LICENSE'))
  await copyFile(resolve(root, 'THIRD-PARTY-NOTICES.md'), resolve(dist, 'THIRD-PARTY-NOTICES.md'))

  const srcLic = resolve(root, 'licenses')
  const dstLic = resolve(dist, 'licenses')
  await mkdir(dstLic, { recursive: true })
  let n = 0
  for (const f of await readdir(srcLic)) {
    await copyFile(join(srcLic, f), join(dstLic, f))
    n++
  }

  console.log(`[copy-notices] copied LICENSE, THIRD-PARTY-NOTICES.md, and ${n} license file(s) into dist/`)
}

main().catch((err) => {
  console.error('[copy-notices] failed:', err)
  process.exit(1)
})
