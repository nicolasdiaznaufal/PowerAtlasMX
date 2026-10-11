// Compare: every number for slot k equals what Explorer / Revenue show for that slot alone; URL round trip with 3 slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { recordFor, seriesFor, tilesOf, revenueOf, partialNote, yearRows } from '../v2/assets/js/explorer-data.js';
import { buildEntries, compareRows, yearAxis } from '../v2/assets/js/compare-data.js';
import { createStore, serializeSel } from '../v2/assets/js/store.js';
import { createRouter } from '../v2/assets/js/route-logic.js';
import { STYLES } from '../v2/assets/js/series-style.js';

const W = join(dirname(fileURLToPath(import.meta.url)), '..');
const f = (p) => join(W, 'data', p);
const need = ['analysis/analysis_nodos.json', 'analysis/analysis.json', 'derived/node_profiles.json', 'derived/series_nodes.json', 'derived/series_areas.json'];
const skip = !need.every((p) => existsSync(f(p))) && 'web/data not present (ignored by git)';
const J = (p) => JSON.parse(readFileSync(f(p), 'utf8'));
const src = () => ({ nodos: J(need[0]), analysis: J(need[1]), profiles: J(need[2]), sNodes: J(need[3]), sAreas: J(need[4]) });

test('series styles differ by colour, dash and marker', () => {
  assert.equal(STYLES.length, 3);
  for (const key of ['color', 'dash', 'marker']) assert.equal(new Set(STYLES.map((s) => s[key])).size, 3, key);
});

test('every number for slot k equals the single-slot value (mixes, both windows, nominal and real)', { skip }, () => {
  const s = src(), ids = s.nodos.ids;
  const mixes = [
    [{ kind: 'node', id: ids[0] }, { kind: 'state', id: 'JALISCO' }, { kind: 'national', id: 'ALL' }],
    [{ kind: 'node', id: ids[321] }, { kind: 'node', id: ids[1500] }, { kind: 'node', id: '03MMN-230' }],
    [{ kind: 'region', id: 'CENTRAL' }, { kind: 'node', id: ids[777] }],
    [{ kind: 'state', id: 'YUCATAN' }, { kind: 'region', id: 'PENINSULAR' }, { kind: 'node', id: '08NCM-115' }],
  ];
  let n = 0;
  for (const slots of mixes) for (const win of ['Y2', 'Y1']) for (const real of [false, true]) {
    const entries = buildEntries(s, slots, win), rows = compareRows(entries, real), ya = yearAxis(entries, real);
    slots.forEach((slot, k) => {
      const rec = recordFor(s, slot, win);
      const tag = `${slot.kind}:${slot.id} ${win} ${real ? 'real' : 'nominal'}`;
      assert.deepEqual(entries[k].rec, rec, tag);
      if (rec.missing) { assert.equal(rows[k].ok, false); return; }
      const t = tilesOf(rec, real), rv = revenueOf(rec, real);
      for (const x of t) { assert.equal(rows[k].tiles[x.id].value, x.value, `${tag} ${x.id}`); assert.equal(rows[k].tiles[x.id].text, x.text); }
      assert.equal(rows[k].rev.total, rv.total, tag); assert.equal(rows[k].rev.shortcut, rv.shortcut); assert.equal(rows[k].rev.scale, rv.scale);
      assert.equal(rows[k].partial, partialNote(rec));
      assert.deepEqual(entries[k].series, seriesFor(s, slot));
      const own = yearRows(seriesFor(s, slot), real);
      own.forEach((y) => assert.equal(ya.vals[k][ya.years.indexOf(y.label)], y.vf, `${tag} year ${y.label}`));
      n++;
    });
  }
  assert.ok(n >= 40, `only ${n} slot checks`);
});

test('partial-year note is per slot', { skip }, () => {
  const s = src();
  const rows = compareRows(buildEntries(s, [{ kind: 'node', id: '03MMN-230' }, { kind: 'node', id: s.nodos.ids[0] }, { kind: 'national', id: 'ALL' }], 'Y1'), false);
  assert.match(rows[0].partial, /Partial year: 7,200 priced hours of 8,760/);
  assert.equal(rows[1].partial, null); assert.equal(rows[2].partial, null);
});

test('URL round trip with 3 slots, removing a chip, Back and Forward', () => {
  const valid = { node: (id) => ['01AAN-85'].includes(id), state: (k) => ['JALISCO'].includes(k), region: () => false };
  const store = createStore(), hist = []; let i = -1;
  const router = createRouter({ store, valid: () => valid, replace: (h) => { hist[i] = h; }, currentHash: () => hist[i] });
  const push = (h) => { hist.length = i + 1; hist.push(h); i++; return router.resolve(h); };
  push('#/explorer?sel=01AAN-85,state:JALISCO,national&real=1');
  assert.equal(store.get().length, 3);
  assert.equal(hist[i], '#/explorer?sel=01AAN-85,state:JALISCO,national&real=1');
  store.remove({ kind: 'state', id: 'JALISCO' });                         // chip removed on this entry
  assert.equal(hist[i], '#/explorer?sel=01AAN-85,national&real=1');
  push('#/revenue?sel=01AAN-85,national&real=1');
  i--; router.resolve(hist[i]);                                            // Back
  assert.equal(serializeSel(store.get()), '01AAN-85,national');
  assert.equal(hist[i], '#/explorer?sel=01AAN-85,national&real=1');
  i++; router.resolve(hist[i]);                                            // Forward
  assert.equal(hist[i], '#/revenue?sel=01AAN-85,national&real=1');
  assert.equal(store.add({ kind: 'state', id: 'JALISCO' }), true);
  assert.equal(store.add({ kind: 'region', id: 'NORTE' }), false);        // cap of 3
  assert.equal(hist[i], '#/revenue?sel=01AAN-85,national,state:JALISCO&real=1');
});

