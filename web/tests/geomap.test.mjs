// Map: geometry decode, point-in-polygon against the deck geometry, grid-index hit testing, metric domains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodeRing, pointInRings, GridIndex, ll2xy, xy2ll, mix } from '../assets/js/geomap.js';
import { metricOf, METRICS } from '../assets/js/sec-map-pure.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..');
const geo = JSON.parse(readFileSync(join(dir, 'assets', 'geo', 'mx.json'), 'utf8'));
const index = JSON.parse(readFileSync(join(dir, 'data', 'index.json'), 'utf8'));
const states = new Map(geo.states.map((s) => [s.k, s.r.map((r) => decodeRing(r, geo.scale))]));

test('geometry asset: 32 states, 7 regions + Baja, rings inside the viewBox', () => {
  assert.equal(geo.states.length, 32);
  assert.deepEqual(Object.keys(geo.regions).sort(), ['BAJA', 'CENTRAL', 'NORESTE', 'NOROESTE', 'NORTE', 'OCCIDENTAL', 'ORIENTAL', 'PENINSULAR']);
  for (const rings of states.values()) for (const r of rings) for (let i = 0; i < r.length; i += 2) {
    assert.ok(r[i] >= -5 && r[i] <= geo.vb[0] + 5 && r[i + 1] >= -5 && r[i + 1] <= geo.vb[1] + 5);
  }
});
test('projection: equirectangular, invertible, Mexico City lands inside its state polygon', () => {
  const [x, y] = ll2xy(-99.13, 19.43);
  const [lon, lat] = xy2ll(x, y);
  assert.ok(Math.abs(lon + 99.13) < 1e-9 && Math.abs(lat - 19.43) < 1e-9);
  assert.ok(pointInRings([...states.get('MEXICO'), ...states.get('CIUDAD DE MEXICO')], x, y));
});
test('hit test: at least 95 % of nodes with coordinates fall in their declared state; sea points fall in none', () => {
  const nodes = index.nodos.filter((n) => n.lat != null && n.entidad && states.has(n.entidad));
  let ok = 0;
  for (const n of nodes) { const [x, y] = ll2xy(n.lon, n.lat); if (pointInRings(states.get(n.entidad), x, y)) ok++; }
  assert.ok(ok / nodes.length > 0.95, `${ok}/${nodes.length}`);
  const [sx, sy] = ll2xy(-120, 20);
  assert.ok([...states.values()].every((r) => !pointInRings(r, sx, sy)));
});
test('grid index returns the nearest marker within the radius and nothing beyond it', () => {
  const xs = new Float32Array([10, 12, 300, 900]), ys = new Float32Array([10, 11, 300, 700]);
  const g = new GridIndex(xs, ys, 1173, 740, 14);
  assert.equal(g.nearest(11.9, 11, 5), 1);
  assert.equal(g.nearest(10.1, 10.1, 5), 0);
  assert.equal(g.nearest(100, 100, 7), -1);
  assert.equal(g.nearest(899, 699, 7), 3);
});
test('grid index agrees with brute force on 2,500 random markers', () => {
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const n = 2500, xs = new Float32Array(n), ys = new Float32Array(n);
  for (let i = 0; i < n; i++) { xs[i] = rnd() * 1173; ys[i] = rnd() * 740; }
  const g = new GridIndex(xs, ys, 1173, 740, 14);
  for (let q = 0; q < 300; q++) {
    const x = rnd() * 1173, y = rnd() * 740, r = 9;
    let best = -1, bd = r * r;
    for (let i = 0; i < n; i++) { const d = (xs[i] - x) ** 2 + (ys[i] - y) ** 2; if (d <= bd) { bd = d; best = i; } }
    assert.equal(g.nearest(x, y, r), best);
  }
});
test('metric value follows the price basis and falls back to nominal', () => {
  const s = { p_cap: 500, p_cap_real: 520, pml_medio: 650, pml_medio_real: 660, vf: 0.77, pct_e0: 1.5, spread_punta_solar: 300 };
  assert.equal(metricOf(s, 'cap', true), 520);
  assert.equal(metricOf(s, 'cap', false), 500);
  assert.ok(Math.abs(metricOf(s, 'vf', true) - 520 / 660) < 1e-12);
  assert.equal(metricOf({ ...s, p_cap_real: null }, 'cap', true), 500);
  assert.equal(metricOf(null, 'vf', true), null);
  assert.ok(METRICS.vf.lo < METRICS.vf.hi && METRICS.le0.lo > METRICS.le0.hi);
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});
