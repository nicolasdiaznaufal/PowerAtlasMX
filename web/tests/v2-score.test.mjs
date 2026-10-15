import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { combine, scoreNode, normWeights, norm, buildSearch, search, percentile, areaSummary, modelsOf, FLOOR, percentileLin, valueAtRte, valueScale, econ, crf, unit, areaMedian } from '../v2/assets/js/score-core.js';

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

test('battery value at a given efficiency, linear percentile, economics', () => {
  const b = { dis_4h: 2000, ch_4h: 850, pfdis_4h: 2300, pfch_4h: 700, dis_2h: 1000, ch_2h: 425 };
  assert.ok(Math.abs(valueAtRte(b, 4, 0.85) - 1000) < 1e-9);
  assert.ok(valueAtRte(b, 4, 1) > valueAtRte(b, 4, 0.7));
  assert.ok(Math.abs(valueAtRte(b, 4, 0.85, true) - (2300 - 700 / 0.85)) < 1e-9);
  assert.equal(valueAtRte(null, 4, 0.85), null);
  assert.equal(valueAtRte({}, 4, 0.85), null);
  assert.equal(percentileLin([1, 2, 3, 4], 50), 2.5);
  assert.equal(percentileLin([5], 10), 5);
  assert.equal(percentileLin([], 10), null);
  assert.equal(unit(5, 0, 10), 0.5); assert.equal(unit(-1, 0, 10), 0); assert.equal(unit(99, 0, 10), 1);
  assert.ok(Math.abs(crf(0.1, 15) - 0.13147) < 1e-4);
  assert.equal(crf(0, 10), 0.1);
  const e = econ(1000, 4, { power: 4500, energy: 3800, om: 1.5, life: 15, disc: 0.1 });
  assert.equal(e.capex, 19700);
  assert.ok(Math.abs(e.annual - (19700 * crf(0.1, 15) + 19700 * 0.015)) < 1e-6);
  assert.ok(Math.abs(e.coverage - 1000 / e.annual) < 1e-12);
  assert.ok(Math.abs(e.payback - 19700 / (1000 - 295.5)) < 1e-9);
  assert.equal(econ(200, 4, { power: 4500, energy: 3800, om: 1.5, life: 15, disc: 0.1 }).payback, null);
  assert.equal(areaMedian([{ state: 'A', v: 1 }, { state: 'A', v: 3 }, { state: 'A', v: null }, { state: 'B', v: 9 }], { kind: 'state', id: 'A' }, (n) => n.v), 2);
});
test('value scale moves with the efficiency; component and score stay in range', () => {
  const nodes = Array.from({ length: 11 }, (_, i) => ({ bat: { dis_4h: 1000 + 100 * i, ch_4h: 300 } }));
  const a = valueScale(nodes, 0.85), c = valueScale(nodes, 0.6);
  assert.ok(c[0] < a[0] && c[1] < a[1]);
  const data = { meta: { config: { weights: {} } }, bat_meta: { config: { weights: { value: 1 }, rte: 0.85, scales: { value_pctl: [10, 90] } } }, nodes };
  const ctx = { rte: 0.6 };
  const M = modelsOf(data, ctx);
  const n = { bat: { components: { value: 0.5 }, dis_4h: 1500, ch_4h: 300 } };
  assert.ok(M.bat.comp(n).value >= 0 && M.bat.comp(n).value <= 1);
  ctx.rte = 0.85;
  assert.equal(M.bat.comp(n).value, 0.5); // the file's own efficiency uses the stored components
});
const SCORES = new URL('../data/derived/scores.json', import.meta.url);
test('at the default efficiency the browser recomputation reproduces the stored battery scores', { skip: !existsSync(SCORES) }, () => {
  const d = JSON.parse(readFileSync(SCORES, 'utf8'));
  const ctx = { rte: d.bat_meta.config.rte, force: true };
  const M = modelsOf(d, ctx);
  let n = 0, worst = 0;
  for (const x of d.nodes) {
    if (!x.bat || x.bat.dis_4h == null) continue;
    const s = scoreNode(x, M.bat, M.bat.W0, 'strict');
    worst = Math.max(worst, Math.abs(s - x.bat.score)); n++;
  }
  assert.ok(n > 2000, `${n} nodes`);
  assert.ok(worst < 0.35, `worst difference ${worst}`);
});
