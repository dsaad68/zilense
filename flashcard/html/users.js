// ====================================================================
// users.js · multi-user progress tracker for HSK-1 flashcards.
//
// Storage layout (localStorage key  hsk1-user:<name>):
//   {
//     "schemaVersion": 1,
//     "cards": {
//       "<word.id>": {
//         "correct":    <int>,
//         "wrong":      <int>,
//         "last":       <epoch-ms>,
//         "lastResult": "correct" | "wrong",
//         "recent":     ["correct"|"wrong", ...]   // ring buffer · 8 max
//       },
//       ...
//     }
//   }
//
// Older data without schemaVersion (the cards map at the root) is auto-
// migrated on read.  All localStorage reads are guarded — corrupted or
// non-JSON entries fall back to an empty store rather than throwing.
//
// Public API (window.UserStats):
//   setUser, getUser, getCurrentUser, logout
//   load, save, list, has, deleteUser
//   mark, get, filter, buildRound, stats, reset
//   exportJson, importJson
// ====================================================================

window.UserStats = (function () {
  const KEY_PREFIX  = 'hsk1-user:';
  const CURRENT_KEY = 'hsk1-current-user';
  const MAX_RECENT  = 8;
  const SCHEMA      = 1;

  let user = null;

  // ─── Identity ────────────────────────────────────────────────────
  function setUser(name) {
    user = String(name || '').trim();
    if (!user) return;
    try { localStorage.setItem(CURRENT_KEY, user); } catch (e) {}
    if (!localStorage.getItem(KEY_PREFIX + user)) save({});
  }
  function getUser() { return user; }
  function getCurrentUser() {
    try { return localStorage.getItem(CURRENT_KEY) || ''; }
    catch (e) { return ''; }
  }
  function logout() {
    user = null;
    try { localStorage.removeItem(CURRENT_KEY); } catch (e) {}
  }

  // ─── Storage I/O · guarded everywhere ────────────────────────────
  function _readRaw(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;   // corrupt entry — caller treats as missing
    }
  }

  // Normalize any stored shape into the cards map.  Auto-migrates the
  // pre-schemaVersion shape (raw cards map at root) and writes the new
  // wrapped format back so subsequent reads don't have to re-detect.
  function _cardsFromRaw(raw, key) {
    if (!raw || typeof raw !== 'object') return {};
    if (raw.schemaVersion === SCHEMA && raw.cards && typeof raw.cards === 'object') {
      return raw.cards;
    }
    // Legacy: raw IS the cards map.  Detect by absence of schemaVersion
    // and presence of at least one numeric-key entry (or empty {}).
    const cards = raw;
    if (key) {
      // Persist in the new shape so the next read is a clean v1.
      try {
        localStorage.setItem(key, JSON.stringify({ schemaVersion: SCHEMA, cards }));
      } catch (e) {}
    }
    return cards;
  }

  function load() {
    if (!user) return {};
    return _cardsFromRaw(_readRaw(KEY_PREFIX + user), KEY_PREFIX + user);
  }
  function save(cards) {
    if (!user) return;
    try {
      localStorage.setItem(
        KEY_PREFIX + user,
        JSON.stringify({ schemaVersion: SCHEMA, cards: cards || {} })
      );
    } catch (e) { /* quota / privacy mode — ignore */ }
  }

  // ─── User listing ────────────────────────────────────────────────
  function list() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(KEY_PREFIX) !== 0) continue;
      const name = k.slice(KEY_PREFIX.length);
      const cards = _cardsFromRaw(_readRaw(k));
      let seen = 0, lastTouch = 0;
      for (const id in cards) {
        const c = cards[id] || {};
        if ((c.correct + c.wrong) > 0) seen++;
        if (c.last > lastTouch) lastTouch = c.last;
      }
      out.push({ name, seen, lastTouch });
    }
    out.sort((a, b) => b.lastTouch - a.lastTouch);
    return out;
  }
  function has(name) {
    return !!localStorage.getItem(KEY_PREFIX + String(name).trim());
  }
  function deleteUser(name) {
    try { localStorage.removeItem(KEY_PREFIX + String(name).trim()); }
    catch (e) {}
  }

  // ─── Per-card record ─────────────────────────────────────────────
  function id(word) { return String(word.id); }

  function mark(word, result /* 'correct' | 'wrong' */) {
    const data = load();
    const k = id(word);
    if (!data[k]) {
      data[k] = { correct: 0, wrong: 0, last: 0, lastResult: '', recent: [] };
    }
    if (result === 'correct') data[k].correct++;
    else if (result === 'wrong') data[k].wrong++;
    data[k].last = Date.now();
    data[k].lastResult = result;
    data[k].recent = (data[k].recent || []).concat(result).slice(-MAX_RECENT);
    save(data);
    return data[k];
  }

  function get(word) {
    const data = load();
    return data[id(word)] || { correct: 0, wrong: 0, last: 0, lastResult: '', recent: [] };
  }

  // ─── Filters & round building ────────────────────────────────────
  function filter(deck, type) {
    if (type === 'all' || !type) return deck.slice();
    const data = load();
    return deck.filter(function (w) {
      const s = data[id(w)];
      const seen = s && (s.correct + s.wrong) > 0;
      if (type === 'unseen')        return !seen;
      if (type === 'seen')          return seen;
      if (type === 'wrong-ever')    return seen && s.wrong > 0;
      if (type === 'wrong-recent') {
        if (!seen) return false;
        const last3 = (s.recent || []).slice(-3);
        return last3.indexOf('wrong') !== -1;
      }
      if (type === 'correct')       return seen && s.correct > s.wrong && s.lastResult === 'correct';
      return true;
    });
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildRound(deck, opts) {
    let pool = filter(deck, opts.source);
    if (pool.length === 0) return [];
    if (opts.order !== 'sequential') pool = shuffle(pool.slice());
    if (opts.size && opts.size < pool.length) pool = pool.slice(0, opts.size);
    return pool;
  }

  // ─── Aggregate stats ─────────────────────────────────────────────
  function stats(deck) {
    const data = load();
    let seen = 0, correct = 0, wrong = 0, totalMarks = 0, totalWrong = 0;
    deck.forEach(function (w) {
      const s = data[id(w)];
      if (!s) return;
      const n = s.correct + s.wrong;
      if (n === 0) return;
      seen++;
      totalMarks += n;
      totalWrong += s.wrong;
      if (s.correct > s.wrong) correct++;
      else if (s.wrong > 0)    wrong++;
    });
    return {
      total:    deck.length,
      seen:     seen,
      unseen:   deck.length - seen,
      correct:  correct,
      wrong:    wrong,
      reviews:  totalMarks,
      accuracy: totalMarks ? Math.round((100 * (totalMarks - totalWrong)) / totalMarks) : 0
    };
  }

  function reset() { save({}); }

  // ─── Export / import ─────────────────────────────────────────────
  function exportJson() {
    return JSON.stringify({
      schemaVersion: SCHEMA,
      user: user,
      exportedAt: new Date().toISOString(),
      cards: load()
    }, null, 2);
  }

  // Returns { ok: bool, count: int, error?: string }.  Replaces the
  // current user's data on success.  Accepts either the v1 wrapper
  // or a raw legacy cards map.
  function importJson(text) {
    if (!user) return { ok: false, error: 'no user signed in' };
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { ok: false, error: 'invalid JSON' }; }
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'expected an object' };
    }
    let cards;
    if (parsed.schemaVersion === SCHEMA && parsed.cards) cards = parsed.cards;
    else if (parsed.cards && typeof parsed.cards === 'object') cards = parsed.cards;
    else cards = parsed;     // legacy raw map
    // Validate + coerce field types · drop entries that don't have a
    // numeric id key with correct/wrong counters
    const valid = {};
    let count = 0;
    for (const k in cards) {
      const c = cards[k];
      if (!c || typeof c !== 'object') continue;
      if (!/^\d+$/.test(k)) continue;
      valid[k] = {
        correct:    Number(c.correct) || 0,
        wrong:      Number(c.wrong)   || 0,
        last:       Number(c.last)    || 0,
        lastResult: (c.lastResult === 'correct' || c.lastResult === 'wrong') ? c.lastResult : '',
        recent:     Array.isArray(c.recent)
                      ? c.recent.filter(x => x === 'correct' || x === 'wrong').slice(-MAX_RECENT)
                      : []
      };
      count++;
    }
    save(valid);
    return { ok: true, count: count };
  }

  return {
    setUser, getUser, getCurrentUser, logout,
    load, save, list, has, deleteUser,
    mark, get, filter, buildRound, stats, reset,
    exportJson, importJson,
  };
})();
