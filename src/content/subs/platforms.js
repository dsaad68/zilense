/* platforms.js — per-platform adapters for the subtitle overlay. Each adapter is a
   small bag of selectors + readers so the engine stays platform-agnostic and new
   sites are a matter of adding one entry here. Loaded on demand by engine.js (only
   on a supported video page), never by the all-frames content bundle.

   Phase 1 needs, per adapter:
     id                  short name (logging / dedupe)
     getPlayer()         the element to mount the overlay into AND that goes
                         fullscreen (so the overlay survives fullscreen as its child)
     getVideo()          the <video>, for the Phase 2 clock
     getCaptionRoot()    the native caption container to observe + scrape
     readActiveText(el)  the line currently shown inside that container
     nativeHideSelector  CSS selector whose ink we suppress while we stand in
     supportsDual        whether engine may try the two-real-tracks path (Phase 2)

   YouTube additionally carries the Phase 2 track wiring (getVideoId / track
   discovery is event-based via the MAIN-world hook, handled in engine.js). */

const youtube = {
  id: 'youtube',
  supportsDual: true,
  getPlayer() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player')
  },
  getVideo() {
    const p = this.getPlayer()
    return (p && p.querySelector('video')) || document.querySelector('video.html5-main-video') || document.querySelector('video')
  },
  getCaptionRoot() {
    const p = this.getPlayer()
    return (p && p.querySelector('.ytp-caption-window-container')) ||
      document.querySelector('.ytp-caption-window-container')
  },
  readActiveText(root) {
    if (!root) return ''
    const segs = root.querySelectorAll('.ytp-caption-segment')
    if (segs.length) return Array.from(segs).map((s) => s.textContent).join('')
    return root.textContent || ''
  },
  nativeHideSelector: '.ytp-caption-window-container',
  getVideoId() {
    try { return new URL(location.href).searchParams.get('v') || '' } catch (e) { return '' }
  },
}

const coursera = {
  id: 'coursera',
  supportsDual: false, // Phase 1 (scrape the shown track) only
  getPlayer() {
    return document.querySelector('.video-js') || document.querySelector('.rc-VideoMVPControlsView') ||
      document.querySelector('video')?.parentElement || null
  },
  getVideo() { return document.querySelector('video') },
  getCaptionRoot() {
    return document.querySelector('.vjs-text-track-display') || document.querySelector('.rc-Caption')
  },
  readActiveText(root) {
    if (!root) return ''
    const cues = root.querySelectorAll('.vjs-text-track-cue, .vjs-text-track-cue > div')
    if (cues.length) return Array.from(cues).map((c) => c.textContent).join(' ')
    return root.textContent || ''
  },
  nativeHideSelector: '.vjs-text-track-display',
}

const ADAPTERS = [
  { test: /(^|\.)youtube(-nocookie)?\.com$/i, adapter: youtube },
  { test: /(^|\.)coursera\.org$/i, adapter: coursera },
]

// the adapter for the current host, or null. host defaults to this frame's host.
export function detectPlatform(host = location.hostname) {
  const hit = ADAPTERS.find((a) => a.test.test(host))
  return hit ? hit.adapter : null
}
