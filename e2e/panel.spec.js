/* panel.spec.js — Playwright smoke test: load the built extension in Chromium,
   open the side-panel page, and verify the dictionary loads and search works.
   Run `npm run build` first. Extensions require a headed, persistent context. */
import { test, chromium, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(__dirname, '../dist')

let context
let extId

test.beforeAll(async () => {
  expect(existsSync(resolve(distDir, 'manifest.json')), 'run `npm run build` first').toBeTruthy()
  context = await chromium.launchPersistentContext('', {
    headless: false, // MV3 extensions don't load in classic headless
    args: [
      `--headless=new`,
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
    ],
  })
  // the extension id is the host of its service-worker URL
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker')
  extId = new URL(sw.url()).host
})

test.afterAll(async () => { await context?.close() })

test('side panel loads the dictionary and looks up a word', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extId}/src/sidepanel/index.html`)

  // dictionary finishes loading -> the empty "hover" prompt appears
  await expect(page.getByText('Hover a character to begin')).toBeVisible({ timeout: 30_000 })

  // search by pinyin -> 你好 surfaces and opens as an entry
  await page.getByPlaceholder(/Search/).fill('nihao')
  const result = page.locator('.result', { hasText: '你好' }).first()
  await expect(result).toBeVisible({ timeout: 10_000 })
  await result.click()

  await expect(page.locator('.hanzi-big')).toContainText('你好')
  await expect(page.locator('.defs')).toContainText(/hello/i)
})
