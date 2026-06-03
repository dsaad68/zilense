/* popup.spec.js — Playwright smoke test: load the built extension and open the
   toolbar action popup as a page, verifying it renders its brand icon, the three
   actions, and the HSK/toggle controls. Run `npm run build` first. */
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
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker')
  extId = new URL(sw.url()).host
})

test.afterAll(async () => { await context?.close() })

test('toolbar popup renders the brand icon and controls', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extId}/src/popup/index.html`)

  // the brand mark is the real extension icon (not a text seal)
  const seal = page.locator('.brand .seal')
  await expect(seal).toBeVisible()
  await expect(seal).toHaveAttribute('src', /icons\/icon-48\.png$/)

  // the three primary actions are present with their labels
  await expect(page.locator('#open-panel')).toContainText('Open side panel')
  await expect(page.locator('#reader-mode')).toContainText('Reader mode')
  await expect(page.locator('#flashcards')).toContainText('Flashcards')

  // settings controls: the two switches and the HSK level picker (Off + 7 levels)
  await expect(page.locator('#hover-toggle')).toBeVisible()
  await expect(page.locator('#hsk-color')).toBeVisible()
  await expect(page.locator('#hsk-level option')).toHaveCount(8)
})
