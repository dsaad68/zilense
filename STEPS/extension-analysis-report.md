# Zilense Chrome Extension Analysis

Reviewed on 2026-06-01 after the latest project update, through commit
`9018c6a` plus the currently staged changes. Package version is now `0.3.2`.

## Summary

Zilense is moving in the right direction. The latest staged update closes the
biggest Reader-mode concern from the previous review: the host page no longer
delivers Reader article data through parent-to-iframe `postMessage`. The content
script now extracts the article, the worker stashes it in extension session
storage under a random nonce, and the Reader page fetches that article through
the worker. The forged-message E2E test is the right regression test for that
class of bug.

The project now looks solid for alpha/beta use. The dictionary core is tested,
the build passes, the Reader flow is much safer, HSK highlight races are guarded,
Readability is lazy-loaded, and Reader segmentation is bounded. The remaining
work is mostly release-readiness: reliable browser E2E, cleanup of stale docs and
large assets, and a few privacy/performance polish items.

## Verified Commands

- `npm test`: passed, 67/67 tests.
- `npm run build`: passed.
- `npm run test:e2e`: failed in this sandbox before assertions because Chromium
  aborted during `launchPersistentContext`; Playwright then hit `kill EPERM`.
- Built manifest check:
  - Reader resource includes `use_dynamic_url: true`.
  - Content script loads through a small loader plus on-demand chunks.
  - Lazy content-script chunks are web-accessible for the content script.
- Current size notes:
  - `dist/`: about 26 MB.
  - `src/data/cedict.json`: about 14 MB.
  - `src/data/hsk-words.json`: about 140 KB.
  - `src/sidepanel/fonts/`: about 44 MB.
  - `src/sidepanel/fonts.css`: about 824 KB.
  - `assets/hsk-vocab/`: about 1.7 MB.

## Architecture Notes

- Manifest/build: `manifest.config.js`, `vite.config.js`.
- Background worker: `src/background/service-worker.js`.
- Toolbar popup: `src/popup/index.html`, `src/popup/popup.css`,
  `src/popup/popup.js`.
- Content script: `src/content/content.js`, `src/content/content-core.js`,
  `src/content/content.css`.
- Reader mode: `src/reader/index.html`, `src/reader/main.jsx`,
  `src/reader/ReaderView.jsx`, `src/reader/reader.css`.
- Side panel app: `src/sidepanel/App.jsx` and `src/sidepanel/components/*`.
- Dictionary/runtime storage: `src/lib/dict.js`, `src/lib/dict-core.js`,
  `src/lib/pinyin.js`, `src/lib/storage.js`.

## Current Findings

### 1. E2E launch configuration is still inconsistent

Locations: `e2e/panel.spec.js:17-23`, `e2e/reader.spec.js:37-43`

Both E2E specs set `headless: false` and comment that MV3 extensions need a
headed persistent context, but both also pass `--headless=new`. In this sandbox,
`npm run test:e2e` still fails before any assertions while launching Chromium.

Impact:

- The new Reader regression tests exist, but they have not been proven in this
  environment.
- The launch options are confusing for future contributors and CI setup.

Recommended fix:

- Move the extension launch helper into one shared E2E utility.
- Make launch mode explicit, for example `E2E_HEADLESS=new|false`.
- Align comments, config, and CI documentation.
- Run these tests in a browser-capable environment before shipping Reader mode.

### 2. HSK source spreadsheets are still not canonical

Locations: `assets/hsk-vocab/*.xls`, `assets/scripts/convert-hsk.mjs`

The folder still contains duplicate/copy `.xls` files and `.DS_Store`. The
converter ingests every `.xls` in the directory, so future accidental copies can
quietly affect generated HSK data.

Recommended fix:

- Keep one canonical raw source set.
- Move duplicates/copies to `Archive/` or delete them.
- Make the converter warn or fail on `copy` filenames.
- Log sorted input filenames during conversion.

### 3. Font assets still dominate repo size

Locations: `src/sidepanel/fonts/`, `src/sidepanel/fonts.css`,
`assets/scripts/fetch-fonts.mjs`

