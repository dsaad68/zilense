import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { htmlToParas, fallbackParas, blockParas } from '../src/content/reader-extract.js'

/* Reader article extraction (the DOMParser/querySelectorAll logic that turns a
   page or Readability's cleaned HTML into paragraph strings). Previously only
   reachable in a real browser; happy-dom gives it a DOM under node:test. We use a
   per-test Window so no globals are touched. */
const window = new Window()
const parser = new window.DOMParser()

// build a live document (for the fallbackParas path) from a body fragment
function docWith(bodyHTML) {
  const w = new Window()
  w.document.body.innerHTML = bodyHTML
  return w.document
}

test('htmlToParas: keeps only block elements containing Han, normalizing whitespace', () => {
  const html = `
    <article>
      <h2>学习中文</h2>
      <p>  我  喜欢\n学习中文。 </p>
      <p>Hello, this is English only.</p>
      <p></p>
      <li>第一条</li>
      <pre>代码示例</pre>
    </article>`
  const paras = htmlToParas(html, parser)
  assert.deepEqual(paras, ['学习中文', '我 喜欢 学习中文。', '第一条', '代码示例'])
  // the English-only and empty <p> are dropped; whitespace is collapsed
})

test('htmlToParas: empty/missing html or parser yields an empty list', () => {
  assert.deepEqual(htmlToParas('', parser), [])
  assert.deepEqual(htmlToParas(null, parser), [])
  assert.deepEqual(htmlToParas('<p>你好</p>', null), [])
})

test('htmlToParas: caps the result at 400 paragraphs', () => {
  const many = Array.from({ length: 450 }, (_, i) => `<p>第${i}段中文</p>`).join('')
  const paras = htmlToParas(many, parser)
  assert.equal(paras.length, 400)
  assert.equal(paras[0], '第0段中文')
})

test('fallbackParas: collects <p> with Han from the live document, ignores other blocks', () => {
  const doc = docWith('<h2>标题</h2><p>第一段中文</p><p>only english</p><div>块级但非段落</div><p>第二段</p>')
  // fallback only scans <p> (not h2/div), and only those with Han
  assert.deepEqual(fallbackParas(doc), ['第一段中文', '第二段'])
})

test('blockParas: a non-element root (no querySelectorAll) is safe', () => {
  assert.deepEqual(blockParas(null), [])
  assert.deepEqual(blockParas({}), [])
})
