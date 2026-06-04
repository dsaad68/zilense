import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

/* hover-driver wires the cursor → highlight/popup machinery shared by the content
   script and the PDF viewer. It uses the live DOM, the caret API, the CSS Custom
   Highlight API, and chrome.runtime messaging — none of which happy-dom provides —
   so we polyfill the few primitives it touches and stub a canned 'hover' reply,
   then drive a real mousemove and assert it paints the token + inline popup. This
   is the regression guard for the extraction out of content.js. */

let initHoverDriver

before(async () => {
  GlobalRegistrator.register()
  // CSS Custom Highlight API: a Map for highlights + a no-op Highlight class. happy-dom
  // exposes CSS via a getter that returns a fresh namespace each read (dropping any
  // property we add), so replace the whole global with a stable stub object.
  Object.defineProperty(globalThis, 'CSS', { value: { highlights: new Map() }, configurable: true, writable: true })
  globalThis.Highlight = class { constructor(...r) { this.ranges = r } add() {} }
  // rAF synchronous so the mousemove handler resolves within the test tick
  globalThis.requestAnimationFrame = (cb) => { cb(); return 0 }
  ;({ initHoverDriver } = await import('../src/content/hover-driver.js'))
})
after(() => GlobalRegistrator.unregister())

beforeEach(() => {
  globalThis.CSS.highlights.clear()
  document.body.innerHTML = ''
  // a known caret target is set per-test by pointing caretPositionFromPoint at it
  delete document.caretPositionFromPoint
  // default to "no active selection" so click tests pin (a selection test overrides)
  window.getSelection = () => ({ isCollapsed: true, toString: () => '' })
})

// canned service-worker reply: 你好 is a 2-char word
function stubChrome() {
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) {
        if (msg && msg.type === 'hover' && cb) {
          cb({ word: '你好', len: 2, pinyin: 'nǐ hǎo', defs: ['hello'], hskSenses: [] })
        } else if (cb) { cb({}) }
      },
    },
    // no chrome.storage → the driver's optional-chained bootstrap is skipped
  }
}

function moveOver(node) {
  // make the caret API resolve to the start of `node` regardless of x/y
  document.caretPositionFromPoint = () => ({ offsetNode: node, offset: 0 })
  document.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 5, clientY: 5, bubbles: true }))
}

test('hover: paints the token highlight for the longest word under the cursor', () => {
  stubChrome()
  const driver = initHoverDriver()
  document.body.innerHTML = '<p id="t">你好世界</p>'
  moveOver(document.getElementById('t').firstChild)
  assert.ok(globalThis.CSS.highlights.has('mydict-tok'), 'a mydict-tok highlight is set on hover')
  driver.destroy()
})

test('hover: builds the inline popup with the word, pinyin and gloss', () => {
  stubChrome()
  const driver = initHoverDriver()
  document.body.innerHTML = '<p id="t">你好世界</p>'
  moveOver(document.getElementById('t').firstChild)
  const host = document.getElementById('mydict-popup-host')
  assert.ok(host, 'popup host is created')
  assert.equal(host.style.display, 'block', 'popup is shown')
  const text = host.shadowRoot.textContent
  assert.ok(text.includes('你好'), 'popup shows the word')
  assert.ok(text.includes('nǐ hǎo'), 'popup shows the pinyin')
  assert.ok(text.includes('hello'), 'popup shows the gloss')
  driver.destroy()
})

test('hover: respects the allowDisable predicate (no highlight when disabled)', () => {
  stubChrome()
  const driver = initHoverDriver({ allowDisable: () => true })
  document.body.innerHTML = '<p id="t">你好世界</p>'
  moveOver(document.getElementById('t').firstChild)
  assert.ok(!globalThis.CSS.highlights.has('mydict-tok'), 'disabled site paints nothing')
  driver.destroy()
})

// a chrome stub that records every message sent (for the click/pin assertions)
function recordingChrome() {
  const sent = []
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) {
        sent.push(msg)
        if (cb) cb(msg && msg.type === 'hover' ? { word: '你好', len: 2, pinyin: 'nǐ hǎo', defs: ['hello'], hskSenses: [] } : {})
      },
    },
  }
  return sent
}
function clickAt(node) {
  document.caretPositionFromPoint = () => ({ offsetNode: node, offset: 0 })
  document.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 5, clientY: 5, bubbles: true }))
  document.dispatchEvent(new window.MouseEvent('mouseup', { clientX: 5, clientY: 5, bubbles: true }))
}

test('enabled: clicking a word pins it and opens the panel', () => {
  const sent = recordingChrome()
  const driver = initHoverDriver()
  document.body.innerHTML = '<p id="t">你好世界</p>'
  clickAt(document.getElementById('t').firstChild)
  const open = sent.find((m) => m && m.type === 'open-panel')
  assert.ok(open && open.q === '你好', 'a plain click pins the word and asks to open the panel')
  driver.destroy()
})

test('disabled: clicking a word does NOT pin or open the panel (the bug)', () => {
  const sent = recordingChrome()
  const driver = initHoverDriver({ allowDisable: () => true })
  document.body.innerHTML = '<p id="t">你好世界</p>'
  clickAt(document.getElementById('t').firstChild)
  assert.ok(!sent.some((m) => m && m.type === 'open-panel'), 'no open-panel message when disabled')
  assert.ok(!globalThis.CSS.highlights.has('mydict-pin'), 'no pin highlight when disabled')
  driver.destroy()
})

