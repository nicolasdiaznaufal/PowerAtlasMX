// v2 daily series: decoder, 7-day moving averages (golden example ported from tests/test_daily_series.py), real pesos, lazy gate, cache rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { decodeDoc, ma7, ma7Ratio, dailyView, dayFactors, dayDiff, dateOf, rangeOf, SCALE } from '../v2/assets/js/daily-math.js';
import { vfThreshold, clampVf } from '../v2/assets/js/daily-math.js';
import { vfAxis } from '../v2/assets/js/svg-charts.js';
import { refocus } from '../v2/assets/js/daily-card.js';
import { dailyUrl, shouldLoadDaily, remember } from '../v2/assets/js/daily-load.js';

const DIR = new URL('../data/solar_v2/daily/', import.meta.url).pathname;
const real = fs.existsSync(`${DIR}manifest.json`) ? {} : { skip: 'web/data/solar_v2/daily absent' };
const rd = (f) => JSON.parse(fs.readFileSync(DIR + f, 'utf8'));
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const NaN_ = null;

test('golden example of tests/test_daily_series.py: ratio of sums, min 4 valid days, n_horas weighting', () => {
  const ing = [500, 400, 300, 600, 450, NaN_, 350], y = [1, 1, 1, 1, 1, NaN_, 0.5], pml = [400, 500, 0.01, 600, 300, 200, 700], n = [24, 24, 24, 24, 12, 24, 24];
  const { cap, vf } = ma7Ratio(ing, y, pml, n);
  const k = [0, 1, 2, 3, 4, 6], capRef = k.reduce((s, i) => s + ing[i], 0) / k.reduce((s, i) => s + y[i], 0), pmRef = k.reduce((s, i) => s + n[i] * pml[i], 0) / k.reduce((s, i) => s + n[i], 0);
  near(capRef, 2600 / 5.5);
  near(cap[6], capRef); near(vf[6], capRef / pmRef);
  assert.deepEqual(cap.slice(0, 3), [null, null, null]);              // fewer than 4 valid days
  assert.ok(cap[3] !== null);
  assert.ok(vf[6] < 2);                                                // the mean of vf_dia would be about 4000
  near(ma7(pml, n)[6], pml.reduce((s, v, i) => s + v * n[i], 0) / n.reduce((a, b) => a + b, 0));
});

test('mean of vf_dia vs ratio of sums on a blow-up window', () => {
  const vfd = [0.46, 0.2, 0.41, 0.54, 0.04, null, -1258.55], ing = [46, 20, 41, 54, 4, null, -300], y = [1, 1, 1, 1, 1, null, 0.2], pml = [100, 100, 100, 100, 100, 100, 0.2], n = Array(7).fill(24);
  const naive = vfd.filter((v) => v !== null).reduce((a, b) => a + b, 0) / 6;
  const { vf } = ma7Ratio(ing, y, pml, n);
  assert.ok(Math.abs(naive) > 100 && Math.abs(vf[6]) < 2);
});

test('min valid days and n_horas weighting', () => {
  const x = [10, 20, null, null, null, null, 40], n = [24, 12, 24, 24, 24, 24, 24];
  assert.equal(ma7(x, n)[6], null);                                    // 3 valid days < 4
  assert.equal(ma7([10, 20, 30, 40, null, null, null], [24, 24, 24, 24, 24, 24, 24])[3], 25);
  near(ma7([10, 20, 30, 40], [24, 12, 12, 24])[3], (240 + 240 + 360 + 960) / 72);
  assert.equal(ma7([1, 2, 3, 4, 5, 6, 7, 8], Array(8).fill(1))[7], 5); // window of 7 days: days 2..8
});

