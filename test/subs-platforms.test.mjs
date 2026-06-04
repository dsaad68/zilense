import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectPlatform } from '../src/content/subs/platforms.js'

/* The subtitle content script runs in EVERY frame (content.js is all_frames), so its
   host gate must match only the surfaces that actually carry a video player. A login
   iframe like accounts.youtube.com has a strict CSP and no player — matching it would
   make the engine chunk fail to dynamically import (CSP block) for nothing. These
   tests pin which hosts the adapter accepts. */

test('detectPlatform: accepts the YouTube surfaces that have a player', () => {
  for (const h of ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com',
    'www.youtube-nocookie.com', 'youtube-nocookie.com']) {
    assert.equal(detectPlatform(h)?.id, 'youtube', `${h} -> youtube adapter`)
  }
})

test('detectPlatform: rejects YouTube login/creator subdomains (no player, strict CSP)', () => {
  for (const h of ['accounts.youtube.com', 'studio.youtube.com', 'consent.youtube.com', 'tv.youtube.com']) {
    assert.equal(detectPlatform(h), null, `${h} -> no adapter`)
  }
})

test('detectPlatform: Coursera and unrelated hosts', () => {
  assert.equal(detectPlatform('www.coursera.org')?.id, 'coursera')
  assert.equal(detectPlatform('learn.coursera.org')?.id, 'coursera')
  assert.equal(detectPlatform('example.com'), null)
  assert.equal(detectPlatform('notyoutube.com'), null)
})
