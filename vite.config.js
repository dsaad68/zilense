import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // CRXJS needs a stable HMR port for the side panel during dev.
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
  build: {
    // match the manifest's minimum_chrome_version
    target: 'chrome116',
    // Disable Vite's module-preload helper. In a content script the lazy
    // `import('./engine.js')` otherwise goes through __vitePreload, which resolves
    // the dep chunk paths against the PAGE origin (e.g. https://www.youtube.com/
    // assets/engine-*.js) — those 404, the preload promise rejects, and the whole
    // dynamic import fails, so the subtitle engine never loads on the page. With
    // preload off the import is a plain import() resolved via import.meta.url (the
    // chrome-extension:// origin), which loads correctly. Extension pages load from
    // the extension origin either way, so they're unaffected.
    modulePreload: false,
    rollupOptions: {
      // Reader mode is reached only via web_accessible_resources (the content
      // script injects it as an iframe), not from the manifest's page slots that
      // CRXJS auto-discovers — so register its HTML as an explicit build input,
      // or its <script>/<link> source paths ship un-bundled. CRXJS merges this
      // with its own manifest-derived inputs.
      // The flashcards page is opened as a top-level tab from the toolbar popup
      // (chrome.tabs.create + runtime.getURL), so it isn't in a manifest page slot
      // either — register it the same way so it gets bundled.
      input: {
        reader: resolve(__dirname, 'src/reader/index.html'),
        flashcards: resolve(__dirname, 'src/flashcards/index.html'),
        // The PDF viewer is reached via web_accessible_resources (manual "Open this
        // PDF in Zilense" navigation, and the opt-in auto-redirect rule), not a
        // manifest page slot CRXJS auto-discovers — so register it as an explicit
        // build input or its <script>/<link> ship un-bundled (incl. the pdf.js worker).
        pdfviewer: resolve(__dirname, 'src/pdfviewer/index.html'),
      },
    },
  },
})
