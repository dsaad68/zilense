/* StrokeOrder.jsx — animated stroke order via hanzi-writer. Ported from
   panel.jsx; the library is bundled, per-character stroke data is fetched on
   demand from the jsdelivr CDN (only when this section is expanded). */
import React, { useState, useEffect, useRef } from 'react'
import HanziWriter from 'hanzi-writer'
import { Svg } from './icons.jsx'

export function StrokeOrder({ char, dark }) {
  const ref = useRef(null)
  const writerRef = useRef(null)
  const [status, setStatus] = useState('loading') // loading | ok | error

  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = ''
    writerRef.current = null
    setStatus('loading')
    let cancelled = false
    const w = HanziWriter.create(ref.current, char, {
      width: 150, height: 150, padding: 6,
      strokeColor: dark ? '#e9ddc9' : '#2a2520',
      radicalColor: '#c8443a',
      outlineColor: dark ? '#4a443b' : '#d9cdb8',
      showOutline: true,
      strokeAnimationSpeed: 1, delayBetweenStrokes: 220,
      charDataLoader: (c, onComplete) => {
        fetch('https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/' + encodeURIComponent(c) + '.json')
          .then((r) => { if (!r.ok) throw new Error('nf'); return r.json() })
          .then((d) => { if (!cancelled) { setStatus('ok'); onComplete(d) } })
          .catch(() => { if (!cancelled) setStatus('error') })
      },
    })
    writerRef.current = w
    const t = setTimeout(() => { if (!cancelled) w.animateCharacter() }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [char, dark])

  return (
    <div className="stroke-wrap">
      <div className="stroke-box">
        <div className="stroke-grid">
          <span /><span /><span className="d1" /><span className="d2" />
        </div>
        <div ref={ref} className="stroke-svg" />
        {status === 'loading' && <div className="stroke-msg">loading strokes…</div>}
        {status === 'error' && <div className="stroke-msg ghost" lang="zh">{char}<small>stroke data unavailable</small></div>}
      </div>
      <button className="ghostbtn sm" disabled={status !== 'ok'}
        onClick={() => writerRef.current && writerRef.current.animateCharacter()}>
        {Svg.replay} Replay
      </button>
    </div>
  )
}
