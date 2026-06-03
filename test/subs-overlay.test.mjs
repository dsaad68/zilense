import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { applyNativeHide, removeNativeHide, HOST_ID } from '../src/content/subs/overlay.js'

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

test('overlay host id is the stable, documented hook', () => {
  // content.js relies on the overlay living in a CLOSED shadow root (so it is NOT
  // in composedPath and the page lookup can't double-handle it); the host id is the
  // public handle the engine mounts into the player.
  assert.equal(HOST_ID, 'mydict-subs-host')
})
