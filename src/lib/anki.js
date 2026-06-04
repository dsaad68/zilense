/* anki.js — turn dictionary cards into an Anki-importable, tab-separated file.

   Pure (no DOM), so it's unit-testable in plain Node; the Blob/<a download>
   glue lives in the callers (the flashcards page and the side panel's Saved
   tab). Output leads with Anki's file-header directives so a plain .txt imports
   cleanly without the user touching the import dialog:

     #separator:tab
     #html:true
     #columns:Hanzi  Pinyin  Meaning

   then one tab-separated row per card. Because html:true is set, a newline in a
   field becomes <br>; a literal tab becomes a space so a stray tab can't shift
   the columns. */

const HEADER = ['#separator:tab', '#html:true', '#columns:Hanzi\tPinyin\tMeaning']

// sanitize one field for a tab-separated, html:true file
function field(s) {
  return String(s == null ? '' : s)
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, '<br>')
    .trim()
}

/* toAnkiTsv(cards) — cards are { w, p, m } (hanzi / pinyin / meaning), the same
   shape the flashcards page builds via lookup(). Cards without a hanzi (`w`) are
   dropped. Returns the full file contents as a string (trailing newline). */
export function toAnkiTsv(cards) {
  const rows = (cards || [])
    .filter((c) => c && c.w)
    .map((c) => [field(c.w), field(c.p), field(c.m)].join('\t'))
  return HEADER.concat(rows).join('\n') + '\n'
}
