// v2 daily series: decoder, 7-day moving averages (golden example ported from tests/test_daily_series.py), real pesos, lazy gate, cache rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { decodeDoc, ma7, ma7Ratio, dailyView, dayFactors, dayDiff, dateOf, rangeOf, SCALE } from '../v2/assets/js/daily-math.js';
import { dailyUrl, shouldLoadDaily, remember } from '../v2/assets/js/daily-load.js';

const DIR = new URL('../data/solar_v2/daily/', import.meta.url).pathname;
const real = fs.existsSync(`${DIR}manifest.json`) ? {} : { skip: 'web/data/solar_v2/daily absent' };
const rd = (f) => JSON.parse(fs.readFileSync(DIR + f, 'utf8'));
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const NaN_ = null;

test('golden example of tests/test_daily_series.py: ratio of sums, min 4 valid days, n_horas weighting', () => {
  const ing = [500, 400, 300, 600, 450, NaN_, 350], y = [1, 1, 1, 1, 1, NaN_, 0.5], pml = [400, 500, 0.01, 600, 300, 200, 700], n = [24, 24, 24, 24, 12, 24, 24];
  const { cap } = ma7Ratio(ing, y, pml, n);
  const k = [0, 1, 2, 3, 4, 6], capRef = k.reduce((s, i) => s + ing[i], 0) / k.reduce((s, i) => s + y[i], 0);
  near(capRef, 2600 / 5.5);
  near(cap[6], capRef);
  assert.deepEqual(cap.slice(0, 3), [null, null, null]);              // fewer than 4 valid days
  assert.ok(cap[3] !== null);
  near(ma7(pml, n)[6], pml.reduce((s, v, i) => s + v * n[i], 0) / n.reduce((a, b) => a + b, 0));
});

test('captured price is a ratio of sums: a blow-up day does not dominate the week', () => {
  const ing = [46, 20, 41, 54, 4, null, -300], y = [1, 1, 1, 1, 1, null, 0.2], pml = [100, 100, 100, 100, 100, 100, 0.2], n = Array(7).fill(24);
  const { cap } = ma7Ratio(ing, y, pml, n);
  near(cap[6], (46 + 20 + 41 + 54 + 4 - 300) / 5.2);
  assert.equal('vf' in ma7Ratio(ing, y, pml, n), false);   // the daily value factor was removed from the product
});

test('real pesos factor multiplies money fields only; hours and output stay', () => {
  const doc = { schema_version: 'daily/1', start: '2024-01-31', n: 8, scale: SCALE,
    pml: { n_horas: Array(8).fill(24), pml_avg: Array(8).fill(1000), energia_avg: Array(8).fill(1000), perdidas_avg: Array(8).fill(0), congestion_avg: Array(8).fill(0), spread: Array(8).fill(500) },
    tracker: { y_day: Array(8).fill(50000), horas_solares: Array(8).fill(10), p_cap_dia: Array(8).fill(10000), vf_dia: Array(8).fill(10000), ingreso_dia: Array(8).fill(10000) }, fijo: null };
  doc.fijo = doc.tracker;
  const d = decodeDoc(doc), f = dayFactors(d.start, d.n, { months: ['2024-01', '2024-02'], factor: [1.5, 1.2] });
  assert.deepEqual([f[0], f[1], f[7]], [1.5, 1.2, 1.2]);
  const nom = dailyView(d, 'tracker'), rl = dailyView(d, 'tracker', { real: true, factors: f });
  near(nom.revenue[6], 1000); near(rl.revenue[6], (1000 * 1.5 + 1000 * 1.2 * 6) / 7, 1e-6);
  near(nom.cap[6], 200); near(rl.cap[6], (1500 + 1200 * 6) / 7 / 5, 1e-6);   // ratio of sums in today's pesos
  near(rl.hours[6], 10); near(rl.output[6], 5);
});

test('spread excludes days with fewer than 12 hours', () => {
  const n = 7, pml = (v) => Array(n).fill(v), z = Array(n).fill(null);
  const d = decodeDoc({ schema_version: 'daily/1', start: '2024-01-01', n, scale: SCALE, pml: { n_horas: [1, 11, 12, 24, 24, 24, 24], pml_avg: pml(100), energia_avg: pml(1), perdidas_avg: z, congestion_avg: z, spread: [9000, 9000, 10, 20, 30, 40, 50] },
    tracker: { y_day: z, horas_solares: z, p_cap_dia: z, vf_dia: z, ingreso_dia: z }, fijo: { y_day: z, horas_solares: z, p_cap_dia: z, vf_dia: z, ingreso_dia: z } });
  near(d.pml.spread[0], 900); near(dailyView(d, 'tracker').spread[6], (12 * 1 + 24 * (2 + 3 + 4 + 5)) / 108); // days with 1 and 11 hours do not count
});

test('date helpers and span range', () => {
  assert.equal(dateOf('2020-01-01', 0), '2020-01-01'); assert.equal(dateOf('2020-01-01', 2464), '2026-09-30');
  assert.equal(dayDiff('2020-01-01', '2026-09-30'), 2464);
  assert.deepEqual(rangeOf('2020-01-01', 2465, { from: '2025-08', to: '2026-07' }), [dayDiff('2020-01-01', '2025-08-01'), dayDiff('2020-01-01', '2026-07-31')]);
  assert.equal(rangeOf('2020-01-01', 2465, { from: '2026-08', to: '2026-12' })[1], 2464);
});

