/* panel.jsx — the Chrome side panel UI (the extension itself). Exports SidePanel to window. */

const { useState, useEffect, useRef } = React;

// ---- pinyin tone coloring ------------------------------------------------
const TONE_GROUPS = ["āēīōūǖ", "áéíóúǘ", "ǎěǐǒǔǚ", "àèìòùǜ"];
function syllableTone(syl) {
  for (const ch of syl) {
    for (let t = 0; t < 4; t++) if (TONE_GROUPS[t].includes(ch)) return t + 1;
  }
  return 5;
}
function ToneText({ pinyin, size }) {
  const sylls = String(pinyin).split(/\s+/);
  return (
    <span style={{ fontSize: size, letterSpacing: 0.2 }}>
      {sylls.map((s, i) => (
        <span key={i} className={"tone-" + syllableTone(s)}>
          {s}{i < sylls.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}

// ---- small ui atoms ------------------------------------------------------
function HSKBadge({ level }) {
  return <span className="badge hsk">HSK {level}</span>;
}
function Pos({ children }) {
  return <span className="pos">{children}</span>;
}
function IconBtn({ title, active, onClick, children }) {
  return (
    <button className={"iconbtn" + (active ? " on" : "")} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

// speaker / star / search svgs
const Svg = {
  speaker: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 6a8 8 0 0 1 0 12" />
    </svg>
  ),
  starOutline: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />
    </svg>
  ),
  starFill: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  ),
  replay: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 2.6-6.3" /><path d="M3 4v4h4" />
    </svg>
  ),
  brush: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3l5 5L9 20H4v-5L16 3Z" /><path d="M13.5 5.5l5 5" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2M12 19.5v2M4.2 7l1.7 1M18.1 16l1.7 1M4.2 17l1.7-1M18.1 8l1.7-1M2.5 12h2M19.5 12h2" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
};

// fake audio: just a tiny chime via WebAudio so the button does something
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine"; o.frequency.value = 660;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch (e) {}
}

// ---- stroke order (Hanzi Writer) ----------------------------------------
function StrokeOrder({ char, dark }) {
  const ref = useRef(null);
  const writerRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ok | error

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = "";
    writerRef.current = null;
    setStatus("loading");
    if (!window.HanziWriter) { setStatus("error"); return; }
    let cancelled = false;
    const w = window.HanziWriter.create(ref.current, char, {
      width: 150, height: 150, padding: 6,
      strokeColor: dark ? "#e9ddc9" : "#2a2520",
      radicalColor: "#c8443a",
      outlineColor: dark ? "#4a443b" : "#d9cdb8",
      showOutline: true,
      strokeAnimationSpeed: 1, delayBetweenStrokes: 220,
      charDataLoader: (c, onComplete) => {
        fetch("https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/" + encodeURIComponent(c) + ".json")
          .then((r) => { if (!r.ok) throw new Error("nf"); return r.json(); })
          .then((d) => { if (!cancelled) { setStatus("ok"); onComplete(d); } })
          .catch(() => { if (!cancelled) setStatus("error"); });
      },
    });
    writerRef.current = w;
    const t = setTimeout(() => { if (!cancelled) w.animateCharacter(); }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [char, dark]);

  return (
    <div className="stroke-wrap">
      <div className="stroke-box">
        <div className="stroke-grid">
          <span /><span /><span className="d1" /><span className="d2" />
        </div>
        <div ref={ref} className="stroke-svg" />
        {status === "loading" && <div className="stroke-msg">loading strokes…</div>}
        {status === "error" && <div className="stroke-msg ghost">{char}<small>stroke data unavailable</small></div>}
      </div>
      <button className="ghostbtn sm" disabled={status !== "ok"}
        onClick={() => writerRef.current && writerRef.current.animateCharacter()}>
        {Svg.replay} Replay
      </button>
    </div>
  );
}

// ---- entry view ----------------------------------------------------------
function EntryView({ entry, dark, onNavigate, isSaved, onToggleSave, onBack }) {
  const [showChars, setShowChars] = useState(true);
  const [showStrokes, setShowStrokes] = useState(false);
  useEffect(() => { setShowChars(true); setShowStrokes(false); }, [entry.q]);
  const isWord = entry.type === "word";

  return (
    <div className="entry">
      {onBack && (
        <button className="backbtn" onClick={onBack}>{Svg.back} Back</button>
      )}
      <div className="entry-head">
        <div className="hanzi-big" lang="zh">{entry.q}</div>
        <div className="entry-actions">
          <IconBtn title="Pronounce" onClick={playChime}>{Svg.speaker}</IconBtn>
          <IconBtn title={isSaved ? "Saved" : "Save to deck"} active={isSaved} onClick={() => onToggleSave(entry.q)}>
            {isSaved ? Svg.starFill : Svg.starOutline}
          </IconBtn>
        </div>
      </div>

      <div className="pinyin-row">
        <ToneText pinyin={entry.pinyin} size={22} />
      </div>

      <div className="meta-row">
        <HSKBadge level={entry.hsk} />
        <Pos>{entry.pos}</Pos>
        <span className="freq">· {entry.freq}</span>
      </div>

      <ol className="defs">
        {entry.defs.map((d, i) => <li key={i}>{d}</li>)}
      </ol>

      {isWord && (
        <div className="section">
          <button className="disclosure" onClick={() => setShowChars((v) => !v)}>
            <span className="section-label">Characters · {entry.chars.length}</span>
            <span className={"chev" + (showChars ? " open" : "")}>{Svg.chevron}</span>
          </button>
          {showChars && (
            <div className="charcards">
              {entry.chars.map((c, i) => {
                const ce = window.DICT.lookup(c);
                return (
                  <button className="charcard" key={i} onClick={() => onNavigate(c)}>
                    <span className="cc-hanzi" lang="zh">{c}</span>
                    <span className="cc-body">
                      <ToneText pinyin={ce ? ce.pinyin : ""} size={15} />
                      <span className="cc-gloss">{ce ? ce.defs[0] : ""}</span>
                    </span>
                    <span className="cc-arrow">›</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!isWord && (
        <div className="section">
          <button className="disclosure" onClick={() => setShowStrokes((v) => !v)}>
            <span className="section-label">Stroke order</span>
            <span className={"chev" + (showStrokes ? " open" : "")}>{Svg.chevron}</span>
          </button>
          {showStrokes && <StrokeOrder char={entry.q} dark={dark} />}
        </div>
      )}

      {!isWord && (
        <div className="section">
          <div className="section-label">Radical &amp; components</div>
          <div className="radline">
            <div className="radical">
              <span className="rad-char" lang="zh">{entry.radical.char}</span>
              <span className="rad-meaning">{entry.radical.meaning}</span>
            </div>
            <div className="comps">
              {entry.components.map((c, i) => (
                <div className="comp" key={i}>
                  <span className="comp-char" lang="zh">{c}</span>
                  <span className="comp-gloss">{window.DICT.compMeaning(c)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="strokes-count">{entry.strokes} strokes</div>
        </div>
      )}

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
    </div>
  );
}

// ---- search results ------------------------------------------------------
function searchEntries(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const hasHan = /[\u4e00-\u9fff]/.test(q);
  return window.DICT.ALL_ENTRIES.filter((e) => {
    if (hasHan) return e.q.includes(q);
    return (
      e.defs.some((d) => d.toLowerCase().includes(q)) ||
      e.pinyin.replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g, (m) => "aaaaeeeeiiiioooouuuuüüüü"[
        "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ".indexOf(m)]).includes(q) ||
      e.pinyin.toLowerCase().includes(q)
    );
  }).slice(0, 30);
}

function ResultRow({ e, onNavigate, isSaved }) {
  return (
    <button className="result" onClick={() => onNavigate(e.q)}>
      <span className="r-hanzi" lang="zh">{e.q}</span>
      <span className="r-body">
        <span className="r-top">
          <ToneText pinyin={e.pinyin} size={14} />
          {isSaved && <span className="r-star">{Svg.starFill}</span>}
        </span>
        <span className="r-gloss">{e.defs.slice(0, 2).join("; ")}</span>
      </span>
      <span className="r-hsk">HSK{e.hsk}</span>
    </button>
  );
}

// ---- saved / flashcards --------------------------------------------------
function SavedView({ saved, onNavigate, onToggleSave }) {
  if (!saved.length) {
    return (
      <div className="empty">
        <div className="empty-mark">★</div>
        <div className="empty-title">No saved words yet</div>
        <div className="empty-sub">Tap the star on any entry to build your review deck.</div>
      </div>
    );
  }
  return (
    <div className="saved-list">
      <div className="saved-count">{saved.length} word{saved.length > 1 ? "s" : ""} in deck</div>
      {saved.map((q) => {
        const e = window.DICT.lookup(q);
        if (!e) return null;
        return (
          <div className="flash" key={q}>
            <button className="flash-main" onClick={() => onNavigate(q)}>
              <span className="f-hanzi" lang="zh">{q}</span>
              <span className="f-body">
                <ToneText pinyin={e.pinyin} size={14} />
                <span className="f-gloss">{e.defs[0]}</span>
              </span>
            </button>
            <button className="f-remove" title="Remove" onClick={() => onToggleSave(q)}>{Svg.starFill}</button>
          </div>
        );
      })}
    </div>
  );
}

// ---- settings menu (accent / face / tone colors) ------------------------
function SettingsMenu({ settings, onSetting, onClose }) {
  const accents = [
    { c: "#c8443a", n: "Vermilion" }, { c: "#2f6f4f", n: "Jade" },
    { c: "#3b5b8c", n: "Indigo" }, { c: "#b5862f", n: "Gold" }, { c: "#4a4540", n: "Ink" },
  ];
  return (
    <>
      <div className="set-overlay" onClick={onClose} />
      <div className="settings-pop" role="dialog" aria-label="Display settings">
        <div className="set-title">Display</div>

        <div className="set-row col">
          <span className="set-label">Accent</span>
          <div className="swatches">
            {accents.map(({ c, n }) => (
              <button key={c} title={n} aria-label={n}
                className={"swatch" + (settings.accent === c ? " on" : "")}
                style={{ background: c }} onClick={() => onSetting("accent", c)}>
                {settings.accent === c && <span className="sw-check">✓</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row">
          <span className="set-label">Chinese face</span>
          <div className="segmini">
            <button className={settings.hanFont === "sans" ? "on" : ""}
              onClick={() => onSetting("hanFont", "sans")}>Sans</button>
            <button className={settings.hanFont === "serif" ? "on" : ""}
              onClick={() => onSetting("hanFont", "serif")}>Serif</button>
          </div>
        </div>

        <div className="set-row">
          <span className="set-label">Pinyin tone colors</span>
          <button className={"switch" + (settings.toneColors ? " on" : "")}
            role="switch" aria-checked={settings.toneColors}
            onClick={() => onSetting("toneColors", !settings.toneColors)}>
            <span className="knob" />
          </button>
        </div>
      </div>
    </>
  );
}

// ---- panel shell ---------------------------------------------------------
function SidePanel({ entryQ, onNavigate, dark, onToggleDark, settings, onSetting }) {
  const [tab, setTab] = useState("dict");
  const [query, setQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mydict.saved") || "[]"); } catch (e) { return []; }
  });
  useEffect(() => { localStorage.setItem("mydict.saved", JSON.stringify(saved)); }, [saved]);

  const toggleSave = (q) => setSaved((s) => (s.includes(q) ? s.filter((x) => x !== q) : [q, ...s]));
  const entry = entryQ ? window.DICT.lookup(entryQ) : null;
  const results = searchEntries(query);

  // navigation history (in-panel clicks only; hovering resets it)
  const [backStack, setBackStack] = useState([]);
  const internal = useRef(false);
  useEffect(() => {
    if (internal.current) internal.current = false;
    else setBackStack([]);
  }, [entryQ]);

  const navigate = (q) => {
    if (q !== entryQ) { internal.current = true; setBackStack((s) => [...s, entryQ]); }
    setQuery(""); setTab("dict"); onNavigate(q);
  };
  const goBack = () => {
    if (!backStack.length) return;
    const prev = backStack[backStack.length - 1];
    internal.current = true;
    setBackStack((s) => s.slice(0, -1));
    setQuery(""); setTab("dict"); onNavigate(prev);
  };

  return (
    <div className="panel" data-theme={dark ? "dark" : "light"}>
      <header className="p-head">
        <div className="brand">
          <span className="seal" lang="zh">字</span>
          <span className="brand-name">My&#8202;Dict<small>汉语词典</small></span>
        </div>
        <div className="head-actions">
          <IconBtn title="Settings" active={showSettings} onClick={() => setShowSettings((v) => !v)}>
            {Svg.gear}
          </IconBtn>
          <IconBtn title={dark ? "Light mode" : "Dark mode"} onClick={onToggleDark}>
            {dark ? Svg.sun : Svg.moon}
          </IconBtn>
        </div>
      </header>

      {showSettings && (
        <SettingsMenu settings={settings} onSetting={onSetting} onClose={() => setShowSettings(false)} />
      )}

      <div className="searchbar">
        <span className="search-ic">{Svg.search}</span>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (e.target.value) setTab("dict"); }}
          placeholder="Search 汉字 or English…"
          lang="zh"
        />
        {query && <button className="clr" onClick={() => setQuery("")}>×</button>}
      </div>

      <nav className="tabs">
        <button className={"tab" + (tab === "dict" ? " on" : "")} onClick={() => setTab("dict")}>Dictionary</button>
        <button className={"tab" + (tab === "saved" ? " on" : "")} onClick={() => setTab("saved")}>
          Saved {saved.length > 0 && <span className="tabcount">{saved.length}</span>}
        </button>
      </nav>

      <div className="p-body">
        {tab === "saved" ? (
          <SavedView saved={saved} onNavigate={navigate} onToggleSave={toggleSave} />
        ) : query ? (
          results.length ? (
            <div className="results">
              <div className="results-label">{results.length} result{results.length > 1 ? "s" : ""}</div>
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
            onBack={backStack.length ? goBack : null} />
        ) : (
          <div className="empty">
            <div className="empty-mark" lang="zh">译</div>
            <div className="empty-title">Hover a character to begin</div>
            <div className="empty-sub">
              Move your cursor over any character on the page and its meaning appears here instantly.
              Select a word to see the whole-word reading, then break it into characters.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

window.SidePanel = SidePanel;
