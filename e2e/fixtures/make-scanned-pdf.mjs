/* make-scanned-pdf.mjs — generate e2e/fixtures/zh-scanned.pdf: an IMAGE-ONLY
   (scanned-style) PDF — one page that is a single JPEG of Chinese text, with NO
   text layer. It mirrors a photographed workbook page, so the OCR e2e can prove the
   viewer recognizes the image and builds a selectable/hoverable text layer.

   The text is rasterized by rendering HTML in headless Chromium and screenshotting
   it to a JPEG, which is embedded directly in a minimal PDF as a /DCTDecode image
   XObject. Run: `node e2e/fixtures/make-scanned-pdf.mjs` (output is committed). */
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const W = 600, H = 200

const html = `<!doctype html><meta charset="utf-8">
<div style="width:${W}px;height:${H}px;background:#fff;display:flex;align-items:center;
  justify-content:center;font-family:'PingFang SC','Heiti SC','Noto Sans CJK SC',sans-serif;
  font-size:64px;color:#000;letter-spacing:14px">好吃 杯子 衣服</div>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
await page.setContent(html)
const jpeg = await page.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: W, height: H } })
await browser.close()

// minimal single-page PDF embedding the JPEG as a DCTDecode image that fills the page
const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  // object 5 (the image) is emitted specially so the raw JPEG bytes splice in
]

// serialize to a flat Buffer, tracking the running byte offset of each object
const parts = []
let pos = 0
const emit = (x) => { const b = Buffer.isBuffer(x) ? x : Buffer.from(x, 'binary'); parts.push(b); pos += b.length }

emit('%PDF-1.7\n%\xff\xff\xff\xff\n')
const offsets = []
const total = objs.length + 1 // + the image object
for (let i = 0; i < objs.length; i++) {
  offsets[i] = pos
  emit(`${i + 1} 0 obj\n${objs[i]}\nendobj\n`)
}
// object 5: the image XObject, JPEG bytes verbatim under /DCTDecode
offsets[4] = pos
emit('5 0 obj\n')
emit(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB `
  + `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
emit(jpeg)
emit('\nendstream\nendobj\n')

const xrefStart = pos
let tail = `xref\n0 ${total}\n0000000000 65535 f \n`
for (const off of offsets) tail += `${String(off).padStart(10, '0')} 00000 n \n`
tail += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
emit(tail)

const out = resolve(__dirname, 'zh-scanned.pdf')
writeFileSync(out, Buffer.concat(parts))
console.log('wrote', out, `(${Buffer.concat(parts).length} bytes, image ${W}x${H})`)
