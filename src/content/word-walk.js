/* word-walk.js — the hover word-collection walk, split out of content.js so it can
   be unit-tested against a DOM (happy-dom) rather than only in a real browser. It
   uses the live `document` + `NodeFilter` like the content script does; tests
   register happy-dom globals so the same code runs unchanged. */

import { isHanChar } from './content-core.js'

export const MAX_WORD = 12 // longest forward run we ask the panel to match

// collect up to MAX_WORD consecutive Chinese chars from (startNode,startIndex),
// walking forward across text nodes. Returns { text, positions } where
// positions[i] = { node, offset, size } locates the i-th character (size = its
// UTF-16 length, 1 or 2, so a multi-node / astral range highlights correctly).
// Iterates by code point and stops at the first non-Chinese character.
export function collectForward(startNode, startIndex) {
  const positions = []
  let text = ''
  // root the walk at the start node's tree (document OR a shadow root) so a word
  // inside a web component is collected across its shadow-internal text nodes
  const root = (startNode.getRootNode && startNode.getRootNode()) || document.body || document.documentElement
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  walker.currentNode = startNode
  let node = startNode
  let offset = startIndex
  while (node && positions.length < MAX_WORD) {
    const data = node.data || ''
    while (offset < data.length && positions.length < MAX_WORD) {
      const cp = data.codePointAt(offset)
      const ch = String.fromCodePoint(cp)
      if (!isHanChar(ch)) return { text, positions } // word boundary
      const size = cp > 0xffff ? 2 : 1
      positions.push({ node, offset, size })
      text += ch
      offset += size
    }
    node = walker.nextNode()
    offset = 0
  }
  return { text, positions }
}

// reconstruct the word text from the first `len` collected positions — reads the
// underlying text nodes back (a word can span several), so it stays correct when
// collectForward crossed inline-element boundaries.
export function textOf(positions, len) {
  let t = ''
  for (let i = 0; i < Math.min(len, positions.length); i++) {
    const p = positions[i]
    t += (p.node.data || '').substr(p.offset, p.size || 1)
  }
  return t
}