function altClickAt(node) {
  document.caretPositionFromPoint = () => ({ offsetNode: node, offset: 0 })
  document.dispatchEvent(new window.MouseEvent('click', { altKey: true, button: 0, clientX: 5, clientY: 5, bubbles: true }))
}
function selectText(text) {
  window.getSelection = () => ({ isCollapsed: false, toString: () => text })
}

test('enabled: Alt-click pins the word', () => {
  const sent = recordingChrome()
  const driver = initHoverDriver()
  document.body.innerHTML = '<p id="t">你好世界</p>'
  altClickAt(document.getElementById('t').firstChild)
  const open = sent.find((m) => m && m.type === 'open-panel')
  assert.ok(open && open.q === '你好', 'Alt-click pins the word')
  driver.destroy()
})

test('disabled: Alt-click does NOT pin', () => {
  const sent = recordingChrome()
  const driver = initHoverDriver({ allowDisable: () => true })
  document.body.innerHTML = '<p id="t">你好世界</p>'
  altClickAt(document.getElementById('t').firstChild)
  assert.ok(!sent.some((m) => m && m.type === 'open-panel'), 'Alt-click inert when disabled')
  driver.destroy()
})

test('enabled: the pin hotkey pins the hovered word', () => {
  const sent = recordingChrome()
  const driver = initHoverDriver()
  document.body.innerHTML = '<p id="t">你好世界</p>'
  moveOver(document.getElementById('t').firstChild) // sets the hovered word
  sent.length = 0 // drop the hover messages; we only care about the keydown
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'p', bubbles: true }))
  const open = sent.find((m) => m && m.type === 'open-panel')
  assert.ok(open && open.q === '你好', 'pressing the pin key pins the hovered word')
  driver.destroy()
})

test('disabled: the pin hotkey does NOT pin (even with a previously hovered word)', () => {
  let off = false
  const sent = recordingChrome()
  const driver = initHoverDriver({ allowDisable: () => off })
  document.body.innerHTML = '<p id="t">你好世界</p>'
  moveOver(document.getElementById('t').firstChild) // hover while enabled to set the word
  off = true
  sent.length = 0
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'p', bubbles: true }))
  assert.ok(!sent.some((m) => m && m.type === 'open-panel'), 'hotkey inert once disabled')
  driver.destroy()
})

test('enabled: selecting text looks it up', () => {
  const sent = recordingChrome()
  const driver = initHoverDriver()
  document.body.innerHTML = '<p id="t">你好世界</p>'
  selectText('你好')
  document.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 5, clientY: 5, bubbles: true }))
  document.dispatchEvent(new window.MouseEvent('mouseup', { clientX: 5, clientY: 5, bubbles: true }))
  const lk = sent.find((m) => m && m.type === 'lookup')
  assert.ok(lk && lk.q === '你好', 'the selection is looked up')
  driver.destroy()
})

test('disabled: selecting text does NOT look up', () => {
  const sent = recordingChrome()
  const driver = initHoverDriver({ allowDisable: () => true })
  document.body.innerHTML = '<p id="t">你好世界</p>'
  selectText('你好')
  document.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 5, clientY: 5, bubbles: true }))
  document.dispatchEvent(new window.MouseEvent('mouseup', { clientX: 5, clientY: 5, bubbles: true }))
  assert.ok(!sent.some((m) => m && m.type === 'lookup'), 'no selection lookup when disabled')
  driver.destroy()
})

test('unpin() is exposed and clears the pin overlay', () => {
  recordingChrome()
  const driver = initHoverDriver()
  document.body.innerHTML = '<p id="t">你好世界</p>'
  clickAt(document.getElementById('t').firstChild) // pin it
  assert.ok(globalThis.CSS.highlights.has('mydict-pin'), 'a pin highlight is set')
  driver.unpin()
  assert.ok(!globalThis.CSS.highlights.has('mydict-pin'), 'unpin() clears the pin highlight')
  driver.destroy()
})

test('hover: suppressHighlight skips the token overlay but keeps the popup', () => {
  stubChrome()
  // suppress overlays (as the PDF viewer does for OCR layers)
  const driver = initHoverDriver({ suppressHighlight: () => true })
  document.body.innerHTML = '<p id="t">你好世界</p>'
  moveOver(document.getElementById('t').firstChild)
  assert.ok(!globalThis.CSS.highlights.has('mydict-tok'), 'no highlight overlay when suppressed')
  const host = document.getElementById('mydict-popup-host')
  assert.ok(host && host.style.display === 'block', 'popup still shows when highlight is suppressed')
  assert.ok(host.shadowRoot.textContent.includes('你好'), 'popup still has the word')
  driver.destroy()
})

test('destroy: removes listeners so a later mousemove is inert', () => {
  stubChrome()
  const driver = initHoverDriver()
  driver.destroy()
  document.body.innerHTML = '<p id="t">你好世界</p>'
  moveOver(document.getElementById('t').firstChild)
  assert.ok(!globalThis.CSS.highlights.has('mydict-tok'), 'no highlight after destroy()')
})
