// ====================================================================
// service-worker.js · minimal offline cache for the HSK-1 trainer.
//
//  · Same-origin static assets: cache-first, fallback to network, cache
//    new responses opportunistically.  Falls back to index.html on hard
//    network errors (so offline navigation lands somewhere usable).
//  · Cross-origin (FontShare, Google Fonts): network-first, cache the
//    successful response so a second offline visit still has the fonts.
//
// Bump CACHE_NAME when you ship a new version — the activate hook
// purges any older cache so users don't get stuck on stale code.
// ====================================================================

const CACHE_NAME = 'hsk1-trainer-v13';

const STATIC_ASSETS = [
  './',
  './index.html',
  './cheatsheet.html',
  './flashcard.css',
  './data.js',
  './users.js',
  './icon.svg',
  './icon-maskable.svg',
  './manifest.webmanifest',
  './cheatsheet/direction.png',
  './cheatsheet/wh-how-questions.png',
  './cheatsheet/reading-time.png',
  './cheatsheet/reading-date.png',
  './cheatsheet/couting-10000.png',
  './cheatsheet/time-day.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(resp => {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
          }
          return resp;
        }).catch(() => caches.match('./index.html'));
      })
    );
  } else {
    // Third-party (fonts) — network-first, cache successful responses
    event.respondWith(
      fetch(req).then(resp => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match(req))
    );
  }
});
