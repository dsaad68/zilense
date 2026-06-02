/* grammar.js — curated grammar/usage notes for common Chinese function words
   (particles, structural words, coverbs). Inspired by Zhongwen's grammar-link
   feature, but a small hand-picked set rather than a 400-keyword database.

   Each entry links to that character's page on the Chinese Grammar Wiki
   (AllSet Learning) — a disambiguation hub that lists every grammar point for the
   character, so it stays correct without us tracking individual article titles.
   The link is a plain external https URL (no host permission needed). */

const WIKI_BASE = 'https://resources.allsetlearning.com/chinese/grammar/'

// char -> short usage note. The wiki URL is derived from the character itself.
const NOTES = {
  了: 'Aspect particle: marks a completed action or a change of state / new situation.',
  的: 'Structural particle: marks possession or attaches a modifier to a noun (like “’s” / “of”).',
  地: 'Structural particle: turns an adjective into an adverb before a verb (like English “-ly”).',
  得: 'Structural particle: links a verb/adjective to a complement of degree or result (说得好).',
  把: '把 construction: moves the object before the verb to focus on what happens to it.',
  被: '被 construction: marks the passive voice — the subject receives the action.',
  在: 'Coverb / aspect: marks location (“at”) or, before a verb, an ongoing action (“-ing”).',
  过: 'Experiential aspect particle: marks that an action has been experienced before.',
  着: 'Durative aspect particle: marks a continuing state or accompanying action.',
  给: 'Coverb: introduces the recipient/beneficiary of an action (“to / for”).',
  让: 'Pivotal verb: “to let / make / have someone do something”.',
  就: 'Adverb: emphasizes immediacy, “then”, or “only / exactly”, depending on context.',
  才: 'Adverb: “only then / not until”, stressing that something happens late or only under a condition.',
  还: 'Adverb: “still / yet / also”, marking continuation or addition.',
  吧: 'Modal particle: softens a sentence into a suggestion, request, or supposition.',
  呢: 'Modal particle: forms a follow-up question or marks an ongoing situation.',
  吗: 'Question particle: turns a statement into a yes/no question.',
  没: 'Negation: negates 有 and past/completed actions (没有 / 没 + verb).',
  不: 'Negation: negates verbs, adjectives, and future/habitual actions.',
}

// grammarFor(q) -> { note, url } for a known function word, else null.
export function grammarFor(q) {
  const note = NOTES[q]
  if (!note) return null
  return { note, url: WIKI_BASE + encodeURIComponent(q) }
}
