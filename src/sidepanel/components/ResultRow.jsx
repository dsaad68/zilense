/* ResultRow.jsx — one search-result row, ported from panel.jsx.
   `e` is a preview { q, pinyin, defs[] } from dict.searchEntries. */
import React from 'react'
import { Svg } from './icons.jsx'
import { ToneText } from './atoms.jsx'

export function ResultRow({ e, onNavigate, isSaved }) {
  return (
    <button className="result" onClick={() => onNavigate(e.q)}>
      <span className="r-hanzi" lang="zh">{e.q}</span>
      <span className="r-body">
        <span className="r-top">
          <ToneText pinyin={e.pinyin} size={14} />
          {isSaved && <span className="r-star">{Svg.starFill}</span>}
        </span>
        <span className="r-gloss">{e.defs.slice(0, 2).join('; ')}</span>
      </span>
      {e.hsk && <span className="r-hsk">HSK{e.hsk}</span>}
    </button>
  )
}
