// v2 geometry: the lon/lat conversion of mx.json must put known nodes inside their own state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { convertGeo, featureContains, featureBounds } from '../v2/assets/js/geo.js';

const W = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(readFileSync(join(W, 'assets/geo/mx.json'), 'utf8'));
const geo = convertGeo(raw);
const idxPath = join(W, 'data/index.json');

test('geometry: 32 states, 8 regions, bounds inside Mexico', () => {
  assert.equal(geo.states.features.length, 32);
  assert.equal(geo.regions.features.length, 8);
  const all = geo.states.features.map(featureBounds);
  assert.ok(Math.min(...all.map((b) => b[0])) > -119 && Math.max(...all.map((b) => b[2])) < -86);
  assert.ok(Math.min(...all.map((b) => b[1])) > 14 && Math.max(...all.map((b) => b[3])) < 33);
});

test('5 known nodes fall inside their own state polygon', { skip: !existsSync(idxPath) && 'web/data not present (ignored by git)' }, () => {
  const nodos = JSON.parse(readFileSync(idxPath, 'utf8')).nodos.filter((n) => n.lat != null);
  const want = ['JALISCO', 'YUCATAN', 'BAJA CALIFORNIA', 'CHIHUAHUA', 'OAXACA'];
  for (const ent of want) {
    const f = geo.states.features.find((s) => s.properties.key === ent);
    assert.ok(f, `state ${ent} missing`);
    const inside = nodos.filter((n) => n.entidad === ent).slice(0, 25);
    assert.ok(inside.length, `no nodes in ${ent}`);
    const hits = inside.filter((n) => featureContains(f, n.lon, n.lat)).length;
    assert.ok(hits / inside.length >= 0.9, `${ent}: ${hits}/${inside.length} nodes inside`);
  }
});
