/* main.jsx — Reader-mode entry. This page runs inside a full-screen iframe the
   content script injects over the host page. As a chrome-extension:// document it
   has chrome.* APIs (like the side panel), so it talks to the service worker
   directly for segmentation/lookup, and to the content script (its parent window)
   via postMessage only to request a close.

   Article hand-off: the content script had the worker stash the extracted article
   in extension-only chrome.storage.session under a nonce, which we receive in our
   own URL hash. We fetch it back THROUGH the worker (which owns session storage),
   so the host page — our parent window while the reader is open — is never trusted
   to deliver the article over postMessage. */
import React, { useState, useEffect, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { loadReaderPrefs, saveReaderPrefs, READER_DEFAULTS } from '../lib/storage.js'
import { ReaderView } from './ReaderView.jsx'
import './reader.css'

function sendWorker(msg) {
  try { chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError) } catch (e) { /* context gone */ }
}

function ReaderApp() {
  const [prefs, setPrefs] = useState(READER_DEFAULTS)
  const [article, setArticle] = useState(null)
  const [tokenParas, setTokenParas] = useState([])
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'empty'

  useEffect(() => { loadReaderPrefs().then(setPrefs) }, [])

  // update one pref + persist it (read-modify-write merge in saveReaderPrefs)
  const set = useCallback((k, v) => {
    setPrefs((s) => ({ ...s, [k]: v }))
    saveReaderPrefs({ [k]: v })
  }, [])

  useEffect(() => {
    let cancelled = false
    // the article was stashed under the nonce in our URL hash; fetch it back through
    // the worker (one-use). No postMessage from the parent is trusted for it.
    const nonce = decodeURIComponent((window.location.hash || '').replace(/^#/, ''))

    function segment(article) {
      if (cancelled) return
      setArticle(article)
      // hard-cap before any privileged work (defense in depth; the worker caps too)
      const paras = Array.isArray(article.paras)
        ? article.paras.filter((p) => typeof p === 'string').slice(0, 400).map((p) => p.slice(0, 4000))
        : []
      if (article.empty || !paras.length) { setStatus('empty'); return }
      try {
        chrome.runtime.sendMessage({ type: 'segment', paras }, (resp) => {
          if (cancelled) return
          if (chrome.runtime.lastError || !resp || !Array.isArray(resp.paras) || !resp.paras.length) {
            setStatus('empty'); return
          }
          setTokenParas(resp.paras)
          setStatus('ready')
        })
      } catch (err) { setStatus('empty') }
    }

    try {
      chrome.runtime.sendMessage({ type: 'reader-article', nonce }, (resp) => {
        if (cancelled) return
        if (chrome.runtime.lastError) { setStatus('empty'); return }
        segment((resp && resp.article) || { empty: true })
      })
    } catch (e) { setStatus('empty') }
    return () => { cancelled = true }
  }, [])

  const onExit = useCallback(() => {
    try { window.parent.postMessage({ type: 'mydict-reader-close' }, '*') } catch (e) {}
  }, [])

  // Esc closes the reader (expected reader-view affordance)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onExit() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  // hover: look the word up in the worker (for the inline popup) — the worker also
  // relays a 'show' to an open side panel as a side effect, keeping it in sync.
  // pin (click / select): open the side panel on that word.
  const requestHover = useCallback((word) => new Promise((resolve) => {
    if (!word) { resolve(null); return }
    try {
      chrome.runtime.sendMessage({ type: 'hover', text: word }, (resp) => {
        resolve(chrome.runtime.lastError ? null : (resp || null))
      })
    } catch (e) { resolve(null) }
  }), [])
  const onPin = useCallback((q) => { if (q) sendWorker({ type: 'open-panel', q }) }, [])

  return (
    <ReaderView
      article={article} tokenParas={tokenParas} status={status}
      p={prefs} set={set} requestHover={requestHover} onPin={onPin} onExit={onExit}
    />
  )
}

createRoot(document.getElementById('root')).render(<ReaderApp />)
