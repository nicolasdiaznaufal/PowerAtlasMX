// Explorer numbers must equal the source JSON (analysis_nodos / analysis / series) for the same slot and window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { recordFor, seriesFor, tilesOf, yearRows } from '../v2/assets/js/explorer-data.js';
import { num } from '../assets/js/format.js';

const W = join(dirname(fileURLToPath(import.meta.url)), '..');
const f = (p) => join(W, 'data', p);
const need = ['analysis/analysis_nodos.json', 'analysis/analysis.json', 'derived/node_profiles.json', 'derived/series_nodes.json', 'derived/series_areas.json'];
const skip = !need.every((p) => existsSync(f(p))) && 'web/data not present (ignored by git)';
const J = (p) => JSON.parse(readFileSync(f(p), 'utf8'));
const load = () => ({ nodos: J(need[0]), analysis: J(need[1]), profiles: J(need[2]), sNodes: J(need[3]), sAreas: J(need[4]) });

test('node tiles equal analysis_nodos.json values (Aug 2025 - Jul 2026)', { skip }, () => {
  const src = load();
  const w = src.nodos.ventanas.deck_2025_26;
  for (const i of [0, 500, 1500, 2430]) {
    if (w.p_cap[i] === null) continue;
    const rec = recordFor(src, { kind: 'node', id: src.nodos.ids[i] }, 'Y2');
    assert.ok(!rec.missing);
    const t = Object.fromEntries(tilesOf(rec).map((x) => [x.id, x]));
    assert.equal(t.base.value, w.pml_medio[i]); assert.equal(t.cap.value, w.p_cap[i]); assert.equal(t.vf.value, w.vf[i]);
    assert.equal(t.z.value, w.pct_e0[i]); assert.equal(t.spread.value, w.spread_punta_solar[i]);
    assert.equal(t.vf.text, num(w.vf[i], 2)); assert.equal(t.base.text, num(w.pml_medio[i], 0));
    assert.equal(rec.hours.pml.length, 24);
    // components add back to the price (energy is derived as pml - losses - congestion)
    const h = rec.hours;
    assert.ok(h.pml.every((v, k) => Math.abs(h.energia[k] + h.perdidas[k] + h.congestion[k] - v) < 1e-9));
  }
});

test('national / region / state tiles equal analysis.json; yearly VF from additive sums', { skip }, () => {
  const src = load();
  const c = src.analysis.ventanas.deck_2025_26.por_config.tracker;
  const nat = recordFor(src, { kind: 'national', id: 'ALL' }, 'Y2');
  assert.equal(nat.vf, c.nacional.vf); assert.equal(nat.base, c.nacional.pml_medio); assert.equal(nat.cap, c.nacional.p_cap);
  assert.equal(nat.hours.y.length, 24);
  const reg = recordFor(src, { kind: 'region', id: 'CENTRAL' }, 'Y2');
  assert.equal(reg.vf, c.regiones.CENTRAL.vf);
  const st = recordFor(src, { kind: 'state', id: 'JALISCO' }, 'Y2');
  assert.equal(st.cap, c.estados.JALISCO.p_cap);
  const ser = seriesFor(src, { kind: 'national', id: 'ALL' });
  assert.equal(ser.months.length, 81);
  for (const y of yearRows(ser)) assert.ok(y.vf > 0.3 && y.vf < 1.2, `${y.label} ${y.vf}`);
});

test('missing slot reports missing, node without window data too', { skip }, () => {
  const src = load();
  assert.equal(recordFor(src, { kind: 'node', id: 'NO-SUCH' }, 'Y2').missing, true);
});
