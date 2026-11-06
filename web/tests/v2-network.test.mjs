import test from 'node:test';
import assert from 'node:assert/strict';
import { bandOf, quantile, median, domainOf, colorOf, filterNodes, groupStats, topNodes, METRICS, KV_BANDS, NO_DATA } from '../v2/assets/js/network-core.js';
import { resolveHash } from '../v2/assets/js/route-logic.js';

const N = [
  { id: 'A', n: 'Alfa', kv: 400, sis: 'SIN', carga: 'I', gen: 'D', crc: 'X', score: 80, gap: -50, mun: 'Léon', ent: 'GTO', zc: 'Z1' },
  { id: 'B', n: 'Beta', kv: 115, sis: 'SIN', carga: 'D', gen: '', crc: 'X', score: 40, gap: 10, mun: 'Mérida', ent: 'YUC', zc: 'Z2' },
  { id: 'C', n: 'Gama', kv: 69, sis: 'BCA', carga: 'D', gen: 'I', crc: 'Y', score: null, gap: null, mun: 'Tijuana', ent: 'BC', zc: 'Z3' },
];
const ALL = { bands: new Set(KV_BANDS.map((b) => b.id)), sis: new Set(['SIN', 'BCA', 'BCS']), load: 'all', gen: 'all', q: '' };

test('voltage bands', () => { assert.deepEqual([400, 230, 161, 138, 115, 85, 69, 34.5].map(bandOf), ['400', '230', '161', '161', '115', '85', '85', '85']); });
test('quantile and median ignore missing values', () => { assert.equal(quantile([1, 2, 3, 4], 50), 2.5); assert.equal(median([3, null, 1, NaN, 2]), 2); });
test('diverging domain is symmetric around zero; sequential uses p5 to p95', () => {
  const d = domainOf(N, METRICS.gap); assert.equal(d[0], -d[1]);
  const s = domainOf(N, METRICS.score); assert.ok(s[0] >= 40 && s[1] <= 80);
});
test('missing values get the no-data colour; colours stay in range', () => {
  assert.deepEqual(colorOf(METRICS.score, null, [0, 1]), NO_DATA);
  colorOf(METRICS.score, 999, [0, 100]).forEach((c) => assert.ok(c >= 0 && c <= 255));
  assert.deepEqual(colorOf(METRICS.gap, 0, [-10, 10]).slice(0, 3), [58, 69, 62]);
});
test('filters: voltage, system, load, generation, accent-insensitive search', () => {
  assert.equal(filterNodes(N, ALL).length, 3);
  assert.deepEqual(filterNodes(N, { ...ALL, bands: new Set(['400']) }).map((n) => n.id), ['A']);
  assert.deepEqual(filterNodes(N, { ...ALL, sis: new Set(['BCA']) }).map((n) => n.id), ['C']);
  assert.deepEqual(filterNodes(N, { ...ALL, load: 'D' }).map((n) => n.id), ['B', 'C']);
  assert.deepEqual(filterNodes(N, { ...ALL, gen: 'any' }).map((n) => n.id), ['A', 'C']);
  assert.deepEqual(filterNodes(N, { ...ALL, q: 'leon' }).map((n) => n.id), ['A']);
});
test('group stats: medians skip nulls, sorted by score; top nodes skip nulls', () => {
  const g = groupStats(N, 'crc'); assert.equal(g[0].key, 'X'); assert.equal(g[0].score, 60); assert.equal(g[1].score, null);
  assert.deepEqual(topNodes(N, METRICS.score, 5).map((n) => n.id), ['A', 'B']);
});
test('#/network is a bare route: no selection is added or required', () => {
  const r = resolveHash('#/network', null, [{ kind: 'node', id: 'X' }]);
  assert.equal(r.path, '/network'); assert.equal(r.hash, '#/network'); assert.deepEqual(r.list, []);
});

import { PERMIT_GROUPS, groupOf, filterPlants, techHex, plantCard } from '../v2/assets/js/network-plants.js';
import { CITIES, tierAt } from '../v2/assets/js/cities.js';
import { lineStyle } from '../v2/assets/js/network-core.js';

