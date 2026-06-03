/* SavedView.jsx — the Saved/flashcards deck, ported from panel.jsx. */
import React from 'react'
import { lookup } from '../../lib/dict.js'
import { toAnkiTsv } from '../../lib/anki.js'
import { Svg } from './icons.jsx'
import { ToneText } from './atoms.jsx'

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

export function SavedView({ saved, onNavigate, onToggleSave }) {
  if (!saved.length) {
    return (
      <div className="empty">
        <div className="empty-mark empty-mark-icon">{Svg.starFill}</div>
        <div className="empty-title">No saved words yet</div>
        <div className="empty-sub">Tap the star on any entry to build your review deck.</div>
      </div>
    )
  }
  return (
    <div className="saved-list">
      <div className="saved-count">
        <span>{saved.length} word{saved.length > 1 ? 's' : ''} in deck</span>
        <span className="saved-tools">
          <button className="hist-clear" onClick={openFlashcards} title="Open the flashcards page in a new tab">Study ↗</button>
          <button className="hist-clear" onClick={() => exportSavedToAnki(saved)} title="Download these words as an Anki-importable file">Export to Anki</button>
        </span>
      </div>
      {saved.map((q) => {
        const e = lookup(q)
        if (!e) return null
        return (
          <div className="flash" key={q}>
            <button className="flash-main" onClick={() => onNavigate(q)}>
              <span className="f-hanzi" lang="zh">{q}</span>
              <span className="f-body">
                <ToneText pinyin={e.pinyin} size={14} />
                <span className="f-gloss">{e.defs[0]}</span>
              </span>
            </button>
            <button className="f-remove" title="Remove" onClick={() => onToggleSave(q)}>{Svg.starFill}</button>
          </div>
        )
      })}
    </div>
  )
}
