<div align="center">

<img src="public/icons/icon-128.png" alt="Zilense icon" width="120" height="120">

# Zilense — Chinese Dictionary

**Hover or select any Chinese on a page → tone-colored pinyin, meaning, stroke order & a clean reader, right in the Chrome side panel.**

</div>

A Chrome MV3 extension that lives in the **side panel**: hover any Chinese
character on a page (or select a word) and its reading + meaning appear
instantly, with tone-colored pinyin, search, stroke order, and a saved deck.

Recreated from a Claude Design prototype as a real extension with
**Vite + React + CRXJS**, backed by
**CC-CEDICT** (~121k entries) via the [`cc-cedict`](https://github.com/edvardsr/cc-cedict)
package.

## Develop / build

```bash
npm install          # also downloads CC-CEDICT data (cc-cedict postinstall)
npm run fetch:fonts  # vendor Google Fonts -> src/sidepanel/fonts/ (one-off; committed)
npm run build:dict   # parse CC-CEDICT -> src/data/cedict.json  (auto-runs on dev/build)
npm run dev          # CRXJS dev server with hot reload  ->  dist/
npm run build        # production build  ->  dist/
npm test             # unit tests (Node's runner)
npm run test:e2e     # Playwright smoke test (loads dist/ in Chromium; build first)
```

## Load in Chrome

1. `npm run build` (or `npm run dev`).
2. Go to `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the `dist/` folder.
4. Click the **Zilense** toolbar icon → a small menu opens with **Open side
   panel**, a **Hover popup** toggle, and **Disable on this site**.

## Use

- **Hover** a Chinese character on any page → it highlights and loads in the panel.
  Works on **simplified and traditional** pages (中國 resolves to 中国).
- **Select** a word (or right-click → *Look up “…” in Zilense*) → whole-word
  reading + character breakdown. Surrounding punctuation is trimmed, and a phrase
  that isn’t one entry is segmented into its words.
- **Search** by hanzi, pinyin (tone marks optional, e.g. `nihao`), or English —
  ranked so common/HSK words beat rare homographs.
- **🔊 Pronounce** plays Mandarin via the browser’s speech synthesis (when a
  zh-CN voice is installed).
- **★ Save** entries to your deck (persists via `chrome.storage`).
- **⚙ Settings**: accent color, Chinese face (sans/serif), pinyin tone colors; plus dark mode.

> Note: Chrome only lets the side panel open from a user gesture, so hovering
> can't auto-open it — open the panel once (toolbar icon menu → **Open side
> panel**, or right-click → *Look up …*), then it updates live as you hover and
> select. The toolbar menu also lets you toggle the inline hover popup and
> disable hover on the current site (selection and pinning keep working there).

## Architecture

| Area | File(s) |
|------|---------|
| Manifest (MV3) | `manifest.config.js` (CRXJS), `vite.config.js` |
| Data pipelines | `assets/scripts/build-dict.mjs` → `src/data/cedict.json` (entries + traditional↔simplified maps + merged HSK/POS/char data); `assets/scripts/convert-chars.mjs` → `assets/char-data/char-data.json` (radical/components/strokes, from makemeahanzi); `assets/scripts/fetch-fonts.mjs` → `src/sidepanel/fonts/` + `fonts.css` (vendored Google Fonts). `assets/scripts/convert-hsk.mjs` (`npm run convert:hsk`) → `assets/hsk-vocab/hsk-data.json` (HSK level + POS + official gloss, parsed from the committed `.xls` lists). All build/data scripts live under `assets/`. |
| Dictionary logic | `src/lib/dict-core.js` (pure lookup/search/segment — unit-tested), `src/lib/dict.js` (loads the index, wraps core), `src/lib/pinyin.js`, `src/lib/storage.js`, `src/lib/examples.js` (Tatoeba) |
| Side panel UI | `src/sidepanel/` (`App.jsx` + `components/`, `panel.css`) |
| On-page lookup | `src/content/content.js` (hover + click-to-pin + select), `content.css` |
| Background | `src/background/service-worker.js` (panel open + context menu) |
| Tests | `test/*.test.mjs` (`npm test`, Node's built-in runner: dict-core, pinyin, content-core, manifest, storage-helpers, reader-stash; DOM logic — reader-extract, word-walk — via happy-dom); `e2e/*.spec.js` (`npm run test:e2e`, Playwright extension tests: `panel.spec.js` side-panel smoke test, `reader.spec.js` Reader pin-to-panel + forged-message hardening) |

## Known limitations / next steps

- **Stroke order** stroke data is fetched on demand from the jsdelivr CDN (the
  `hanzi-writer` library itself is bundled). Bundling all ~9.6k stroke files
  locally would add ~25 MB; deferred. Requires network only when you expand the
  Stroke order section.
- **Data beyond CC-CEDICT** (CC-CEDICT only has simplified/traditional, pinyin,
  defs, classifiers): **HSK 3.0 level + part of speech + official English gloss**
  live in the committed `assets/hsk-vocab/hsk-data.json` (parsed from the HSK 3.0
  `.xls` word lists by `npm run convert:hsk`); **radical /
  components / stroke count** come from
  [makemeahanzi](https://github.com/skishore/makemeahanzi) (`npm run convert:chars`,
  re-downloads its source on demand); **example sentences** come live from
  Tatoeba. **Traditional→simplified** maps are built into `cedict.json` so
  traditional input resolves. Still missing: word **frequency** (a level proxy
  is used in ranking) and bundled audio (pronunciation uses the browser's TTS).
  The derived JSON is committed, so the build needs no source files.
- **Permissions**: `host_permissions` is scoped to the two services the panel
  fetches from (`tatoeba.org`, `cdn.jsdelivr.net`); page injection for hover
  lookup comes from `content_scripts` matches, which needs no host permission.
  `minimum_chrome_version` is `116` (Side Panel API floor is 114; 116 makes
  opening the panel from a page-side user gesture reliable).
- **Fonts**: three typefaces, each with a job — **Noto Sans SC** for all Chinese
  glyphs (switchable to **Noto Serif SC** in Settings), **Source Serif 4**
  (variable, optical-size axis) for English content, and the **system UI sans**
  for functional chrome (labels, badges, tabs, pinyin). They are **self-hosted**:
  `npm run fetch:fonts` vendors the woff2 files into `src/sidepanel/fonts/` and
  writes `fonts.css` (linked from `index.html`), so the extension carries **no
  remote stylesheet/font dependency** (MV3-friendly, works offline). CJK ships as
  many `unicode-range` subset files; the browser fetches only the ranges a page
  uses at runtime. The committed fonts add ~44 MB to the repo and the build
  emits ~10 MB into `dist/` (deduped), so `dist/` is ~25 MB — most of the rest is
  the dictionary JSON.
- **Licensing**: the application code is **MIT** ([`LICENSE`](./LICENSE)). Bundled
  and fetched third-party data, fonts, and libraries keep their own licenses —
  **CC-CEDICT** (CC BY-SA 4.0, attribution + share-alike), **makemeahanzi**
  (Arphic Public License + LGPL), **Noto SC / Source Serif 4** (SIL OFL 1.1),
  **Tatoeba** (CC BY 2.0 FR), Readability (Apache-2.0), React (MIT). Full
  attribution is in [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md), which
  is copied into `dist/` on build and linked from the side-panel Settings. The
  [privacy policy](https://dsaad68.github.io/zilense/privacy) and project site
  are published from [`docs/`](./docs) via GitHub Pages.

- **On-page hover** does greedy longest-match word detection (à la the Zhongwen
  extension): the content script collects the forward run of characters under the
  cursor — **across adjacent text nodes**, so a word split over inline elements
  (新`<span>`闻`</span>`) still matches — and the panel returns the longest
  matching word and how many characters to highlight (新闻 → the 2-char word, not
  新 + 闻).