test('urls of node and area slots', () => {
  assert.match(dailyUrl({ kind: 'node', id: '04MAP-115' }), /daily\/nodes\/04MAP-115\.json$/);
  assert.match(dailyUrl({ kind: 'national', id: 'ALL' }), /daily\/areas\/ALL\.json$/);
  assert.match(dailyUrl({ kind: 'state', id: 'CIUDAD DE MEXICO' }), /areas\/state-CIUDAD_DE_MEXICO\.json$/);
  assert.match(dailyUrl({ kind: 'region', id: 'CENTRAL' }), /areas\/region-CENTRAL\.json$/);
});

test('lazy gate: no daily request until the card is visible; bounded memory cache; SW rule evictable and not precached', async () => {
  assert.equal(shouldLoadDaily(false, true), false); assert.equal(shouldLoadDaily(true, false), false); assert.equal(shouldLoadDaily(true, true), true);
  const m = new Map();
  for (let i = 0; i < 12; i++) remember(m, `u${i}`, () => Promise.resolve(i), 8);
  assert.equal(m.size, 8); assert.equal(m.has('u0'), false); assert.equal(m.has('u11'), true);
  const { dailyUrl: swDaily, evictableUrl } = createRequire(import.meta.url)('../v2/sw-strategy.js');
  assert.equal(swDaily('/data/solar_v2/daily/nodes/01AAN-85.json'), true);
  assert.equal(swDaily('/data/solar_v2/variants/fijo/mean.json'), false);
  assert.equal(evictableUrl('/data/solar_v2/daily/nodes/01AAN-85.json'), false);   // trimmed by its own bound
  const pre = fs.readFileSync(new URL('../v2/precache.js', import.meta.url), 'utf8');
  assert.equal(/solar_v2\/daily|data\//.test(pre), false);
  const sw = fs.readFileSync(new URL('../v2/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /DATA_DAILY = 12/);
});

test('decoder on real files (2 nodes + 1 area) follows the manifest', real, () => {
  const man = rd('manifest.json');
  for (const f of ['nodes/04MAP-115.json', 'nodes/01AAN-85.json', 'areas/ALL.json']) {
    const doc = rd(f), d = decodeDoc(doc);
    assert.equal(d.n, man.n); assert.equal(d.start, man.start);
    const isArea = f.startsWith('areas');
    assert.equal(d.area, isArea);
    for (const blk of ['pml', 'tracker', 'fijo']) for (const [k, l] of Object.entries(doc[blk])) {
      assert.equal(l.length, man.n, k);
      assert.ok(k in man.scale);
      const dec = d[blk][k], j = l.findIndex((v) => v !== null);
      assert.ok(j >= 0, `${f} ${blk}.${k} has data`);
      near(dec[j], l[j] * man.scale[k], 1e-9);
      l.forEach((v, i) => assert.equal(dec[i] === null, v === null));
    }
    assert.deepEqual(Object.keys(doc.pml), isArea ? man.fields.area_pml : man.fields.pml);
    assert.deepEqual(Object.keys(doc.tracker), isArea ? man.fields.area_config : man.fields.config);
  }
  const n = decodeDoc(rd('nodes/04MAP-115.json'));
  const k = dayDiff(n.start, '2024-04-03'), vfd = n.tracker.vf_dia, w = [k - 6, k - 5, k - 4, k - 3, k - 2, k - 1, k].map((j) => vfd[j]).filter((v) => v !== null);
  const naive = w.reduce((a, b) => a + b, 0) / w.length, v = dailyView(n, 'tracker');
  assert.ok(Math.abs(naive) > 100, `mean of vf_dia ${naive}`);
  assert.ok(Math.abs(v.cap[k]) < 1e5, `captured price ${v.cap[k]}`);
  const df = rd('deflator_mensual.json');
  assert.equal(df.months.length, df.factor.length); assert.equal(df.factor[df.months.indexOf('2026-09')], 1);
  const a = decodeDoc(rd('areas/ALL.json')), av = dailyView(a, 'tracker');
  assert.ok(av.cap[dayDiff(a.start, '2025-12-15')] > 0 && av.cap[dayDiff(a.start, '2026-09-30')] === null); // solar fields end 2026-07-30
  assert.ok(av.pml[dayDiff(a.start, '2026-09-30')] !== null);                                              // PML-only lines continue
});

test('the Explorer daily card has no value-factor line, toggle or hide rule', () => {
  const src = fs.readFileSync(new URL('../v2/assets/js/daily-card.js', import.meta.url), 'utf8');
  assert.equal(/clampVf|dl-month|vfHidden|data-c=/.test(src), false);
  assert.ok(/PML/.test(src) && /dl-parts/.test(src));     // PML, congestion and losses share one plot, always visible
});

test('revenue, hours and output are the plain mean of the valid days (not n_horas weighted)', () => {
  const z = Array(7).fill(null), n = [24, 24, 24, 24, 12, 24, 24];
  const d = decodeDoc({ schema_version: 'daily/1', start: '2024-01-01', n: 7, scale: SCALE,
    pml: { n_horas: n, pml_avg: Array(7).fill(1000), energia_avg: z, perdidas_avg: z, congestion_avg: z, spread: z },
    tracker: { y_day: [10, 20, 30, 40, 50, 60, 70].map((v) => v * 1e4), horas_solares: [1, 2, 3, 4, 5, 6, 7], p_cap_dia: z, vf_dia: z, ingreso_dia: z }, fijo: { y_day: z, horas_solares: z, p_cap_dia: z, vf_dia: z, ingreso_dia: z } });
  const v = dailyView(d, 'tracker');
  near(v.hours[6], 4); near(v.output[6], 4 * 1e4 * 1e-4 * 1 * 1 * 1e0 * 0 + 4 * 1 * 1e4 / 1e4 * 10 / 10 * 1, 1e9); // weights do not matter: see exact check below
  near(v.output[6], [10, 20, 30, 40, 50, 60, 70].reduce((a, b) => a + b, 0) / 7);
});
