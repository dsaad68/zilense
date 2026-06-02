---
title: HanziLens — Privacy Policy
---

# HanziLens — Privacy Policy

_Last updated: 2 June 2026_

HanziLens is a Chinese-dictionary browser extension. This policy explains what
data it handles and what it does not. **In short: HanziLens does not collect,
transmit, sell, or share any personal information, and it has no analytics or
tracking of any kind.**

## What is stored, and where

The following are stored **locally on your device** using the browser's
`chrome.storage` API. They never leave your device and are not sent to the
developer or any third party:

- **Saved words** — the deck of entries you star.
- **Settings** — your display preferences (accent color, Chinese font, tone
  colors, traditional/simplified, hover popup, pin key, Reader-mode appearance).
- **Recent lookups / history** — words you have looked up, kept locally so the
  panel can show them again.

You can clear this data at any time by removing the saved words in the panel or
by removing the extension from your browser.

## Network requests

HanziLens works offline for its core dictionary. It makes outbound network
requests **only on demand**, and only to the following services, when you
explicitly expand the corresponding section:

- **`tatoeba.org`** — to fetch example sentences when you open the Examples
  section for a word.
- **`cdn.jsdelivr.net`** — to fetch stroke-order path data when you open the
  Stroke order section for a character.

These requests contain only the Chinese word or character being looked up. No
identifiers, account information, or browsing history is attached to them.
Pronunciation uses your browser's built-in speech synthesis and makes no
network request to the developer.

## What HanziLens does NOT do

- It does **not** use analytics, telemetry, cookies, or tracking pixels.
- It does **not** collect personally identifiable information.
- It does **not** transmit the pages you visit, your selections, or your saved
  words to any server.
- It does **not** sell or share any data with third parties.
- It does **not** serve ads.

## Permissions

HanziLens requests the minimum permissions needed to function: reading the
character or word you hover/select on a page (to look it up), `storage` (for the
local data above), `sidePanel` and `contextMenus` (its user interface), and
`activeTab` (to read the current tab's address when you open the panel). It does
not request broad host access to read or modify arbitrary sites in the
background.

## Changes

If this policy changes, the "Last updated" date above will change and the new
version will be published at this URL.

## Contact

Questions about privacy: **dsaad68@gmail.com**
