import { test } from 'node:test'
import assert from 'node:assert/strict'
import manifest from '../manifest.config.js'

// manifest.config.js exports the resolved manifest object (CRXJS defineManifest).
const m = typeof manifest === 'function' ? await manifest({ mode: 'production', command: 'build' }) : manifest

test('manifest: MV3 with the Side Panel API floor declared', () => {
  assert.equal(m.manifest_version, 3)
  assert.equal(m.minimum_chrome_version, '116')
  assert.ok(m.side_panel && m.side_panel.default_path, 'side_panel.default_path is set')
})

test('manifest: permissions are the minimal set', () => {
  for (const p of ['sidePanel', 'storage', 'contextMenus', 'activeTab']) {
    assert.ok(m.permissions.includes(p), `missing permission ${p}`)
  }
})

test('manifest: the toolbar icon opens an action popup', () => {
  assert.ok(m.action && typeof m.action.default_popup === 'string', 'action.default_popup is set')
  assert.ok(m.action.default_popup.includes('popup'), 'default_popup points at the popup page')
})

test('manifest: host_permissions narrowed to the real fetch targets (no <all_urls>)', () => {
  assert.ok(!m.host_permissions.includes('<all_urls>'), 'host_permissions must not be <all_urls>')
  assert.ok(m.host_permissions.some((h) => h.includes('tatoeba.org')), 'Tatoeba host expected')
  assert.ok(m.host_permissions.some((h) => h.includes('jsdelivr.net')), 'jsDelivr host expected')
})

test('manifest: content scripts still inject broadly for hover lookup', () => {
  const cs = m.content_scripts && m.content_scripts[0]
  assert.ok(cs && cs.matches.includes('<all_urls>'), 'content_scripts must match <all_urls>')
  assert.ok(cs.js.some((p) => p.includes('content')), 'content script js listed')
})

test('manifest: content script runs in all frames (iframe lookup)', () => {
  const cs = m.content_scripts && m.content_scripts[0]
  assert.equal(cs.all_frames, true, 'all_frames must be true so iframes are covered')
})

test('manifest: dual-subtitles MAIN-world hook is a SEPARATE, youtube-scoped entry', () => {
  // the subtitle feature's Phase 2 track discovery runs in YouTube's page context
  // (MAIN world). It must be an ADDED content script (not the broad one at [0]) so
  // the all-urls lookup script is unaffected, scoped to youtube, and never <all_urls>.
  const hook = (m.content_scripts || []).find(
    (cs) => cs.world === 'MAIN' && (cs.js || []).some((p) => p.includes('yt-hook')))
  assert.ok(hook, 'a MAIN-world yt-hook content script is registered')
  assert.ok(!hook.matches.includes('<all_urls>'), 'the hook must NOT match <all_urls>')
  assert.ok(hook.matches.every((h) => /youtube(-nocookie)?\.com/.test(h)), 'hook scoped to youtube only')
  assert.notEqual(m.content_scripts[0], hook, 'the broad lookup script stays first')
})

test('manifest: dual subtitles add NO host permission (same-origin fetch only)', () => {
  // Phase 2 fetches timedtext same-origin on youtube.com from the content script, so
  // host_permissions must be UNCHANGED — exactly the panel's two fetch targets.
  assert.deepEqual(
    [...m.host_permissions].sort(),
    ['https://cdn.jsdelivr.net/*', 'https://tatoeba.org/*'],
    'no youtube (or any new) host permission was added',
  )
})

test('manifest: reader page is web-accessible (the content script injects it as an iframe)', () => {
  const war = m.web_accessible_resources || []
  const resources = war.flatMap((w) => w.resources || [])
  assert.ok(resources.some((r) => r.includes('reader')), 'reader page must be in web_accessible_resources')
  // it must be reachable from the pages the content script runs on
  const readerEntry = war.find((w) => (w.resources || []).some((r) => r.includes('reader')))
  assert.ok(readerEntry.matches.includes('<all_urls>'), 'reader page must be web-accessible on <all_urls>')
  // served at a per-session dynamic URL so a web page can't hardcode/iframe the
  // reader to feed it a crafted payload, and so it can't be fingerprinted
  assert.equal(readerEntry.use_dynamic_url, true, 'reader page must use a dynamic URL')
})