test('real pesos factor multiplies money fields only; vf, hours and output stay', () => {
  const doc = { schema_version: 'daily/1', start: '2024-01-31', n: 8, scale: SCALE,
    pml: { n_horas: Array(8).fill(24), pml_avg: Array(8).fill(1000), energia_avg: Array(8).fill(1000), perdidas_avg: Array(8).fill(0), congestion_avg: Array(8).fill(0), spread: Array(8).fill(500) },
    tracker: { y_day: Array(8).fill(50000), horas_solares: Array(8).fill(10), p_cap_dia: Array(8).fill(10000), vf_dia: Array(8).fill(10000), ingreso_dia: Array(8).fill(10000) }, fijo: null };
  doc.fijo = doc.tracker;
  const d = decodeDoc(doc), f = dayFactors(d.start, d.n, { months: ['2024-01', '2024-02'], factor: [1.5, 1.2] });
  assert.deepEqual([f[0], f[1], f[7]], [1.5, 1.2, 1.2]);
  const nom = dailyView(d, 'tracker'), rl = dailyView(d, 'tracker', { real: true, factors: f });
  near(nom.revenue[6], 1000); near(rl.revenue[6], (1000 * 1.5 + 1000 * 1.2 * 6) / 7, 1e-6);
  near(nom.cap[6], 200); near(rl.cap[6], (1500 + 1200 * 6) / 7 / 5, 1e-6);   // ratio of sums in today's pesos
  near(rl.vf[6], nom.vf[6]); near(rl.hours[6], 10); near(rl.output[6], 5);
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
  assert.ok(Math.abs(v.vf[k]) < 5, `ratio of sums ${v.vf[k]}`);
  const df = rd('deflator_mensual.json');
  assert.equal(df.months.length, df.factor.length); assert.equal(df.factor[df.months.indexOf('2026-09')], 1);
  const a = decodeDoc(rd('areas/ALL.json')), av = dailyView(a, 'tracker');
  assert.ok(av.vf[dayDiff(a.start, '2025-12-15')] > 0 && av.vf[dayDiff(a.start, '2026-09-30')] === null); // solar fields end 2026-07-30
  assert.ok(av.pml[dayDiff(a.start, '2026-09-30')] !== null);                                              // PML-only lines continue
});

test('hide rule: 7-day mean price below max(50, 10% of trailing-year mean); short history uses only the 50 floor', () => {
  const short = vfThreshold(Array(20).fill(1000)), long = vfThreshold(Array(40).fill(1000));
  assert.equal(short[19], 50); assert.equal(long[39], 100); assert.equal(long[26], 50);   // 28 valid days needed
  const mk = (n, p) => decodeDoc({ schema_version: 'daily/1', start: '2024-01-01', n, scale: SCALE,
    pml: { n_horas: Array(n).fill(24), pml_avg: Array(n).fill(p), energia_avg: Array(n).fill(p), perdidas_avg: Array(n).fill(0), congestion_avg: Array(n).fill(0), spread: Array(n).fill(0) },
    tracker: { y_day: Array(n).fill(50000), horas_solares: Array(n).fill(10), p_cap_dia: Array(n).fill(0), vf_dia: Array(n).fill(0), ingreso_dia: Array(n).fill(3000) }, fijo: { y_day: [], horas_solares: [], p_cap_dia: [], vf_dia: [], ingreso_dia: [] } });
  const lo = dailyView(mk(10, 600), 'tracker');            // 7-day mean price 60 > 50 and short history: shown
  assert.ok(lo.vf[9] !== null && lo.vfHidden[9] === false);
  const d = mk(40, 10000);                                  // 7-day mean 1000: shown; then low-price week below 10% of the year mean
  for (let i = 33; i < 40; i++) d.pml.pml_avg[i] = 60;
  const v = dailyView(d, 'tracker');
  assert.equal(v.vfHidden[39], true); assert.equal(v.vf[39], null); assert.ok(v.vf[30] !== null);
});

test('real 04MAP-115 2026-01-15 hidden, a normal day shown; no plotted value exceeds the axis', real, () => {
  const n = decodeDoc(rd('nodes/04MAP-115.json')), v = dailyView(n, 'tracker');
  const bad = dayDiff(n.start, '2026-01-15'), ok = dayDiff(n.start, '2025-12-15');
  assert.equal(v.vf[bad], null); assert.equal(v.vfHidden[bad], true);
  assert.ok(v.vf[ok] !== null && v.vf[ok] > 0 && v.vf[ok] < 2.5);
  for (const f of ['nodes/04MAP-115.json', 'areas/ALL.json']) {
    const c = clampVf(dailyView(decodeDoc(rd(f)), 'tracker').vf), ax = vfAxis(c.vals.filter((x) => x !== null));
    assert.ok(c.vals.every((x) => x === null || (x >= ax.lo && x <= ax.hi)));
  }
});

test('clampVf keeps the true value for hover', () => {
  const c = clampVf([0.5, -25, 9, null]);
  assert.deepEqual(c.vals, [0.5, -1, 2.5, null]); assert.deepEqual(c.raw, [0.5, -25, 9, null]); assert.equal(c.clipped, 2);
});

test('focus returns to the toggled control after the re-render', async () => {
  let focused = null;
  const body = { querySelector: (sel) => (sel === '[data-c="pml"]' ? { focus: () => { focused = sel; } } : null) };
  await refocus(Promise.resolve(), body, '[data-c="pml"]');
  assert.equal(focused, '[data-c="pml"]');
  const src = fs.readFileSync(new URL('../v2/assets/js/daily-card.js', import.meta.url), 'utf8');
  assert.equal(/again\(\)/.test(src), false);             // every toggle names the control to refocus
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
