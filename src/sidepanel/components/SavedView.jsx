/* SavedView.jsx — the Saved/flashcards deck, ported from panel.jsx. */
import React from 'react'
import { lookup } from '../../lib/dict.js'
import { Svg } from './icons.jsx'
import { ToneText } from './atoms.jsx'

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
      <div className="saved-count">{saved.length} word{saved.length > 1 ? 's' : ''} in deck</div>
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