test('chip removal: focus moves to the next chip, then to + Add; the announcement names the slot and the count', async () => {
  const { nextFocusIndex, removedMessage } = await import('../v2/assets/js/chips.js');
  assert.equal(nextFocusIndex(0, 2), 0);   // first removed: the chip that moved up
  assert.equal(nextFocusIndex(2, 2), 1);   // last removed: the new last chip
  assert.equal(nextFocusIndex(0, 0), -1);  // nothing left: caller falls back to + Add / heading
  assert.equal(removedMessage('Jalisco', 2), 'Removed Jalisco; 2 of 3 slots');
});

test('VF axis max never clips: >= 1, covers every plotted value, round steps', async () => {
  const { vfAxisMax } = await import('../v2/assets/js/svg-charts.js');
  assert.equal(vfAxisMax([0.5, 0.9, null]), 1);
  assert.equal(vfAxisMax([1.0]), 1);
  assert.equal(vfAxisMax([1.01]), 1.2);
  assert.equal(vfAxisMax([1.36]), 1.6);
  assert.equal(vfAxisMax([2.0]), 2);
});

test('no plotted VF value exceeds the axis max (all node series, all areas)', { skip }, async () => {
  const { vfAxisMax } = await import('../v2/assets/js/svg-charts.js');
  const s = src();
  let over = 0, maxSeen = 0;
  const check = (vals) => { const m = vfAxisMax(vals); for (const v of vals) { if (v !== null && v > m) over++; if (v !== null && v > maxSeen) maxSeen = v; } };
  for (const n of Object.values(s.sNodes.nodes)) check(n.m);
  check(s.sAreas.areas.ALL.m);
  for (const g of ['region', 'state']) for (const a of Object.values(s.sAreas.areas[g])) check(a.m);
  assert.equal(over, 0);
  assert.ok(maxSeen > 1, 'expected at least one VF above 1 in the data');
});

test('table headings name the price basis; average-day VF is labelled nominal', async () => {
  const { columnLabels } = await import('../v2/assets/js/compare-data.js');
  const n = columnLabels(false), r = columnLabels(true);
  assert.match(n.base, /nominal/); assert.match(n.cap, /nominal/); assert.match(n.revenue, /nominal/);
  assert.match(r.base, /today's pesos/); assert.match(r.cap, /today's pesos/); assert.match(r.vf, /today's pesos/);
  assert.match(r.revenue, /today's pesos/); assert.match(r.shortcut, /today's pesos/);
  assert.match(r.vfDay, /nominal/); assert.match(n.vfDay, /nominal/);
  assert.match(r.heading('Aug 2025 – Jul 2026'), /today's pesos/);
});

test('bars never leave the plot rectangle, including negative VF (every node and area series)', { skip }, async () => {
  const { barChart, vfAxis, PAD, W } = await import('../v2/assets/js/svg-charts.js');
  const s = src(), H = 240;
  const rects = (svg) => [...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
  let charts = 0, neg = 0;
  const run = (vals) => {
    const bars = vals.map((v, i) => ({ v, label: String(i), color: 'x' }));
    const sc = vfAxis(vals.concat([0.8]));
    const svg = barChart({ bars, scale: sc, hline: { v: 0.8, label: 'w' }, refs: [1], H, aria: 't' });
    charts++;
    if (vals.some((v) => v !== null && v < 0)) neg++;
    assert.ok(sc.ticks.includes(0), 'axis contains zero');
    for (const r of rects(svg)) {
      assert.ok(r.y >= PAD.t - 0.15, `bar above plot: y=${r.y}`);
      assert.ok(r.y + r.h <= H - PAD.b + 0.15, `bar below plot: ${r.y + r.h} > ${H - PAD.b}`);
      assert.ok(r.x >= PAD.l - 0.15 && r.x + r.w <= W - PAD.r + 0.15);
    }
  };
  for (const n of Object.values(s.sNodes.nodes)) run(n.m);
  run(s.sAreas.areas.ALL.m);
  for (const g of ['region', 'state']) for (const a of Object.values(s.sAreas.areas[g])) run(a.m);
  assert.ok(charts > 2400 && neg > 0, `${charts} charts, ${neg} with negatives`);
});

test('nice ticks are round and include 0 (also for negative ranges)', async () => {
  const { niceTicks, vfAxis } = await import('../v2/assets/js/svg-charts.js');
  assert.deepEqual(niceTicks(-0.597, 1.36).ticks.includes(0), true);
  const t = niceTicks(-50, 2100);
  assert.ok(t.ticks.includes(0) && t.lo <= -50 && t.hi >= 2100);
  assert.ok(t.ticks.every((v) => Number.isInteger(v)), JSON.stringify(t.ticks));
  const v = vfAxis([-0.597, 0.9, 1.1]);
  assert.deepEqual(v.ticks, [-0.8, -0.4, 0, 0.4, 0.8, 1.2]);
  assert.deepEqual(vfAxis([0.5]).ticks, [0, 0.25, 0.5, 0.75, 1]);
});

test('route announcement does not overwrite a removal message (it is appended)', async () => {
  const { mergeAnnouncement } = await import('../v2/assets/js/live.js');
  const a = mergeAnnouncement(null, 'Removed Jalisco; 0 of 3 slots', 1000, true);
  const b = mergeAnnouncement(a, 'Map', 1085);
  assert.equal(b.text, 'Removed Jalisco; 0 of 3 slots. Map');
  assert.equal(mergeAnnouncement(a, 'Map', 1000 + 5000).text, 'Map');           // later: plain replace
  assert.equal(mergeAnnouncement(null, 'Explorer', 10).text, 'Explorer');
});
