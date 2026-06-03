/* HistoryView.jsx — recent deliberate lookups (newest first), each re-opens the
   entry; a Clear button empties the list. Mirrors SavedView's structure. */
import React from 'react'
import { lookup } from '../../lib/dict.js'
import { Svg } from './icons.jsx'
import { ToneText } from './atoms.jsx'

export function HistoryView({ history, onNavigate, onClear }) {
  if (!history.length) {
    return (
      <div className="empty">
        <div className="empty-mark empty-mark-icon">{Svg.clock}</div>
        <div className="empty-title">No recent lookups</div>
        <div className="empty-sub">Words you select or open appear here for quick re-opening.</div>
      </div>
    )
  }
  return (
    <div className="saved-list">
      <div className="saved-count">
        {history.length} recent
        <button className="hist-clear" onClick={onClear}>Clear history</button>
      </div>
      {history.map(({ q }) => {
        const e = lookup(q)
        return (
          <div className="flash" key={q}>
            <button className="flash-main" onClick={() => onNavigate(q)}>
              <span className="f-hanzi" lang="zh">{q}</span>
              <span className="f-body">
                {e ? (
                  <>
                    <ToneText pinyin={e.pinyin} size={14} />
                    <span className="f-gloss">{e.defs[0]}</span>
                  </>
                ) : (
                  <span className="f-gloss">{q}</span>
                )}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
