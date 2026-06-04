/* ocr-core.js — the pure (DOM-free, engine-free) parts of OCR text-layer building,
   split out so they can be unit-tested without loading Tesseract or a browser:
     • flatten Tesseract's block→paragraph→line→word tree to a flat word list,
     • convert a word's image-pixel bbox to the CSS-pixel box of its overlay span.
   ocr.js applies these to the DOM. */

// flatten Tesseract v7's recognize({ blocks:true }) result to a flat word list.
// Tolerant of missing levels so a partial/odd result never throws.
export function wordsFromData(data) {
  const out = []
  const blocks = (data && data.blocks) || []
  for (const b of blocks) {
    for (const p of (b && b.paragraphs) || []) {
      for (const l of (p && p.lines) || []) {
        for (const w of (l && l.words) || []) {
          if (w && w.bbox && typeof w.text === 'string') out.push(w)
        }
      }
    }
  }
  return out
}

// convert one word to the CSS-px box of its transparent overlay span, or null when
// it has no usable text / a degenerate box. `inv` is 1/outputScale: Tesseract boxes
// are in canvas pixels (= CSS px × devicePixelRatio), so we scale back to CSS px.
export function wordBox(word, inv) {
  if (!word || !word.bbox) return null
  const text = (word.text || '').trim()
  if (!text) return null
  const { x0, y0, x1, y1 } = word.bbox
  const left = x0 * inv, top = y0 * inv
  const width = (x1 - x0) * inv, height = (y1 - y0) * inv
  if (!(width > 0) || !(height > 0)) return null
  return { left, top, width, height, text }
}
