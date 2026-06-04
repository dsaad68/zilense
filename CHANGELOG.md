# Changelog

All notable changes to **Zilense** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project follows
[Semantic Versioning](https://semver.org/).

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
