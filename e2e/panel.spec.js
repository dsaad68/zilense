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
  // meanings now render as grouped, numbered items (.defs-grouped > .defs-item)
  await expect(page.locator('.defs-grouped')).toContainText(/hello/i)
})

test('side panel consumes a pending lookup on mount', async () => {
  // The worker stashes the selected word in session storage before opening the
  // panel, so a cold panel (whose message listener isn't ready yet) still shows
  // it on mount. This context never calls sidePanel.open(), so no second,
  // headless-invisible panel races this one for the read-once value.
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker')
  await sw.evaluate(() => new Promise((r) =>
    chrome.storage.session.set({ 'mydict.pendingLookup': { q: '学习', t: 1 } }, r)))

  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extId}/src/sidepanel/index.html`)
  await expect(panel.locator('.hanzi-big')).toContainText('学习', { timeout: 30_000 })
})

test('familiarity is recorded only when the feature is enabled', async () => {
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker')
  const readFam = () => sw.evaluate(() => new Promise((r) =>
    chrome.storage.local.get('mydict.familiarity', (g) => r(g['mydict.familiarity'] || null))))

  async function lookUp(page) {
    await page.goto(`chrome-extension://${extId}/src/sidepanel/index.html`)
    await page.getByPlaceholder(/Search/).fill('nihao')
    await page.locator('.result', { hasText: '你好' }).first().click()
    await expect(page.locator('.hanzi-big')).toContainText('你好')
  }

  // feature OFF (the default): a deliberate lookup must record nothing
  await sw.evaluate(() => new Promise((r) => chrome.storage.local.set({
    'mydict.familiarity': {}, 'mydict.settings': { showFamiliarity: false },
  }, r)))
  await lookUp(await context.newPage())
  await new Promise((r) => setTimeout(r, 700)) // past the 400ms debounced write
  expect(await readFam(), 'no familiarity recorded while the feature is off').toEqual({})

  // feature ON: the same deliberate lookup is now recorded
  await sw.evaluate(() => new Promise((r) =>
    chrome.storage.local.set({ 'mydict.settings': { showFamiliarity: true } }, r)))
  await lookUp(await context.newPage())
  await expect
    .poll(async () => Object.keys((await readFam()) || {}).length, { timeout: 5_000 })
    .toBeGreaterThan(0)
})
