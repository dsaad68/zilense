# Chrome Web Store — Listing & Review Copy

Copy-paste source for the Chrome Web Store developer dashboard. Everything here
is factual and matches the shipped code (`manifest.config.js`, `src/`) and the
[privacy policy](./docs/privacy.md).

- **Name:** Zilense - Chinese Dictionary
- **Category:** Productivity (alt: Education)
- **Privacy policy URL:** https://zilense.com/privacy
- **Default language:** English

---

## Single-purpose description

> Zilense has one purpose: to look up Chinese words and characters and show
> their reading and meaning. Hovering or selecting Chinese text on a page, or
> typing a query, opens a dictionary entry (pinyin, definition, stroke order,
> example sentences) in the browser side panel.

---

## Short description (≤ 132 characters)

> Hover or select any Chinese on a page to see pinyin, meaning, stroke order &
> examples in the side panel. Save words to your deck.

---

## Detailed description (store listing body)

> **Zilense turns any web page into a Chinese reading aid.** Hover a Chinese
> character — or select a whole word — and its tone-colored pinyin and English
> meaning appear instantly in the Chrome side panel. No copy-paste, no leaving
> the page.
>
> **Features**
> - **Hover & select lookup** — point at a character to highlight and read it;
>   select a phrase to get the whole-word reading and a character-by-character
>   breakdown. Works on simplified and traditional pages (中國 resolves to 中国).
> - **Smart word detection** — greedy longest-match segmentation finds the
>   actual word under your cursor, even when it is split across inline markup.
> - **Search** — by hanzi, pinyin (tone marks optional, e.g. "nihao"), or
>   English, ranked so common and HSK words come first.
> - **Stroke order** — animated stroke-by-stroke diagrams for any character.
> - **Example sentences** — real usage from the Tatoeba corpus, on demand.
> - **Pronunciation** — hear Mandarin via your browser's speech synthesis.
> - **Saved deck** — star words to build your own study list; it stays on your
>   device.
> - **Side panel or floating window** — use the dictionary docked in Chrome's side
>   panel, or pop it out into a detached window that floats free and stays put as
>   you switch tabs. Both share your saved words, settings, and live lookups, and
>   **keyboard shortcuts** can open either one directly (rebindable in Chrome).
> - **Flashcards** — study your starred words or any HSK 3.0 level on a full-page
>   trainer with flip cards and keyboard shortcuts. HSK decks come from the
>   official word lists (exact gloss, part of speech, and pinyin per entry); pick
>   just one level or everything up to it, choose a pool (all / unseen / recently
>   or ever missed), size, order, and prompt direction. Progress stays on your
>   device and can be exported or imported.
> - **Export to Anki** — turn your starred words into a tab-separated file Anki
>   imports directly.
> - **Reader mode** — open the current article in a clean, distraction-free
>   reader with selectable fonts, larger text, and optional tone-colored pinyin
>   above every character — with the dictionary still live as you read.
> - **PDFs** — open a PDF and Zilense offers to reopen it in a built-in viewer
>   where hover, lookup, and selection work just like on a web page. Scanned or
>   image-only PDFs are recognized with offline OCR (a bundled Chinese model — no
>   network), so even photographed pages become hoverable.
> - **HSK highlighting** and a customizable look (accent color, Chinese serif/
>   sans face, tone colors, dark mode).
>
> **Private by design.** Your saved words, settings, and history stay on your
> device. Zilense has no analytics and no tracking, and it never sends the
> pages you visit anywhere. It reaches the network only when you open the
> example-sentences or stroke-order section for a specific word. See the privacy
> policy for details.
>
> Dictionary data: CC-CEDICT (CC BY-SA 4.0), with names and proper nouns from
> CedPane (public domain). Built with open data and fonts; full attribution is
> included with the extension.

---

## Permission justifications

One line each — paste into the corresponding dashboard field.

| Permission | Justification |
|------------|---------------|
| **`activeTab`** | Read the active tab's URL and id only when the user clicks the toolbar icon — to open the side panel for that tab and to offer "disable on this site." No background access to tabs. |
| **`storage`** | Persist the user's saved-word deck, display settings, and recent lookups locally on the device. No data leaves the device. |
| **`sidePanel`** | The side panel is the extension's primary UI, where dictionary entries are displayed. |
| **`contextMenus`** | Add right-click items: "Look up '…' in Zilense" for selected text, "Open in Zilense Reader" for the page, and "Open this PDF in Zilense" on PDF links/pages. |
| **Host permission `https://tatoeba.org/*`** | Fetch example sentences for a looked-up word, on demand, only when the user expands the Examples section. |
| **Host permission `https://cdn.jsdelivr.net/*`** | Fetch stroke-order path data (open hanzi-writer data) for a character, on demand, only when the user expands the Stroke order section. |
| **Optional host permission `*://*/*`** | **Not granted at install.** Requested on a user gesture only when the user chooses to open a cross-origin PDF in Zilense's viewer (the viewer, an extension page, must fetch the PDF's bytes to display it). Only the specific PDF's origin is requested at that moment; the user can decline, and revoke it later. |

### Content script on `<all_urls>` (justification for the reviewer)

