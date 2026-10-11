// v2 service worker routing: which requests are cached how.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { strategyFor } = createRequire(import.meta.url)('../v2/sw-strategy.js');

test('navigations under /v2/ are network-first', () => {
  assert.equal(strategyFor('/v2/', 'navigate'), 'navigate');
  assert.equal(strategyFor('/v2/index.html', 'navigate'), 'navigate');
});
test('v2 app files and the v1 pure modules it reuses are stale-while-revalidate', () => {
  for (const p of ['/v2/main.js', '/v2/assets/css/tokens.css', '/v2/assets/fonts/Geist-Variable.woff2', '/v2/assets/img/hero-sun-2000.webp', '/v2/assets/vendor/deckgl/deck.min.js', '/assets/js/format.js', '/assets/js/names.js', '/assets/geo/mx.json']) assert.equal(strategyFor(p, 'cors'), 'static', p);
});
test('data JSON is network-first (never served from cache while online)', () => {
  for (const p of ['/data/index.json', '/data/analysis/analysis_nodos.json', '/data/derived/node_profiles.json']) assert.equal(strategyFor(p, 'cors'), 'data', p);
});
test('the worker itself and unrelated paths bypass the cache; v1 pages are left to the v1 worker', () => {
  assert.equal(strategyFor('/v2/sw.js', 'same-origin'), 'bypass');
  assert.equal(strategyFor('/v2/sw-strategy.js', 'same-origin'), 'bypass');
  assert.equal(strategyFor('/index.html', 'navigate'), 'bypass');
  assert.equal(strategyFor('/assets/css/app.css', 'no-cors'), 'bypass');
  assert.equal(strategyFor('/sw.js', 'same-origin'), 'bypass');
});
