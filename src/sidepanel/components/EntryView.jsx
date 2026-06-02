/* EntryView.jsx — the dictionary entry, ported from panel.jsx. Sections that
   depend on data CC-CEDICT doesn't carry (HSK / POS / freq / radical /
   components / examples) render only when those fields are present, so the
   layout degrades gracefully and is ready to light up once that data is added. */
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { lookup, compMeaning, wordsContainingChar } from '../../lib/dict.js'
import { fetchExamples, tatoebaUrl } from '../../lib/examples.js'
import { grammarFor } from '../../lib/grammar.js'
import { Svg } from './icons.jsx'
import { ToneText, HSKBadge, Pos, IconBtn, speak, hasMandarinVoice } from './atoms.jsx'
import { StrokeOrder } from './StrokeOrder.jsx'
import { buildMeaningGroups } from '../meanings.js'

// Example sentences from Tatoeba — collapsed by default, fetched on first expand
// (so hovering never triggers requests) and cached per word.
function TatoebaExamples({ word }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState({ status: 'idle', items: [] })
  const wordRef = useRef(word) // always the current word, for stale-fetch guarding
  useEffect(() => { wordRef.current = word; setOpen(false); setState({ status: 'idle', items: [] }) }, [word])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && state.status === 'idle') {
      setState({ status: 'loading', items: [] })
      const reqWord = word // ignore this fetch if the entry changes before it resolves
      fetchExamples(word)
        .then((items) => { if (wordRef.current === reqWord) setState({ status: 'ok', items }) })
        .catch(() => { if (wordRef.current === reqWord) setState({ status: 'error', items: [] }) })
    }
  }

  return (
    <div className="section">
      <button className="disclosure" onClick={toggle}>
        <span className="section-label">Examples</span>
        <span className={'chev' + (open ? ' open' : '')}>{Svg.chevron}</span>
      </button>
      {open && (
        <div style={{ marginTop: 14 }}>
          {state.status === 'loading' && <div className="ex-msg">loading examples…</div>}
          {state.status === 'error' && <div className="ex-msg">couldn’t reach Tatoeba</div>}
          {state.status === 'ok' && state.items.length === 0 && (
            <div className="ex-msg">no example sentences found</div>
          )}
          {state.status === 'ok' && state.items.length > 0 && (
            <>
              <div className="examples">
                {state.items.map((ex, i) => (
                  <div className="ex" key={i}>
                    <div className="ex-zh" lang="zh">{ex.zh}</div>
                    {ex.py && <div className="ex-py"><ToneText pinyin={ex.py} size={13} /></div>}
                    <div className="ex-en">{ex.en}</div>
                  </div>
                ))}
              </div>
              <a className="ex-credit" href={tatoebaUrl(word)} target="_blank" rel="noreferrer">
                more examples via Tatoeba ↗
              </a>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function EntryView({ entry, dark, onNavigate, isSaved, onToggleSave, onBack, showTrad = true, hskFirst = false }) {
  const [showChars, setShowChars] = useState(true)
  const [showStrokes, setShowStrokes] = useState(false)
  const [showFamily, setShowFamily] = useState(false)
  const [showGrammar, setShowGrammar] = useState(false)
  useEffect(() => { setShowChars(true); setShowStrokes(false); setShowFamily(false); setShowGrammar(false) }, [entry.q])
  const isWord = entry.type === 'word'
  const grammar = grammarFor(entry.q)
  // word family: other words built from this character (char entries only)
  const family = useMemo(
    () => (isWord ? [] : wordsContainingChar(entry.q, { exclude: entry.q })),
    [entry.q, isWord]
  )
  // HSK glosses: a per-sense level is only worth showing when the senses actually
  // sit at different levels — otherwise it just repeats the badge in the meta row
  const hskSenses = entry.hskSenses || []
  const hskMulti = hskSenses.length > 1
  const hskMultiLevel = new Set(hskSenses.map((s) => s.lvl)).size > 1
  // meanings shown as one continuously-numbered list, grouped by source
  // (HSK / CC-CEDICT / Other), ordered by the "Show HSK meaning first" setting.
  const meaningGroups = buildMeaningGroups(entry, hskFirst)

  // show the pronounce button only when a Mandarin TTS voice is (or becomes) available
  const [canSpeak, setCanSpeak] = useState(hasMandarinVoice())
  useEffect(() => {
    const synth = typeof window !== 'undefined' && window.speechSynthesis
    if (!synth) return
    const update = () => setCanSpeak(hasMandarinVoice())
    synth.addEventListener?.('voiceschanged', update)
    return () => synth.removeEventListener?.('voiceschanged', update)
  }, [])

  // coerce to a real boolean — `{0 && <jsx>}` would otherwise render a literal "0"
  const hasMeta = !!(entry.hsk || entry.pos || entry.freq || (entry.measures && entry.measures.length))

  return (
    <div className="entry">
      {onBack && (
        <button className="backbtn" onClick={onBack}>{Svg.back} Back</button>
      )}
      <div className="entry-head">
        <div className="hanzi-big" lang="zh">
          {entry.q}
          {showTrad && entry.trad && entry.trad !== entry.q && (
            <span className="hanzi-trad" lang="zh" title="Traditional form">{entry.trad}</span>
          )}
        </div>
        <div className="entry-actions">
          {canSpeak && (
            <IconBtn title="Pronounce (Mandarin)" onClick={() => speak(entry.q)}>{Svg.speaker}</IconBtn>
          )}
          <IconBtn title={isSaved ? 'Saved' : 'Save to deck'} active={isSaved} onClick={() => onToggleSave(entry.q)}>
            {isSaved ? Svg.starFill : Svg.starOutline}
          </IconBtn>
        </div>
      </div>

      <div className="pinyin-row">
        <ToneText pinyin={entry.pinyin} size={22} />
      </div>

      {hasMeta && (
        <div className="meta-row">
          {entry.hsk && <HSKBadge level={entry.hsk} />}
          {entry.pos && <Pos>{entry.pos}</Pos>}
          {entry.freq && <span className="freq">· {entry.freq}</span>}
          {entry.measures && entry.measures.map((m, i) => {
            const [han, ...py] = m.split(' ')
            return <span className="measure" key={i}>measure&nbsp;word&nbsp;<b lang="zh">{han}</b> {py.join(' ')}</span>
          })}
        </div>
      )}

      {meaningGroups.length > 0 && (
        <div className="defs-grouped">
          {meaningGroups.map((g) => (
            <React.Fragment key={g.kind}>
              <div className="defs-group-label">{g.label}</div>

              {g.kind === 'hsk' && hskSenses.map((s, i) => (
                // multiple senses: prefix each with its POS so the readings are
                // distinguished (会 [verb] can / [noun] meeting); the level is
                // only added when senses span different levels.
                <div className="defs-item" key={'h' + i}>
                  {hskMultiLevel && <span className="hsk-sense-lvl">HSK {s.lvl}</span>}
                  {hskMulti && s.pos && <span className="hsk-sense-pos">{s.pos}</span>}
                  <span className="defs-item-text">{s.def}</span>
                </div>
              ))}

              {g.kind === 'cc' && entry.defs.map((d, i) => (
                <div className="defs-item" key={'c' + i}>
                  <span className="defs-item-text">{d}</span>
                </div>
              ))}

              {g.kind === 'alt' && entry.alts.map((a, i) => (
                // each alternate reading is one numbered item, displayed like the
                // old "Other readings" block: pinyin (+ traditional form) on its
                // own line, with that reading's meanings muted underneath
                <div className="defs-item" key={'a' + i}>
                  <div className="alt">
                    <div className="alt-py">
                      <ToneText pinyin={a.pinyin} size={15} />
                      {showTrad && a.trad && a.trad !== entry.q && (
                        <span className="alt-trad" lang="zh" title="Traditional form">{a.trad}</span>
                      )}
                    </div>
                    <div className="alt-defs">{a.defs.join('; ')}</div>
                  </div>
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      )}

      {grammar && (
        <div className="section">
          <button className="disclosure" onClick={() => setShowGrammar((v) => !v)}>
            <span className="section-label">Grammar</span>
            <span className={'chev' + (showGrammar ? ' open' : '')}>{Svg.chevron}</span>
          </button>
          {showGrammar && (
            <div style={{ marginTop: 14 }}>
              <p className="grammar-note">{grammar.note}</p>
              <a className="ex-credit" href={grammar.url} target="_blank" rel="noreferrer">
                grammar &amp; usage notes on the Chinese Grammar Wiki ↗
              </a>
            </div>
          )}
        </div>
      )}

      {isWord && entry.chars && entry.chars.length > 0 && (
        <div className="section">
          <button className="disclosure" onClick={() => setShowChars((v) => !v)}>
            <span className="section-label">Characters · {entry.chars.length}</span>
            <span className={'chev' + (showChars ? ' open' : '')}>{Svg.chevron}</span>
          </button>
          {showChars && (
            <div className="charcards">
              {entry.chars.map((c, i) => {
                const ce = lookup(c)
                return (
                  <button className="charcard" key={i} onClick={() => onNavigate(c)}>
                    <span className="cc-hanzi" lang="zh">{c}</span>
                    <span className="cc-body">
                      <ToneText pinyin={ce ? ce.pinyin : ''} size={15} />
                      <span className="cc-gloss">{ce ? ce.defs[0] : ''}</span>
                    </span>
                    <span className="cc-arrow">›</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {!isWord && (
        <div className="section">
          <button className="disclosure" onClick={() => setShowStrokes((v) => !v)}>
            <span className="section-label">Stroke order</span>
            <span className={'chev' + (showStrokes ? ' open' : '')}>{Svg.chevron}</span>
          </button>
          {showStrokes && <StrokeOrder char={entry.q} dark={dark} />}
        </div>
      )}

      {!isWord && entry.radical && (
        <div className="section">
          <div className="section-label">Radical &amp; components</div>
          <div className="radline">
            <div className="radical">
              <span className="rad-char" lang="zh">{entry.radical.char}</span>
              <span className="rad-meaning">{entry.radical.meaning}</span>
            </div>
            {entry.components && (
              <div className="comps">
                {entry.components.map((c, i) => (
                  <div className="comp" key={i}>
                    <span className="comp-char" lang="zh">{c}</span>
                    <span className="comp-gloss">{compMeaning(c)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {entry.strokes && <div className="strokes-count">{entry.strokes} strokes</div>}
        </div>
      )}

      {!isWord && family.length > 0 && (
        <div className="section">
          <button className="disclosure" onClick={() => setShowFamily((v) => !v)}>
            <span className="section-label">Word family · {family.length}</span>
            <span className={'chev' + (showFamily ? ' open' : '')}>{Svg.chevron}</span>
          </button>
          {showFamily && (
            <div className="charcards">
              {family.map((w) => (
                <button className="charcard" key={w.q} onClick={() => onNavigate(w.q)}>
                  <span className="cc-hanzi" lang="zh">{w.q}</span>
                  <span className="cc-body">
                    <ToneText pinyin={w.pinyin} size={15} />
                    <span className="cc-gloss">{w.defs[0]}</span>
                  </span>
                  <span className="cc-arrow">›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {entry.examples && entry.examples.length > 0 ? (
        <div className="section">
          <div className="section-label">Examples</div>
          <div className="examples">
            {entry.examples.map((ex, i) => (
              <div className="ex" key={i}>
                <div className="ex-zh" lang="zh">{ex.zh}</div>
                <div className="ex-py"><ToneText pinyin={ex.py} size={13} /></div>
                <div className="ex-en">{ex.en}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <TatoebaExamples word={entry.q} />
      )}
    </div>
  )
}
