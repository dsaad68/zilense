import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePdfTarget, isFileTarget } from '../src/pdfviewer/target.js'

/* parsePdfTarget reads the PDF viewer's URL hash (#file=<url>) into a validated,
   allowed-scheme URL. Callers build an ENCODED hash; we also accept a RAW
   (un-encoded) URL as a fallback. Disallowed schemes resolve to '' so the viewer
   never fetches a javascript:/data:/extension URL. */

test('parsePdfTarget: decodes an encoded https target', () => {
  const url = 'https://example.com/a b.pdf?v=2'
  assert.equal(parsePdfTarget('#file=' + encodeURIComponent(url)), url)
})

test('parsePdfTarget: accepts a raw (un-encoded) https target', () => {
  assert.equal(parsePdfTarget('#file=https://example.com/doc.pdf'),
    'https://example.com/doc.pdf')
})

test('parsePdfTarget: accepts a raw query string', () => {
  assert.equal(parsePdfTarget('#file=https://example.com/doc.pdf?id=7'),
    'https://example.com/doc.pdf?id=7')
})

test('parsePdfTarget: accepts file:// targets', () => {
  assert.equal(parsePdfTarget('#file=file:///home/u/book.pdf'),
    'file:///home/u/book.pdf')
  assert.ok(isFileTarget('file:///home/u/book.pdf'))
  assert.ok(!isFileTarget('https://example.com/book.pdf'))
})

test('parsePdfTarget: accepts a bare encoded url with no file= prefix', () => {
  const url = 'https://example.com/doc.pdf'
  assert.equal(parsePdfTarget('#' + encodeURIComponent(url)), url)
})

test('parsePdfTarget: rejects disallowed schemes', () => {
  assert.equal(parsePdfTarget('#file=' + encodeURIComponent('javascript:alert(1)')), '')
  assert.equal(parsePdfTarget('#file=' + encodeURIComponent('data:application/pdf;base64,AAAA')), '')
  assert.equal(parsePdfTarget('#file=' + encodeURIComponent('chrome-extension://abc/x.pdf')), '')
})

test('parsePdfTarget: rejects empty / malformed / non-string hashes', () => {
  assert.equal(parsePdfTarget(''), '')
  assert.equal(parsePdfTarget('#'), '')
  assert.equal(parsePdfTarget('#file='), '')
  assert.equal(parsePdfTarget('#file=not a url'), '')
  assert.equal(parsePdfTarget(null), '')
  assert.equal(parsePdfTarget(undefined), '')
})
