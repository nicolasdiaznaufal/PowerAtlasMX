// v2 routing: selection sync must never write a stale path; ids validated; URL normalised; Back/Forward restore entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, serializeSel } from '../v2/assets/js/store.js';
import { createRouter, resolveHash } from '../v2/assets/js/route-logic.js';

const valid = { node: (id) => ['01AAN-85', '01XAL-230'].includes(id), state: (k) => ['JALISCO', 'YUCATAN'].includes(k), region: (k) => ['NORTE'].includes(k) };
const many = { node: () => false, state: () => true, region: () => false };

/** fake browser history: push = user navigation, back/forward = traversal, replace = replaceState */
function harness() {
  const store = createStore();
  const hist = [];
  let i = -1;
  const replace = (h) => { hist[i] = h; };
  const router = createRouter({ store, valid: () => valid, replace, currentHash: () => hist[i] });
  const h = {
    store, hist, router,
    get url() { return hist[i]; },
    push(hash) { hist.length = i + 1; hist.push(hash); i++; return router.resolve(hash); },
    navigateUnresolved(hash) { hist.length = i + 1; hist.push(hash); i++; },
    back() { i--; return router.resolve(hist[i]); },
    forward() { i++; return router.resolve(hist[i]); },
  };
  return h;
}

test('forward navigation with a different sel writes the NEW path (regression: stale curPath)', () => {
  const h = harness();
  h.push('#/choose?sel=01AAN-85');
  assert.equal(h.url, '#/choose?sel=01AAN-85');
  h.push('#/explorer?sel=state:JALISCO');
  assert.equal(h.url, '#/explorer?sel=state:JALISCO');
  assert.equal(serializeSel(h.store.get()), 'state:JALISCO');
});

test('Back and Forward restore each entry exactly', () => {
  const h = harness();
  h.push('#/map?sel=01AAN-85');
  h.push('#/choose?sel=01AAN-85');
  h.push('#/explorer?sel=state:JALISCO');
  h.back();
  assert.equal(h.url, '#/choose?sel=01AAN-85');
  assert.equal(serializeSel(h.store.get()), '01AAN-85');
  h.back();
  assert.equal(h.url, '#/map?sel=01AAN-85');
  h.forward(); h.forward();
  assert.equal(h.url, '#/explorer?sel=state:JALISCO');
  assert.equal(serializeSel(h.store.get()), 'state:JALISCO');
  assert.deepEqual(h.hist, ['#/map?sel=01AAN-85', '#/choose?sel=01AAN-85', '#/explorer?sel=state:JALISCO']);
});

test('deep link: unknown ids dropped, national counts as one, URL normalised', () => {
  const h = harness();
  const r = h.push('#/explorer?sel=01AAN-85,ZZZ-BOGUS,state:JALISCO,national,state:YUCATAN');
  assert.equal(r.path, '/explorer');
  assert.equal(h.url, '#/explorer?sel=01AAN-85,state:JALISCO,national,state:YUCATAN');
  assert.equal(h.store.get().length, 4);
});

test('compare cap is 16 places: the 17th and later ids of a deep link are dropped', () => {
  const sel = Array.from({ length: 20 }, (_, i) => `state:S${i}`).join(',');
  const r = resolveHash(`#/explorer?sel=${sel}`, many);
  assert.equal(r.list.length, 16);
  assert.equal(r.list[15].id, 'S15');
});

test('unknown route normalises to #/; selection-less analysis route redirects to #/map', () => {
  assert.equal(resolveHash('#/nonsense', valid).hash, '#/');
  assert.equal(resolveHash('#/explorer?sel=BOGUS', valid).path, '/map');
  const h = harness();
  h.push('#/revenue');
  assert.equal(h.url, '#/map');
});

test('selection changes on the current route keep that route in the URL', () => {
  const h = harness();
  h.push('#/map?sel=01AAN-85');
  h.store.add({ kind: 'state', id: 'JALISCO' });
  assert.equal(h.url, '#/map?sel=01AAN-85,state:JALISCO');
});

test('a hash without sel inherits the current selection and is rewritten to carry it', () => {
  const h = harness();
  h.push('#/map?sel=01AAN-85');
  h.push('#/');
  assert.equal(h.url, '#/');
  const r = h.push('#/map');
  assert.equal(r.path, '/map');
  assert.equal(h.url, '#/map?sel=01AAN-85');
  assert.equal(serializeSel(h.store.get()), '01AAN-85');
  h.push('#/explorer');
  assert.equal(h.url, '#/explorer?sel=01AAN-85');
});

test('landing ignores sel in the URL and keeps the held selection', () => {
  const h = harness();
  h.push('#/map?sel=01AAN-85');
  h.push('#/?sel=state:JALISCO');
  assert.equal(h.url, '#/');
  assert.equal(serializeSel(h.store.get()), '01AAN-85');
});

test('a selection change while a navigation is still queued does not overwrite the new URL', () => {
  const h = harness();
  h.push('#/map?sel=01AAN-85');
  h.navigateUnresolved('#/choose?sel=01AAN-85'); // URL already moved, router still on /map (transition running)
  h.store.add({ kind: 'state', id: 'JALISCO' });
  assert.equal(h.url, '#/choose?sel=01AAN-85');
  assert.equal(h.hist[0], '#/map?sel=01AAN-85');
  h.router.resolve(h.url); // the queued navigation resolves later and wins
  assert.equal(serializeSel(h.store.get()), '01AAN-85');
});

test("price basis lives in the URL as &real=1 and survives navigation, Back and reload", () => {
  const h = harness();
  h.push('#/explorer?sel=01AAN-85&real=1');
  assert.equal(h.store.real, true);
  assert.equal(h.url, '#/explorer?sel=01AAN-85&real=1');
  h.push('#/revenue?sel=01AAN-85&real=1');
  h.store.setReal(false);                              // user flips the toggle on this entry
  assert.equal(h.url, '#/revenue?sel=01AAN-85');
  h.back();
  assert.equal(h.store.real, true);                    // previous entry restored exactly
  assert.equal(h.url, '#/explorer?sel=01AAN-85&real=1');
  h.forward();
  assert.equal(h.store.real, false);
  // reload = resolving the same hash on a fresh router
  const h2 = harness();
  h2.push('#/revenue?sel=state:JALISCO&real=1');
  assert.equal(h2.store.real, true);
  assert.equal(h2.url, '#/revenue?sel=state:JALISCO&real=1');
  // a bare hash inherits the basis
  h2.push('#/map');
  assert.equal(h2.url, '#/map?sel=state:JALISCO&real=1');
});
