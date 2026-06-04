import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wordsFromData, wordBox } from '../src/pdfviewer/ocr-core.js'

/* Pure OCR helpers used to turn Tesseract output into the transparent overlay text
   layer for scanned PDFs. Engine/DOM-free, so testable in plain Node. */

const sample = {
  blocks: [{
    paragraphs: [{
      lines: [{
        words: [
          { text: '好吃', bbox: { x0: 100, y0: 200, x1: 200, y1: 240 } },
          { text: '', bbox: { x0: 0, y0: 0, x1: 0, y1: 0 } }, // empty → dropped
          { text: '杯子', bbox: { x0: 220, y0: 200, x1: 320, y1: 240 } },
        ],
      }],
    }],
  }],
}

test('wordsFromData: flattens block→paragraph→line→word', () => {
  const words = wordsFromData(sample)
  assert.equal(words.length, 3)
  assert.deepEqual(words.map((w) => w.text), ['好吃', '', '杯子'])
})

test('wordsFromData: tolerates missing levels / bad input', () => {
  assert.deepEqual(wordsFromData(null), [])
  assert.deepEqual(wordsFromData({}), [])
  assert.deepEqual(wordsFromData({ blocks: [{}] }), [])
  assert.deepEqual(wordsFromData({ blocks: [{ paragraphs: [{ lines: [{}] }] }] }), [])
})

test('wordBox: converts an image-px bbox to CSS-px at devicePixelRatio 1', () => {
  const b = wordBox({ text: '好吃', bbox: { x0: 100, y0: 200, x1: 200, y1: 240 } }, 1)
  assert.deepEqual(b, { left: 100, top: 200, width: 100, height: 40, text: '好吃' })
})

test('wordBox: divides by devicePixelRatio (inv = 1/2 for retina canvas)', () => {
  const b = wordBox({ text: '杯', bbox: { x0: 100, y0: 200, x1: 200, y1: 240 } }, 0.5)
  assert.deepEqual(b, { left: 50, top: 100, width: 50, height: 20, text: '杯' })
})

test('wordBox: trims text and rejects empty / degenerate boxes', () => {
  assert.equal(wordBox({ text: '  ', bbox: { x0: 0, y0: 0, x1: 9, y1: 9 } }, 1), null)
  assert.equal(wordBox({ text: 'x', bbox: { x0: 5, y0: 5, x1: 5, y1: 9 } }, 1), null) // zero width
  assert.equal(wordBox({ text: ' 好 ', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }, 1).text, '好')
  assert.equal(wordBox(null, 1), null)
})
