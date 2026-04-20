/* ═══════════════════════════════════════════
   PLAYIQ — Service Worker
   Strategy: Cache-first for app shell,
             Network-only for live API calls
═══════════════════════════════════════════ */

const CACHE = 'playiq-v9';

const BASE = self.registration.scope;

const APP_SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'styles.css',
  BASE + 'app.js',
  BASE + 'sports/nba/config.js',
  BASE + 'sports/mlb/config.js',
  BASE + 'sports/nhl/config.js',
  BASE + 'sports/ncaab/config.js',
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
    // Network only — bypass ALL caches for live data
    const fresh = new Request(e.request, { cache: 'no-store' });
    e.respondWith(fetch(fresh).catch(() => new Response('', { status: 503 })));
    return;
  }

  const isAppShell =
    url.hostname === self.location.hostname &&
    (url.pathname.endsWith('.html') ||
     url.pathname.endsWith('.css') ||
     url.pathname.endsWith('.js') ||
     url.pathname === new URL(BASE).pathname);

  if (isAppShell) {
    // Network-first for app shell — always get latest, fall back to cache
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for CDN assets (Chart.js, Google Fonts)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
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
