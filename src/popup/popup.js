/* popup.js — the toolbar action menu:
     • Open side panel   -> chrome.sidePanel.open() (this click is the user gesture)
     • Hover popup        -> flips settings.inlinePopup (the inline mini-card)
     • Disable on site    -> toggles location.hostname in mydict.disabledSites
     • Highlight HSK ≤ N  -> one-shot: messages the active tab's content script to
                            highlight every HSK word up to the chosen level
   Reads/writes the same storage the side panel and content script use, so the
   content script picks up changes live via chrome.storage.onChanged. */
import {
  loadState,
  saveSettingsPatch,
  loadDisabledSites,
  saveDisabledSites,
  toggleSite,
} from '../lib/storage.js'

const $ = (id) => document.getElementById(id)

// does this tab URL look like a PDF? Chrome's native viewer keeps the real URL in
// tab.url, so a `.pdf` pathname is the practical signal (Content-Type isn't visible
// from the popup). Covers http(s) and local file:// PDFs.
function looksLikePdf(url) {
  try {
    const u = new URL(url)
    if (!/^(https?|file):$/.test(u.protocol)) return false
    return /\.pdf$/i.test(u.pathname)
  } catch { return false }
}

// the host-permission match pattern for a PDF's origin (so the viewer can fetch
// it). Null for file:// — that needs the "Allow access to file URLs" toggle, not a
// host permission.
function originPattern(url) {
  try {
    const u = new URL(url)
    if (u.protocol === 'file:') return null
    return `${u.protocol}//${u.host}/*`
  } catch { return null }
}

function setSwitch(el, on) {
  el.classList.toggle('on', on)
  el.setAttribute('aria-checked', on ? 'true' : 'false')
}

async function init() {
  // the active tab — its id opens the panel, its hostname keys the site toggle
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  let host = ''
  try { host = tab && tab.url ? new URL(tab.url).hostname : '' } catch {}

  const { settings } = await loadState()
  document.body.dataset.theme = settings.dark ? 'dark' : 'light'

  // Open side panel — must call open() synchronously inside this click handler
  // so the user activation carries through (don't await before it).
  $('open-panel').addEventListener('click', () => {
    if (tab && tab.id != null) {
      chrome.sidePanel.open({ tabId: tab.id }).catch((e) => console.error('[mydict] sidePanel.open', e))
    }
    window.close()
  })

  // Reader mode — tell the active tab's content script to extract the article and
  // open the reader overlay. Disabled on non-web tabs (no content script there).
  const readerBtn = $('reader-mode')
  if (tab && tab.id != null) {
    readerBtn.addEventListener('click', () => {
      chrome.tabs.sendMessage(tab.id, { type: 'reader-open' }, () => void chrome.runtime.lastError)
      window.close()
    })
  } else {
    readerBtn.disabled = true
    readerBtn.style.opacity = '.4'
    readerBtn.style.cursor = 'default'
  }

  // Flashcards — open the study page in a new tab. It's an extension page
  // (opened via runtime.getURL), so it works on any tab and needs no permission.
  $('flashcards').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/flashcards/index.html') })
    window.close()
  })

  // Open this PDF in Zilense — only shown when the active tab is a PDF. Chrome's
  // native PDF viewer has no hoverable text, so we navigate the tab to the bundled
  // PDF.js viewer (real text layer) with the PDF URL in the hash. For http(s) we
  // first request host access to that origin (a user gesture, granted on demand)
  // so the viewer can fetch the bytes; file:// relies on the user's "Allow access
  // to file URLs" toggle instead (Chrome can't grant it programmatically).
  const pdfBtn = $('open-pdf')
  if (tab && tab.id != null && tab.url && looksLikePdf(tab.url)) {
    pdfBtn.hidden = false
    pdfBtn.addEventListener('click', async () => {
      const url = tab.url
      const target = chrome.runtime.getURL('src/pdfviewer/index.html') + '#file=' + encodeURIComponent(url)
      try {
        const pat = originPattern(url)
        if (pat) await chrome.permissions.request({ origins: [pat] }).catch(() => {})
      } catch (e) { /* request rejected/unsupported — navigate anyway, viewer shows a hint */ }
      chrome.tabs.update(tab.id, { url: target })
      window.close()
    })
  }

  // Hover popup = settings.inlinePopup (the floating mini-card)
  const hoverBtn = $('hover-toggle')
  let inlinePopup = settings.inlinePopup
  setSwitch(hoverBtn, inlinePopup)
  hoverBtn.addEventListener('click', () => {
    inlinePopup = !inlinePopup
    setSwitch(hoverBtn, inlinePopup)
    // patch only this field so we don't clobber other settings (a later popup
    // control, or a side-panel change made while the popup is open)
    saveSettingsPatch({ inlinePopup })
  })

  // Disable on this site = hostname in the disabled-sites list
  const siteBtn = $('site-toggle')
  const hostEl = $('host')
  let disabled = await loadDisabledSites()
  if (host) {
    hostEl.textContent = host
    setSwitch(siteBtn, disabled.includes(host))
    siteBtn.addEventListener('click', () => {
      disabled = toggleSite(disabled, host)
      setSwitch(siteBtn, disabled.includes(host))
      saveDisabledSites(disabled)
    })
  } else {
    // non-web page (chrome://, extension pages) — no host to toggle
    hostEl.textContent = 'unavailable here'
    siteBtn.disabled = true
    siteBtn.style.opacity = '.4'
    siteBtn.style.cursor = 'default'
  }

  // Highlight HSK ≤ N — a one-shot action on the active tab's content script.
  const levelSel = $('hsk-level')
  const colorBtn = $('hsk-color')
  let colorByLevel = !!settings.hskColorByLevel
  setSwitch(colorBtn, colorByLevel)

  const sendHighlight = (level) => {
    if (tab && tab.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: 'hsk-highlight', level, colorByLevel },
        () => void chrome.runtime.lastError)
    }
  }

  if (tab && tab.id != null) {
    // reflect the page's current level (one-shot state lives in the content script)
    chrome.tabs.sendMessage(tab.id, { type: 'hsk-status' }, (resp) => {
      if (chrome.runtime.lastError || !resp) { disableHsk(); return }
      levelSel.value = String(resp.level || 0)
    })
    levelSel.addEventListener('change', () => sendHighlight(levelSel.value | 0))
    colorBtn.addEventListener('click', () => {
      colorByLevel = !colorByLevel
      setSwitch(colorBtn, colorByLevel)
      saveSettingsPatch({ hskColorByLevel: colorByLevel })
      if ((levelSel.value | 0) > 0) sendHighlight(levelSel.value | 0) // recolor live
    })
  } else {
    disableHsk()
  }

  function disableHsk() {
    levelSel.disabled = true
    colorBtn.disabled = true
    colorBtn.style.opacity = '.4'
    colorBtn.style.cursor = 'default'
  }
}

init().catch((e) => console.error('[mydict] popup init', e))
