/* ReaderView.jsx — the reader overlay UI, ported from the Claude Design prototype
   (project/reader.jsx). The shared Chinese-text renderer (ZhText) keeps the
   prototype's hover→panel, click-to-pin, and select-to-pin behavior; tokens
   arrive PRE-SEGMENTED with pinyin from the service worker (so the reader needs no
   dictionary copy).

   The prototype relied on an always-visible docked side panel for hover meanings.
   Here the real side panel may be closed, so hovering a word also shows an inline
   popup card (fed by the worker's hover lookup) — the same `hover` request keeps an
   open side panel in sync as a side effect.

   Dropped from the prototype: the 3-article library switcher (the real reader
   always shows the current page). */
import React, { useState, useEffect, useRef } from 'react'
import { syllableTone } from '../lib/pinyin.js'

const RIcon = {
  x: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
}

// ruby for one token (per-character pinyin above), as flex columns. Native <ruby>
// gives unpredictable line-box metrics; explicit columns let the hover/pin
// highlight wrap tightly and keep the pinyin centered over each character.
// `tk.py` is tone-marked, space-separated per syllable (from the worker's lookup).
function renderRuby(tk) {
  const chars = [...tk.t]
  const parts = tk.py ? String(tk.py).split(/\s+/) : []
  return chars.map((c, i) => {
    const syl = parts[i] || ''
    const toneCls = syl ? 'tone-' + syllableTone(syl) : ''
    return (
      <span key={i} className="zr">
        <span className={'zr-py ' + toneCls}>{syl || ' '}</span>
        <span className="zr-ch">{c}</span>
      </span>
    )
  })
}

// inline hover card near the cursor: word, pinyin, CC-CEDICT definitions, and the
// official HSK gloss(es) — the same content as the on-page popup. The worker's
// hover response carries `defs` and `hskSenses` ([{lvl,pos,def}]).
// pointer-events:none so it never steals the hover.
function HoverPopup({ x, y, resp }) {
  const W = 280, H = 200
  let left = x + 14, top = y + 16
  if (left + W > window.innerWidth - 6) left = Math.max(6, x - 14 - W)
  if (top + H > window.innerHeight - 6) top = Math.max(6, y - 16 - H)
  const defs = resp.defs && resp.defs.length ? resp.defs.slice(0, 5) : []
  const senses = resp.hskSenses && resp.hskSenses.length ? resp.hskSenses : []
  const multi = senses.length > 1
  let prevLvl = null
  return (
    <div className="rd-hpop" style={{ left, top }}>
      <div className="hhead">
        <span className="hw" lang="zh">{resp.word}</span>
        <span className="hpy">{resp.pinyin || ''}</span>
      </div>
      {defs.map((d, i) => (
        <div className="hdef" key={'d' + i}>
          {defs.length > 1 ? <span className="n">{i + 1}.</span> : null}
          <span>{d}</span>
        </div>
      ))}
      {senses.map((s, i) => {
        // repeated same-level tags are hidden but keep their width so meanings align
        const hideTag = s.lvl === prevLvl
        prevLvl = s.lvl
        return (
          <div className={'hhsk' + (i === 0 && defs.length ? ' divide' : '')} key={'h' + i}>
            <span className="htag" style={hideTag ? { visibility: 'hidden' } : undefined}>HSK {s.lvl}</span>
            <span>{(multi && s.pos ? '[' + s.pos + '] ' : '') + s.def}</span>
          </div>
        )
      })}
    </div>
  )
}

