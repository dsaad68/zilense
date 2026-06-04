/* subs-core.js — pure helpers for the on-video subtitle overlay. No DOM and no
   browser/bundler imports beyond pinyin tone detection, so it runs in plain Node
   and is unit-tested. The overlay (overlay.js) and the YouTube track engine
   (engine.js) import these; the heavy DOM/observer work stays out of here. */

import { syllableTone } from '../../lib/pinyin.js'

/* tokensToRuby(tokens) — turn the worker's segmented tokens ([{t,kind,py}], the
   same shape the reader gets back from the `segment` message) into a DOM-agnostic
   ruby render model the overlay can paint without re-deriving tones:

     word/char -> { kind, word, chars: [{ c, py, tone }] }   tone 0 = no pinyin
     punct     -> { kind:'punct', text }                     (latin, spaces, 。!?)

   Mixed Chinese/Latin lines fall out naturally: Han runs become word/char tokens
   with per-character pinyin, every other code point is a punct token rendered
   plainly. Pure, so "segment + pinyin a subtitle line" is testable end to end. */
export function tokensToRuby(tokens) {
  const out = []
  for (const tk of tokens || []) {
    if (!tk || tk.t == null) continue
    if (tk.kind === 'punct') { out.push({ kind: 'punct', text: tk.t }); continue }
    const chars = [...String(tk.t)]
    const syls = tk.py ? String(tk.py).split(/\s+/) : []
    out.push({
      kind: tk.kind === 'word' ? 'word' : 'char',
      word: String(tk.t),
      chars: chars.map((c, i) => {
        const py = syls[i] || ''
        return { c, py, tone: py ? syllableTone(py) : 0 }
      }),
    })
  }
  return out
}

/* containsHan(text) — does a scraped/parsed line have any Chinese at all? Used to
   skip lines (e.g. an English-only caption) that don't need pinyin annotation. */
const HAN_RE = /\p{Script=Han}/u
export function containsHan(text) {
  return HAN_RE.test(String(text || ''))
}

/* ---- cue lists (Phase 2: two real tracks synced to the video clock) ---------

   A cue is { start, end, text } in SECONDS. Tracks come from YouTube's timedtext
   endpoint as json3 (the modern format); parseJson3 turns one track into a sorted
   cue list. cueAt picks the cue to show at the current playback time. Both pure so
   "right cue for a given time, overlaps, gaps" is unit-testable. */

// json3 shape: { events: [{ tStartMs, dDurationMs, segs:[{utf8}] }, ...] }. Events
// without segs (or whose text is only a newline) are layout/append markers — drop
// them. Times are ms in the source; we store seconds.
export function parseJson3(json) {
  const events = json && Array.isArray(json.events) ? json.events : []
  const cues = []
  for (const ev of events) {
    if (!ev || ev.tStartMs == null || !Array.isArray(ev.segs)) continue
    const text = ev.segs.map((s) => (s && s.utf8 != null ? s.utf8 : '')).join('')
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!clean) continue
    const start = ev.tStartMs / 1000
    const dur = ev.dDurationMs != null ? ev.dDurationMs / 1000 : 0
    cues.push({ start, end: start + dur, text: clean })
  }
  cues.sort((a, b) => a.start - b.start)
  return cues
}

/* cueAt(cues, time, lastIdx) — the cue active at `time` (seconds), or null in a
   gap. `cues` must be start-sorted (parseJson3 guarantees it). When cues overlap,
   the latest one that has started and not yet ended wins (the freshest line).
   `lastIdx` is an optional hint (the previous result's index) so the common case
   — playback advancing one cue at a time — costs O(1); we fall back to a scan when
   the hint misses (a seek). Returns { cue, idx } or null. */
export function cueAt(cues, time, lastIdx = -1) {
  if (!cues || !cues.length) return null
  const inCue = (i) => time >= cues[i].start && time < cues[i].end
  // fast path: still in the hinted cue, or in the next one or two (normal playback)
  for (let i = Math.max(0, lastIdx); i < cues.length && i <= lastIdx + 2; i++) {
    if (i >= 0 && inCue(i)) return pickOverlap(cues, i, time)
  }
  // binary search for the last cue whose start <= time, then walk back over any
  // still-open overlapping cues to honor "freshest started wins"
  let lo = 0, hi = cues.length - 1, cand = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= time) { cand = mid; lo = mid + 1 } else hi = mid - 1
  }
  for (let i = cand; i >= 0; i--) {
    if (time < cues[i].end) { if (inCue(i)) return pickOverlap(cues, i, time) }
    // a cue that started earlier but is much shorter can't reach `time`; keep
    // scanning back only while a longer earlier cue might still be open
    if (cues[i].start < time - LONGEST_CUE) break
  }
  return null
}

const LONGEST_CUE = 30 // s — stop scanning back past a cue that can't still be open

