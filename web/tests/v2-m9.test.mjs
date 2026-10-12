// M9: scenarios (zero = published, exact levers), span parsing and URL round trip, span summary vs v1 compute().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { recordFor, tilesOf, revenueOf } from '../v2/assets/js/explorer-data.js';
import { scenarioRecord, scenarioEntries, typicalStats, applyScenario, solarHours } from '../v2/assets/js/scenario.js';
import { parseScenario, serializeScenario, parseSpan, isNeutral } from '../v2/assets/js/query-extras.js';
import { createStore, serializeSel } from '../v2/assets/js/store.js';
import { createRouter, hrefFor } from '../v2/assets/js/route-logic.js';
import { exactSpan, vfSummary, presetSpans, inSpan } from '../v2/assets/js/span-data.js';

const W = join(dirname(fileURLToPath(import.meta.url)), '..');
const f = (p) => join(W, 'data', p);
const need = ['analysis/analysis_nodos.json', 'analysis/analysis.json', 'derived/node_profiles.json', 'derived/series_nodes.json', 'derived/series_areas.json', 'index.json', 'nodes/01AAN-85.json'];
const skip = !need.every((p) => existsSync(f(p))) && 'web/data not present (ignored by git)';
const J = (p) => JSON.parse(readFileSync(f(p), 'utf8'));
const src = () => ({ nodos: J(need[0]), analysis: J(need[1]), profiles: J(need[2]), sNodes: J(need[3]), sAreas: J(need[4]) });
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

test('query parsing: scenario is clamped and neutral values vanish; span needs ordered YYYY-MM', () => {
  assert.deepEqual(parseScenario('p:999,m:-5,y:50'), { price: 300, dip: 0, yield: 30 });
  assert.equal(parseScenario('p:0,m:100,y:0'), null);
  assert.equal(parseScenario('x:1,p:abc'), null);
  assert.equal(serializeScenario({ price: 50, dip: 100, yield: -10 }), 'p:50,m:100,y:-10');
  assert.equal(serializeScenario(null), '');
  assert.deepEqual(parseSpan('2023-03', '2025-08'), { from: '2023-03', to: '2025-08' });
  assert.equal(parseSpan('2025-08', '2023-03'), null);
  assert.equal(parseSpan('2023-13', '2025-01'), null);
  assert.equal(isNeutral({ price: 0, dip: 100, yield: 0 }), true);
});

test('scenario and span survive the URL, Back and Forward (and are written by hrefFor)', () => {
  const valid = { node: (id) => id === '01AAN-85', state: () => false, region: () => false };
  const store = createStore(), hist = []; let i = -1;
  const router = createRouter({ store, valid: () => valid, replace: (h) => { hist[i] = h; }, currentHash: () => hist[i] });
  const push = (h) => { hist.length = i + 1; hist.push(h); i++; router.resolve(h); };
  push('#/explorer?sel=01AAN-85&from=2024-08&to=2025-07&sc=p:50,m:100,y:10');
  assert.deepEqual(store.span, { from: '2024-08', to: '2025-07' });
  assert.deepEqual(store.scenario, { price: 50, dip: 100, yield: 10 });
  assert.equal(hist[i], '#/explorer?sel=01AAN-85&from=2024-08&to=2025-07&sc=p:50,m:100,y:10');
  store.setScenario(null);
  assert.equal(hist[i], '#/explorer?sel=01AAN-85&from=2024-08&to=2025-07');
  push('#/revenue?sel=01AAN-85');                        // explicit entry without extras = real values, default window
  assert.equal(store.span, null); assert.equal(store.scenario, null);
  i--; router.resolve(hist[i]);
  assert.deepEqual(store.span, { from: '2024-08', to: '2025-07' });
  assert.equal(hrefFor('/map', [{ kind: 'node', id: 'A' }], true, { span: null, sc: { price: 1, dip: 100, yield: 0 } }), '#/map?sel=A&real=1&sc=p:1,m:100,y:0');
});

