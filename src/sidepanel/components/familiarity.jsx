/* familiarity.jsx — shared bits for the New / Learning / Known familiarity axis:
   a colored status dot and the filter-pill row, reused by the Progress tab and
   the Saved deck. The per-state colors live in panel.css (--fam-* vars) so both
   themes stay in one place. Labels mirror EntryView's FAM_OPTIONS. */
import React from 'react'

export const FAM_ORDER = ['new', 'learning', 'known']
export const FAM_LABEL = { new: 'New', learning: 'Learning', known: 'Known' }

// a small color-coded dot marking a word's state (grey / amber / green)
export function FamDot({ state }) {
  return <span className={'fam-dot fam-dot-' + state} aria-hidden="true" />
}

/* All / New / Learning / Known filter pills with live counts. `value` is the
   active filter ('all' | state); `counts` is { new, learning, known }. */
export function FamFilter({ value, counts, onChange }) {
  const total = counts.new + counts.learning + counts.known
  return (
    <div className="fam-filter" role="group" aria-label="Filter by familiarity">
      <button className={'fam-pill' + (value === 'all' ? ' on' : '')}
        aria-pressed={value === 'all'} onClick={() => onChange('all')}>
        All <span className="fam-pill-n">{total}</span>
      </button>
      {FAM_ORDER.map((s) => (
        <button key={s} className={'fam-pill fam-pill-' + s + (value === s ? ' on' : '')}
          aria-pressed={value === s} onClick={() => onChange(s)}>
          <FamDot state={s} /> {FAM_LABEL[s]} <span className="fam-pill-n">{counts[s]}</span>
        </button>
      ))}
    </div>
  )
}
