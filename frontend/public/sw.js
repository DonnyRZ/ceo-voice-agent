/* No API, account, timesheet, voice, or authenticated HTML is cached. */
const cacheName = 'rk-public-v2';
const publicFiles = ['/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/offline.html', '/pwa/inter-latin.woff2'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(publicFiles)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('rk-public-') && key !== cacheName)
      .map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/pwa/offline.html')));
  } else if (publicFiles.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
});
