import test from 'node:test';
import assert from 'node:assert/strict';
import { combine, scoreNode, normWeights, norm, buildSearch, search, percentile, areaSummary, modelsOf, FLOOR } from '../v2/assets/js/score-core.js';

const K = ['a', 'b'];
test('strict mode is a weighted geometric mean, a zero is lifted to the floor', () => {
  assert.ok(Math.abs(combine({ a: 1, b: 1 }, K, { a: 1, b: 1 }) - 100) < 1e-9);
  const v = combine({ a: 1, b: 0 }, K, { a: 1, b: 1 });
  assert.ok(Math.abs(v - 100 * Math.sqrt(FLOOR)) < 1e-9);
  assert.ok(v > 0);
  assert.ok(Math.abs(combine({ a: 1, b: 0 }, K, { a: 1, b: 1 }, 'linear') - 50) < 1e-9);
});
test('weights are normalised; zero total gives no score', () => {
  const w = normWeights(K, { a: 30, b: 10 });
  assert.ok(Math.abs(w.a - 0.75) < 1e-12 && Math.abs(w.a + w.b - 1) < 1e-12);
  assert.equal(normWeights(K, { a: 0, b: 0 }), null);
  assert.equal(combine({ a: 1, b: 1 }, K, { a: 0, b: 0 }), null);
  assert.ok(Math.abs(combine({ a: 0.5, b: 0.5 }, K, { a: 5, b: 5 }, 'linear') - combine({ a: 0.5, b: 0.5 }, K, { a: 1, b: 1 }, 'linear')) < 1e-9);
  assert.equal(combine({ a: 1, b: 0 }, K, { a: 1, b: 0 }, 'linear'), 100); // a zero-weight component is ignored
});
test('penalty clamps at 0 and unscored nodes stay unscored', () => {
  const m = { keys: K, comp: (n) => n.c, pen: (n) => n.p || 0 };
  assert.equal(scoreNode({ c: { a: 0.1, b: 0.1 }, p: 50 }, m, { a: 1, b: 1 }, 'linear'), 0);
  assert.ok(Math.abs(scoreNode({ c: { a: 1, b: 1 }, p: 12.5 }, m, { a: 1, b: 1 }, 'strict') - 87.5) < 1e-9);
  assert.equal(scoreNode({ c: null }, m, { a: 1, b: 1 }, 'strict'), null);
  assert.equal(scoreNode({ c: { a: NaN, b: 1 } }, m, { a: 1, b: 1 }, 'strict'), null);
});
test('models read the right fields', () => {
  const M = modelsOf({ meta: { config: { weights: { land: 1 } } }, bat_meta: { config: { weights: { value: 1 } } } });
  assert.equal(M.bat.comp({ bat: null }), null);
  assert.deepEqual(M.bat.flags({ bat: null }), ['no battery data']);
  assert.equal(M.bat.pen({ bat: { pen: 7 } }), 7);
  assert.equal(M.solar.comp({ components: { land: 1 } }).land, 1);
});
test('search ignores accents and case, areas before nodes, prefix first', () => {
  assert.equal(norm('Mérida'), 'merida');
  const E = buildSearch([{ id: '07MID-115', nombre: 'Mérida Norte', municipio: 'MÉRIDA', entidad: 'YUCATAN' }, { id: '07XXX-115', nombre: 'Norte Merida', municipio: 'X', entidad: 'Y' }],
    [{ key: 'YUCATAN', name: 'Yucatán' }, { key: 'MERIDA ST', name: 'Merida state' }], ['PENINSULAR']);
  const r = search(E, ' MÉRIDA ');
  assert.deepEqual(r.map((x) => x.id), ['MERIDA ST', '07MID-115', '07XXX-115']);
  assert.deepEqual(search(E, 'yucatan').map((x) => x.kind), ['state']);
  assert.deepEqual(search(E, 'peninsul').map((x) => x.label), ['Peninsular']);
  assert.deepEqual(search(E, ''), []);
  assert.equal(search(E, 'e', 2).length, 2);
});
test('area summary: median, top-10 % threshold, best and top list', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([3, 1, 2], 0.5), 2);
  const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, state: i < 10 ? 'A' : 'B', region: 'R', v: i < 18 ? i : null }));
  const f = (n) => n.v;
  const all = areaSummary(nodes, null, f);
  assert.equal(all.n, 20); assert.equal(all.scored, 18);
  assert.equal(all.median, 9); assert.equal(all.p90, 16); assert.equal(all.best[0].id, 'n17');
  assert.equal(all.top.length, 10);
  const a = areaSummary(nodes, { kind: 'state', id: 'B' }, f);
  assert.equal(a.n, 10); assert.equal(a.scored, 8);
  assert.equal(areaSummary(nodes, { kind: 'region', id: 'ZZ' }, f).median, null);
  assert.equal(areaSummary(nodes, { kind: 'node', id: 'n1' }, f).n, 20);
});

import { createRequire } from 'node:module';
import { resolveHash, ROUTES } from '../v2/assets/js/route-logic.js';
import { precacheList } from '../v2/tools/precache-manifest.mjs';
const { strategyFor, evictableUrl } = createRequire(import.meta.url)('../v2/sw-strategy.js');
test('scores.json is network-first, evictable and never precached', () => {
  assert.equal(strategyFor('/data/derived/scores.json', 'cors'), 'data');
  assert.equal(evictableUrl('/data/derived/scores.json'), true);
  assert.equal(evictableUrl('/data/derived/node_profiles.json'), false);
  assert.equal(precacheList().some((u) => /scores\.json$/.test(u)), false);
  assert.equal(precacheList().some((u) => /score-view\.js$/.test(u)), true);
});
test('#/score is a route that works without a selection and keeps one when given', () => {
  assert.ok(ROUTES.includes('/score'));
  assert.equal(resolveHash('#/score').path, '/score');
  const r = resolveHash('#/score?sel=state:JALISCO', { node: () => true, state: () => true, region: () => true });
  assert.equal(r.path, '/score');
  assert.deepEqual(r.list, [{ kind: 'state', id: 'JALISCO' }]);
  assert.equal(r.hash, '#/score?sel=state:JALISCO');
});
