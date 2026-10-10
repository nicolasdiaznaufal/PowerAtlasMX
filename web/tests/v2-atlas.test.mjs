// v2 atlas: within-region rank and metric domain are pure; values come straight from analysis_nodos.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rankInRegion, buildAtlas, WINDOW } from '../v2/assets/js/atlas.js';
import { domainOf, position } from '../v2/assets/js/metrics.js';
import { parseSel, serializeSel, createStore } from '../v2/assets/js/store.js';
import { filterEntries } from '../v2/assets/js/selector.js';

test('rankInRegion: 1 = best vf within region, nulls skipped', () => {
  const r = rankInRegion(['A', 'A', 'B', 'A', 'B'], [0.8, 0.9, 0.7, null, 0.75]);
  assert.deepEqual(r.rank, [2, 1, 2, null, 1]);
  assert.deepEqual(r.size, [2, 2, 2, null, 2]);
});

test('position: rank 1 is the high end, domain ignores no-data nodes', () => {
  const nodes = [{ has: true, vf: 0.5, rank: 2, rankN: 2 }, { has: true, vf: 0.9, rank: 1, rankN: 2 }, { has: false, vf: null, rank: null, rankN: null }];
  assert.equal(position(nodes[1], 'rank', domainOf(nodes, 'rank')), 1);
  assert.equal(position(nodes[0], 'rank', domainOf(nodes, 'rank')), 0);
  const d = domainOf(nodes, 'vf');
  assert.ok(d[0] >= 0.5 && d[1] <= 0.9);
  assert.equal(position(nodes[2], 'vf', d), null);
});

test('store: max 3, mixed kinds, url round trip', () => {
  const s = createStore();
  assert.ok(s.add({ kind: 'node', id: '01AAN-85' }) && s.add({ kind: 'state', id: 'JALISCO' }) && s.add({ kind: 'national', id: 'ALL' }));
  assert.equal(s.add({ kind: 'region', id: 'NORTE' }), false);
  assert.equal(serializeSel(s.get()), '01AAN-85,state:JALISCO,national');
  assert.deepEqual(parseSel('01AAN-85,state:JALISCO,national'), s.get());
});

test('selector filter: id, name and municipality; empty query lists areas only', () => {
  const e = [{ kind: 'national', id: 'ALL', hay: 'national' }, { kind: 'node', id: '01AAN-85', hay: '01aan-85 actopan actopan' }, { kind: 'node', id: 'X', hay: 'x el salto el salto' }];
  assert.deepEqual(filterEntries(e, '').map((x) => x.id), ['ALL']);
  assert.deepEqual(filterEntries(e, '01aan').map((x) => x.id), ['01AAN-85']);
  assert.deepEqual(filterEntries(e, 'salto').map((x) => x.id), ['X']);
});

const W = join(dirname(fileURLToPath(import.meta.url)), '..');
const skip = !existsSync(join(W, 'data/analysis/analysis_nodos.json')) && 'web/data not present (ignored by git)';
test('atlas values equal analysis_nodos.json for the same node (deck_2025_26)', { skip }, () => {
  const a = JSON.parse(readFileSync(join(W, 'data/analysis/analysis_nodos.json'), 'utf8'));
  const idx = JSON.parse(readFileSync(join(W, 'data/index.json'), 'utf8'));
  const atlas = buildAtlas(idx, a);
  const w = a.ventanas[WINDOW.key];
  for (const i of [0, 100, 1000, 2430]) {
    const n = atlas.nodes.find((x) => x.id === a.ids[i]);
    assert.equal(n.vf, w.vf[i]); assert.equal(n.pcap, w.p_cap[i]); assert.equal(n.pml, w.pml_medio[i]);
  }
  assert.equal(atlas.nodes.filter((n) => n.has).length + 7 >= a.ids.length - 0, true);
  assert.equal(atlas.config, 'tracker');
});
