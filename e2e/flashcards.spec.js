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

  // pick the HSK 1 deck (always has words, unlike a fresh "Starred" deck) via the
  // custom dropdown: open it, then click the HSK 1 option.
  await page.locator('#deck-dd-btn').click()
  await page.locator('#deck-dd-menu .dropdown-opt[data-value="hsk1"]').click()
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

test('flashcards setup: HSK level scope and the pinyin/POS toggles', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extId}/src/flashcards/index.html`)
  await expect(page.locator('#screen-home')).toHaveClass(/active/, { timeout: 30_000 })

  // the starred deck is the default -> the HSK level-scope control stays hidden
  await expect(page.locator('#scope-control')).toBeHidden()

  // choose HSK 2 via the custom dropdown -> scope control appears, "just this level"
  await page.locator('#deck-dd-btn').click()
  await page.locator('#deck-dd-menu .dropdown-opt[data-value="hsk2"]').click()
  await expect(page.locator('#scope-control')).toBeVisible()
  await expect(page.locator('#deck-hint')).toContainText(/in HSK 2/)
  const exact = Number((await page.locator('#deck-hint').textContent()).match(/\d+/)[0])

  // "up to this level" is cumulative -> strictly more words than HSK 2 alone, and
  // the hint switches to "up to HSK 2"
  await page.locator('#scope-control label', { hasText: 'Up to' }).click()
  await expect(page.locator('#deck-hint')).toContainText(/up to HSK 2/)
  const cumulative = Number((await page.locator('#deck-hint').textContent()).match(/\d+/)[0])
  expect(cumulative).toBeGreaterThan(exact)

  // pinyin-on-top is reflected in the round summary (character mode + toggle on)
  await expect(page.locator('#round-summary')).toContainText(/pinyin on top/)
  await page.locator('label.toggle-switch', { has: page.locator('#setup-pinyin') }).click()
  await expect(page.locator('#round-summary')).not.toContainText(/pinyin on top/)

  // the Show-POS toggle is wired (off by default, flips on)
  await expect(page.locator('#setup-pos')).not.toBeChecked()
  await page.locator('label.toggle-switch', { has: page.locator('#setup-pos') }).click()
  await expect(page.locator('#setup-pos')).toBeChecked()
})
