import { test } from 'node:test'
import assert from 'node:assert/strict'

/* Reader article hand-off helpers (stashReaderArticle / takeReaderArticle /
   clearReaderArticle). These use chrome.storage.session, which has no node
   equivalent, so we install a minimal in-memory chrome.storage.session mock and
   import storage.js with a cache-busting query string so its module-level `session`
   binding picks up the mock (the un-queried instance other tests import binds to
   "no chrome" at first load and is unaffected). */
const PREFIX = 'mydict.reader.article.'

function installChromeSession(initial) {
  const store = new Map(initial ? Object.entries(initial) : [])
  const prev = globalThis.chrome
  globalThis.chrome = {
    storage: {
      session: {
        get: (keys, cb) => {
          const out = {}
          if (keys == null) for (const [k, v] of store) out[k] = v
          else for (const k of [].concat(keys)) if (store.has(k)) out[k] = store.get(k)
          cb(out)
        },
        set: (obj, cb) => { for (const k of Object.keys(obj)) store.set(k, obj[k]); cb && cb() },
        remove: (keys, cb) => { for (const k of [].concat(keys)) store.delete(k); cb && cb() },
      },
    },
  }
  return { store, restore: () => { globalThis.chrome = prev } }
}

let caseId = 0
const freshStorage = () => import(`../src/lib/storage.js?reader-stash=${++caseId}`)

test('reader stash: stores under a nonce and takeReaderArticle reads once', async () => {
  const { store, restore } = installChromeSession()
  try {
    const mod = await freshStorage()
    const nonce = await mod.stashReaderArticle({ title: 'x', paras: ['你好'] })
    assert.ok(nonce, 'returns a nonce')
    assert.ok(store.has(PREFIX + nonce), 'article stored under the nonce key')

    const art = await mod.takeReaderArticle(nonce)
    assert.equal(art.title, 'x', 'unwraps the stored article')
    assert.deepEqual(art.paras, ['你好'])
    assert.equal(store.has(PREFIX + nonce), false, 'removed after read (one-use)')
    assert.equal(await mod.takeReaderArticle(nonce), null, 'a replayed nonce yields nothing')
  } finally { restore() }
})

test('reader stash: a new stash sweeps entries older than the TTL', async () => {
  const { store, restore } = installChromeSession()
  const realNow = Date.now
  let t = 1_000_000
  globalThis.Date.now = () => t
  try {
    const mod = await freshStorage()
    const oldNonce = await mod.stashReaderArticle({ title: 'old' })
    assert.ok(store.has(PREFIX + oldNonce))

    t += 6 * 60 * 1000 // advance past the 5-minute TTL
    const newNonce = await mod.stashReaderArticle({ title: 'new' })

    assert.equal(store.has(PREFIX + oldNonce), false, 'orphaned stash swept on the next stash')
    assert.ok(store.has(PREFIX + newNonce), 'the fresh stash survives')
  } finally { globalThis.Date.now = realNow; restore() }
})

test('reader stash: takeReaderArticle treats an expired entry as missing', async () => {
  const { restore } = installChromeSession()
  const realNow = Date.now
  let t = 5_000_000
  globalThis.Date.now = () => t
  try {
    const mod = await freshStorage()
    const nonce = await mod.stashReaderArticle({ title: 'x' })
    t += 6 * 60 * 1000 // past the TTL before it's ever read
    assert.equal(await mod.takeReaderArticle(nonce), null, 'expired stash is not returned')
  } finally { globalThis.Date.now = realNow; restore() }
})

test('reader stash: clearReaderArticle removes an orphaned stash', async () => {
  const { store, restore } = installChromeSession()
  try {
    const mod = await freshStorage()
    const nonce = await mod.stashReaderArticle({ title: 'x' })
    await mod.clearReaderArticle(nonce)
    assert.equal(store.has(PREFIX + nonce), false, 'explicit cleanup removes the stash')
  } finally { restore() }
})
