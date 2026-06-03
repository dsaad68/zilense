/* yt-hook.js — a tiny helper that runs in YouTube's OWN page context (MAIN world,
   declared in the manifest). The subtitle engine runs in the isolated content-script
   world, where it cannot read YouTube's player object or see the page's network
   calls. This hook bridges exactly two things and nothing else:

     1. captures the URL of the player's own `/api/timedtext` requests (a known-good,
        signed base URL that stays valid across SPA navigations), and
     2. on request, reads the current caption track list + translation targets from
        the player and hands them back.

   It communicates only through CustomEvents on `document`, with JSON-string details
   so the data crosses the world boundary cleanly. No network requests of its own, no
   page globals leaked. The actual fetching of caption tracks happens back in the
   content script, same-origin on youtube.com (no host permission, no MAIN-world
   fetch). This is the EasySubs XHR-hook technique, kept minimal. */
(function () {
  if (window.__zilenseYtHook) return
  window.__zilenseYtHook = true

  const EV_REQ = 'zilense-subs-yt-req' // content script -> here: "give me the tracks"
  const EV_TRACKS = 'zilense-subs-yt-tracks' // here -> content script: the track list
  const EV_TT = 'zilense-subs-yt-timedtext' // here -> content script: a captured URL

  let lastTimedText = ''

  // Notice the player's timedtext requests so we always have a fresh, signed base
  // URL to derive from — robust across SPA navigations where ytInitialPlayerResponse
  // is stale. We only READ the URL; the request itself is the player's own.
  try {
    const open = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        if (typeof url === 'string' && url.indexOf('/api/timedtext') !== -1) {
          lastTimedText = url
          document.dispatchEvent(new CustomEvent(EV_TT, { detail: url }))
        }
      } catch (e) {}
      return open.apply(this, arguments)
    }
  } catch (e) {}

  function trackName(t) {
    if (t.name && t.name.simpleText) return t.name.simpleText
    if (t.name && t.name.runs) return t.name.runs.map((r) => r.text).join('')
    return t.languageCode || ''
  }

  function readTracks() {
    let pr = null
    try {
      const mp = document.getElementById('movie_player')
      if (mp && typeof mp.getPlayerResponse === 'function') pr = mp.getPlayerResponse()
    } catch (e) {}
    if (!pr) { try { pr = window.ytInitialPlayerResponse } catch (e) {} }
    const r = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer
    const raw = (r && r.captionTracks) || []
    const tracks = raw.map((t) => ({
      lang: t.languageCode || '',
      name: trackName(t),
      kind: t.kind === 'asr' ? 'asr' : '', // ASR = YouTube's machine speech-to-text
      baseUrl: t.baseUrl || '',
      translatable: !!t.isTranslatable,
    }))
    // languages the player can MACHINE-translate any translatable track into
    const targets = ((r && r.translationLanguages) || []).map((l) => ({
      lang: l.languageCode || '',
      name: (l.languageName && (l.languageName.simpleText ||
        (l.languageName.runs && l.languageName.runs.map((x) => x.text).join('')))) || l.languageCode || '',
    }))
    return { tracks, targets, timedtext: lastTimedText }
  }

  document.addEventListener(EV_REQ, function () {
    try {
      document.dispatchEvent(new CustomEvent(EV_TRACKS, { detail: JSON.stringify(readTracks()) }))
    } catch (e) {}
  })
})()
