// Network-first service worker: works offline for the app shell, never serves stale data.
const CACHE = 'forsa-v1-10';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(async (c) => {
        // Keep only the newest version of each file (app.js?v=…), so the cache never grows.
        const old = await c.keys();
        await Promise.all(old.filter((r) => { const u = new URL(r.url); return u.pathname === url.pathname && u.search !== url.search; }).map((r) => c.delete(r)));
        await c.put(e.request, copy);
      });
    }
    return res;
  }).catch(() => caches.match(e.request)));
});
