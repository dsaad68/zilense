/* popup.js — the toolbar action menu:
     • Pause             -> pauses the on-page lookup everywhere (settings.enabled)
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
  loadSubsPrefs,
  saveSubsPrefs,
} from '../lib/storage.js'
import { detectPlatform } from '../content/subs/platforms.js'

const $ = (id) => document.getElementById(id)

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

  // Pause switch — pauses the on-page lookup (hover / click-to-pin / selection)
  // everywhere. The switch shows the PAUSED state (on = paused) and writes
  // settings.enabled (paused === enabled:false); the content script reads it live via
  // chrome.storage.onChanged and goes inert while paused. The side panel, flashcards,
  // and the other explicit actions below keep working.
  const masterBtn = $('master-toggle')
  let paused = settings.enabled === false
  setSwitch(masterBtn, paused)
  masterBtn.addEventListener('click', () => {
    paused = !paused
    setSwitch(masterBtn, paused)
    saveSettingsPatch({ enabled: !paused })
  })

  // Open side panel — must call open() synchronously inside this click handler
  // so the user activation carries through (don't await before it).
  $('open-panel').addEventListener('click', () => {
    if (tab && tab.id != null) {
      chrome.sidePanel.open({ tabId: tab.id }).catch((e) => console.error('[mydict] sidePanel.open', e))
    }
    window.close()
  })

  // Open in window — the dictionary in a chromeless popup window that floats free
  // of the tab strip and stays put across tab switches. The actual open lives in
  // the service worker (openDictWindow): it owns the single-instance logic so the
  // toolbar menu and the keyboard shortcut share one implementation. We just send
  // the message; the worker focuses an existing window or creates a fresh one.
  $('open-window').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-window' }, () => void chrome.runtime.lastError)
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

  // Pinyin tone colors — one switch for "color pinyin by tone" everywhere. It drives
  // BOTH the global setting (settings.toneColors: side panel + Reader) and the
  // on-video subtitle overlay (mydict.subs.tones), which is otherwise the only
  // tone-colored surface with no toggle of its own. The subtitle overlay re-renders
  // live via storage.onChanged; the panel / Reader reflect it on their next render.
  const toneBtn = $('tone-colors')
  let toneColors = settings.toneColors !== false
  setSwitch(toneBtn, toneColors)
  toneBtn.addEventListener('click', () => {
    toneColors = !toneColors
    setSwitch(toneBtn, toneColors)
    saveSettingsPatch({ toneColors })
    saveSubsPrefs({ tones: toneColors })
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

  // Subtitles (pinyin + lookup) — the on-video overlay. The whole section is shown
  // ONLY on a supported video site (YouTube / Coursera), since that is the only
  // place the feature does anything; detectPlatform is the same host check the
  // content script uses. Master toggle plus two sub-toggles (dual subtitles,
  // pinyin), persisted under mydict.subs (read live by the content script). The
  // sub-rows dim when the feature is off, mirroring the reader's dependent rows.
  if (host && detectPlatform(host)) {
  $('subs-section').hidden = false
  const subs = await loadSubsPrefs()
  const subsBtn = $('subs-toggle')
  const subsDualBtn = $('subs-dual')
  const subsPyBtn = $('subs-pinyin')
  const subsLang2 = $('subs-lang2')
  const subRows = [$('subs-dual-row'), $('subs-lang2-row'), $('subs-pinyin-row')]
  let subsOn = !!subs.enabled
  let subsDual = subs.dual !== false
  let subsPinyin = subs.pinyin !== false
  // the chosen bottom-line language; empty = English-preferred default. Only known
  // options are reflected, so an unfamiliar stored code falls back to the default.
  subsLang2.value = [...subsLang2.options].some((o) => o.value === (subs.lang2 || '')) ? (subs.lang2 || '') : ''
  const reflectSubs = () => {
    setSwitch(subsBtn, subsOn)
    setSwitch(subsDualBtn, subsDual)
    setSwitch(subsPyBtn, subsPinyin)
    for (const row of subRows) {
      row.style.opacity = subsOn ? '1' : '.4'
      row.style.pointerEvents = subsOn ? 'auto' : 'none'
    }
  }
  reflectSubs()
  subsBtn.addEventListener('click', () => {
    subsOn = !subsOn
    reflectSubs()
    saveSubsPrefs({ enabled: subsOn })
  })
  // Dual subtitles — show two tracks at once (Chinese on top, a second language
  // below) when the video has them; off falls back to the single shown track.
  subsDualBtn.addEventListener('click', () => {
    subsDual = !subsDual
    setSwitch(subsDualBtn, subsDual)
    saveSubsPrefs({ dual: subsDual })
  })
  // Second (bottom-line) language for the dual view. Empty = English-preferred; a
  // chosen language is a preference that gracefully falls back when a video lacks it.
  subsLang2.addEventListener('change', () => saveSubsPrefs({ lang2: subsLang2.value }))
  subsPyBtn.addEventListener('click', () => {
    subsPinyin = !subsPinyin
    setSwitch(subsPyBtn, subsPinyin)
    saveSubsPrefs({ pinyin: subsPinyin })
  })
  } // end supported-video-site gate

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
