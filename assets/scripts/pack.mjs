/* pack.mjs — package the built extension into an uploadable Chrome Web Store
   zip. Run via `npm run pack`, which builds first, so dist/ is fresh (and the
   postbuild step has copied LICENSE / THIRD-PARTY-NOTICES.md into it).

   The zip is created from INSIDE dist/, so manifest.json sits at the zip root —
   which is what the Chrome Web Store requires. Output: release/hanzilens-<version>.zip
   .DS_Store and other OS cruft are excluded. */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..') // assets/scripts -> repo root
const dist = resolve(root, 'dist')
const releaseDir = resolve(root, 'release')

const { version } = createRequire(import.meta.url)(resolve(root, 'package.json'))

if (!existsSync(resolve(dist, 'manifest.json'))) {
  console.error('[pack] dist/manifest.json not found — run `npm run build` first')
  process.exit(1)
}

mkdirSync(releaseDir, { recursive: true })
const zipPath = resolve(releaseDir, `hanzilens-${version}.zip`)
rmSync(zipPath, { force: true }) // overwrite any previous build of this version

// zip from within dist/ so the archive root is the extension root.
execFileSync(
  'zip',
  ['-r', '-X', '-q', zipPath, '.', '-x', '*.DS_Store', '-x', '__MACOSX*'],
  { cwd: dist, stdio: 'inherit' },
)

console.log(`[pack] wrote ${zipPath}`)
