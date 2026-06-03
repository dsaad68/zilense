import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toAnkiTsv } from '../src/lib/anki.js'

const HEADER = '#separator:tab\n#html:true\n#columns:Hanzi\tPinyin\tMeaning\n'

test('toAnkiTsv: header directives + tab-separated rows', () => {
  const out = toAnkiTsv([{ w: '学习', p: 'xuéxí', m: 'to study; to learn' }])
  const lines = out.split('\n')
  assert.equal(lines[0], '#separator:tab')
  assert.equal(lines[1], '#html:true')
  assert.equal(lines[2], '#columns:Hanzi\tPinyin\tMeaning')
  assert.equal(lines[3], '学习\txuéxí\tto study; to learn')
  assert.equal(out.endsWith('\n'), true)
})

test('toAnkiTsv: drops cards without a hanzi', () => {
  const out = toAnkiTsv([{ w: '', p: 'x', m: 'y' }, { w: '好', p: 'hǎo', m: 'good' }, null])
  const rows = out.split('\n').filter((l) => l && !l.startsWith('#'))
  assert.deepEqual(rows, ['好\thǎo\tgood'])
})

test('toAnkiTsv: sanitizes tabs and newlines so columns never shift', () => {
  const out = toAnkiTsv([{ w: '中', p: 'zhōng', m: 'middle\tcenter\nmid' }])
  const row = out.split('\n').find((l) => l.startsWith('中'))
  assert.equal(row, '中\tzhōng\tmiddle center<br>mid')
})

test('toAnkiTsv: missing pinyin/meaning become empty fields', () => {
  const out = toAnkiTsv([{ w: '门' }])
  assert.ok(out.includes('\n门\t\t\n'))
})

test('toAnkiTsv: empty or missing input yields just the header', () => {
  assert.equal(toAnkiTsv([]), HEADER)
  assert.equal(toAnkiTsv(), HEADER)
})