test('zero scenario returns the published records unchanged: nodes, states, regions, national, both windows, nominal and real', { skip }, () => {
  const s = src(), ids = s.nodos.ids;
  const slots = [{ kind: 'node', id: ids[0] }, { kind: 'node', id: ids[1500] }, { kind: 'state', id: 'JALISCO' }, { kind: 'region', id: 'CENTRAL' }, { kind: 'national', id: 'ALL' }];
  let n = 0;
  for (const slot of slots) for (const win of ['Y2', 'Y1']) for (const real of [false, true]) {
    const rec = recordFor(s, slot, win);
    if (rec.missing) continue;
    const z = scenarioRecord(rec, { price: 0, dip: 100, yield: 0 }).rec;
    assert.equal(z, rec);
    assert.deepEqual(tilesOf(z, real).map((t) => t.value), tilesOf(rec, real).map((t) => t.value));
    assert.equal(revenueOf(z, real).total, revenueOf(rec, real).total);
    const e = [{ slot, rec, series: null }];
    assert.equal(scenarioEntries(e, null), e);
    n++;
  }
  assert.ok(n >= 18);
});

test('levers: price shift moves the typical-day average by exactly the shift; yield scales revenue exactly; dip 0 removes the dip', { skip }, () => {
  const s = src();
  for (const slot of [{ kind: 'node', id: s.nodos.ids[0] }, { kind: 'state', id: 'JALISCO' }, { kind: 'national', id: 'ALL' }]) {
    for (const win of ['Y2', 'Y1']) {
      const rec = recordFor(s, slot, win), b = typicalStats(rec.hours);
      // price shift +75: typical-day average moves by exactly 75; captured price too (output weighted, same shift)
      let r = scenarioRecord(rec, { price: 75, dip: 100, yield: 0 });
      const t = typicalStats(r.rec.hours);
      assert.ok(near(t.B - b.B, 75, 1e-9), `${slot.id} shift ${t.B - b.B}`);
      assert.ok(near(t.C - b.C, 75, 1e-9));
      // displayed (published x ratio): within 2% of the shift
      assert.ok(Math.abs((r.rec.base - rec.base) - 75) / 75 < 0.02, `${slot.id} displayed shift ${r.rec.base - rec.base}`);
      // yield +10%: revenue +10% exactly, prices and VF unchanged
      r = scenarioRecord(rec, { price: 0, dip: 100, yield: 10 });
      assert.ok(near(r.rec.ingreso, rec.ingreso * 1.1, 1e-12));
      assert.ok(near(r.rec.ingresoReal, rec.ingresoReal * 1.1, 1e-12));
      assert.ok(near(r.rec.base, rec.base, 1e-12) && near(r.rec.cap, rec.cap, 1e-12) && near(r.rec.vf, rec.vf, 1e-12));
      assert.ok(near(r.rec.yf, rec.yf * 1.1, 1e-12));
      // yield -30%
      assert.ok(near(scenarioRecord(rec, { price: 0, dip: 100, yield: -30 }).rec.ingreso, rec.ingreso * 0.7, 1e-12));
      // dip 0: no solar hour below the daily mean any more; dip 150: deeper than real
      const mean = b.B, solar = solarHours(rec.hours.y);
      const flat = applyScenario(rec.hours, { price: 0, dip: 0, yield: 0 }), deep = applyScenario(rec.hours, { price: 0, dip: 150, yield: 0 });
      for (const h of solar) { assert.ok(flat.pml[h] >= Math.min(rec.hours.pml[h], mean) - 1e-9); if (rec.hours.pml[h] < mean) { assert.ok(near(flat.pml[h], mean)); assert.ok(deep.pml[h] <= rec.hours.pml[h] + 1e-9); } }
      // energy component absorbs the change: components still add up to the price
      assert.ok(flat.pml.every((p, h) => near(flat.energia[h] + flat.perdidas[h] + flat.congestion[h], p, 1e-9)));
    }
  }
});

test('reset restores the published values', { skip }, () => {
  const s = src(), rec = recordFor(s, { kind: 'national', id: 'ALL' }, 'Y2');
  const store = createStore();
  store.setScenario({ price: 120, dip: 140, yield: 20 });
  const sim = scenarioRecord(rec, store.scenario).rec;
  assert.notEqual(sim.cap, rec.cap);
  store.setScenario(null);
  assert.equal(scenarioRecord(rec, store.scenario).rec, rec);
});

