// PowerAtlasMx v2 service worker, scope /v2/. Small on purpose:
//  - app shell + fonts + hero: stale-while-revalidate (instant repeat visits, updated in the background)
//  - data JSON: network first, the cached copy is only an offline fallback (never served while online)
//  - navigations: network first, cached shell or offline.html when offline
// Bump VERSION on every release that changes the shell; old caches are deleted on activate.
const VERSION = 'v2-m7-1';
const SHELL = `v2-shell-${VERSION}`;
const DATA = `v2-data-${VERSION}`;
importScripts('sw-strategy.js');
const CORE = ['./', 'offline.html', 'main.js', 'config.js', 'assets/css/tokens.css', 'assets/css/base.css', 'assets/css/map.css', 'assets/css/landing.css', 'assets/css/flow.css', 'assets/css/explorer.css',
  'assets/fonts/Geist-Variable.woff2', 'assets/fonts/GeistMono-Variable.woff2', 'assets/img/hero-sun-1000.webp', 'assets/icons/eclipse.svg', 'assets/js/landing.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('v2-') && k !== SHELL && k !== DATA).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (name, req, res) => { if (res && res.ok) { const cp = res.clone(); caches.open(name).then((c) => c.put(req, cp)); } return res; };
const offline = () => caches.match('offline.html');

const handlers = {
  navigate: (req) => fetch(req).then((r) => put(SHELL, req, r)).catch(() => caches.match(req).then((h) => h || caches.match('./')).then((h) => h || offline())),
  static: (req) => caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => put(SHELL, req, r)).catch(() => hit || Response.error());
    return hit || net;
  }),
  data: (req) => fetch(req).then((r) => put(DATA, req, r)).catch(() => caches.match(req).then((h) => h || Response.error())),
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const s = self.swStrategy.strategyFor(url.pathname, req.mode);
  if (s === 'bypass') return;
  e.respondWith(handlers[s](req));
});
