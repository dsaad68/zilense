/* SavedView.jsx — the Saved/flashcards deck, ported from panel.jsx. The deck can
   be filtered by familiarity (New / Learning / Known) — orthogonal to the ★ that
   put a word here — and each row carries a colored state dot. */
import React, { useState } from 'react'
import { lookup } from '../../lib/dict.js'
import { getFamiliarity } from '../../lib/storage.js'
import { Svg } from './icons.jsx'
import { ToneText } from './atoms.jsx'
import { FamDot, FamFilter } from './familiarity.jsx'

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