// among cues that contain `time`, return the one with the latest start (freshest)
function pickOverlap(cues, i, time) {
  let best = i
  for (let j = i + 1; j < cues.length && cues[j].start <= time; j++) {
    if (time < cues[j].end && cues[j].start >= cues[best].start) best = j
  }
  // also look just behind in case the hint landed on an older overlapping cue
  for (let j = i - 1; j >= 0 && cues[j].start >= time - LONGEST_CUE; j--) {
    if (time >= cues[j].start && time < cues[j].end && cues[j].start > cues[best].start) best = j
  }
  return { cue: cues[best], idx: best }
}

/* json3Url(baseUrl, tlang) — derive the json3 timedtext URL for a track from the
   signed baseUrl YouTube hands us in the player response. `&fmt=json3` asks for the
   modern JSON format; `&tlang` (optional) requests YouTube's own MACHINE
   translation into that language (opt-in only — that is the one "translation" the
   platform, not us, provides). Same-origin on youtube.com, so no host permission.
   Pure (URL math only); returns '' on a missing/invalid base. */
export function json3Url(baseUrl, tlang) {
  if (!baseUrl) return ''
  try {
    const u = new URL(baseUrl, 'https://www.youtube.com')
    u.searchParams.set('fmt', 'json3')
    if (tlang) u.searchParams.set('tlang', tlang)
    return u.toString()
  } catch (e) { return '' }
}

/* pickTracks(tracks, prefs, targets) — choose the two lines for the dual view from
   the caption list YouTube exposes. Each track: { lang, name, kind, baseUrl,
   translatable } where kind 'asr' marks YouTube's auto-SPEECH-recognition track and
   `auto` an already-machine-translated track. `targets` is the list of languages
   YouTube can MACHINE-translate a translatable track into ({ lang, name }).
   prefs: { lang1, lang2, allowAsr, allowAutoTranslation, dual }.

   Eligibility: human-authored tracks always; the two machine kinds each behind an
   opt-in (ASR -> allowAsr, machine translation -> allowAutoTranslation). BUT dual is
   a learner feature whose whole point is a second line, so turning `dual` on implies
   BOTH opt-ins — otherwise a typical video (one Chinese track, everything else
   auto) could never produce two lines.

   Rules:
     - line 1 (top, annotated): lang1 if given (real, else auto-translation), else
       the first Chinese track, else the first eligible track.
     - line 2 (bottom): the chosen second language, DEFAULTING TO ENGLISH — a real
       track in that language, else YouTube auto-translation into it, else any other
       eligible track that differs from line 1.
   A returned line may be a real track or a translation descriptor
   { lang, name, baseUrl, tlang } (tlang = the machine-translation target). Either
   line may be null. Pure: no fetching here. */
export function pickTracks(tracks, prefs = {}, targets = []) {
  const list = Array.isArray(tracks) ? tracks.filter((t) => t && t.lang) : []
  const allowAsr = !!prefs.allowAsr || !!prefs.dual
  const allowAutoTranslation = !!prefs.allowAutoTranslation || !!prefs.dual
  const eligible = (t) =>
    t.kind === 'asr' ? allowAsr : t.kind === 'auto' ? allowAutoTranslation : true
  const real = list.filter(eligible)
  const isZh = (t) => /^zh/i.test(t.lang)
  const byLang = (lang) => (lang ? real.find((t) => t.lang === lang) : null)

  // build a machine-translation descriptor for `lang`, if allowed and offered
  const tgts = Array.isArray(targets) ? targets : []
  const transBase = list.find((t) => t.translatable) || list[0] || null
  const translate = (lang) => {
    const l = lang && String(lang)
    return allowAutoTranslation && l && transBase && tgts.some((t) => t.lang === l)
      ? { lang: l, name: l, baseUrl: transBase.baseUrl, tlang: l }
      : null
  }

  const line1 =
    byLang(prefs.lang1) || translate(prefs.lang1) || real.find(isZh) || real[0] || null
  const differs = (t) => t && t !== line1 && (!line1 || t.lang !== line1.lang)

  const want = String(prefs.lang2 || 'en')
  const wantRe = new RegExp('^' + want.replace(/[^a-z0-9-]/gi, ''), 'i')
  const matches = real.filter((t) => differs(t) && wantRe.test(t.lang))
  // a human track wins over an auto-generated one in the SAME language: e.g. when a
  // video has both `en` (ASR) and `en-GB` (human), prefer `en-GB` — the ASR `en` is
  // not separately fetchable and would come back empty.
  const tr = (!line1 || line1.lang !== want) ? translate(want) : null
  const line2 =
    matches.find((t) => t.kind !== 'asr') || // a human track in the wanted language (best)
    tr ||                                     // else machine-translate into it (reliable)
    matches[0] ||                             // else an auto-generated track in that language
    real.find(differs) ||                     // else any other eligible track
    null
  return { line1, line2: line2 === line1 ? null : line2 }
}
