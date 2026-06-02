/* examples.js — fetch example sentences from Tatoeba (https://tatoeba.org),
   a free, crowd-sourced sentence database (CC-BY). Each result carries the
   Mandarin sentence, a `Latn` transcription (numbered pinyin), and human
   translations; we surface zh + tone-marked pinyin + English.

   Fetched on demand (only when the Examples section is expanded) and cached per
   word, so hovering never triggers requests. The manifest grants host permission
   for tatoeba.org, so this cross-origin fetch needs no CORS cooperation. */

import { romanizeToDiacritics } from './pinyin.js'

const cache = new Map() // word -> [{ zh, py, en }]

export async function fetchExamples(word, limit = 5) {
  if (!word) return []
  if (cache.has(word)) return cache.get(word)

  const url =
    'https://tatoeba.org/en/api_v0/search?from=cmn&to=eng&sort=relevance&query=' +
    encodeURIComponent(word)

  const res = await fetch(url)
  if (!res.ok) throw new Error('Tatoeba HTTP ' + res.status)
  const json = await res.json()

  const out = []
  for (const r of json.results || []) {
    if (!r || !r.text) continue
    const en = (r.translations || []).flat().find((t) => t && t.lang === 'eng' && t.text)
    if (!en) continue // only show sentences that have an English translation
    const latn = (r.transcriptions || []).find((t) => t && t.script === 'Latn' && t.text)
    out.push({
      zh: r.text,
      py: latn ? romanizeToDiacritics(latn.text) : '',
      en: en.text,
    })
    if (out.length >= limit) break
  }

  cache.set(word, out)
  return out
}

// link to the full Tatoeba result list for a word
export function tatoebaUrl(word) {
  return (
    'https://tatoeba.org/en/sentences/search?from=cmn&to=eng&query=' +
    encodeURIComponent(word)
  )
}
