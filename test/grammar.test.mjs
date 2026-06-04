import { test } from 'node:test'
import assert from 'node:assert/strict'
import { grammarFor } from '../src/lib/grammar.js'

test('grammarFor: the named particles have a note + a Grammar Wiki link', () => {
  for (const p of ['了', '的', '地', '得', '把', '被']) {
    const g = grammarFor(p)
    assert.ok(g, `expected a grammar entry for ${p}`)
    assert.ok(typeof g.note === 'string' && g.note.length > 0, `note for ${p}`)
    assert.match(g.url, /^https:\/\/resources\.allsetlearning\.com\/chinese\/grammar\//)
    // the URL targets the character's disambiguation page
    assert.ok(g.url.includes(encodeURIComponent(p)), `${p} appears in its URL`)
  }
})

test('grammarFor: non-function words return null', () => {
  assert.equal(grammarFor('中国'), null)
  assert.equal(grammarFor('猫'), null)
  assert.equal(grammarFor(''), null)
  assert.equal(grammarFor(undefined), null)
})
