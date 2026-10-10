// Frontend-owned derived series (web/tools/build_derived.py) must agree with analysis.json and with the node sheets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const J = (p) => JSON.parse(readFileSync(join(dir, p), 'utf8'));
const a = J('analysis/analysis.json'), nn = J('analysis/analysis_nodos.json');
const prof = J('derived/node_profiles.json'), sn = J('derived/series_nodes.json'), sa = J('derived/series_areas.json');

test('derived files exist and have the expected shape', () => {
  assert.equal(sa.months.length, 81);
  assert.deepEqual(sa.years, [2020, 2021, 2022, 2023, 2024, 2025]);
  assert.ok(Object.keys(prof.nodes).length > 2400);
  assert.equal(Object.keys(sa.areas.region).length, 7);
});
// tolerance 0.004: analysis.json also counts node-months with a few missing hours (largest gap: Quintana Roo, Dec 2025, 0.0035); median gap 0.0002
test('monthly region VF equals analysis.json explorador (Aug 2025 – Jul 2026)', () => {
  const ex = a.ventanas.deck_2025_26.por_config.tracker.explorador;
  const i0 = sa.months.indexOf('2025-08');
  for (const [reg, rows] of Object.entries(ex.vf_mensual_regiones)) rows.forEach((r, k) => assert.ok(Math.abs(sa.areas.region[reg].m[i0 + k] - r.vf) < 0.004, `${reg} ${r.mes}`));
  for (const [st, rows] of Object.entries(ex.vf_mensual_estados)) rows.forEach((r, k) => assert.ok(Math.abs(sa.areas.state[st].m[i0 + k] - r.vf) < 0.004, `${st} ${r.mes}`));
});
test('hourly profile of a node reproduces its window average price and captured price', () => {
  const id = '01AAN-85', i = nn.ids.indexOf(id), w = nn.ventanas.deck_2025_26;
  const [pml, per, cg, y] = prof.nodes[id].Y2;
  const avg = pml.reduce((s, v) => s + v, 0) / 24;
  assert.ok(Math.abs(avg - w.pml_medio[i]) < 0.5);
  const cap = pml.reduce((s, v, h) => s + v * y[h], 0) / y.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(cap / avg - w.vf_dia_promedio[i]) < 0.005);
  assert.equal(per.length, 24); assert.equal(cg.length, 24);
});
test('calendar-year series: complete years only, national VF in a sane band and falling from 2022', () => {
  const y = sa.areas.ALL.y;
  assert.deepEqual(Object.keys(y), ['2020', '2021', '2022', '2023', '2024', '2025']);
  const vf = (r, real) => (real ? r[3] / r[2] : r[1] / r[0]);
  for (const k of Object.keys(y)) assert.ok(vf(y[k], false) > 0.7 && vf(y[k], false) < 1.05);
  assert.ok(vf(y['2025'], false) < vf(y['2022'], false));
  assert.ok(y['2025'][4] > 2000);
});
test('node monthly series: full-window VF is within the published node KPI band', () => {
  const s = sn.nodes['01AAN-85'];
  const vals = s.m.filter((v) => v !== null);
  assert.ok(vals.length >= 80);
  const raw = J('nodes/01AAN-85.json');
  const vf = raw.kpis.tracker.vf;
  const mean = vals.reduce((x, y2) => x + y2, 0) / vals.length;
  assert.ok(Math.abs(mean - vf) < 0.03);
});