> The content script is what makes hover/selection lookup work, so it must be
> able to run on any page the user reads Chinese on — the user cannot predict in
> advance which sites those are. The script is intentionally minimal: it detects
> the character under the cursor or the selected text and sends it to the
> extension for lookup. It does **not** read, collect, or transmit page content
> anywhere; the dictionary itself is bundled and runs locally in the side panel.
> Network access is limited to the two host permissions above and happens only
> on explicit user action. `activeTab` is used instead of broad host permissions
> for tab-URL access.

### `web_accessible_resources` (justification for the reviewer)

> Reader mode is an extension page that the content script injects as a
> full-screen iframe over the current article, so the reader page is declared
> web-accessible. It is served with `use_dynamic_url: true` (a per-session random
> URL), so web pages cannot hardcode or fingerprint it or feed it a crafted
> payload. The article hand-off to the reader goes through the extension's
> service worker with a one-time nonce, never through the host page. The PDF
> viewer page (`src/pdfviewer/index.html`) is also web-accessible — the tab is
> navigated to it to open a PDF — at a **stable** URL because the redirect rule and
> the navigation both need a fixed target. The other web-accessible entry is the
> CRXJS-generated content-script chunk, added automatically by the build.

### Content Security Policy — `'wasm-unsafe-eval'` (justification for the reviewer)

> `content_security_policy.extension_pages` adds `'wasm-unsafe-eval'` to
> `script-src` (kept otherwise at `'self'`) solely so the bundled **Tesseract.js**
> OCR engine's WebAssembly can compile. This is required to read **scanned/image
> PDFs**, which have no text layer. All OCR code, the WebAssembly core, and the
> Chinese language model are **bundled in the package** (under `/tesseract`) and
> run locally — **no remote code is fetched or executed**, and the page image
> never leaves the device.

---

## Data-usage disclosure (dashboard certifications)

Answers for the "Privacy practices" tab.

**Does this item collect or use the following user data?**

| Data type | Collected? | Notes |
|-----------|-----------|-------|
| Personally identifiable information | **No** | |
| Health information | **No** | |
| Financial / payment information | **No** | |
| Authentication information | **No** | |
| Personal communications | **No** | |
| Location | **No** | |
| Web history | **No** | Lookup history is stored locally only and never transmitted. |
| User activity (clicks, mouse position, keystroke logging, etc.) | **No** | |
| Website content (text, images, the pages the user visits) | **No** | The looked-up word/character is sent only to Tatoeba/jsDelivr on demand to fetch examples/stroke data; nothing is stored or sent to the developer. PDFs opened in the viewer (and any OCR of scanned pages) are processed entirely on the device. |

**Certifications (check all three — true for Zilense):**
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://zilense.com/privacy

---

## Notes for the reviewer (free-text box)

> 1. **No remote code.** All executable code — including the PDF.js viewer and the
>    Tesseract OCR engine + its WebAssembly core — is bundled in the package. The
>    `'wasm-unsafe-eval'` CSP only lets that **bundled** WASM compile; nothing is
>    fetched and eval'd. The only network requests are to `tatoeba.org` (example
>    sentences) and `cdn.jsdelivr.net` (stroke-order **data**, JSON path
>    coordinates — not script), fetched on demand for a specific looked-up word.
>    When the user opens a PDF in the viewer, the viewer fetches that PDF's bytes
>    from its origin (with the user's granted access) to display it — the PDF is
>    rendered and, if scanned, OCR'd entirely on the device.
>
> 2. **Bundle size.** The package includes the full CC-CEDICT dictionary plus
>    CedPane name/proper-noun additions (`cedict.json`, ~20 MB) so lookups work
>    offline and privately, and the bundled OCR engine + Chinese model (~9 MB under
>    `/tesseract`) so scanned PDFs work offline. Both are loaded on demand. This is
>    data the extension's core function depends on, not unused payload.
>
> 3. **`<all_urls>` content script** is required for on-page hover/selection
>    lookup (see the permission justification above). It only detects the
>    word under the cursor / the user's selection and forwards it for lookup;
>    it does not exfiltrate page content.
>
> 4. **Open data & attribution.** Dictionary, character, and font data are open
>    (CC-CEDICT under CC BY-SA 4.0, CedPane in the public domain, makemeahanzi,
>    Noto/Source Serif under the SIL OFL). Full attribution ships in the package
>    as `THIRD-PARTY-NOTICES.md` and is linked from the in-app Settings.

---

## Screenshot checklist (1280×800 or 640×400 PNG/JPEG; 1–5 images)

Capture fresh screenshots against a real Chinese article, cropped to the required
size. Suggested set:

1. **Hover lookup** — cursor over a highlighted character, side panel showing the
   entry (pinyin + meaning).
2. **Word selection** — a selected multi-character word with its breakdown.
3. **Stroke order** — the animated stroke diagram expanded.
4. **Reader mode** — the clean reader with tone-colored pinyin ruby.
5. **Settings / dark mode** — the appearance options (accent, serif/sans, tones).

Optional store assets: small promo tile 440×280 (recommended for better
placement); the 128×128 store icon is already in `public/icons/icon-128.png`.
