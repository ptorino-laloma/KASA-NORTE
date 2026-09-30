// Service worker mínimo para que la app se pueda instalar en el celular.
// Estrategia: siempre red primero. La copia guardada solo se usa si no hay
// conexión, para mostrar la pantalla en vez de un error del navegador.
// Los datos (/api/*) nunca se guardan: sin conexión no se ven números viejos.
const CACHE = 'kasa-norte-v2';
const SHELL = ['/', '/app.js', '/calc.js', '/fonts/league-spartan-latin.woff2', '/fonts/figtree-latin.woff2', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request.mode === 'navigate' ? '/' : e.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(e.request.mode === 'navigate' ? '/' : e.request))
  );
});
