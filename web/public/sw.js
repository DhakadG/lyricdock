// LyricDock web app service worker: the app shell works offline and opens instantly.
// One cache per version (lyricdock-<version>); the build stamps the version and the file list.
// The app's own caches (dock-videos, dock-lyrics) are left alone. Cross-origin requests are never touched.
const VERSION = '__VERSION__';
const SHELL = `lyricdock-${VERSION}`;
const FILES = __FILES__; // every file of the build, relative to the scope ('./' is the app page)
// The asset server answers /index.html with a redirect to /, and a redirected response can't serve a page load.
const clean = r => r && r.redirected ? new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers }) : r;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  // No skipWaiting here: the page decides when to switch (Settings -> Updates, or "Update automatically").
});

self.addEventListener('message', e => { if (e.data === 'apply-update') self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('lyricdock-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Page loads (/, /callback?code=..., anything else) all get the app; the query string stays for the app to read.
  if (req.mode === 'navigate' && !url.pathname.startsWith('/player')) {
    e.respondWith(caches.match('./', { cacheName: SHELL }).then(r => clean(r) || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { cacheName: SHELL, ignoreSearch: url.pathname !== '/player' }).then(r => clean(r) || fetch(req)));
});
