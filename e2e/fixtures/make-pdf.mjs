/* make-pdf.mjs — generate e2e/fixtures/zh-sample.pdf: a tiny PDF whose text layer
   yields real Chinese so the PDF-viewer e2e can hover/segment words. It uses a
   Type0 / Identity-H font with a ToUnicode CMap but NO embedded font program —
   PDF.js extracts the text from ToUnicode (independent of glyph rendering), which
   is all the hover path needs. Run: `node e2e/fixtures/make-pdf.mjs`. The output is
   committed so `npm run test:e2e` needs no generation step. */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// CID -> Unicode for the characters we show: 学习中文 (= "study" 学习 + "Chinese" 中文,
// both CC-CEDICT words, so segmentLongest yields two 2-char words)
const CHARS = [
  { cid: 1, u: 0x5b66 }, // 学
  { cid: 2, u: 0x4e60 }, // 习
  { cid: 3, u: 0x4e2d }, // 中
  { cid: 4, u: 0x6587 }, // 文
]
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0')
const showHex = CHARS.map((c) => hex4(c.cid)).join('')
const bfchars = CHARS.map((c) => `<${hex4(c.cid)}> <${hex4(c.u)}>`).join('\n')

const toUnicode =
  `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${CHARS.length} beginbfchar
${bfchars}
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`

const content = `BT /F0 28 Tf 72 740 Td <${showHex}> Tj ET`

// assemble objects, tracking byte offsets for the xref table
const objects = []
const add = (body) => { objects.push(body); return objects.length } // returns obj number

// object numbers follow add() order: catalog=1, pages=2, page=3, type0 font=4,
// content=5, cid font=6, tounicode=7, descriptor=8 — references below must match.
add('<< /Type /Catalog /Pages 2 0 R >>')                                  // 1
add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')                          // 2
add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '               // 3
  + '/Resources << /Font << /F0 4 0 R >> >> /Contents 5 0 R >>')
add('<< /Type /Font /Subtype /Type0 /BaseFont /STSong /Encoding /Identity-H ' // 4
  + '/DescendantFonts [6 0 R] /ToUnicode 7 0 R >>')
add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)     // 5
add('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /STSong '            // 6
  + '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> '
  + '/FontDescriptor 8 0 R /CIDToGIDMap /Identity /DW 1000 >>')
add(`<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`) // 7
add('<< /Type /FontDescriptor /FontName /STSong /Flags 4 '                // 8
  + '/FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 '
  + '/CapHeight 700 /StemV 80 >>')

// serialize with a cross-reference table
let pdf = '%PDF-1.7\n%\xff\xff\xff\xff\n'
const offsets = []
objects.forEach((body, i) => {
  offsets[i] = Buffer.byteLength(pdf, 'binary')
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
})
const xrefStart = Buffer.byteLength(pdf, 'binary')
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

const out = resolve(__dirname, 'zh-sample.pdf')
writeFileSync(out, Buffer.from(pdf, 'binary'))
console.log('wrote', out, `(${Buffer.byteLength(pdf, 'binary')} bytes)`)
