# Changelog

All notable changes to **Zilense** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project follows
[Semantic Versioning](https://semver.org/).

## [1.9.3] — 2026-06-04

### Changed
- The toolbar menu now shows the **Subtitles** section only on supported video
  sites (YouTube / Coursera), where the feature actually does something; on every
  other page the menu is just the dictionary controls.

### Fixed
- **The on-video subtitle engine never loaded on real pages.** The content script's
  lazy `import('./engine.js')` went through Vite's module-preload helper, which
  resolved the engine chunk against the *page* origin (`https://www.youtube.com/
  assets/engine-*.js` → 404) and rejected the import — so the whole overlay (pinyin,
  lookup, dual) silently never ran. Disabled module preload for the build so the
  import resolves against the extension origin.
- Dual subtitles failing to load caption text on YouTube: a track's raw caption URL
  now often returns nothing without a session token the player adds. The hook now
  captures the player's own caption requests (both `fetch` and XHR) and the engine
  fetches cues from that working URL (swapping format/language/translation), instead
  of the bare URL. Set `localStorage.zilenseSubsDebug = '1'` on a video page and
  reload to see `[zilense subs]` diagnostics if dual still won't engage.

## [1.9.2] — 2026-06-04

### Added
- **Dual subtitles toggle** in the toolbar menu, with a **Second language** picker.
  Chinese shows on top and a second language below. The second line defaults to
  **English** and can be set to another language; a chosen language falls back to
  English (or the next available track) when a video doesn't carry it, so the second
  line never silently disappears.
- Turning on Dual subtitles now **uses YouTube's auto-captions and auto-translation
  when needed**, so it works on the common case of a video that only has an
  auto-generated Chinese track — the Chinese line uses that track and the second
  line is machine-translated into the chosen language. (The separate per-line
  auto-caption / auto-translation toggles are gone; dual implies them.)

## [1.9.1] — 2026-06-04

### Added
- A **Pinyin tone colors** toggle in the toolbar menu. It turns tone coloring on/off
  everywhere at once — the side panel and Reader, and the on-video subtitle overlay
  (which previously had no way to switch its tone colors off).

### Fixed
- The subtitle engine no longer tries to load on YouTube login/creator subdomains
  (`accounts.`/`studio.`/`consent.youtube.com`). Those frames have no video player
  and a strict CSP that blocked the dynamically-imported engine chunk; the feature
  now runs only on the surfaces that actually have a player.
- Right-click **look up selection** no longer fails to open the side panel with "may
  only be called in response to a user gesture" — the panel is now opened within the
  click gesture before any async work.

## [1.9.0] — 2026-06-04

### Added
- **Dual subtitles (Phase 2).** On YouTube, Zilense can now show two real caption
  tracks at once — the Chinese line annotated with pinyin + clickable words, a
  second line beneath it — synced to the video clock from same-origin `timedtext`
  (no new permission). A gear menu picks the top/bottom languages.
- The Chinese line is annotated by language, so pinyin and word lookup follow the
  Chinese track whether it is the top or the bottom line.

### Changed
- The single "allow auto" subtitle option is now two independent opt-ins —
  **auto-captions** (YouTube's speech recognition) and **auto-translation** (its
  machine translation). Both default off, so the picker offers human-authored
  tracks only unless you opt in; existing settings are migrated automatically.

### Fixed
- Dual mode now activates only when **both** chosen tracks actually have cues; a
  single failed fetch keeps the native captions instead of hiding them behind a
  one-line overlay.
- A subtitle line cleared during navigation can no longer be repainted by a late
  in-flight segmentation reply.
- When a caption track's signed URL goes stale across an in-page navigation, the
  engine falls back to the timedtext URL the player itself fetched (matched by
  language, same-origin).

## [1.8.5] — 2026-06-04

### Changed
- Removed the opt-in "open all PDFs automatically" auto-redirect and its
  `declarativeNetRequestWithHostAccess` permission — PDFs are opened manually via
  the in-page toast and the right-click menu, so the extension no longer intercepts
  navigations. Manifest permissions are back to the minimal `sidePanel`, `storage`,
  `contextMenus`, `activeTab`.

## [1.8.4] — 2026-06-04

### Added
- When you open a PDF in Chrome's native viewer, Zilense now shows a small,
  dismissible **in-page toast** offering to reopen it in Zilense (where hover,
  lookup, and selection work). Clicking **Open in Zilense** loads it in the bundled
  viewer; cross-origin PDFs get a one-click "Allow & open" grant in the viewer. No
  new permissions. (Replaces the earlier toolbar-popup banner.)

### Fixed
- Silenced Tesseract's chatty native debug output ("Estimating resolution as…",
  "Detected N diacritics") that was logged to the console on every OCR'd page
  (`debug_file` redirected to `/dev/null`).

