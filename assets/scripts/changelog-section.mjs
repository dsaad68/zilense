/* changelog-section.mjs — print the body of one version's section from CHANGELOG.md,
   used as the GitHub release notes. Usage: node assets/scripts/changelog-section.mjs 1.9.4
   Prints everything under `## [1.9.4] …` up to (but not including) the next `## `
   heading. Exits non-zero if that version has no section, so the release workflow
   fails loudly rather than publishing empty notes. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const version = process.argv[2]
if (!version) {
  console.error('usage: node assets/scripts/changelog-section.mjs <version>')
  process.exit(1)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const lines = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8').split('\n')

const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
if (start === -1) {
  console.error(`changelog-section: no "## [${version}]" section in CHANGELOG.md`)
  process.exit(1)
}
let end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
if (end === -1) end = lines.length

const body = lines.slice(start + 1, end).join('\n').trim()
if (!body) {
  console.error(`changelog-section: the "${version}" section is empty`)
  process.exit(1)
}
process.stdout.write(body + '\n')
