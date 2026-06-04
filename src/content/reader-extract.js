/* reader-extract.js — pure article-extraction helpers for Reader mode, split out
   of content.js so they can be unit-tested with a DOM (happy-dom) instead of only
   in a real browser. No module-level DOM access and no globals: the document /
   DOMParser is passed in, so the same functions run in the content script and in
   tests. content.js wires them to the live `document` and `new DOMParser()`. */

const HAN_TEXT = /\p{Script=Han}/u
const MAX_PARAS = 400 // cap paragraphs handed to the reader (bounds segmentation cost)

// collect block-level paragraphs that actually contain Han text from a parsed
// document / element root, normalizing whitespace and skipping empty/non-CJK crumbs
export function blockParas(root, selector = 'p, li, h2, h3, h4, h5, h6, pre') {
  if (!root || !root.querySelectorAll) return []
  const out = []
  root.querySelectorAll(selector).forEach((el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (t && HAN_TEXT.test(t)) out.push(t)
  })
  return out.slice(0, MAX_PARAS)
}

// split Readability's cleaned article HTML into paragraph strings (leaf block
// elements with Han). `parser` is a DOMParser instance (injected for testability).
export function htmlToParas(html, parser) {
  if (!html || !parser) return []
  let doc
  try { doc = parser.parseFromString(html, 'text/html') } catch (e) { return [] }
  return blockParas(doc)
}

// fallback when Readability can't parse: every <p> on the live page that has Han
export function fallbackParas(doc) {
  return blockParas(doc, 'p')
}