## [1.8.2] — 2026-06-04

### Added
- **Hover-to-define in PDFs.** Chrome's built-in PDF viewer renders text to a
  canvas with no hoverable text, so Zilense now ships a bundled **PDF.js viewer**
  whose real text layer makes hover, the inline popup, click-to-pin, and selection
  lookup work on PDFs exactly as they do on web pages.
  - **Open this PDF in Zilense** — opening a PDF shows an in-page toast (and a
    right-click menu item) that reopens it in the viewer. No broad permissions by
    default; host access for the PDF's origin is requested on demand (the viewer
    offers a one-click "Allow & open"). PDFs are opened manually — no navigation
    redirect.
  - Works with `http(s)://` PDFs, and local `file://` PDFs once **“Allow access to
    file URLs”** is enabled for Zilense (the viewer shows that hint when needed).
  - **Scanned PDFs (offline OCR).** Image-only PDFs (e.g. photographed workbooks)
    have no text layer, so the viewer runs bundled **Tesseract.js** with a
    Simplified-Chinese model — fully offline, no network — to recognize each page
    image and synthesize a text layer, making hover and selection work on scanned
    pages too. OCR runs on demand per visible page with a progress badge. On OCR'd
    pages the hover/pin highlight overlays are suppressed (the recognized text can't
    align pixel-perfectly with the image) — the popup and panel lookup still work;
    digital PDFs keep the overlays.

### Changed
- The on-page hover/pin/popup machinery was factored into a shared `hover-driver`
  module so the content script and the PDF viewer drive it from one implementation.
  No behavior change for existing pages.

## [1.7.5] — 2026-06-04

### Added
- **Open in window** (toolbar menu → Open in window): the dictionary in a detached,
  chromeless popup window that floats free of the side panel and stays put across
  tab switches. It shares the side panel's data and receives the same live
  hover/selection lookups; a repeat click focuses the existing window rather than
  opening another.
- **Keyboard shortcuts** for launching the dictionary directly, without the toolbar
  menu (rebind at `chrome://extensions/shortcuts`):
  - **Ctrl/⌘ + Shift + Y** → open the dictionary window.
  - **Ctrl/⌘ + Shift + E** → open the side panel.

## [1.7.0] — 2026-06-04

### Added
- **Flashcards** study page (toolbar menu → Flashcards): study your starred words
  or any HSK 3.0 level with flip cards, keyboard shortcuts, and per-device progress
  that can be exported/imported as JSON.
  - HSK decks are built directly from the official HSK 3.0 word lists — **one card
    per list row**, carrying that row's exact gloss, part of speech, and pinyin, so
    a word with two senses at a level becomes two cards.
  - **Level scope**: study *just this level* or *everything up to it* (cumulative).
  - Round setup: study pool (all / unseen / recently missed / ever missed), size,
    order, and prompt direction, plus **pinyin-on-top** and **show part-of-speech**
    toggles.
- **Export to Anki** for starred words, from both the panel's Saved tab and the
  flashcards page.
- Project website: a dedicated Flashcards section, a redesigned footer, and the
  "Track what you know" feature moved to the end and marked **Experimental**.
- This `CHANGELOG.md`.

### Changed
- Toolbar popup now shows the real extension icon instead of a text badge.
- Side-panel empty states use the **字** brand glyph, matching the extension icon.
- Contact email standardized to `me@verybad.engineer` (manifest author + privacy
  policy).
- Documentation refreshed: README and the Chrome Web Store listing now describe the
  flashcards and HSK-list changes; test inventory brought up to date.

### Fixed
- Flashcards end-to-end test updated to drive the new custom deck dropdown (it was
  still targeting the removed native `<select>`).

## [1.5.0] and earlier

The side-panel Chinese dictionary foundation: hover/select lookup (simplified and
traditional), tone-colored pinyin, whole-word reading with a character-by-character
breakdown, animated stroke order, HSK 3.0 levels with on-page highlighting, a
distraction-free reader mode with pinyin ruby, Tatoeba example sentences, ranked
search (hanzi / pinyin / English), CedPane names and proper nouns, a saved deck and
lookup history, opt-in familiarity tracking, self-hosted fonts, and a customizable
theme. See the Git history for the detailed evolution.

[1.7.0]: https://github.com/dsaad68/zilense/releases/tag/v1.7.0
