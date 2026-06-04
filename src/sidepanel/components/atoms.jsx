/* atoms.jsx — small UI atoms ported from panel.jsx: tone-colored pinyin,
   HSK badge, POS, icon button, and Mandarin pronunciation. */
import React from 'react'
import { syllableTone } from '../../lib/pinyin.js'

export function ToneText({ pinyin, size }) {
  const sylls = String(pinyin || '').split(/\s+/)
  return (
    <span style={{ fontSize: size, letterSpacing: 0.2 }}>
      {sylls.map((s, i) => (
        <span key={i} className={'tone-' + syllableTone(s)}>
          {s}{i < sylls.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  )
}

export function HSKBadge({ level }) {
  return <span className="badge hsk">HSK {level}</span>
}

export function Pos({ children }) {
  return <span className="pos">{children}</span>
}

export function IconBtn({ title, active, onClick, children }) {
  return (
    <button className={'iconbtn' + (active ? ' on' : '')} title={title} onClick={onClick}>
      {children}
    </button>
  )
}

// Is a Mandarin TTS voice available? (Web Speech API; voices load async, so this
// can be false on first paint and become true shortly after.)
export function hasMandarinVoice() {
  try {
    const synth = window.speechSynthesis
    if (!synth) return false
    const voices = synth.getVoices()
    return voices.length === 0 || voices.some((v) => /^zh\b|zh-|cmn/i.test(v.lang))
  } catch (e) {
    return false
  }
}

// Speak Chinese text with the Web Speech API (real Mandarin pronunciation, no
// network, no bundled audio). Prefers a zh-CN voice; no-ops if unsupported.
export function speak(text) {
  try {
    const synth = window.speechSynthesis
    if (!synth || !text) return
    synth.cancel() // stop any in-flight utterance
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    const zh = synth.getVoices().find((v) => /^zh\b|zh-|cmn/i.test(v.lang))
    if (zh) u.voice = zh
    synth.speak(u)
  } catch (e) {}
}
