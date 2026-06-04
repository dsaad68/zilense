/* pdfviewer.spec.js — Playwright E2E for the bundled PDF.js viewer. Chrome's native
   PDF viewer has no hoverable text; this viewer renders a real text layer so the
   shared hover driver works on PDFs. We load a tiny Chinese-text fixture and cover:
     • the text layer renders with the PDF's Chinese text,
     • hovering a character paints the hover token (mydict-tok) — the driver
       resolved the word via the service worker, exactly as on a web page,
     • clicking a word pins it and drives the side panel (worker `open-panel` →
       setPendingLookup), reusing reader.spec's open-panel assertion.

   Run `npm run build` first. MV3 extensions need a headed, persistent context, so
   this runs via `npm run test:e2e`, not `npm test`. The fixture is committed; see
   e2e/fixtures/make-pdf.mjs for how it's generated. */
import { test, chromium, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(__dirname, '../dist')

// the fixture is served from an arbitrary https origin; the viewer (an extension
// page) fetches it. We fulfill with permissive CORS so the fetch needs no host
// permission in the test.
const PDF_URL = 'https://zilense.test/zh-sample.pdf'
const pdfBytes = readFileSync(resolve(__dirname, 'fixtures/zh-sample.pdf'))

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
  await context.route(`${PDF_URL}*`, (route) => route.fulfill({
    contentType: 'application/pdf',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: pdfBytes,
  }))
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker')
  extId = new URL(sw.url()).host
})

test.afterAll(async () => { await context?.close() })

const viewerUrl = () =>
  `chrome-extension://${extId}/src/pdfviewer/index.html#file=${encodeURIComponent(PDF_URL)}`

test('PDF viewer: renders a text layer carrying the PDF’s Chinese text', async () => {
  const page = await context.newPage()
  await page.goto(viewerUrl())
  await expect(page.locator('.textLayer span').first()).toBeVisible({ timeout: 30_000 })
  const text = await page.locator('.textLayer').first().innerText()
  expect(text).toContain('学习')
  await page.close()
})

test('PDF viewer: hover paints the token; click pins the word to the panel', async () => {
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker')
  // clear any stale pending lookup so the assertion below is unambiguous
  await sw.evaluate(() => new Promise((r) => chrome.storage.session.remove('mydict.pendingLookup', r)))

  const page = await context.newPage()
  await page.goto(viewerUrl())
  const span = page.locator('.textLayer span').first()
  await expect(span).toBeVisible({ timeout: 30_000 })

  // hover → the driver collects the forward run under the cursor, asks the worker to
  // segment+look it up (first use loads the ~14 MB dict), and paints mydict-tok
  await span.hover()
  await expect
    .poll(() => page.evaluate(() => 'highlights' in CSS && CSS.highlights.has('mydict-tok')),
      { timeout: 45_000, intervals: [400, 800, 1200] })
    .toBe(true)

  // click → pin → worker `open-panel` → setPendingLookup(word). Reading it back
  // from session storage proves the pin reached the worker with a real Chinese word
  // (same proof reader.spec uses for its iframe pin path).
  await span.click()
  await expect
    .poll(async () => sw.evaluate(() => new Promise((r) =>
      chrome.storage.session.get('mydict.pendingLookup', (g) => r((g['mydict.pendingLookup'] || {}).q)))),
      { timeout: 10_000 })
    .toMatch(/[一-鿿]/)
  await page.close()
})

test('PDF toast: native PDF shows an "Open in Zilense" toast that loads the viewer', async () => {
  // open the digital fixture in Chrome's NATIVE viewer (navigate the tab to the .pdf).
  // The content script runs on the PDF tab's top frame and shows the toast.
  const page = await context.newPage()
  await page.goto(PDF_URL)
  // the toast lives in a shadow root on #mydict-pdf-toast-host
  await expect
    .poll(() => page.evaluate(() => {
      const h = document.getElementById('mydict-pdf-toast-host')
      return !!(h && h.shadowRoot && h.shadowRoot.querySelector('.open'))
    }), { timeout: 15_000 })
    .toBe(true)
  // clicking "Open in Zilense" asks the worker to navigate this tab to the viewer
  await page.evaluate(() =>
    document.getElementById('mydict-pdf-toast-host').shadowRoot.querySelector('.open').click())
  await expect.poll(() => page.url(), { timeout: 15_000 }).toContain('/src/pdfviewer/index.html')
  await expect(page.locator('.textLayer span').first()).toBeVisible({ timeout: 30_000 })
  await page.close()
})

test('PDF viewer: OCRs a scanned (image-only) PDF into a selectable text layer', async () => {
  // a one-page image-only PDF (no text layer) — see fixtures/make-scanned-pdf.mjs
  const scanned = readFileSync(resolve(__dirname, 'fixtures/zh-scanned.pdf'))
  const SC_URL = 'https://zilense.test/zh-scanned.pdf'
  const page = await context.newPage()
  await page.route(`${SC_URL}*`, (route) => route.fulfill({
    contentType: 'application/pdf',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: scanned,
  }))
  await page.goto(`chrome-extension://${extId}/src/pdfviewer/index.html#file=${encodeURIComponent(SC_URL)}`)

  // no PDF text layer → the viewer runs bundled Tesseract OCR and fills the layer
  // with recognized words. Allow time for the model to load + recognize.
  await expect(page.locator('.textLayer span').first()).toBeVisible({ timeout: 120_000 })
  const text = await page.locator('.textLayer').first().innerText()
  expect(text).toMatch(/[好吃杯子衣服]/) // recognized at least one of the rendered words

  // the synthesized OCR layer is selectable just like a digital text layer
  const span = page.locator('.textLayer span').filter({ hasText: /[一-鿿]/ }).first()
  const r = await span.boundingBox()
  await page.mouse.move(r.x + 1, r.y + r.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width - 1, r.y + r.height / 2, { steps: 6 })
  await page.mouse.up()
  expect(await page.evaluate(() => window.getSelection().toString())).toMatch(/[一-鿿]/)
  await page.close()
})

test('PDF viewer: the text layer is selectable (drag selects text)', async () => {
  const page = await context.newPage()
  await page.goto(viewerUrl())
  const span = page.locator('.textLayer span').first()
  await expect(span).toBeVisible({ timeout: 30_000 })

  // drag across the span; the text layer spans are real, selectable text nodes
  const r = await span.boundingBox()
  await page.mouse.move(r.x + 2, r.y + r.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width - 2, r.y + r.height / 2, { steps: 8 })
  await page.mouse.up()
  expect(await page.evaluate(() => window.getSelection().toString())).toContain('学习')
  await page.close()
})