test('span: presets, VF summary, and exact period figures equal v1 compute() for three node slots', { skip }, () => {
  const s = src(), index = J('index.json');
  const months = s.sNodes.months, win = { desde: '2025-08', hasta: '2026-07' };
  const ps = presetSpans(months, win);
  assert.deepEqual(ps.slice(0, 2).map((p) => p.id), ['l12', 'all']);
  assert.equal(ps.find((p) => p.id === '2020').from, '2020-01');
  assert.equal(ps.find((p) => p.id === '2026').to, months[months.length - 1]);
  const ser = { months, vf: s.sNodes.nodes['05CJM-115'].m };
  const sm = vfSummary(ser, { from: '2023-01', to: '2023-12' });
  assert.equal(sm.months, 12);
  assert.equal(sm.withData, ser.vf.filter((v, i) => inSpan(months[i], { from: '2023-01', to: '2023-12' }) && v !== null).length);
  for (const id of ['01AAN-85', '05CJM-115', '08XLC-115']) {
    const raw = J(`nodes/${id}.json`);
    // window equals the published window figures (v1 compute == analysis_nodos)
    const w = exactSpan(raw, index, '2025-08', '2026-07', false), i = s.nodos.ids.indexOf(id), v = s.nodos.ventanas.deck_2025_26;
    // the analysis files publish 4 decimals
    for (const [x, y] of [[w.B, v.pml_medio[i]], [w.C, v.p_cap[i]], [w.VF, v.vf[i]]]) assert.ok(Math.abs(x - y) <= 6e-5, `${id}: ${x} vs ${y}`);
    // arbitrary span: our wrapper is v1's compute()
    const a = exactSpan(raw, index, '2023-03', '2025-08', false);
    assert.ok(a && a.B > 0 && a.C !== null && a.monthsInRange === 30);
    const r = exactSpan(raw, index, '2023-03', '2025-08', true);
    assert.ok(r.realUsed && r.B > a.B, 'today\'s pesos are above nominal for this span');
  }
});

test('applying a hash never writes an intermediate URL (a reload in the middle would capture it)', () => {
  const valid = { node: () => true, state: () => true, region: () => true };
  const store = createStore(), writes = []; let cur = '#/explorer?sel=A-1&from=2023-01&to=2023-09';
  const router = createRouter({ store, valid: () => valid, replace: (h) => { writes.push(h); cur = h; }, currentHash: () => cur });
  router.resolve(cur); writes.length = 0;
  const target = '#/revenue?sel=A-1,state:JALISCO,national&sc=p:-100,m:50,y:-10';
  cur = target; router.resolve(target);
  assert.deepEqual(writes, [], 'nothing is written while the target is already canonical');
  assert.deepEqual(store.get().length, 3);
  assert.deepEqual(store.scenario, { price: -100, dip: 50, yield: -10 });
  assert.equal(store.span, null);
});

import { columnLabels } from '../v2/assets/js/compare-data.js';

test('negative prices under a scenario: prices kept, VF and revenue are n/a (validador repro nodes)', { skip }, () => {
  const s = src();
  for (const [id, win] of [['04PLD-230', 'Y2'], ['04LCF-230', 'Y1']]) {
    if (!s.nodos.ids.includes(id)) continue;
    const rec = recordFor(s, { kind: 'node', id }, win);
    if (rec.missing) continue;
    const { rec: sim } = scenarioRecord(rec, { price: -300, dip: 100, yield: 0 });
    assert.ok(sim.simNA, `${id} ${win}`);
    assert.equal(sim.vf, null); assert.equal(sim.vfDay, null); assert.equal(sim.ingreso, null); assert.equal(sim.atajo, null);
    assert.ok(sim.base < rec.base && sim.cap < rec.cap);   // prices are still simulated
    const t = Object.fromEntries(tilesOf(sim, false).map((x) => [x.id, x]));
    assert.equal(t.vf.text, '—');
    assert.equal(revenueOf(sim, false).total, null);
    assert.equal(revenueOf(sim, false).hours.real.every((v) => v === null), true);
    // real-pesos basis never turns a scenario into a value factor either
    assert.equal(tilesOf(sim, true).find((x) => x.id === 'vf').value, null);
  }
  // a mild scenario is never n/a
  const ok = scenarioRecord(recordFor(s, { kind: 'national', id: 'ALL' }, 'Y2'), { price: -20, dip: 100, yield: 0 }).rec;
  assert.ok(!ok.simNA && ok.vf > 0);
});

