// =============================================================
// Patrimônio · Service Worker — Network-First (sempre atualizado)
// =============================================================
const CACHE_VERSION = 'v1.5.0';
const CACHE_NAME = `patrimonio-${CACHE_VERSION}`;

// INSTALL: ativa imediatamente sem esperar
self.addEventListener('install', e => {
  self.skipWaiting();
});

// ACTIVATE: apaga caches antigos e assume controle
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// FETCH: network-first para TUDO
// Sempre tenta a rede. Só usa cache se a rede falhar (offline).
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(resp => {
        // Salva cópia no cache só se resposta válida
        if (resp && resp.status === 200) {
          const cloned = resp.clone();
          caches.open(CACHE_NAME)
            .then(c => c.put(e.request, cloned))
            .catch(() => {});
        }
        return resp;
      })
      .catch(() => {
        // Offline: tenta cache
        return caches.match(e.request)
          .then(r => r || caches.match('./dashboard-patrimonio.html'));
      })
  );
});

// Mensagem para forçar atualização
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
