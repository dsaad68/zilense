/* SavedView.jsx — the Saved/flashcards deck, ported from panel.jsx. The deck can
   be filtered by familiarity (New / Learning / Known) — orthogonal to the ★ that
   put a word here — and each row carries a colored state dot. */
import React, { useState } from 'react'
import { lookup } from '../../lib/dict.js'
import { toAnkiTsv } from '../../lib/anki.js'
import { getFamiliarity } from '../../lib/storage.js'
import { Svg } from './icons.jsx'
import { ToneText } from './atoms.jsx'
import { FamDot, FamFilter } from './familiarity.jsx'

// Build { w, p, m } cards from the saved words (looked up in the dictionary) and
// download them as an Anki-importable tab-separated .txt. Same card shape and
// formatter the flashcards page uses, so both exports match.
function exportSavedToAnki(saved) {
  const cards = saved.map((q) => {
    const e = lookup(q)
    return { w: q, p: e ? e.pinyin : '', m: e ? (e.defs || []).slice(0, 2).join('; ') : '' }
  })
  const blob = new Blob([toAnkiTsv(cards)], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `zilense-anki-${new Date().toISOString().slice(0, 10)}.txt`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function openFlashcards() {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/flashcards/index.html') })
  }
}

export function SavedView({ saved, familiarity = {}, showFamiliarity = true, onNavigate, onToggleSave }) {
  const [filter, setFilter] = useState('all')

  if (!saved.length) {
    return (
      <div className="empty">
        <div className="empty-mark empty-mark-icon">{Svg.starFill}</div>
        <div className="empty-title">No saved words yet</div>
        <div className="empty-sub">Tap the star on any entry to build your review deck.</div>
      </div>
    )
  }

  // pair each saved word with its familiarity state, for counts + filtering
  const rows = saved.map((q) => ({ q, fam: getFamiliarity(familiarity, q) }))
  const counts = { new: 0, learning: 0, known: 0 }
  for (const r of rows) counts[r.fam.state]++
  const active = showFamiliarity ? filter : 'all'
  const shown = active === 'all' ? rows : rows.filter((r) => r.fam.state === active)

  return (
    <div className="saved-view">
      <div className="saved-count">
        <span>{saved.length} word{saved.length > 1 ? 's' : ''} in deck</span>
        <span className="saved-tools">
          <button className="hist-clear" onClick={openFlashcards} title="Open the flashcards page in a new tab">Study</button>
          <button className="hist-clear" onClick={() => exportSavedToAnki(saved)} title="Download these words as an Anki-importable file">Export</button>
        </span>
      </div>
      {showFamiliarity && <FamFilter value={filter} counts={counts} onChange={setFilter} />}
      {shown.length === 0 ? (
        <div className="fam-empty">No {filter} words in your deck.</div>
      ) : (
        <div className="saved-list">
          {shown.map(({ q, fam }) => {
            const e = lookup(q)
            if (!e) return null
            return (
              <div className="flash" key={q}>
                <button className="flash-main" onClick={() => onNavigate(q)}>
                  <span className="f-hanzi" lang="zh">{q}</span>
                  <span className="f-body">
                    <ToneText pinyin={e.pinyin} size={14} />
                    <span className="f-gloss">{showFamiliarity && <FamDot state={fam.state} />} {e.defs[0]}</span>
                  </span>
                </button>
                <button className="f-remove" title="Remove" onClick={() => onToggleSave(q)}>{Svg.starFill}</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
