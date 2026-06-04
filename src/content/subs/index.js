/* index.js — the subtitle feature's entry point, statically imported by content.js
   and therefore parsed in EVERY page and frame the content script runs in. So it
   does as little as possible: a hostname regex, and on anything that isn't a
   supported video host it returns immediately. Only on a supported host does it
   read the mydict.subs setting and, when the feature is ON (and the site isn't in
   the user's "disable on this site" list), dynamically import the heavier engine —
   keeping the observer/overlay/adapters out of the all-frames bundle, the same way
   content.js defers Readability.

   The feature is OFF by default and toggled live from the toolbar popup; a
   storage listener starts/stops the engine without a reload. */

// cheap pre-filter (the authoritative per-platform list lives in platforms.js,
// loaded only inside the engine chunk). Keep these two in sync.
const SUPPORTED_HOST = /(^|\.)(youtube(-nocookie)?\.com|coursera\.org)$/i
const SUBS_KEY = 'mydict.subs'
const DISABLED_KEY = 'mydict.disabledSites'

const DEFAULTS = { enabled: false, pinyin: true, tones: true, dual: true, lang1: '', lang2: '', allowAsr: false, allowAutoTranslation: false }

let engine = null
let importing = null
let prefs = { ...DEFAULTS }
let disabledHere = false

const shouldRun = () => prefs.enabled && !disabledHere

async function activate() {
  if (!importing) importing = import('./engine.js').catch((e) => { importing = null; throw e })
  const mod = await importing
  if (!shouldRun()) return // toggled off again while the chunk loaded
  if (!engine) engine = mod.attach()
  if (engine) engine.start(prefs)
}

function deactivate() {
  if (engine) engine.stop()
}

function applyPrefs(next) {
  const was = shouldRun()
  prefs = { ...DEFAULTS, ...(next || {}) }
  const now = shouldRun()
  if (now && !was) activate()
  else if (!now && was) deactivate()
  else if (now && engine) engine.setPrefs(prefs)
}

function applyDisabled(list) {
  const was = shouldRun()
  disabledHere = Array.isArray(list) && list.includes(location.hostname)
  const now = shouldRun()
  if (now && !was) activate()
  else if (!now && was) deactivate()
}

export function initSubs() {
  if (!SUPPORTED_HOST.test(location.hostname)) return // not a video host — do nothing
  try {
    chrome.storage?.local.get([SUBS_KEY, DISABLED_KEY], (got) => {
      if (chrome.runtime.lastError) return
      disabledHere = Array.isArray(got && got[DISABLED_KEY]) && got[DISABLED_KEY].includes(location.hostname)
      prefs = { ...DEFAULTS, ...((got && got[SUBS_KEY]) || {}) }
      if (shouldRun()) activate()
    })
    chrome.storage?.onChanged.addListener((changes, area) => {
      if (area !== 'local') return
      if (changes[SUBS_KEY]) applyPrefs(changes[SUBS_KEY].newValue)
      if (changes[DISABLED_KEY]) applyDisabled(changes[DISABLED_KEY].newValue)
    })
  } catch (e) { /* no chrome.storage here — feature simply stays off */ }
}
