/* main.js — the bundled PDF.js viewer. Chrome's native PDF viewer (PDFium) paints
   text to a canvas and exposes no hoverable DOM, so hover-to-define can't reach it.
   This page renders the same PDF with PDF.js, whose text layer is a stack of real,
   transparent <span> text nodes over each page — and then starts the SHARED hover
   driver (the exact one the content script uses), so hover / pin / inline popup /
   click-to-panel work on PDFs with no special-casing.

   The PDF to open arrives in our URL hash as #file=<encoded url> (see target.js).
   We render lazily: each page gets a correctly-sized placeholder up front (so the
   scrollbar is right) and its canvas + text layer fill in when it scrolls near. */

import * as pdfjsLib from 'pdfjs-dist'
// Bundle the worker as a fingerprinted asset and point pdf.js at its extension URL.
// No CDN workerSrc: MV3 CSP forbids remote script and Zilense is offline-first.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { initHoverDriver } from '../content/hover-driver.js'
import { parsePdfTarget, isFileTarget } from './target.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const viewer = document.getElementById('viewer')
const statusEl = document.getElementById('status')
const emptyEl = document.getElementById('empty')

const setStatus = (t) => { statusEl.textContent = t || '' }

// fit each page to a comfortable reading column, capped so huge pages don't blow up
function pageScale(page) {
  const unscaled = page.getViewport({ scale: 1 })
  const target = Math.min(1000, Math.max(320, window.innerWidth - 32))
  return target / unscaled.width
}

// render one page's canvas + text layer into its placeholder (idempotent: the
// IntersectionObserver may fire more than once, so we guard with data-rendered)
async function renderPage(page, holder) {
  if (holder.dataset.rendered) return
  holder.dataset.rendered = '1'
  const scale = Number(holder.dataset.scale) || pageScale(page)
  const viewport = page.getViewport({ scale })
  const outputScale = window.devicePixelRatio || 1

  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width * outputScale)
  canvas.height = Math.floor(viewport.height * outputScale)
  canvas.style.width = Math.floor(viewport.width) + 'px'
  canvas.style.height = Math.floor(viewport.height) + 'px'
  holder.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null
  await page.render({ canvasContext: ctx, viewport, transform }).promise

  // the text layer: transparent real <span>s positioned over the glyphs. Its
  // width/height use calc(var(--scale-factor) * …), so the scale must be set here.
  const textLayerDiv = document.createElement('div')
  textLayerDiv.className = 'textLayer'
  textLayerDiv.style.setProperty('--scale-factor', String(scale))
  holder.appendChild(textLayerDiv)
  const textLayer = new pdfjsLib.TextLayer({
    // disableNormalization keeps the span text identical to the PDF so selection
    // (and our hover word-collection) map 1:1; includeMarkedContent matches what
    // the reference viewer feeds the layer. Both are what the reference uses.
    textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
    container: textLayerDiv,
    viewport,
  })
  await textLayer.render()
  if (textLayerDiv.querySelector('span')) {
    // digital PDF: real text layer. Make selection robust on real-world PDFs
    // (sparse / overlapping / out-of-order spans, e.g. pinyin over hanzi).
    bindTextLayerSelection(textLayerDiv)
  } else {
    // scanned page: no text layer to extract — OCR the rendered image instead so
    // hover + selection have text to attach to. Fire-and-forget (OCR is slow); the
    // render loop shouldn't block on it.
    runOcr(holder, canvas, textLayerDiv, outputScale)
  }
}

// OCR a scanned page's canvas into the text layer, with a small progress overlay.
// tesseract.js (and the chi_sim model) load on demand — only when a scanned page is
// actually encountered — so digital PDFs never pay for the OCR engine.
async function runOcr(holder, canvas, textLayerDiv, outputScale) {
  const status = document.createElement('div')
  status.className = 'ocr-status'
  status.textContent = 'Recognizing text…'
  holder.appendChild(status)
  try {
    const { ocrCanvasToLayer } = await import('./ocr.js')
    const n = await ocrCanvasToLayer(canvas, textLayerDiv, outputScale, (m) => {
      status.textContent = ocrLabel(m)
    })
    if (n > 0) bindTextLayerSelection(textLayerDiv)
    else status.textContent = 'No text recognized on this page'
    if (n > 0) status.remove()
  } catch (e) {
    status.textContent = 'OCR failed — see console'
    console.error('[zilense] OCR failed', e)
  }
}

// friendly label for a tesseract progress message
function ocrLabel(m) {
  const pct = m.progress != null ? ' ' + Math.round(m.progress * 100) + '%' : ''
  if (m.status === 'recognizing text') return 'Recognizing text…' + pct
  if ((m.status || '').includes('loading')) return 'Loading OCR…' + pct
  return (m.status || 'Working…') + pct
}

/* Text-layer selection enhancement, ported from pdfjs-dist's web/pdf_viewer
   TextLayerBuilder. The bare TextLayer class lays the transparent spans out but
   does NOT make drag-selection work across them; in many PDFs the browser then
   can't extend a selection past a single span. The fix the reference viewer uses
   is an `endOfContent` sentinel per layer plus a global selectionchange handler
   that moves+sizes it next to the live anchor, so the selection can grow over the
   whole page. We keep one global listener for all rendered pages. */
