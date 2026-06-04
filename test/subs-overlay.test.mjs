import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { applyNativeHide, removeNativeHide, HOST_ID, createOverlay } from '../src/content/subs/overlay.js'

/* The overlay's native-caption hide is the reversible part of the feature: while
   the subtitle overlay stands in, the platform's own caption ink is suppressed via
   one injected <style>; turning the feature off must remove it so native captions
   return. applyNativeHide/removeNativeHide touch the live document, so we register
   happy-dom here (contained to this file). */
before(() => GlobalRegistrator.register())
after(() => GlobalRegistrator.unregister())

const HIDE_ID = 'mydict-subs-native-hide'

test('applyNativeHide injects one suppressing <style> for the platform selector', () => {
  document.head.innerHTML = ''
  applyNativeHide(document, '.ytp-caption-window-container')
  const el = document.getElementById(HIDE_ID)
  assert.ok(el, 'a style element is injected')
  assert.equal(el.tagName, 'STYLE')
  assert.match(el.textContent, /\.ytp-caption-window-container/, 'targets the native caption container')
  assert.match(el.textContent, /visibility:hidden/, 'suppresses the native caption ink')
})

test('applyNativeHide is idempotent (one style element, updated in place)', () => {
  document.head.innerHTML = ''
  applyNativeHide(document, '.a')
  applyNativeHide(document, '.b')
  const all = document.querySelectorAll('#' + HIDE_ID)
  assert.equal(all.length, 1, 'never stacks duplicate style elements')
  assert.match(all[0].textContent, /\.b/, 'updated to the latest selector')
})

test('removeNativeHide restores native captions (reversibility)', () => {
  document.head.innerHTML = ''
  applyNativeHide(document, '.ytp-caption-window-container')
  assert.ok(document.getElementById(HIDE_ID), 'hidden while the feature is on')
  removeNativeHide(document)
  assert.equal(document.getElementById(HIDE_ID), null, 'turning the feature off removes the hide')
  // calling remove again is a safe no-op
  removeNativeHide(document)
  assert.equal(document.getElementById(HIDE_ID), null)
})

// The overlay renders into a CLOSED shadow root (host.shadowRoot is null from
// outside), which is exactly the point — the page's lookup can't reach it. happy-dom
// keeps the root reachable through an internal Symbol so these tests can inspect what
// the overlay actually painted without weakening the production closed-root design.
function closedRoot(host) {
  const sym = Object.getOwnPropertySymbols(host).find((s) => s.toString() === 'Symbol(shadowRoot)')
  return host[sym]
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const noop = () => {}

test('clear() invalidates a pending segmentation so a late reply cannot repaint', async () => {
  // a setLine call segments asynchronously; if the overlay is cleared (SPA nav /
  // track change) while that worker reply is in flight, the reply must NOT repaint
  // the now-empty line. The fix bumps the line's generation inside clear().
  let resolveSeg
  const requestSegment = () => new Promise((r) => { resolveSeg = r })
  const ov = createOverlay({ requestSegment, requestHover: async () => null, onPin: noop })
  const l1 = closedRoot(ov.host).querySelector('.line.l1')

  ov.setLine1('你好')          // kicks off segmentation (left pending)
  ov.clear()                    // navigation/clear arrives before the reply
  resolveSeg([{ t: '你好', kind: 'word', py: 'nǐ hǎo' }]) // stale reply lands now
  await tick()

  assert.equal(l1.textContent, '', 'stale segmentation reply is dropped after clear')
})

test('the Chinese line is annotated by language, even when it is the bottom line', async () => {
  // Phase 2 may put Chinese on either line (the user chooses top/bottom). Pinyin +
  // clickable words must follow the Chinese text, not a fixed line index.
  const requestSegment = async (t) =>
    t === '你好' ? [{ t: '你好', kind: 'word', py: 'nǐ hǎo' }] : []
  const ov = createOverlay({ requestSegment, requestHover: async () => null, onPin: noop })
  const root = closedRoot(ov.host)
  const l1 = root.querySelector('.line.l1')
  const l2 = root.querySelector('.line.l2')

  ov.setLine1('Hello')   // non-Chinese on top
  ov.setLine2('你好')     // Chinese on the bottom line
  await tick()

  assert.equal(l1.textContent, 'Hello', 'the non-Chinese top line is shown plainly')
  assert.notEqual(l1.lang, 'zh', 'the non-Chinese line is not marked zh')
  assert.equal(l2.lang, 'zh', 'the bottom Chinese line is marked zh')
  assert.ok(l2.querySelectorAll('.w').length >= 1, 'the bottom Chinese line has clickable word spans')
  assert.ok(l2.querySelector('.zr'), 'the bottom Chinese line carries ruby (pinyin columns)')
})

test('setControls: ASR / auto-translation tracks are offered only when opted in', () => {
  const ov = createOverlay({ requestSegment: async () => [], requestHover: async () => null, onPin: noop })
  const root = closedRoot(ov.host)
  const tracks = [
    { lang: 'zh-Hans', name: 'Chinese', kind: '' },
    { lang: 'en', name: 'English', kind: 'asr' }, // YouTube auto-speech-recognition
  ]
  const targets = [{ lang: 'ja', name: 'Japanese' }] // a machine auto-translation target
  const optValues = () =>
    [...root.querySelectorAll('select')].flatMap((s) => [...s.options].map((o) => o.value))

  // both opt-ins off: only the human track is selectable
  ov.setControls({ tracks, targets, lang1: 'zh-Hans', lang2: '', allowAsr: false, allowAutoTranslation: false, onChange: noop })
  let vals = optValues()
  assert.ok(vals.includes('zh-Hans'), 'the human track is always offered')
  assert.ok(!vals.includes('en'), 'the ASR track is hidden when allowAsr is off')
  assert.ok(!vals.includes('ja'), 'the auto-translation target is hidden when allowAutoTranslation is off')

  // opt in to both: the machine tracks now appear
  ov.setControls({ tracks, targets, lang1: 'zh-Hans', lang2: '', allowAsr: true, allowAutoTranslation: true, onChange: noop })
  vals = optValues()
  assert.ok(vals.includes('en'), 'the ASR track is offered once allowAsr is on')
  assert.ok(vals.includes('ja'), 'the auto-translation target is offered once allowAutoTranslation is on')
})

test('overlay host id is the stable, documented hook', () => {
  // content.js relies on the overlay living in a CLOSED shadow root (so it is NOT
  // in composedPath and the page lookup can't double-handle it); the host id is the
  // public handle the engine mounts into the player.
  assert.equal(HOST_ID, 'mydict-subs-host')
})
