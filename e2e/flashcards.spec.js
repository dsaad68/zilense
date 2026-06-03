/* flashcards.spec.js — Playwright smoke test: load the built extension, open the
   flashcards page, build an HSK deck, run a card, and reach the results screen.
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
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker')
  extId = new URL(sw.url()).host
})

test.afterAll(async () => { await context?.close() })

test('flashcards page studies an HSK deck end to end', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extId}/src/flashcards/index.html`)

  // dictionary loads -> the setup screen becomes active
  await expect(page.locator('#screen-home')).toHaveClass(/active/, { timeout: 30_000 })

  // pick the HSK 1 deck (always has words, unlike a fresh "Starred" deck)
  await page.selectOption('#deck-select', 'hsk1')
  await expect(page.locator('#deck-hint')).toContainText(/HSK 1/)

  // start is enabled once the pool is non-empty -> begin the round
  const start = page.locator('#start-btn')
  await expect(start).toBeEnabled()
  await start.click()

  // round screen active, a card is shown
  await expect(page.locator('#screen-round')).toHaveClass(/active/)
  await expect(page.locator('#card')).toBeVisible()

  // space reveals the answer; the back face carries the character + meaning
  await page.keyboard.press('Space')
  await expect(page.locator('#card')).toHaveClass(/revealed/)
  await expect(page.locator('#a-char')).not.toBeEmpty()
  await expect(page.locator('#a-mean')).not.toBeEmpty()

  // space again marks the revealed card "Got it" (no auto-advance on keyboard)
  await page.keyboard.press('Space')

  // end the round -> results screen tallies the one correct card
  await page.locator('#abandon-btn').click()
  await expect(page.locator('#screen-results')).toHaveClass(/active/)
  await expect(page.locator('#r-correct')).toHaveText('1')
})
