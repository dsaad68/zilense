import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  name: 'Zilense - Chinese Dictionary',
  version: pkg.version,
  description: pkg.description,
  author: { email: 'me@verybad.engineer' },
  homepage_url: 'https://zilense.com',
  // Side Panel API needs Chrome 114+, and opening the panel from a content-script
  // user gesture (pin-to-open) is reliable from Chrome 116+.
  minimum_chrome_version: '116',
  // The side panel IS the extension UI.
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  action: {
    default_title: 'Zilense',
    // Clicking the icon opens a small menu (open panel / hover popup / disable on
    // this site) instead of opening the panel directly; the menu's button opens
    // the side panel from its own user gesture.
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
    512: 'icons/icon-512.png',
  },
  // Keyboard shortcuts (chrome://extensions/shortcuts lets users rebind them).
  // Both are handled in the service worker's chrome.commands.onCommand listener;
  // a command invocation is a user gesture, which sidePanel.open() requires. If a
  // suggested key collides with an existing Chrome/extension binding, Chrome just
  // leaves it unassigned and the user can set their own — the command still exists.
  commands: {
    'open-window': {
      suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
      description: 'Open Zilense in a window',
    },
    'open-side-panel': {
      suggested_key: { default: 'Ctrl+Shift+E', mac: 'Command+Shift+E' },
      description: 'Open the Zilense side panel',
    },
  },
  background: {
    service_worker: 'src/background/service-worker.js',
    type: 'module',
  },
  // The bundled PDF viewer runs Tesseract.js (offline OCR for scanned PDFs), whose
  // WebAssembly core needs 'wasm-unsafe-eval' to compile. Scoped to extension pages
  // only; everything stays 'self' (no remote code) — the OCR worker, core wasm, and
  // chi_sim model are all bundled under /tesseract.
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/content.js'],
      css: ['src/content/content.css'],
      run_at: 'document_idle',
      // run in iframes too, so hover/selection lookup works inside embedded
      // frames. The script is light (caret detection + messaging; the dictionary
      // lives in the panel), so the per-frame cost is small.
      all_frames: true,
    },
    {
      // MAIN-world hook for the dual-subtitle feature (Phase 2). It runs in
      // YouTube's own page context so it can read the player's caption-track list
      // and notice the player's timedtext requests; the content script (isolated
      // world) can't. It talks back over CustomEvents only and makes no requests of
      // its own — the engine fetches tracks same-origin on youtube.com, so this adds
      // NO host permission. A content_scripts `matches` entry is declarative
      // injection, not a host grant (the entry above already matches <all_urls>).
      matches: [
        'https://www.youtube.com/*',
        'https://m.youtube.com/*',
        'https://www.youtube-nocookie.com/*',
      ],
      js: ['src/content/subs/yt-hook.js'],
      run_at: 'document_start',
      all_frames: true,
      world: 'MAIN',
    },
  ],
  // activeTab lets the action popup read the active tab's URL (hostname for
  // "disable on this site") and id (to open the side panel) when the user clicks
  // the icon — no broad host permission needed.
  permissions: ['sidePanel', 'storage', 'contextMenus', 'activeTab'],
  // Content scripts (hover lookup) inject everywhere via content_scripts.matches,
  // which needs NO host permission. host_permissions is only for the panel's
  // cross-origin fetches: example sentences (Tatoeba) and stroke data (jsDelivr).
  host_permissions: ['https://tatoeba.org/*', 'https://cdn.jsdelivr.net/*'],
  // The PDF viewer (an extension page) fetches PDF bytes from arbitrary origins.
  // Rather than ship a broad host permission at install, we request *://*/* ON
  // DEMAND (chrome.permissions.request on the user's "Open this PDF"/enable-auto
  // gesture), keeping the default install prompt minimal. file:// PDFs additionally
  // need the user-toggled "Allow access to file URLs" (Chrome can't grant it here).
  optional_host_permissions: ['*://*/*'],
  // Reader mode is an extension page the content script injects as a full-screen
  // iframe over the host page, so the page context must be allowed to load it.
  // (CRXJS also auto-adds the content-script chunk here; this entry is merged in.)
  // use_dynamic_url: the reader page is served at a per-session random URL instead
  // of a stable chrome-extension://<id>/src/reader/index.html. A web page can no
  // longer hardcode/iframe the reader to feed it a crafted article payload, and the
  // extension is harder to fingerprint by its reader URL (analysis report finding 1).
  // chrome.runtime.getURL() in our own content script still resolves the live URL.
  web_accessible_resources: [
    {
      resources: ['src/reader/index.html'],
      matches: ['<all_urls>'],
      use_dynamic_url: true,
    },
    // The PDF viewer is navigated to (from the in-page "Open in Zilense" toast and
    // the right-click menu) via a fixed chrome.runtime.getURL, so it's a STABLE URL
    // (no use_dynamic_url).
    {
      resources: ['src/pdfviewer/index.html'],
      matches: ['<all_urls>'],
    },
  ],
})
