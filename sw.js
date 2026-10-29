// Service worker de mistercard: permite instalar la web como app.
// Network-first: siempre contenido fresco; usa copia guardada solo sin conexión.
const CACHE = 'mistercard-v1';
// Solo "/": /index.html redirige a "/" y Safari no acepta respuestas redirigidas en navegaciones
const CORE = ['/'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const nav = req.mode === 'navigate';
  e.respondWith(
    fetch(req)
      .then((res) => {
        // Solo se guarda la portada; la calculadora o /admin/ no deben pisarla
        if (nav && res.ok && new URL(req.url).pathname === '/') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
        }
        return res;
      })
      // Sin conexión: la copia guardada; la portada solo para páginas, nunca para imágenes o la API
      .catch(() => caches.match(req).then((r) => r || (nav ? caches.match('/') : Response.error())))
  );
});
