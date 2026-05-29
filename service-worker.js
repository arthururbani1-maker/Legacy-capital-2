// =============================================================
// Patrimônio · Service Worker
// Offline-first com network-first para HTML (atualização automática)
// =============================================================
const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `patrimonio-${CACHE_VERSION}`;

const CORE_ASSETS = [
  './',
  './dashboard-patrimonio.html',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-512-maskable.png',
  './assets/icons/apple-touch-icon.png'
];

// INSTALL: pre-cache core assets
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS).catch(err => {
        console.warn('[SW] pre-cache parcial:', err);
      }))
  );
});

// ACTIVATE: delete old caches and take over open pages
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// FETCH strategy:
// - HTML / navigation → network-first (always try fresh, fallback to cache)
// - Same-origin assets → cache-first with background refresh
// - Cross-origin (CDN) → network with cache fallback
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;

  // Navigation requests: network-first
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          if (resp && resp.status === 200 && sameOrigin) {
            const cloned = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, cloned));
          }
          return resp;
        })
        .catch(() =>
          caches.match(e.request).then(r =>
            r || caches.match('./dashboard-patrimonio.html')
          )
        )
    );
    return;
  }

  // Same-origin assets: cache-first
  if (sameOrigin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) {
          // Background refresh
          fetch(e.request).then(resp => {
            if (resp && resp.status === 200) {
              caches.open(CACHE_NAME).then(c => c.put(e.request, resp.clone()));
            }
          }).catch(()=>{});
          return cached;
        }
        return fetch(e.request).then(resp => {
          if (resp && resp.status === 200) {
            const cloned = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, cloned));
          }
          return resp;
        });
      })
    );
    return;
  }

  // Cross-origin (CDN libs): try network, fallback to cache
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        if (resp && resp.status === 200) {
          const cloned = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, cloned)).catch(()=>{});
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});

// Allow page to trigger immediate update activation
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
