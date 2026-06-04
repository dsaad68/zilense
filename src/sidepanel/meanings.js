/* meanings.js — pure grouping of an entry's meanings for the side-panel display.

   The entry view shows meanings as a single continuously-numbered list, split
   into source groups with a header each:

     hskFirst = true            hskFirst = false
     ----------------           ----------------
     HSK                        CC-CEDICT
       1. …                       1. …
     CC-CEDICT                    2. …
       2. …                       3. …
       3. …                     HSK
     Other                        4. …
       4. …                     Other
                                  5. …

   "HSK" comes from the official HSK glossary (entry.hskSenses), "CC-CEDICT" from
   the primary definitions (entry.defs), and "Other" from the alternate readings
   (entry.alts) — each alt reading is one item. Only non-empty groups are kept;
   the HSK group leads or trails the CC-CEDICT group depending on hskFirst, and
   "Other" always comes last. Numbering is continuous across the groups (handled
   in the view via a CSS counter), so a `start` index is provided per group for
   non-CSS consumers / tests. */

export function buildMeaningGroups(entry, hskFirst = false) {
  const e = entry || {}
  const hskSenses = Array.isArray(e.hskSenses) ? e.hskSenses : []
  const defs = Array.isArray(e.defs) ? e.defs : []
  const alts = Array.isArray(e.alts) ? e.alts : []

  const hskGroup = hskSenses.length ? { kind: 'hsk', label: 'HSK', count: hskSenses.length } : null
  const ccGroup = defs.length ? { kind: 'cc', label: 'CC-CEDICT', count: defs.length } : null
  const altGroup = alts.length ? { kind: 'alt', label: 'Other', count: alts.length } : null

  const ordered = (hskFirst ? [hskGroup, ccGroup, altGroup] : [ccGroup, hskGroup, altGroup]).filter(Boolean)

  // assign a continuous 1-based start number to each group
  let n = 1
  for (const g of ordered) {
    g.start = n
    n += g.count
  }
  return ordered
}
