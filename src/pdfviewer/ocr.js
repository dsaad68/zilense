/* ocr.js — offline OCR for SCANNED PDFs. Many PDFs (e.g. photographed HSK
   workbooks) are just full-page images with no text layer, so PDF.js extracts
   nothing and hover/selection have nothing to attach to. Chrome's native viewer
   side-steps this with built-in OCR; we do the same with a fully-bundled
   Tesseract.js (engine + chi_sim model under /tesseract, no network).

   For each scanned page we recognize the rendered canvas, then synthesize the SAME
   kind of transparent, absolutely-positioned text layer PDF.js builds for digital
   PDFs — one span per recognized word, positioned over its image glyphs — so the
   existing hover driver and text selection work unchanged. */
import { createWorker, OEM, PSM } from 'tesseract.js'
import { wordsFromData, wordBox } from './ocr-core.js'

const U = (p) => chrome.runtime.getURL(p)

let workerPromise = null
// One Tesseract worker for the whole viewer, created on the first scanned page and
// reused for the rest. All assets are bundled extension URLs (offline); the SIMD
// LSTM core is forced (Chrome 116+ has SIMD) and the model is served uncompressed.
export function ensureOcrWorker(onStatus) {
  if (workerPromise) return workerPromise
  workerPromise = createWorker('chi_sim', OEM.LSTM_ONLY, {
    workerPath: U('tesseract/worker.min.js'),
    corePath: U('tesseract/tesseract-core-simd-lstm.wasm.js'),
    langPath: U('tesseract'), // dir holding chi_sim.traineddata
    workerBlobURL: false, // load the worker from its extension URL (MV3-CSP safe)
    gzip: false, // the bundled model is uncompressed
    cacheMethod: 'none', // it's already local; no IndexedDB copy needed
    logger: (m) => { if (onStatus && m && m.status) onStatus(m) },
  }).then(async (w) => {
    // PSM.AUTO: let Tesseract find the page's blocks/lines itself
    await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    return w
  }).catch((e) => { workerPromise = null; throw e })
  return workerPromise
}

export async function terminateOcrWorker() {
  if (!workerPromise) return
  try { (await workerPromise).terminate() } catch (e) {}
  workerPromise = null
}

// Recognize `canvas` and fill `textLayerDiv` with transparent word spans aligned to
// the image. `outputScale` is the canvas device-pixel ratio (canvas pixels =
// CSS px × outputScale), so we divide bboxes by it to land in the layer's CSS px.
// Returns the number of word spans created.
export async function ocrCanvasToLayer(canvas, textLayerDiv, outputScale, onStatus) {
  const worker = await ensureOcrWorker(onStatus)
  if (onStatus) onStatus({ status: 'recognizing text', progress: 0 })
  const { data } = await worker.recognize(canvas, {}, { blocks: true })

  const inv = 1 / (outputScale || 1)
  const frag = document.createDocumentFragment()
  const spans = []
  for (const w of wordsFromData(data)) {
    const box = wordBox(w, inv)
    if (!box) continue
    const span = document.createElement('span')
    // .textLayer span CSS already sets position:absolute; color:transparent;
    // white-space:pre; transform-origin:0 0 — we just place + size it
    span.style.left = box.left.toFixed(2) + 'px'
    span.style.top = box.top.toFixed(2) + 'px'
    span.style.fontSize = box.height.toFixed(2) + 'px'
    span.textContent = box.text
    span.dataset.w = String(box.width) // stash target width for the scaleX pass
    frag.appendChild(span)
    spans.push(span)
  }
  // insert endOfContent stays last; put words before it if present
  const end = textLayerDiv.querySelector('.endOfContent')
  textLayerDiv.insertBefore(frag, end || null)
  // second pass: scale each span horizontally so its glyph run fills the word box
  // (one batched reflow — matches how PDF.js fits text to the original metrics)
  for (const span of spans) {
    const natural = span.offsetWidth
    const target = Number(span.dataset.w)
    if (natural > 0 && target > 0) span.style.transform = `scaleX(${(target / natural).toFixed(4)})`
    delete span.dataset.w
  }
  return spans.length
}
