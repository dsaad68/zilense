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
