import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

/* The engine's Phase 2 upgrade must be all-or-nothing: the dual view shows TWO
   synced lines, so it may switch off the native captions only when BOTH chosen
   tracks actually yield cues. If one track's fetch fails, entering "dual" would hide
   the real captions behind a single visible line — so the engine must stay in Phase 1
   scrape mode. These tests drive the real engine against a fake adapter + stubbed
   fetch / track hook on a youtube.com origin and assert that contrast.

   We register happy-dom with a youtube.com URL so the engine's same-origin guard and
   canFetch() host check pass, then import the engine AFTER the globals exist. */
before(() => GlobalRegistrator.register({ url: 'https://www.youtube.com/watch?v=vid1' }))
after(() => GlobalRegistrator.unregister())

const { createEngine } = await import('../src/content/subs/engine.js')

const EV_REQ = 'zilense-subs-yt-req'
const EV_TRACKS = 'zilense-subs-yt-tracks'

const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms))
function closedRoot(host) {
  const sym = Object.getOwnPropertySymbols(host).find((s) => s.toString() === 'Symbol(shadowRoot)')
  return host[sym]
}

// a minimal json3 payload with a single cue active at t=0.5s
const J3 = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '你好' }] }] })

let player, captionRoot, adapter, onReq, restore

beforeEach(() => {
  // fake YouTube player DOM the adapter points at
  player = document.createElement('div')
  captionRoot = document.createElement('div')
  player.appendChild(captionRoot)
  document.body.appendChild(player)

  adapter = {
    id: 'youtube',
    supportsDual: true,
    getPlayer: () => player,
    getVideo: () => ({ currentTime: 0.5 }), // plain stand-in; engine only reads currentTime
    getCaptionRoot: () => captionRoot,
    readActiveText: (r) => (r ? r.textContent : ''),
    nativeHideSelector: '.ytp-caption-window-container',
    getVideoId: () => 'vid1',
  }

  // the MAIN-world hook stand-in: answer a track-list request with two real tracks
  onReq = () => {
    const detail = JSON.stringify({
      tracks: [
        { lang: 'zh-Hans', name: 'Chinese', baseUrl: '/api/timedtext?v=vid1&lang=zh-Hans', translatable: true },
        { lang: 'en', name: 'English', baseUrl: '/api/timedtext?v=vid1&lang=en', translatable: true },
      ],
      targets: [],
      timedtext: '',
    })
    document.dispatchEvent(new CustomEvent(EV_TRACKS, { detail }))
  }
  document.addEventListener(EV_REQ, onReq)

  // deterministic rAF so the engine's sync/scrape scheduling runs under the test
  const raf = globalThis.requestAnimationFrame
  const caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 5)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  restore = () => { globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = caf }

  // worker bridge: segment echoes the text as one word; everything else is a no-op
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (msg, cb) => {
        if (msg && msg.type === 'segment') cb({ paras: [[{ t: msg.paras[0], kind: 'word', py: '' }]] })
        else if (cb) cb(null)
      },
    },
  }
})

afterEach(() => {
  document.removeEventListener(EV_REQ, onReq)
  restore()
  delete globalThis.chrome
  delete globalThis.fetch
  player.remove()
})

const PREFS = { enabled: true, pinyin: true, tones: true, dual: true, lang1: '', lang2: '', allowAsr: false, allowAutoTranslation: false }

test('both track fetches succeed -> engine enters the dual view', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => JSON.parse(J3) })
  const engine = createEngine(adapter)
  engine.start({ ...PREFS })
  await flush()

  const host = player.querySelector('#' + 'mydict-subs-host')
  assert.ok(host, 'overlay mounted into the player')
  const root = closedRoot(host)
  // entering dual is what reveals the language picker (renderControls -> setControls)
  assert.equal(root.querySelector('.ctrl').style.display, 'flex', 'dual view is active (picker shown)')
  // and the cue clock paints the Chinese line from the fetched track (ruby columns
  // interleave pinyin placeholders, so normalize whitespace before matching)
  const painted = root.querySelector('.line.l1').textContent.replace(/\s/g, '')
  assert.match(painted, /你好/, 'cue text is rendered from the fetched track')
  engine.stop()
})

test('one track fetch fails -> engine stays in scrape mode (no dual)', async () => {
  // zh-Hans returns cues; en fails. Phase 2 needs both, so the engine must not upgrade.
  globalThis.fetch = async (url) => {
    if (String(url).includes('lang=zh-Hans')) return { ok: true, json: async () => JSON.parse(J3) }
    return { ok: false, json: async () => ({}) } // the second track's fetch fails
  }
  const engine = createEngine(adapter)
  engine.start({ ...PREFS })
  await flush()

  const host = player.querySelector('#' + 'mydict-subs-host')
  const root = closedRoot(host)
  assert.notEqual(root.querySelector('.ctrl').style.display, 'flex', 'dual view did NOT activate')
  const painted = root.querySelector('.line.l1').textContent.replace(/\s/g, '')
  assert.doesNotMatch(painted, /你好/, 'no cue text painted (still scraping)')
  engine.stop()
})

test('a chosen second language falls back to English when the video lacks it', async () => {
  // the tracks are zh-Hans + en; the user has globally picked Spanish for line 2.
  // A chosen lang2 is a preference, so the bottom line falls back to the
  // English-preferred default and the dual view still activates.
  globalThis.fetch = async () => ({ ok: true, json: async () => JSON.parse(J3) })
  const engine = createEngine(adapter)
  engine.start({ ...PREFS, lang2: 'es' })
  await flush()

  const root = closedRoot(player.querySelector('#' + 'mydict-subs-host'))
  assert.equal(root.querySelector('.ctrl').style.display, 'flex',
    'dual still activates (lang2 fell back to the available English track)')
  engine.stop()
})
