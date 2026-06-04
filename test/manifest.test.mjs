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

test('manifest: PDFs use on-demand host access only — no navigation interception', () => {
  // PDFs are opened manually (in-page toast / right-click), so we do NOT redirect
  // navigations — no declarativeNetRequest of any kind
  assert.ok(!m.permissions.includes('declarativeNetRequest'),
    'must not request declarativeNetRequest')
  assert.ok(!m.permissions.includes('declarativeNetRequestWithHostAccess'),
    'must not request declarativeNetRequestWithHostAccess (no auto-redirect)')
  // the viewer's cross-origin PDF fetch uses host access requested on a user gesture,
  // declared OPTIONAL so the default install prompt stays minimal
  assert.ok((m.optional_host_permissions || []).includes('*://*/*'),
    'broad host access must be optional, not granted at install')
  assert.ok(!m.host_permissions.includes('*://*/*'),
    'broad host access must not be in host_permissions (install-time)')
})

test('manifest: extension-pages CSP allows bundled WASM but no remote code', () => {
  const csp = m.content_security_policy && m.content_security_policy.extension_pages
  assert.ok(csp, 'extension_pages CSP must be set (Tesseract OCR WASM needs it)')
  assert.match(csp, /'wasm-unsafe-eval'/, "CSP must allow 'wasm-unsafe-eval' for the OCR WebAssembly")
  assert.match(csp, /script-src 'self'/, "script-src must stay 'self' (no remote code)")
  assert.ok(!/https?:\/\//.test(csp), 'CSP must not allow any remote script origin')
})

test('manifest: PDF viewer page is web-accessible at a STABLE url', () => {
  const war = m.web_accessible_resources || []
  const entry = war.find((w) => (w.resources || []).some((r) => r.includes('pdfviewer')))
  assert.ok(entry, 'pdfviewer page must be in web_accessible_resources')
  assert.ok(entry.matches.includes('<all_urls>'), 'pdfviewer must be reachable from any page')
  // the DNR redirect target + chrome.runtime.getURL navigation need a fixed URL, so
  // (unlike the reader) it must NOT use a per-session dynamic URL
  assert.notEqual(entry.use_dynamic_url, true, 'pdfviewer page must use a stable URL')
})

test('manifest: the toolbar icon opens an action popup', () => {
  assert.ok(m.action && typeof m.action.default_popup === 'string', 'action.default_popup is set')
  assert.ok(m.action.default_popup.includes('popup'), 'default_popup points at the popup page')
})

test('manifest: keyboard shortcuts for opening the window and the side panel', () => {
  assert.ok(m.commands, 'commands block is set')
  for (const c of ['open-window', 'open-side-panel']) {
    assert.ok(m.commands[c], `missing command ${c}`)
    assert.ok(m.commands[c].suggested_key, `command ${c} needs a suggested key`)
    assert.ok(typeof m.commands[c].description === 'string', `command ${c} needs a description`)
  }
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
