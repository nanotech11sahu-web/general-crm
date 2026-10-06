// App-shell service worker: static assets are cache-first, pages network-first with an offline fallback.
// API calls and the event stream are never cached (they carry private lead data).
const CACHE = 'leaddesk-shell-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/icon.svg', '/manifest.webmanifest'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/v1/')) return;
  if (url.pathname.startsWith('/_next/static/') || url.pathname === '/icon.svg') {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })));
    return;
  }
  if (e.request.mode === 'navigate') e.respondWith(fetch(e.request).catch(() => new Response('<!doctype html><meta name=viewport content="width=device-width"><body style="font:16px system-ui;padding:24px"><h1>You are offline</h1><p>Reconnect to see your leads.</p>', { headers: { 'content-type': 'text/html' } })));
});
