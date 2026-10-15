// v2 service worker routing: which requests are cached how.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { strategyFor, staleCaches, storeResponse } = createRequire(import.meta.url)('../v2/sw-strategy.js');
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { precacheList, moduleGraph, contentHash } from '../v2/tools/precache-manifest.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));

test('navigations under /v2/ are network-first', () => {
  assert.equal(strategyFor('/v2/', 'navigate'), 'navigate');
  assert.equal(strategyFor('/v2/index.html', 'navigate'), 'navigate');
});
test('v2 app files and the v1 pure modules it reuses are cache-first within the release', () => {
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

test('precache.js lists every module main.js can load (static and dynamic imports) and every stylesheet: no blank page offline', () => {
  const src = readFileSync(join(HERE, '..', 'v2', 'precache.js'), 'utf8');
  const list = JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));
  assert.deepEqual(list, precacheList(), 'precache.js is stale: run node web/v2/tools/precache-manifest.mjs --write');
  for (const f of moduleGraph()) {
    const rel = f.split('/web/')[1];
    const url = rel.startsWith('v2/') ? rel.slice(3) : `../${rel}`;
    assert.ok(list.includes(url), `${url} missing from the precache list`);
  }
  for (const must of ['./', 'index.html', 'offline.html', 'main.js', 'assets/js/shell.js', 'assets/js/live.js', '../assets/js/format.js', '../assets/js/names.js', '../assets/js/geomap.js', 'assets/vendor/deckgl/deck.min.js', 'assets/fonts/Geist-Variable.woff2']) assert.ok(list.includes(must), must);
});

test("only stale v2 caches are deleted by the v2 worker; v1's worker would delete all of them (hence the refill + inline fallback)", () => {
  assert.deepEqual(staleCaches(['v2-shell-v2-m7-3', 'v2-shell-v2-m7-4', 'v2-data', 'nsv-v5-v2bypass-shell'], 'v2-shell-v2-m7-4', 'v2-data'), ['v2-shell-v2-m7-3']);
  // v1's rule, read from its source: caches that do not start with its VERSION are deleted
  const v1 = readFileSync(join(HERE, '..', 'sw.js'), 'utf8');
  assert.match(v1, /!k\.startsWith\(VERSION\)/);
  const v1Version = /const VERSION = '([^']+)'/.exec(v1)[1];
  for (const name of ['v2-shell-v2-m7-4', 'v2-data']) assert.equal(name.startsWith(v1Version), false, `${name} is removed by v1`);
  const v2 = readFileSync(join(HERE, '..', 'v2', 'sw.js'), 'utf8');
  assert.match(v2, /inlineOffline/);                 // the fallback never resolves undefined
  assert.match(v2, /precache\(\)\.catch/);            // missing shell is re-filled from the network
  assert.match(v2, /clients\.claim/);              // a new release takes over at once; the page reloads on controllerchange
  assert.match(v2.split("addEventListener('install'")[1].split('\n')[0], /precache\(\)\.then\(\(\) => self\.skipWaiting\(\)\)/); // skip waiting only after the whole shell is cached
  assert.match(v2, /cache: 'reload'/);               // never a stale HTTP-cached copy in a release
});

test('storeResponse clones BEFORE async work: the page may consume the body first (regression: v2-data stayed empty)', async () => {
  const stored = [];
  const cachesApi = { open: async () => ({ put: async (req, res) => { await new Promise((r) => setTimeout(r, 5)); stored.push([req, await res.text()]); } }) };
  const res = new Response('{"nodos":[1,2,3]}', { status: 200 });
  const p = storeResponse(cachesApi, 'v2-data', '/data/index.json', res, () => {});
  assert.equal(await res.text(), '{"nodos":[1,2,3]}');      // the page reads the original right away
  assert.equal(await p, true);
  assert.deepEqual(stored, [['/data/index.json', '{"nodos":[1,2,3]}']]);
});

test('storeResponse skips non-200 and opaque responses, and warns once (never silently) when caching fails', async () => {
  const warns = [];
  const ok = { open: async () => ({ put: async () => {} }) };
  assert.equal(await storeResponse(ok, 'x', 'r', new Response('a', { status: 206 }), (m) => warns.push(m)), false);
  assert.equal(await storeResponse(ok, 'x', 'r', null, (m) => warns.push(m)), false);
  assert.equal(warns.length, 0);
  const failing = { open: async () => ({ put: async () => { throw new Error('quota'); } }) };
  assert.equal(await storeResponse(failing, 'x', 'r', new Response('a'), (m) => warns.push(m)), false);
  assert.equal(await storeResponse(failing, 'x', 'r', new Response('a'), (m) => warns.push(m)), false);
  assert.equal(warns.length, 1, 'warned once');
});

test('the cache VERSION carries the hash of the precached files: a shell edit without a version bump fails', () => {
  const sw = readFileSync(join(HERE, '..', 'v2', 'sw.js'), 'utf8');
  const v = /const VERSION = '([^']+)'/.exec(sw)[1];
  assert.equal(v.endsWith(`-${contentHash()}`), true, `VERSION ${v} is stale for the current shell files: run node web/v2/tools/precache-manifest.mjs --write`);
});
