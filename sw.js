/* ═══════════════════════════════════════════
   PLAYIQ — Service Worker
   Strategy: Cache-first for app shell,
             Network-only for live API calls
═══════════════════════════════════════════ */

const CACHE = 'playiq-v2';

const BASE = self.registration.scope;

const APP_SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'styles.css',
  BASE + 'app.js',
  BASE + 'manifest.json',
  BASE + 'icon.svg',
];

/* ── INSTALL: pre-cache the app shell ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

/* ── ACTIVATE: remove old caches ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── FETCH: route requests ── */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go network-first for live API calls
  const isLiveAPI =
    url.hostname.includes('espn.com') ||
    url.hostname.includes('anthropic.com') ||
    url.hostname.includes('espncdn.com');

  if (isLiveAPI) {
    // Network only — live data must be fresh
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Cache-first for everything else (app shell, fonts, CDN assets)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Cache CDN assets (Chart.js, Google Fonts)
        if (
          url.hostname.includes('cdn.jsdelivr.net') ||
          url.hostname.includes('fonts.googleapis.com') ||
          url.hostname.includes('fonts.gstatic.com')
        ) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
