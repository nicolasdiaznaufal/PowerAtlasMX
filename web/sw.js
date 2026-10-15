// Service worker: app shell precached; data network-first with cache fallback so visited nodes work offline.
// Bump VERSION whenever any app file or the data schema changes.
const VERSION = 'nsv-v5-v2bypass';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const APP = [
  './', 'index.html', 'manifest.webmanifest',
  'assets/css/app.css', 'assets/css/tokens.css',
  'assets/js/app.js', 'assets/js/analysis.js', 'assets/js/calc.js', 'assets/js/charts.js', 'assets/js/common.js', 'assets/js/contract.js', 'assets/js/contrast.js',
  'assets/js/data.js', 'assets/js/data-pure.js', 'assets/js/sec-map-pure.js', 'assets/js/engine.js', 'assets/js/finclient.js', 'assets/js/finmodel.js', 'assets/js/finworker.js', 'assets/js/fmt.js', 'assets/js/format.js',
  'assets/js/geomap.js', 'assets/js/mapmetric.js', 'assets/js/names.js', 'assets/js/params.js', 'assets/js/sec-map.js', 'assets/js/sec-meta.js', 'assets/js/sec-money.js',
  'assets/js/sec-node.js', 'assets/js/sec-story.js', 'assets/js/sec-story-pure.js', 'assets/js/tex.js', 'assets/js/util.js', 'assets/js/worker.js',
  'assets/vendor/chartjs/chart.umd.js', 'assets/vendor/katex/katex.min.js', 'assets/vendor/katex/katex.min.css',
  'assets/fonts/bricolage-grotesque-latin-600-normal.woff2', 'assets/fonts/bricolage-grotesque-latin-700-normal.woff2', 'assets/fonts/bricolage-grotesque-latin-800-normal.woff2',
  'assets/fonts/dm-sans-latin-400-normal.woff2', 'assets/fonts/dm-sans-latin-500-normal.woff2', 'assets/fonts/dm-sans-latin-600-normal.woff2',
  'assets/fonts/dm-mono-latin-400-normal.woff2', 'assets/fonts/dm-mono-latin-500-normal.woff2',
  'assets/geo/mx.json', 'assets/img/repsa-logo.png', 'assets/img/pvlib-logo.png', 'assets/icons/icon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'data/index.json', 'data/disponibles.json', 'data/analysis/analysis.json', 'data/analysis/analysis_nodos.json', 'data/derived/geography.json', 'data/derived/series_areas.json',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(APP.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/v2/')) return;
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(DATA).then((c) => c.put(req, cp)); } return r; }).catch(() => caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(SHELL).then((c) => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
