// v2 routing: selection sync must never write a stale path; ids validated; URL normalised; Back/Forward restore entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, serializeSel } from '../v2/assets/js/store.js';
import { createRouter, resolveHash } from '../v2/assets/js/route-logic.js';

const valid = { node: (id) => ['01AAN-85', '01XAL-230'].includes(id), state: (k) => ['JALISCO', 'YUCATAN'].includes(k), region: (k) => ['NORTE'].includes(k) };

/** fake browser history: push = user navigation, back/forward = traversal, replace = replaceState */
function harness() {
  const store = createStore();
  const hist = [];
  let i = -1;
  const replace = (h) => { hist[i] = h; };
  const router = createRouter({ store, valid: () => valid, replace });
  const h = {
    store, hist, router,
    get url() { return hist[i]; },
    push(hash) { hist.length = i + 1; hist.push(hash); i++; return router.resolve(hash); },
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

test('deep link: unknown ids dropped, cap 3, national counts as one, URL normalised', () => {
  const h = harness();
  const r = h.push('#/explorer?sel=01AAN-85,ZZZ-BOGUS,state:JALISCO,national,state:YUCATAN');
  assert.equal(r.path, '/explorer');
  assert.equal(h.url, '#/explorer?sel=01AAN-85,state:JALISCO,national');
  assert.equal(h.store.get().length, 3);
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
