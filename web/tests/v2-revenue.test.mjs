// Cross-view consistency: Revenue and Explorer read the same record; revenue adds up to the published ingreso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { recordFor, revenueOf, tilesOf, priceBasis, partialNote, tableLabels } from '../v2/assets/js/explorer-data.js';

const W = join(dirname(fileURLToPath(import.meta.url)), '..');
const f = (p) => join(W, 'data', p);
const need = ['analysis/analysis_nodos.json', 'analysis/analysis.json', 'derived/node_profiles.json', 'derived/series_nodes.json', 'derived/series_areas.json'];
const skip = !need.every((p) => existsSync(f(p))) && 'web/data not present (ignored by git)';
const J = (p) => JSON.parse(readFileSync(f(p), 'utf8'));
const src = () => ({ nodos: J(need[0]), analysis: J(need[1]), profiles: J(need[2]), sNodes: J(need[3]), sAreas: J(need[4]) });
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

test('Revenue and Explorer agree for nodes, national, a region and a state, both windows, nominal and real', { skip }, () => {
  const s = src();
  const slots = [];
  const ids = s.nodos.ids;
  for (const i of [0, 321, 777, 1500, 2100, 2430]) slots.push({ kind: 'node', id: ids[i] });
  slots.push({ kind: 'national', id: 'ALL' }, { kind: 'region', id: 'CENTRAL' }, { kind: 'region', id: 'PENINSULAR' }, { kind: 'state', id: 'JALISCO' }, { kind: 'state', id: 'YUCATAN' });
  let checked = 0;
  for (const slot of slots) for (const win of ['Y2', 'Y1']) for (const real of [false, true]) {
    const rec = recordFor(s, slot, win);
    if (rec.missing) continue;
    checked++;
    const rv = revenueOf(rec, real), pb = priceBasis(rec, real), t = Object.fromEntries(tilesOf(rec, real).map((x) => [x.id, x.value]));
    const tag = `${slot.kind}:${slot.id} ${win} ${real ? 'real' : 'nominal'}`;
    // same price inputs as the Explorer tiles
    assert.equal(rv.base, t.base, `${tag} average price`);
    assert.equal(rv.cap, t.cap, `${tag} captured price`);
    assert.equal(rv.vf, t.vf, `${tag} VF`);
    assert.equal(rv.base, pb.base);
    // headline = published ingreso field of that basis
    assert.equal(rv.total, real && rec.ingresoReal != null ? rec.ingresoReal : rec.ingreso, `${tag} total`);
    if (rec.hours) {
      // hourly bars (production x price shape) add up to the yearly figure within rounding
      const day = rv.hours.real.reduce((a, b) => a + b, 0) * 365;
      assert.ok(near(day, rv.total, 1e-9), `${tag}: hours ${day} vs ingreso ${rv.total}`);
      const sday = rv.hours.shortcut.reduce((a, b) => a + b, 0) * 365;
      assert.ok(near(sday, rv.shortcut, 1e-9), `${tag}: shortcut hours`);
      // shape inputs are the Explorer's own profile arrays (same object)
      assert.equal(rec.hours.pml.length, 24);
    }
    // yearly revenue ties to production x captured price: exact for nodes
    if (slot.kind === 'node') assert.ok(near(rec.ingreso, rec.yf * rec.cap, 1e-6), `${tag}: ingreso = yf x cap`);
    assert.ok(rv.total > 0 && rv.shortcut >= rv.total * 0.9);
  }
  assert.ok(checked >= 30, `only ${checked} combinations checked`);
});

test('typical-day production x price is within a few percent of the exact yearly revenue (the shape is a typical day)', { skip }, () => {
  const s = src();
  for (const slot of [{ kind: 'node', id: s.nodos.ids[0] }, { kind: 'national', id: 'ALL' }]) {
    const rec = recordFor(s, slot, 'Y2');
    const raw = rec.hours.y.reduce((a, y, k) => a + y * rec.hours.pml[k], 0) * 365;
    assert.ok(Math.abs(raw / rec.ingreso - 1) < 0.08, `${slot.id}: raw typical day ${raw} vs ${rec.ingreso}`);
  }
});

test('partial-year note appears for nodes with fewer than 8,760 priced hours and not for full-year nodes', { skip }, () => {
  const s = src();
  const cases = [['Y1', ['03MMN-230', '03ZSU-115', '03AMX-69', '06BRL-115']], ['Y2', ['03RIC-115', '06IPR-115', '08DZY-115', '08SIK-115']]];
  for (const [win, ids] of cases) for (const id of ids) {
    const rec = recordFor(s, { kind: 'node', id }, win);
    assert.ok(!rec.missing && rec.nHoras < 8760, `${id} ${win}`);
    const n = partialNote(rec);
    assert.match(n, /^Partial year: [\d,]+ priced hours of 8,760\. Revenue covers priced hours only and is understated\.$/);
    assert.ok(n.includes(rec.nHoras.toLocaleString('en-US')));
    // nothing is annualised: the published figure is untouched
    assert.equal(revenueOf(rec, false).total, rec.ingreso);
  }
  const full = recordFor(s, { kind: 'node', id: s.nodos.ids[0] }, 'Y2');
  assert.equal(full.nHoras, 8760); assert.equal(partialNote(full), null);
  assert.equal(partialNote(recordFor(s, { kind: 'national', id: 'ALL' }, 'Y2')), null);
});

test('typical-day gap and scale factor are derived from the published ingreso', { skip }, () => {
  const s = src();
  for (const slot of [{ kind: 'node', id: s.nodos.ids[0] }, { kind: 'node', id: '03MMN-230' }, { kind: 'region', id: 'CENTRAL' }, { kind: 'national', id: 'ALL' }]) {
    const rec = recordFor(s, slot, slot.id === '03MMN-230' ? 'Y1' : 'Y2');
    const rv = revenueOf(rec, false);
    const raw = rec.hours.y.reduce((a, y, k) => a + y * rec.hours.pml[k], 0);
    assert.ok(near(rv.gap, (raw * 365 / rec.ingreso - 1) * 100, 1e-9));
    assert.ok(near(rv.scale * raw * 365, rec.ingreso, 1e-9));
    assert.ok(Math.abs(rv.gap) < 60, `${slot.id}: gap ${rv.gap}`);
  }
});

test("table labels name the basis; the real-mode footnote says the factor includes the today's-pesos adjustment", () => {
  const n = tableLabels(false, 0.819), r = tableLabels(true, 0.861);
  assert.match(n.shortcut, /nominal/); assert.match(n.hour, /nominal/);
  assert.doesNotMatch(n.note, /today's pesos/);
  assert.match(r.shortcut, /today's pesos/); assert.match(r.hour, /today's pesos/);
  assert.match(r.note, /includes the adjustment from nominal to today's pesos/);
  assert.match(r.note, /0\.861/); assert.match(n.note, /0\.819/);
});

test('real-mode scale factor = nominal factor x (ingreso_real / ingreso)', { skip }, () => {
  const s = src();
  const rec = recordFor(s, { kind: 'node', id: '03MMN-230' }, 'Y1');
  const n = revenueOf(rec, false), r = revenueOf(rec, true);
  assert.ok(near(r.scale / n.scale, rec.ingresoReal / rec.ingreso, 1e-9));
});