test('a slot without a baseline stays published and says so under an active scenario', () => {
  const noHours = { slot: { kind: 'node', id: 'X' }, rec: { base: 100, cap: 80, vf: 0.8, hours: null }, series: null };
  const out = scenarioEntries([noHours], { price: 10, dip: 100, yield: 0 });
  assert.equal(out[0].noBaseline, true);
  assert.equal(out[0].real, undefined);                    // not marked simulated
  assert.equal(out[0].rec.vf, 0.8);
  const flat = { slot: { kind: 'node', id: 'Y' }, rec: { base: 0, cap: 0, vf: null, hours: { pml: Array(24).fill(0), y: Array(24).fill(1), perdidas: Array(24).fill(0), congestion: Array(24).fill(0), energia: Array(24).fill(0) } } };
  assert.equal(scenarioEntries([flat], { price: 10, dip: 100, yield: 0 })[0].noBaseline, true);
  assert.equal(scenarioEntries([noHours], null)[0].noBaseline, undefined);
});

test('comparison tables mark the unsimulated column; span bounds clamp the URL', () => {
  assert.match(columnLabels(false, true).z, /not simulated/);
  assert.doesNotMatch(columnLabels(false, false).z, /not simulated/);
  assert.deepEqual(parseSpan('2019-05', '2030-01', { min: '2020-01', max: '2026-09' }), { from: '2020-01', to: '2026-09' });
  assert.equal(parseSpan('2027-01', '2027-06', { min: '2020-01', max: '2026-09' }), null);
  assert.deepEqual(parseSpan('2023-03', '2024-01', { min: '2020-01', max: '2026-09' }), { from: '2023-03', to: '2024-01' });
  const valid = { node: () => true, state: () => true, region: () => true, months: { min: '2020-01', max: '2026-09' } };
  const store = createStore(), writes = []; let cur = '#/explorer?sel=A-1&from=2019-01&to=2031-12';
  const router = createRouter({ store, valid: () => valid, replace: (h) => { writes.push(h); cur = h; }, currentHash: () => cur });
  router.resolve(cur);
  assert.equal(cur, '#/explorer?sel=A-1&from=2020-01&to=2026-09');
  assert.deepEqual(store.span, { from: '2020-01', to: '2026-09' });
});

import { indicatorsHTML } from '../v2/assets/js/indicators.js';
import { tableHTML, NA_HTML } from '../v2/assets/js/compare-ui.js';
import { compareRows } from '../v2/assets/js/compare-data.js';

const synth = (over = {}) => ({ level: 'node', n: 1, base: 600, cap: 500, vf: 0.83, vfDay: 0.85, spread: 300, z: 1, yf: 2000, ingreso: 1e6, ingresoReal: 1.1e6, atajo: 1.2e6,
  baseReal: 650, capReal: 540, hours: null, ...over });
const shellStub = { store: { real: false }, label: (s) => ({ t: `Slot ${s.id}`, k: 'Node' }) };

test('no-baseline slot (no hourly profile): stays published, marked, never shown as simulated (scenario.js + indicators.js)', () => {
  const entries = scenarioEntries([{ slot: { kind: 'node', id: 'NB' }, rec: synth(), series: null }], { price: 40, dip: 100, yield: 0 });
  assert.equal(entries[0].noBaseline, true);
  assert.equal(entries[0].real, undefined);
  const html = indicatorsHTML(entries, shellStub, 'explorer');
  assert.match(html, /Not simulated \(no baseline\)/);
  assert.doesNotMatch(html, />Simulated</);
  assert.doesNotMatch(html, /vs real/);
  assert.match(html, />600</);               // the published average price
});

test('compare tables give the reason when a price is <= 0 under the scenario', { skip }, () => {
  const s = src();
  const slots = [{ kind: 'node', id: '04PLD-230' }, { kind: 'national', id: 'ALL' }];
  const base = slots.map((slot) => ({ slot, rec: recordFor(s, slot, 'Y2'), series: null }));
  if (base[0].rec.missing) return;
  const sim = scenarioEntries(base, { price: -300, dip: 100, yield: 0 });
  const rows = compareRows(sim, false);
  assert.equal(rows[0].na, true);
  assert.equal(rows[1].na, false);           // national stays positive at -300
  const cols = [{ h: 'VF', get: (r) => (r.na ? NA_HTML : r.tiles.vf.text) }];
  const html = tableHTML(rows, sim, shellStub, cols);
  assert.match(html, /n\/a \(price ≤ 0\)/);
  assert.match(html, /title="n\/a: price ≤ 0 under this scenario"/);
  assert.equal((html.match(/n\/a \(price ≤ 0\)/g) || []).length, 1);
});
