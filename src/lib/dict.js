/* dict.js — thin runtime wrapper around dict-core. Fetches the bundled
   CC-CEDICT index once (Vite emits it as an asset via the ?url import), then
   delegates all logic to the pure functions in dict-core.js. Keeping the logic
   in dict-core lets it be unit-tested in plain Node (it has no ?url import). */

import cedictUrl from '../data/cedict.json?url'
import * as core from './dict-core.js'

let DB = null
let INDEX = null // search indexes, built once after the dictionary loads
let loadPromise = null

export function loadDict() {
  if (DB) return Promise.resolve(DB)
  if (!loadPromise) {
    loadPromise = fetch(cedictUrl)
      .then((r) => {
        if (!r.ok) throw new Error('cedict.json HTTP ' + r.status)
        return r.json()
      })
      .then((d) => {
        DB = d
        INDEX = core.buildIndex(d) // one-time, off the per-keystroke path
        return d
      })
      .catch((err) => {
        loadPromise = null // allow a retry to re-attempt the fetch
        throw err
      })
  }
  return loadPromise
}

export function isReady() {
  return !!DB
}

export function lookup(q) {
  return DB ? core.lookup(DB, q) : null
}

export function segmentLongest(text, maxLen) {
  return DB ? core.segmentLongest(DB, text, maxLen) : null
}

export function searchEntries(query, limit) {
  return DB ? core.searchEntries(DB, INDEX, query, limit) : []
}

export function wordsContainingChar(char, opts) {
  return DB ? core.wordsContainingChar(DB, INDEX, char, opts) : []
}

export function hskWordsAtBand(band) {
  return DB ? core.hskWordsAtBand(DB, band) : []
}

export function compMeaning(c) {
  return DB ? core.compMeaning(DB, c) : ''
}