The repo still vendors about 44 MB of font files and an 824 KB `fonts.css`.

Recommended fix:

- Reduce requested families/weights to what the UI actually uses.
- Dedupe fetched files by URL/content hash.
- Consider one bundled Chinese family by default and optional serif support.

## Fixed Since Last Review

- Reader article stash residue: stashes are now timestamped, swept past a 5-minute
  TTL on every new stash (and on read), and explicitly cleared by the content
  script when an open is aborted after stashing. Covered by `test/reader-stash.test.mjs`.
- Stale docs/comments: README now lists both `e2e/panel.spec.js` and
  `e2e/reader.spec.js`; source comments no longer hardcode analysis-report finding
  numbers.
- Reader article trust: fixed by replacing parent-to-iframe article
  `postMessage` with worker-backed session storage and a one-use nonce.
- Reader forged message regression: covered by the new `e2e/reader.spec.js`
  test, pending a successful browser run outside this sandbox.
- Reader pin-to-panel coverage: added in `e2e/reader.spec.js`, pending a
  successful browser run outside this sandbox.
- HSK stale async response race: fixed with `hskGen` and requested-level checks.
- Readability content-script bloat: improved by dynamic import; the built
  content script now loads through a small loader and on-demand chunks.
- Reader segmentation hot path: improved with capped input, bounded segment
  window, and event-loop yields.
- Reader URL fingerprinting/hardcoded iframe risk: reduced with
  `use_dynamic_url: true`.

## Coverage Gaps

- Full E2E run in a browser-capable environment.
- Reader open/close from toolbar popup and context menu.
- Reader selected-text pin flow, not only clicking a rendered token.
- HSK level switching with slow worker responses.
- Large-page HSK responsiveness.
- Popup workflows: per-site disable, HSK controls, Reader button.
- Cold-panel pin-to-open from real page interaction.
- Inline popup positioning near viewport edges.

## Improvement Suggestions

- Add `npm run validate` for dictionary build, unit tests, production build,
  manifest sanity checks, and optional E2E.
- Share a single Playwright extension launch helper between E2E specs.
- Add browser fixtures for article pages, long pages, iframes, shadow DOM, and
  hostile pages that try to message the Reader iframe.
- Add a diagnostics/about page with version, dictionary build timestamp, data
  sizes, remote-service reachability, and privacy mode status.
- Store saved entries with a snapshot of pinyin/definitions, not only query text.
- Add import/export for saved words: JSON backup, CSV, Anki TSV.
- Add remote-data toggles for Tatoeba and stroke data.

## Feature Suggestions

### Reader Mode

- Save sentence from Reader with word, source URL, and surrounding context.
- Reader vocabulary list sorted by HSK level and frequency.
- Known-word dimming based on saved/reviewed words.
- Resume reading position per article.
- Offline article export or saved reading queue.
- Reader progress sidebar showing unique words, new words, and HSK distribution.

### Learning

- Spaced repetition review for saved words.
- HSK filters in search and saved deck.
- Tone practice mode.
- Similar-character and component/radical drills.
- Cloze cards from saved Reader sentences.
- Daily review queue based on words saved from real pages.

### Power User

- Keyboard shortcuts for open panel, open Reader, focus search, save word, toggle
  hover, and toggle HSK highlight.
- Batch lookup for pasted paragraphs.
- Custom word-list import for classroom vocabulary, names, and domain terms.
- Per-site profiles: hover disabled, default HSK level, default Reader theme.
- Configurable pin key and quick actions for add-to-deck/export.

### Publishing

- Web Store screenshots and onboarding.
- Publishable privacy policy.
- Release notes for dictionary and HSK data changes.
- Clear local/remote data disclosure in the UI.
- Small first-run page explaining hover, Reader, saved deck, and offline data.

## Suggested Next Steps

1. Fix the E2E launch-mode mismatch and run the full suite outside this sandbox.
2. Clean up HSK raw inputs and font assets.
3. Add `npm run validate` before packaging or release.
