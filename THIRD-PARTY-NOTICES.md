# Third-Party Notices

Zilense ("the extension") bundles, derives from, or fetches the following
third-party works. Each is the property of its respective authors and is used
under the license named below. The full text of each license is available at
the linked canonical URI; verbatim copies of the licenses that ship with their
packages are included in the [`licenses/`](./licenses) folder of this repository
and in the packaged extension.

The Zilense application source code itself is licensed under the MIT License
(see [`LICENSE`](./LICENSE)). The terms below govern the bundled data, fonts,
and libraries — **not** the application code.

---

## Dictionary data

### CC-CEDICT
- **Used for:** the core Chinese–English dictionary (entries, pinyin, definitions,
  classifiers, traditional↔simplified mapping). Parsed by
  `assets/scripts/build-dict.mjs` into `src/data/cedict.json` and bundled.
- **Source / attribution:** CC-CEDICT, maintained by MDBG — <https://www.mdbg.net/chinese/dictionary?page=cc-cedict>
  and <https://cc-cedict.org/>.
- **License:** Creative Commons Attribution-ShareAlike 4.0 International
  (**CC BY-SA 4.0**) — <https://creativecommons.org/licenses/by-sa/4.0/>.
- **Note:** This license requires attribution (given above) and is *share-alike*:
  the dictionary data and any adaptation of it remain under CC BY-SA 4.0. CC BY-SA
  4.0 §3(a) expressly permits providing the license by hyperlink, as done here.

### CedPane
- **Used for:** a second dictionary source covering names and proper nouns (people,
  places, brands, etc.) so those resolve alongside CC-CEDICT. Fetched at build time
  and merged into `src/data/cedict.json` by `assets/scripts/build-dict.mjs`, where
  each entry is tagged as a proper noun (and ranked below everyday words).
- **Source / attribution:** CedPane (Chinese-English Dictionary Public-domain
  Additions for Names Etc) by Silas S. Brown — <https://github.com/ssb22/CedPane>
  and <https://ssb22.user.srcf.net/cedpane/>.
- **License:** released into the **public domain** (the Unlicense) — the verbatim
  dedication that ships with the project is in
  [`licenses/cedpane-LICENSE.txt`](./licenses/cedpane-LICENSE.txt).

### HSK 3.0 word lists
- **Used for:** HSK level, part-of-speech, and official English gloss
  (`assets/hsk-vocab/hsk-data.json`, merged into `cedict.json`).
- **Source / attribution:** the official HSK 3.0 standard
  (《国际中文教育中文水平等级标准》). Used as factual reference data.

---

## Character / stroke data

### makemeahanzi
- **Used for:** character decomposition — radical, components, stroke count, and
  short glosses (`assets/scripts/convert-chars.mjs` →
  `assets/char-data/char-data.json`). The stroke-order graphics rendered by
  hanzi-writer (fetched at runtime, see below) are also derived from this dataset.
- **Source / attribution:** makemeahanzi by Shaunak Kishore —
  <https://github.com/skishore/makemeahanzi>.
- **License:** the character **graphics** data is derived from Arphic Technology's
  "AR PL UMing" / "AR PL UKai" fonts and is distributed under the **Arphic Public
  License** (<https://www.freedesktop.org/wiki/Arphic_Public_License/>); the
  **dictionary / decomposition** data is distributed under the **GNU Lesser
  General Public License (LGPL)** — <https://www.gnu.org/licenses/lgpl-3.0.html>.

### hanzi-writer
- **Used for:** the stroke-order animation library (bundled) and its on-demand
  stroke-path data fetched from `cdn.jsdelivr.net` (`hanzi-writer-data`, itself
  derived from makemeahanzi — see the Arphic / LGPL terms above).
- **Source / attribution:** hanzi-writer by Chris Birkhimer and contributors —
  <https://github.com/chanind/hanzi-writer>.
- **License:** MIT — see [`licenses/hanzi-writer-LICENSE.txt`](./licenses/hanzi-writer-LICENSE.txt).

---

## Fonts (self-hosted in `src/sidepanel/fonts/`)

### Noto Sans SC & Noto Serif SC
- **Used for:** Chinese glyph rendering (sans + serif faces).
- **Source / attribution:** the Noto project (Google) —
  <https://github.com/notofonts/noto-cjk>.
- **License:** SIL Open Font License, Version 1.1 (**OFL 1.1**) —
  <https://openfontlicense.org/open-font-license-official-text/>.

### Source Serif 4
- **Used for:** English body / serif text.
- **Source / attribution:** Source Serif by Adobe —
  <https://github.com/adobe-fonts/source-serif>.
- **License:** SIL Open Font License, Version 1.1 (**OFL 1.1**) —
  <https://openfontlicense.org/open-font-license-official-text/>.

---

## Example sentences (fetched at runtime)

### Tatoeba
- **Used for:** example sentences shown on demand (`src/lib/examples.js`), fetched
  live from `tatoeba.org` only when the Examples section is expanded.
- **Source / attribution:** the Tatoeba Project — <https://tatoeba.org>.
- **License:** sentence content is licensed under Creative Commons
  Attribution 2.0 France (**CC BY 2.0 FR**) —
  <https://creativecommons.org/licenses/by/2.0/fr/>.

---

## Libraries

### @mozilla/readability
- **Used for:** article extraction in Reader mode.
- **Source / attribution:** Mozilla (originally Arc90) —
  <https://github.com/mozilla/readability>.
- **License:** Apache License 2.0 — full text at
  <https://www.apache.org/licenses/LICENSE-2.0>; the notice that ships with the
  package is in [`licenses/mozilla-readability-LICENSE.txt`](./licenses/mozilla-readability-LICENSE.txt).

### React & React-DOM
- **Used for:** the side-panel, popup, and Reader UI.
- **Source / attribution:** Meta (Facebook, Inc.) and contributors —
  <https://github.com/facebook/react>.
- **License:** MIT — see [`licenses/react-LICENSE.txt`](./licenses/react-LICENSE.txt)
  and [`licenses/react-dom-LICENSE.txt`](./licenses/react-dom-LICENSE.txt).

---

*Build-time-only tooling (Vite, CRXJS, @vitejs/plugin-react, Playwright,
happy-dom, the `cc-cedict` npm loader) is not redistributed in the packaged
extension and is therefore not listed above; those packages remain under their
own licenses in `node_modules`.*