// shared Chinese text block: handles hover→popup/panel, click-to-pin, select-to-pin.
// `tokenParas` is an array of paragraphs, each an array of {t, kind, py} tokens.
// `requestHover(word)` -> Promise<resp> (also nudges an open side panel worker-side).
function ZhText({ tokenParas, ruby, tones, requestHover, onPin }) {
  const [hoverIdx, setHoverIdx] = useState(-1)
  const [pinnedIdx, setPinnedIdx] = useState(-1)
  const [selPinned, setSelPinned] = useState(false)
  const [popup, setPopup] = useState(null) // { x, y, resp }
  const selecting = useRef(false)
  const reqSeq = useRef(0) // invalidates stale hover responses (mouse moved on)

  const hideHover = () => { reqSeq.current++; setHoverIdx(-1); setPopup(null) }

  useEffect(() => { setPinnedIdx(-1); setSelPinned(false); hideHover() }, [tokenParas])

  // hide the popup when the article scrolls (its coords are viewport-fixed)
  useEffect(() => {
    const onScroll = () => hideHover()
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [])

  const locked = pinnedIdx >= 0 || selPinned
  const showIdx = pinnedIdx >= 0 ? pinnedIdx : (locked ? -1 : hoverIdx)

  const enterTok = (idx, word, e) => {
    if (selecting.current || locked) return
    setHoverIdx(idx)
    const x = e.clientX, y = e.clientY
    const seq = ++reqSeq.current
    requestHover(word).then((resp) => {
      if (seq !== reqSeq.current) return // hovered elsewhere / left in the meantime
      setPopup(resp && resp.word && ((resp.defs && resp.defs.length) || resp.pinyin) ? { x, y, resp } : null)
    })
  }

  const handleMouseUp = () => {
    const raw = window.getSelection ? String(window.getSelection()) : ''
    selecting.current = false
    // Pin the selected run (the live selection also locks hover). Strip everything
    // but the Han characters — in ruby mode the selection interleaves the pinyin
    // spans, and we only want to look up the word itself. Cap the length so a
    // paragraph grab doesn't get sent as a lookup.
    const han = raw.replace(/[^\p{Script=Han}]/gu, '')
    if (han && [...han].length <= 16) { setSelPinned(true); setPinnedIdx(-1); setPopup(null); onPin(han) }
  }

  let gi = 0
  return (
    <div
      className={'rd-body' + (ruby ? ' ruby' : '') + (tones ? ' tones' : '')}
      onMouseDown={() => { selecting.current = true }}
      onMouseUp={handleMouseUp}
      onMouseLeave={hideHover}
    >
      {tokenParas.map((toks, pi) => (
        <p key={pi} className="zt-p" lang="zh">
          {toks.map((tk) => {
            const idx = gi++
            if (tk.kind === 'punct')
              return <span key={idx} className="zpunct">{tk.t}</span>
            const cls = 'ztok ' + tk.kind +
              (idx === showIdx ? ' active' : '') +
              (idx === pinnedIdx ? ' pinned' : '')
            return (
              <span
                key={idx} className={cls} data-q={tk.t}
                onMouseEnter={(e) => enterTok(idx, tk.t, e)}
                onClick={() => {
                  if (pinnedIdx === idx) { setPinnedIdx(-1); setSelPinned(false); return }
                  setSelPinned(false); setPinnedIdx(idx); setPopup(null); onPin(tk.t)
                }}
              >
                {ruby ? renderRuby(tk) : tk.t}
              </span>
            )
          })}
        </p>
      ))}
      {popup && <HoverPopup x={popup.x} y={popup.y} resp={popup.resp} />}
    </div>
  )
}

const RD_WIDTHS = { narrow: 640, medium: 860, wide: 1080 }

// appearance popover — font, text size, column width, theme, pinyin, tone colors
function AppearancePop({ p, set }) {
  const themes = [
    { k: 'paper', c: '#faf6ec', n: 'Paper' },
    { k: 'sepia', c: '#ecd8b0', n: 'Sepia' },
    { k: 'dark', c: '#26221b', n: 'Dark' },
  ]
  return (
    <div className="rd-pop app" role="menu">
      <div className="rd-pop-title">Appearance</div>

      <div className="rd-row">
        <span className="rd-label">Font</span>
        <div className="rd-seg">
          <button className={p.font === 'serif' ? 'on' : ''} onClick={() => set('font', 'serif')} style={{ fontFamily: '"Noto Serif SC", serif' }}>Serif</button>
          <button className={p.font === 'sans' ? 'on' : ''} onClick={() => set('font', 'sans')}>Sans</button>
        </div>
      </div>

      <div className="rd-row">
        <span className="rd-label">Text size</span>
        <div className="rd-size">
          <button onClick={() => set('size', Math.max(18, p.size - 2))} disabled={p.size <= 18}>A</button>
          <span className="rd-size-val">{p.size}px</span>
          <button onClick={() => set('size', Math.min(60, p.size + 2))} disabled={p.size >= 60} style={{ fontSize: 17 }}>A</button>
        </div>
      </div>

      <div className="rd-row">
        <span className="rd-label">Column width</span>
        <div className="rd-seg">
          <button className={p.width === 'narrow' ? 'on' : ''} onClick={() => set('width', 'narrow')}>Narrow</button>
          <button className={p.width === 'medium' ? 'on' : ''} onClick={() => set('width', 'medium')}>Medium</button>
          <button className={p.width === 'wide' ? 'on' : ''} onClick={() => set('width', 'wide')}>Wide</button>
        </div>
      </div>

      <div className="rd-row">
        <span className="rd-label">Theme</span>
        <div className="rd-theme-sw">
          {themes.map((t) => (
            <button key={t.k} className={p.theme === t.k ? 'on' : ''} style={{ background: t.c }}
              title={t.n} aria-label={t.n} onClick={() => set('theme', t.k)} />
          ))}
        </div>
      </div>

      <div className="rd-row">
        <span className="rd-label">Pinyin</span>
        <button className={'rd-switch' + (p.pinyin ? ' on' : '')} role="switch" aria-checked={p.pinyin}
          onClick={() => set('pinyin', !p.pinyin)}><span className="knob" /></button>
      </div>

      <div className="rd-row" style={{ opacity: p.pinyin ? 1 : 0.4, pointerEvents: p.pinyin ? 'auto' : 'none' }}>
        <span className="rd-label">Pinyin tone colors</span>
        <button className={'rd-switch' + (p.tones ? ' on' : '')} role="switch" aria-checked={p.tones}
          onClick={() => set('tones', !p.tones)}><span className="knob" /></button>
      </div>
    </div>
  )
}

export function ReaderView({ article, tokenParas, status, p, set, requestHover, onPin, onExit }) {
  const [menu, setMenu] = useState(null) // 'app' | null
  const hanFont = p.font === 'serif' ? '"Noto Serif SC", serif' : '"Noto Sans SC", sans-serif'

  return (
    <div className="reader" data-rtheme={p.theme}>
      <div className="rd-bar">
        <div className="rd-bar-l">
          <button className="rd-ic-btn" title="Close reader" onClick={onExit}>{RIcon.x}</button>
          <div className="rd-title-display">
            <span className="rl-mark" lang="zh">读</span>
            <span className="rl-text">
              <span className="rl-title" lang="zh">{(article && article.title) || 'Reader'}</span>
              <span className="rl-host">{(article && article.host) || ''}</span>
            </span>
          </div>
        </div>
        <div className="rd-bar-r">
          <button className={'rd-ic-btn pin' + (p.pinyin ? ' on' : '')} title="Toggle pinyin"
            lang="zh" onClick={() => set('pinyin', !p.pinyin)}>拼</button>
          <button className={'rd-aa' + (menu === 'app' ? ' on' : '')} title="Reading settings"
            onClick={() => setMenu((m) => (m === 'app' ? null : 'app'))}>
            <span className="aa-inner"><span className="aa-big">A</span><span className="aa-sm">a</span></span>
          </button>
        </div>
      </div>

      {menu && <div className="rd-overlay" onClick={() => setMenu(null)} />}
      {menu === 'app' && <AppearancePop p={p} set={set} />}

      <div className="rd-scroll">
        <article className="rd-article" style={{ maxWidth: RD_WIDTHS[p.width], '--rd-han': hanFont, '--rd-size': p.size + 'px' }}>
          {status === 'ready' && article && (
            <>
              {article.kicker ? <div className="rd-kicker">{article.kicker}</div> : null}
              <h1 className="rd-title" lang="zh">{article.title}</h1>
              {article.subtitle ? <div className="rd-sub">{article.subtitle}</div> : null}
              {(article.source || article.meta)
                ? <div className="rd-meta">{[article.source, article.meta].filter(Boolean).join(' · ')}</div>
                : null}
              <ZhText tokenParas={tokenParas} ruby={p.pinyin} tones={p.tones} requestHover={requestHover} onPin={onPin} />
            </>
          )}
          {status === 'loading' && <div className="rd-state">Analyzing page…</div>}
          {status === 'empty' && (
            <div className="rd-state">
              <div className="rd-state-title">Couldn’t find an article here</div>
              <div className="rd-state-sub">HanziLens Reader works best on article and blog pages with a main block of text. Try it on a news article or a blog post.</div>
            </div>
          )}
        </article>
      </div>
    </div>
  )
}