const textLayers = new Map() // textLayerDiv -> its endOfContent div
let selectionListenerOn = false

function resetTextLayer(end, textLayer) {
  textLayer.append(end)
  end.style.width = ''
  end.style.height = ''
  textLayer.classList.remove('selecting')
}

function enableGlobalSelectionListener() {
  if (selectionListenerOn) return
  selectionListenerOn = true
  let isPointerDown = false
  document.addEventListener('pointerdown', () => { isPointerDown = true })
  document.addEventListener('pointerup', () => { isPointerDown = false; textLayers.forEach(resetTextLayer) })
  window.addEventListener('blur', () => { isPointerDown = false; textLayers.forEach(resetTextLayer) })
  document.addEventListener('keyup', () => { if (!isPointerDown) textLayers.forEach(resetTextLayer) })
  let prevRange
  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection()
    if (selection.rangeCount === 0) { textLayers.forEach(resetTextLayer); return }
    const active = new Set()
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i)
      for (const div of textLayers.keys()) {
        if (!active.has(div) && range.intersectsNode(div)) active.add(div)
      }
    }
    for (const [div, endDiv] of textLayers) {
      if (active.has(div)) div.classList.add('selecting')
      else resetTextLayer(endDiv, div)
    }
    const range = selection.getRangeAt(0)
    const modifyStart = prevRange && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
      range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0)
    let anchor = modifyStart ? range.startContainer : range.endContainer
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode
    const parentTextLayer = anchor.parentElement && anchor.parentElement.closest('.textLayer')
    const endDiv = textLayers.get(parentTextLayer)
    if (endDiv) {
      endDiv.style.width = parentTextLayer.style.width
      endDiv.style.height = parentTextLayer.style.height
      anchor.parentElement.insertBefore(endDiv, modifyStart ? anchor : anchor.nextSibling)
    }
    prevRange = range.cloneRange()
  })
}

function bindTextLayerSelection(textLayerDiv) {
  const end = document.createElement('div')
  end.className = 'endOfContent'
  textLayerDiv.append(end)
  textLayerDiv.addEventListener('mousedown', () => textLayerDiv.classList.add('selecting'))
  textLayers.set(textLayerDiv, end)
  enableGlobalSelectionListener()
}

// show the "no/blocked PDF" panel; for file:// targets, the most common cause is
// the un-toggled "Allow access to file URLs", so spell that out.
function showEmpty(target, detail) {
  viewer.hidden = true
  emptyEl.hidden = false
  if (isFileTarget(target)) {
    emptyEl.innerHTML =
      '<h2>Can’t open this local PDF</h2>' +
      '<p>To read <code>file://</code> PDFs, enable <b>“Allow access to file URLs”</b> ' +
      'for Zilense on the extensions page, then reload:</p>' +
      '<p><code>chrome://extensions</code> → Zilense → Details → Allow access to file URLs</p>'
  } else if (!target) {
    emptyEl.innerHTML =
      '<h2>No PDF to show</h2><p>Open a PDF and choose “Open this PDF in Zilense”.</p>'
  } else {
    emptyEl.innerHTML =
      '<h2>Couldn’t load this PDF</h2><p>' + (detail || 'The file could not be read.') + '</p>'
  }
}

async function main() {
  // Start the shared hover driver immediately: its listeners live on `document`, so
  // any page rendered now or later is covered. (Our own page is never "disabled",
  // so no allowDisable predicate.)
  initHoverDriver()

  const target = parsePdfTarget(window.location.hash)
  if (!target) { showEmpty(''); return }

  setStatus('Loading…')
  let pdf
  try {
    pdf = await pdfjsLib.getDocument({ url: target }).promise
  } catch (e) {
    showEmpty(target, e && e.message)
    setStatus('')
    return
  }

  const total = pdf.numPages
  setStatus(total + (total === 1 ? ' page' : ' pages'))
  document.title = 'Zilense PDF — ' + (target.split('/').pop() || 'document')

  // render-on-demand: build a sized placeholder per page now, fill it when near
  const observer = new IntersectionObserver((entries, obs) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const holder = entry.target
      obs.unobserve(holder)
      const n = Number(holder.dataset.page)
      pdf.getPage(n).then((page) => renderPage(page, holder)).catch(() => {})
    }
  }, { rootMargin: '600px 0px' }) // start a little before the page enters view

  // size each placeholder from its page's scaled viewport so the scrollbar is right
  for (let n = 1; n <= total; n++) {
    const page = await pdf.getPage(n)
    const scale = pageScale(page)
    const vp = page.getViewport({ scale })
    const holder = document.createElement('div')
    holder.className = 'page'
    holder.dataset.page = String(n)
    holder.dataset.scale = String(scale)
    holder.style.width = Math.floor(vp.width) + 'px'
    holder.style.height = Math.floor(vp.height) + 'px'
    viewer.appendChild(holder)
    observer.observe(holder)
  }
}

main()
