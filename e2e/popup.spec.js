/* popup.spec.js — Playwright smoke test: load the built extension and open the
   toolbar action popup as a page, verifying it renders its brand icon, the
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

  // the primary actions are present with their labels
  await expect(page.locator('#open-panel')).toContainText('Open side panel')
  await expect(page.locator('#open-window')).toContainText('Open in window')
  await expect(page.locator('#reader-mode')).toContainText('Reader mode')
  await expect(page.locator('#flashcards')).toContainText('Flashcards')

  // settings controls: the two switches and the HSK level picker (Off + 7 levels)
  await expect(page.locator('#hover-toggle')).toBeVisible()
  await expect(page.locator('#hsk-color')).toBeVisible()
  await expect(page.locator('#hsk-level option')).toHaveCount(8)

  // pause switch — present, defaults OFF (not paused), and flips when clicked
  const master = page.locator('#master-toggle')
  await expect(master).toBeVisible()
  await expect(master).toHaveAttribute('aria-checked', 'false')
  await master.click()
  await expect(master).toHaveAttribute('aria-checked', 'true')
})

test('panel draws a brand header only when opened as a window', async () => {
  const base = `chrome-extension://${extId}/src/sidepanel/index.html`

  // side-panel mode (no ?mode): Chrome's own bar supplies the name, so no header
  const sidePanel = await context.newPage()
  await sidePanel.goto(base)
  await expect(sidePanel.locator('.searchbar')).toBeVisible()
  await expect(sidePanel.locator('.win-head')).toHaveCount(0)

  // window mode: the app renders its own brand header with the extension icon
  const windowed = await context.newPage()
  await windowed.goto(`${base}?mode=window`)
  await expect(windowed.locator('.win-head .win-title')).toContainText('Zilense')
  await expect(windowed.locator('.win-head .win-seal')).toHaveAttribute('src', /icons\/icon-48\.png$/)
})

test('"Open in window" opens a detached dictionary window via the worker', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extId}/src/popup/index.html`)

  // the click messages the service worker, which calls chrome.windows.create —
  // the new window surfaces as a fresh page on the context
  const opened = context.waitForEvent('page')
  await page.locator('#open-window').click()
  const win = await opened
  await win.waitForLoadState()

  // it's the side-panel page in window mode, with its own brand header
  expect(win.url()).toContain('/src/sidepanel/index.html')
  expect(win.url()).toContain('mode=window')
  await expect(win.locator('.win-head .win-title')).toContainText('Zilense')
})
