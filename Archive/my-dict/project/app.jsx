/* app.jsx — composes the mock browser: a Chinese article on the left, the
   extension side panel docked on the right. Hover/select drives the panel. */

const { useState: useS, useMemo } = React;

// greedy segmentation of the article into word / char / punct tokens
function segment(text) {
  const words = window.DICT.WORD_TOKENS;
  const out = [];
  let i = 0;
  while (i < text.length) {
    let matched = null;
    for (const w of words) {
      if (text.startsWith(w, i)) { matched = w; break; }
    }
    if (matched) { out.push({ t: matched, kind: "word" }); i += matched.length; continue; }
    const ch = text[i];
    if (/[\u4e00-\u9fff]/.test(ch)) out.push({ t: ch, kind: "char" });
    else out.push({ t: ch, kind: "punct" });
    i++;
  }
  return out;
}

function Article({ activeQ, onHover }) {
  const tokens = useMemo(() => segment(window.DICT.ARTICLE), []);
  const [hoverIdx, setHoverIdx] = React.useState(-1);
  const [pinnedIdx, setPinnedIdx] = React.useState(-1); // single clicked token
  const [selPinned, setSelPinned] = React.useState(false); // pinned via drag-select
  const selecting = React.useRef(false);
  const locked = pinnedIdx >= 0 || selPinned;

  // selection → look up the selected run, and pin it
  const handleMouseUp = () => {
    const sel = window.getSelection ? String(window.getSelection()).trim() : "";
    selecting.current = false;
    if (sel && window.DICT.lookup(sel)) {
      setSelPinned(true);
      setPinnedIdx(-1);
      onHover(sel);
    }
  };

  const showIdx = pinnedIdx >= 0 ? pinnedIdx : (locked ? -1 : hoverIdx);

  return (
    <div className="page"
      onMouseDown={() => { selecting.current = true; }}
      onMouseUp={handleMouseUp}
    >
      <div className="page-bar">
        <span className="page-host">my-reader.app</span>
        <span className={"hint" + (locked ? " pinned" : "")}>
          {locked
            ? "Pinned — click the word again or select to change"
            : "Hover a character → it appears in the panel ↗"}
        </span>
      </div>
      <article className="post">
        <div className="kicker">Graded Reader · Beginner</div>
        <h1>我的中文生活</h1>
        <div className="byline">My Life in Chinese · 78 characters · ~2 min</div>
        <p className="lead" lang="zh" onMouseLeave={() => setHoverIdx(-1)}>
          {tokens.map((tk, idx) =>
            tk.kind === "punct" ? (
              <span key={idx} className="punct">{tk.t}</span>
            ) : (
              <span
                key={idx}
                className={"tok " + tk.kind +
                  (idx === showIdx ? " active" : "") +
                  (idx === pinnedIdx ? " pinned" : "")}
                data-q={tk.t}
                onMouseEnter={() => {
                  if (selecting.current || locked) return; // locked: ignore hover
                  setHoverIdx(idx);
                  onHover(tk.t);
                }}
                onClick={() => {
                  if (pinnedIdx === idx) { setPinnedIdx(-1); setSelPinned(false); return; } // unpin
                  setSelPinned(false);
                  setPinnedIdx(idx);
                  onHover(tk.t);
                }}
              >
                {tk.t}
              </span>
            )
          )}
        </p>
        <p className="note">
          Reading tip: hover any single character for its meaning, or highlight a
          whole word like <span className="inline-zh" lang="zh">朋友</span> to see the
          word reading plus a character-by-character breakdown.
        </p>
      </article>
    </div>
  );
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#c8443a",
  "hanFont": "sans",
  "readingSize": 30,
  "toneColors": true
}/*EDITMODE-END*/;

// 6-digit hex + alpha → rgba string
function softHex(hex, a) {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + a + ")";
}

function App() {
  const [entryQ, setEntryQ] = useS("你好");
  const [dark, setDark] = useS(false);
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // apply tweaks via an injected stylesheet (wins over theme blocks)
  React.useEffect(() => {
    const han = t.hanFont === "serif" ? '"Noto Serif SC", serif' : '"Noto Sans SC", sans-serif';
    const tones = t.toneColors
      ? ""
      : ".panel .tone-1,.panel .tone-2,.panel .tone-3,.panel .tone-4,.panel .tone-5{color:var(--ink2)!important;}";
    const css = `
      :root{ --font-han: ${han}; }
      .panel[data-theme]{ --accent:${t.accent}!important; --accent-soft:${softHex(t.accent, 0.12)}!important; }
      .seal{ background:${t.accent}!important; box-shadow:0 2px 8px ${softHex(t.accent, 0.3)}!important; }
      .lead{ font-size:${t.readingSize}px!important; }
      ${tones}
    `;
    let s = document.getElementById("tweak-overrides");
    if (!s) { s = document.createElement("style"); s.id = "tweak-overrides"; document.head.appendChild(s); }
    s.textContent = css;
  }, [t.accent, t.hanFont, t.readingSize, t.toneColors]);

  return (
    <div className="stage">
      <ChromeWindow
        width={1180}
        height={772}
        url="my-reader.app/reader/my-life-in-chinese"
        tabs={[{ title: "我的中文生活 — Reader" }, { title: "New Tab" }]}
        activeIndex={0}
      >
        <div className="split">
          <Article activeQ={entryQ} onHover={setEntryQ} />
          <div className="dock" data-theme={dark ? "dark" : "light"}>
            <div className="dock-head">
              <span className="dock-title">Side panel</span>
              <span className="dock-dots"><i /><i /><i /></span>
            </div>
            <SidePanel
              entryQ={entryQ}
              onNavigate={setEntryQ}
              dark={dark}
              onToggleDark={() => setDark((d) => !d)}
              settings={t}
              onSetting={setTweak}
            />
          </div>
        </div>
      </ChromeWindow>
      <div className="caption">My&#8202;Dict — Chinese dictionary in the Chrome side panel · hover, select, search &amp; save</div>

      <TweaksPanel>
        <TweakSection label="Reading" />
        <TweakSlider label="Article text" value={t.readingSize} min={22} max={40} unit="px"
          onChange={(v) => setTweak("readingSize", v)} />
        <TweakSection label="In-panel settings" />
        <div style={{ fontSize: 12, color: "#8a8178", lineHeight: 1.5, padding: "2px 2px 4px" }}>
          Accent, Chinese face and pinyin tone colors live in the panel’s ⚙ Settings menu (top-right, next to dark mode).
        </div>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