test('line colours are the atlas-sen voltage palette', () => {
  assert.deepEqual(lineStyle(400).c.slice(0, 3), [163, 45, 45]); assert.deepEqual(lineStyle(230).c.slice(0, 3), [194, 65, 12]);
  assert.deepEqual(lineStyle(115).c.slice(0, 3), [124, 138, 160]); assert.deepEqual(lineStyle(69).c.slice(0, 3), [184, 179, 168]);
});
test('plants: every status belongs to one permit group; technology colours; filter; card shows permit dates', () => {
  const sts = ['operating', 'building', 'permit', 'requested', 'none', 'revoked', 'ended', 'denied', 'cancelled', 'retired'];
  sts.forEach((s) => assert.equal(PERMIT_GROUPS.filter((g) => g.sts.includes(s)).length, 1, s));
  assert.equal(groupOf('revoked'), 'bad'); assert.equal(techHex('Fotovoltaica'), '#F5B301'); assert.equal(techHex('Ciclo Combinado'), '#A98B63');
  const P = [{ n: 'Sol', co: 'X', st: 'operating', num: 'E/1' }, { n: 'Mal', co: 'Y', st: 'revoked' }];
  assert.equal(filterPlants(P, new Set(['bad'])).length, 1); assert.equal(filterPlants(P, new Set(['ok', 'bad']), 'e/1').length, 1);
  assert.match(plantCard({ n: 'Sol', st: 'operating', grant: '2017-08-03', exp: '2047-08-03', num: 'E/1' }, (x) => x), /2047-08-03/);
});
test('cities: tiers, valid Mexican coordinates, tier by zoom', () => {
  CITIES.forEach(([n, lo, la, t]) => { assert.ok(n && lo > -120 && lo < -86 && la > 14 && la < 33 && [1, 2, 3].includes(t), n); });
  assert.equal(new Set(CITIES.map((c) => c[0])).size, CITIES.length);
  assert.deepEqual([3, 5, 6].map(tierAt), [1, 2, 3]);
});

import { techFam, TECHS } from '../v2/assets/js/network-plants.js';
const P2 = [
  { n: 'a', st: 'operating', t: 'Fotovoltaica', mw: 300, mkt: 'MEM', mlab: 'Generador MEM', reg: 'Norte', exp: '2034-05-01' },
  { n: 'b', st: 'operating', t: 'Eólico', mw: 40, mkt: 'Legado', mod: 'Autoabastecimiento', reg: 'Oriental', exp: '2037-01-01' },
  { n: 'c', st: 'none', t: 'Turbina Hidráulica', mw: 10, reg: 'Norte', exp: null },
];
const PF = { groups: new Set(['ok', 'permit', 'none', 'bad']), techs: new Set(TECHS.map((t) => t[0])), mkt: 'all', ptype: 'all', exp: 'all', mw: 0, reg: 'all', q: '' };
test('plant filters: technology, market, permit type, expiry bucket, size, region', () => {
  assert.equal(filterPlants(P2, PF).length, 3);
  assert.deepEqual(filterPlants(P2, { ...PF, techs: new Set(['pv']) }).map((p) => p.n), ['a']);
  assert.deepEqual(filterPlants(P2, { ...PF, mkt: 'Legado' }).map((p) => p.n), ['b']);
  assert.deepEqual(filterPlants(P2, { ...PF, ptype: 'Autoabastecimiento' }).map((p) => p.n), ['b']);
  assert.deepEqual(filterPlants(P2, { ...PF, exp: 'lt2035' }).map((p) => p.n), ['a']);
  assert.deepEqual(filterPlants(P2, { ...PF, exp: '2035' }).map((p) => p.n), ['b']);
  assert.deepEqual(filterPlants(P2, { ...PF, mw: 200 }).map((p) => p.n), ['a']);
  assert.deepEqual(filterPlants(P2, { ...PF, reg: 'Norte' }).map((p) => p.n), ['a', 'c']);
  assert.equal(techFam('Turbina Hidráulica'), 'hydro');
});
