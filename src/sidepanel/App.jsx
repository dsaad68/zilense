/* App.jsx — the MyDict side panel. Self-contained port of panel.jsx's SidePanel
   shell: it owns entry/tab/search/saved/settings state, loads the bundled
   CC-CEDICT index, and receives live lookups pushed from the content script
   (hover a character / select a word on any page). */
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { loadDict, lookup, searchEntries, segmentLongest } from '../lib/dict.js'
import { loadState, saveSaved, saveSettings, saveHistory, pushHistory, takePendingLookup, DEFAULT_SETTINGS,
  loadFamiliarity, saveFamiliarity, bumpFamiliarity, setFamiliarityState, getFamiliarity } from '../lib/storage.js'
import { Svg } from './components/icons.jsx'
import { IconBtn } from './components/atoms.jsx'
import { EntryView } from './components/EntryView.jsx'
import { ResultRow } from './components/ResultRow.jsx'
import { SavedView } from './components/SavedView.jsx'
import { ProgressView } from './components/ProgressView.jsx'
import { HistoryView } from './components/HistoryView.jsx'
import { SettingsMenu } from './components/SettingsMenu.jsx'

// 6-digit hex + alpha -> rgba string
function softHex(hex, a) {
  const n = hex.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16)
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'
}

export default function App() {
  const [loadStatus, setLoadStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const ready = loadStatus === 'ready'
  const [entryQ, setEntryQ] = useState('')
  const [tab, setTab] = useState('dict')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [saved, setSaved] = useState([])
  const [history, setHistory] = useState([])
  const [familiarity, setFamiliarity] = useState({}) // mydict.familiarity: word -> {state,seen,lastSeen}
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [hydrated, setHydrated] = useState(false)
  // was the currently-shown entry reached by a deliberate action (select /
  // context-menu / search / navigate) rather than a passive hover? Only
  // deliberate lookups feed familiarity tracking.
  const deliberate = useRef(false)
  const dark = settings.dark

  // load dictionary + persisted state once
  const [loadNonce, setLoadNonce] = useState(0) // bump to retry after a load error
  useEffect(() => {
    let alive = true
    setLoadStatus('loading')
    loadDict()
      .then(() => alive && setLoadStatus('ready'))
      .catch((err) => { if (alive) { console.error('[mydict] loadDict', err); setLoadStatus('error') } })
    return () => { alive = false }
  }, [loadNonce])

  useEffect(() => {
    let alive = true
    // Hydrate THEN read any pending lookup, in sequence: a context-menu/pin lookup
    // stashed before this panel mounted must merge INTO the loaded history, not
    // race it. Doing both in one chain means the late loadState() can't overwrite
    // the pending word's history entry.
    ;(async () => {
      const [s, fam] = await Promise.all([loadState(), loadFamiliarity()])
      if (!alive) return
      setSaved(s.saved)
      setSettings(s.settings)
      setFamiliarity(fam)
      let hist = s.history
      const q = await takePendingLookup()
      if (!alive) return
      if (q) {
        deliberate.current = true // a pinned/context-menu lookup is deliberate
        setEntryQ(q); setQuery(''); setTab('dict')
        hist = pushHistory(hist, q.trim(), Date.now())
      }
      setHistory(hist)
      setHydrated(true) // only start persisting after initial load (avoid clobbering)
    })()
    return () => { alive = false }
  }, [])

  // persist (guarded so the mount render doesn't overwrite stored values)
  useEffect(() => { if (hydrated) saveSaved(saved) }, [saved, hydrated])
  useEffect(() => { if (hydrated) saveSettings(settings) }, [settings, hydrated])
  useEffect(() => { if (hydrated) saveHistory(history) }, [history, hydrated])
  // debounced: coalesce rapid familiarity bumps into one write
  useEffect(() => {
    if (!hydrated) return
    const id = setTimeout(() => saveFamiliarity(familiarity), 400)
    return () => clearTimeout(id)
  }, [familiarity, hydrated])

  // record a DELIBERATE lookup (selection / context-menu / in-panel navigation —
  // never transient hover) into recent history, newest first
  const recordHistory = (q) => {
    deliberate.current = true
    setHistory((h) => pushHistory(h, (q || '').trim(), Date.now()))
  }

  // live lookups pushed from the content script / context menu
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return
    const show = (q) => { setEntryQ(q); setQuery(''); setTab('dict') }
    const onMsg = (msg, sender, sendResponse) => {
      if (!msg) return
      // selection / context-menu: look up the given string as-is (deliberate)
      if (msg.type === 'lookup' && typeof msg.q === 'string') {
        const q = msg.q.trim()
        show(q)
        recordHistory(q)
        return
      }
      // hover: the service worker now resolves the word (so the on-page popup
      // works with the panel closed) and pushes the result here to DISPLAY only —
      // no history, since hover is transient.
      if (msg.type === 'show' && typeof msg.q === 'string') {
        deliberate.current = false // hover is passive — don't let it bump familiarity
        show(msg.q)
        return
      }
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => chrome.runtime.onMessage.removeListener(onMsg)
  }, [])

  // debounce search input (full-dictionary scan)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 120)
    return () => clearTimeout(id)
  }, [query])

  // inject tweak overrides (accent / Chinese face / tone colors) — wins over theme
  useEffect(() => {
    const han = settings.hanFont === 'serif' ? '"Noto Serif SC", serif' : '"Noto Sans SC", sans-serif'
    const tones = settings.toneColors
      ? ''
      : '.panel .tone-1,.panel .tone-2,.panel .tone-3,.panel .tone-4,.panel .tone-5{color:var(--ink2)!important;}'
    const css = `
      :root{ --font-han: ${han}; }
      .panel[data-theme]{ --accent:${settings.accent}!important; --accent-soft:${softHex(settings.accent, 0.12)}!important; }
      .seal{ background:${settings.accent}!important; box-shadow:0 2px 8px ${softHex(settings.accent, 0.3)}!important; }
      ${tones}
    `
    let s = document.getElementById('tweak-overrides')
    if (!s) { s = document.createElement('style'); s.id = 'tweak-overrides'; document.head.appendChild(s) }
    s.textContent = css
  }, [settings.accent, settings.hanFont, settings.toneColors])

  const setSetting = (k, v) => setSettings((s) => ({ ...s, [k]: v }))
  const toggleSave = (q) => setSaved((s) => (s.includes(q) ? s.filter((x) => x !== q) : [q, ...s]))
  // the user sets a word's familiarity state (New / Learning / Known)
  const setFam = (q, state) => setFamiliarity((f) => setFamiliarityState(f, q, state))

  const entry = ready && entryQ ? lookup(entryQ) : null
  const results = useMemo(() => (ready && debounced ? searchEntries(debounced) : []), [ready, debounced])

  // auto-signal: bump a word's seen-count when the user DELIBERATELY opens it
  // (select / context-menu / search / navigate) — never on passive hover — and
  // only while familiarity tracking is enabled, so a disabled feature records
  // nothing. Keyed on the resolved headword; the deliberate flag is consumed so
  // it fires once per intentional lookup, not on every render.
  useEffect(() => {
    if (!hydrated || !entry || !settings.showFamiliarity || !deliberate.current) return
    deliberate.current = false
    setFamiliarity((f) => bumpFamiliarity(f, entry.q, Date.now()))
  }, [entry ? entry.q : null, hydrated, settings.showFamiliarity])

  // phrase fallback: a selected run that isn't itself an entry (e.g. a short
  // sentence) is segmented into known words so the lookup isn't a dead end
  const phrase = useMemo(() => {
    if (!ready || !entryQ || entry) return null
    let rest = [...entryQ]
    if (rest.length <= 1) return null
    const rows = []
    let guard = 0
    while (rest.length && guard++ < 24) {
      const seg = segmentLongest(rest.join(''))
      if (!seg || !seg.word) break
      const l = lookup(seg.word)
      if (l) rows.push({ q: seg.word, pinyin: l.pinyin, defs: l.defs, hsk: l.hsk })
      rest = rest.slice(seg.len)
    }
    return rows.length ? rows : null
  }, [ready, entryQ, entry])

  // navigation history (in-panel clicks only; external pushes reset it)
  const [backStack, setBackStack] = useState([])
  const internal = useRef(false)
  useEffect(() => {
    if (internal.current) internal.current = false
    else setBackStack([])
  }, [entryQ])

  const navigate = (q) => {
    if (q !== entryQ) { internal.current = true; setBackStack((s) => [...s, entryQ]) }
    setQuery(''); setTab('dict'); setEntryQ(q); recordHistory(q)
  }
  const goBack = () => {
    if (!backStack.length) return
    const prev = backStack[backStack.length - 1]
    internal.current = true
    setBackStack((s) => s.slice(0, -1))
    setQuery(''); setTab('dict'); setEntryQ(prev)
  }

  return (
    <div className="panel" data-theme={dark ? 'dark' : 'light'}>
      {showSettings && (
        <SettingsMenu settings={settings} onSetting={setSetting} onClose={() => setShowSettings(false)} />
      )}

      {/* Chrome's side-panel bar already shows the icon + name, so the app header
          carries no brand — the search row hosts the settings / theme controls. */}
      <div className="searchbar">
        <span className="search-ic">{Svg.search}</span>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (e.target.value) setTab('dict') }}
          placeholder="Search 汉字 or English…"
          lang="zh"
        />
        {query && <button className="clr" onClick={() => setQuery('')}>×</button>}
        <span className="bar-sep" />
        <IconBtn title="Settings" active={showSettings} onClick={() => setShowSettings((v) => !v)}>
          {Svg.gear}
        </IconBtn>
        <IconBtn title={dark ? 'Light mode' : 'Dark mode'} onClick={() => setSetting('dark', !dark)}>
          {dark ? Svg.sun : Svg.moon}
        </IconBtn>
      </div>

      <nav className="tabs">
        <button className={'tab' + (tab === 'dict' ? ' on' : '')} onClick={() => setTab('dict')}>Dictionary</button>
        <button className={'tab' + (tab === 'saved' ? ' on' : '')} onClick={() => setTab('saved')}>
          Saved {saved.length > 0 && <span className="tabcount">{saved.length}</span>}
        </button>
        {settings.showFamiliarity && (
          <button className={'tab' + (tab === 'progress' ? ' on' : '')} onClick={() => setTab('progress')}>
            Progress
          </button>
        )}
        <button className={'tab' + (tab === 'history' ? ' on' : '')} onClick={() => setTab('history')}>
          History
        </button>
      </nav>

      <div className="p-body">
        {loadStatus === 'error' ? (
          <div className="empty">
            <div className="empty-mark">⚠</div>
            <div className="empty-title">Couldn’t load the dictionary</div>
            <div className="empty-sub">The bundled CC-CEDICT data failed to load.</div>
            <button className="tab on" style={{ marginTop: 14 }} onClick={() => setLoadNonce((n) => n + 1)}>
              Reload
            </button>
          </div>
        ) : !ready ? (
          <div className="empty">
            <div className="empty-mark" lang="zh">字</div>
            <div className="empty-title">Loading dictionary…</div>
            <div className="empty-sub">Indexing CC-CEDICT — just a moment.</div>
          </div>
        ) : tab === 'saved' ? (
          <SavedView saved={saved} familiarity={familiarity} showFamiliarity={settings.showFamiliarity}
            onNavigate={navigate} onToggleSave={toggleSave} />
        ) : tab === 'progress' && settings.showFamiliarity ? (
          <ProgressView familiarity={familiarity} onNavigate={navigate} />
        ) : tab === 'history' ? (
          <HistoryView history={history} onNavigate={navigate} onClear={() => setHistory([])} />
        ) : query ? (
          results.length ? (
            <div className="results">
              <div className="results-label">{results.length} result{results.length > 1 ? 's' : ''}</div>
              {results.map((e) => (
                <ResultRow key={e.q} e={e} onNavigate={navigate} isSaved={saved.includes(e.q)} />
              ))}
            </div>
          ) : (
            <div className="empty">
              <div className="empty-mark">？</div>
              <div className="empty-title">No matches for “{query}”</div>
              <div className="empty-sub">Try a single character, pinyin, or an English word.</div>
            </div>
          )
        ) : entry ? (
          <EntryView entry={entry} dark={dark} onNavigate={navigate}
            isSaved={saved.includes(entry.q)} onToggleSave={toggleSave}
            fam={getFamiliarity(familiarity, entry.q)}
            onSetFamiliarity={settings.showFamiliarity ? setFam : null}
            showTrad={settings.showTrad} hskFirst={settings.hskFirst}
            onBack={backStack.length ? goBack : null} />
        ) : phrase ? (
          <div className="results">
            <div className="results-label">No exact entry for “{entryQ}” — showing words</div>
            {phrase.map((e, i) => (
              <ResultRow key={e.q + i} e={e} onNavigate={navigate} isSaved={saved.includes(e.q)} />
            ))}
          </div>
        ) : entryQ ? (
          <div className="empty">
            <div className="empty-mark">？</div>
            <div className="empty-title">No entry for “{entryQ}”</div>
            <div className="empty-sub">That word isn’t in CC-CEDICT. Try selecting a single character.</div>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-mark" lang="zh">字</div>
            <div className="empty-title">Hover a character to begin</div>
            <div className="empty-sub">
              Move your cursor over any Chinese character on the page and its meaning appears here instantly.
              Select a word to see the whole-word reading, then break it into characters.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
