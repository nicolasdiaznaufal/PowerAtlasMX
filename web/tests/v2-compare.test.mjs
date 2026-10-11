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
