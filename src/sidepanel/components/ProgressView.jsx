/* ProgressView.jsx — the Progress tab. Lists every word the user has actually
   encountered (the mydict.familiarity map records a word the first time it's
   hovered / looked up), grouped by how well they know it. Filter pills narrow to
   New / Learning / Known; rows are sorted most-recently-seen first and navigate
   to the entry on click. Reuses the .saved-list / .flash row look. */
import React, { useState } from 'react'
import { lookup } from '../../lib/dict.js'
import { getFamiliarity } from '../../lib/storage.js'
import { ToneText } from './atoms.jsx'
import { FamDot, FamFilter } from './familiarity.jsx'

export function ProgressView({ familiarity, onNavigate }) {
  const [filter, setFilter] = useState('all')

  // resolve every tracked word to an entry (skip any that no longer resolve),
  // newest-seen first
  const words = Object.keys(familiarity || {})
    .map((q) => ({ q, fam: getFamiliarity(familiarity, q), e: lookup(q) }))
    .filter((w) => w.e)
    .sort((a, b) => b.fam.lastSeen - a.fam.lastSeen)

  const counts = { new: 0, learning: 0, known: 0 }
  for (const w of words) counts[w.fam.state]++

  if (!words.length) {
    return (
      <div className="empty">
        <div className="empty-mark" lang="zh">译</div>
        <div className="empty-title">No words tracked yet</div>
        <div className="empty-sub">Hover or look up words as you read — they’ll collect here, grouped by how well you know them.</div>
      </div>
    )
  }

  const shown = filter === 'all' ? words : words.filter((w) => w.fam.state === filter)

  return (
    <div className="progress-view">
      <FamFilter value={filter} counts={counts} onChange={setFilter} />
      {shown.length === 0 ? (
        <div className="fam-empty">No {filter} words yet.</div>
      ) : (
        <div className="saved-list">
          {shown.map(({ q, fam, e }) => (
            <div className="flash" key={q}>
              <button className="flash-main" onClick={() => onNavigate(q)}>
                <span className="f-hanzi" lang="zh">{q}</span>
                <span className="f-body">
                  <ToneText pinyin={e.pinyin} size={14} />
                  <span className="f-gloss"><FamDot state={fam.state} /> {e.defs[0]}</span>
                </span>
                {fam.seen > 0 && <span className="f-seen">seen {fam.seen}×</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
