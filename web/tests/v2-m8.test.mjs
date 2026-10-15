// M8: chart axes always labelled, PML decomposition, analysis scope, national area tables, copy file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { barChart, lineChart, pairChart, renderChart, chartWidth } from '../v2/assets/js/svg-charts.js';
import { decompChart, solarRuns } from '../v2/assets/js/chart-decomp.js';
import { targetFor, scopeOptions, remember, LEVELS } from '../v2/assets/js/scope.js';
import { areaRows, sortRows } from '../v2/assets/js/area-tables.js';
import { COPY } from '../v2/assets/js/copy.js';

const W = join(dirname(fileURLToPath(import.meta.url)), '..');
const hasData = existsSync(join(W, 'data/analysis/analysis.json'));
const ticks = (svg) => (svg.match(/class="tick"/g) || []).length;
const hours = Array.from({ length: 24 }, (_, h) => h);
const y = hours.map((h) => (h >= 6 && h <= 18 ? Math.sin(((h - 6) / 12) * Math.PI) : 0));
const pml = hours.map((h) => 500 + 20 * h), per = hours.map(() => 5), cg = hours.map((h) => (h % 5) - 2), en = pml.map((p, i) => p - per[i] - cg[i]);

test('every chart builder emits x tick labels and an x axis title', () => {
  const bars = barChart({ bars: hours.map((h) => ({ v: h / 10, label: String(h), color: 'x' })), xEvery: 3, aria: 'a', xtitle: 'Hour' });
  assert.ok(ticks(bars) > 8 && /class="atitle xtitle"/.test(bars) && />Hour</.test(bars));
  const lines = lineChart({ series: [{ vals: hours, label: 'a' }], labels: hours.map(String), xEvery: 3, aria: 'a', xtitle: 'Hour' });
  assert.ok(ticks(lines) > 8 && /xtitle/.test(lines));
  const pairs = pairChart({ a: hours, b: hours, ca: 'x', cb: 'y', aria: 'a', xtitle: 'Hour' });
  assert.ok(ticks(pairs) > 8 && /xtitle/.test(pairs));
  const dc = decompChart({ energia: en, perdidas: per, congestion: cg, pml, y, base: 600, cap: 520, aria: 'a' });
  assert.ok(ticks(dc) >= 12 + 4 && /xtitle/.test(dc), 'hour labels + y ticks');
  for (const cls of ['solar-band', 'pml-line', 'out-line', 'hline', 'cline']) assert.match(dc, new RegExp(cls));
});

test('chart width follows the container so tick text keeps its size on phones', () => {
  assert.equal(chartWidth({ clientWidth: 360 }), 360);
  assert.equal(chartWidth({ clientWidth: 80 }), 300);
  assert.equal(chartWidth({ clientWidth: 4000 }), 1000);
  const el = { clientWidth: 420, innerHTML: '' };
  renderChart(el, () => barChart({ bars: [{ v: 1, label: 'a', color: 'x' }], aria: 'a', xtitle: 'x' }));
  assert.match(el.innerHTML, /viewBox="0 0 420 /);
});

test('solar hours are the runs where output is at least 5% of the peak hour', () => {
  assert.deepEqual(solarRuns(y), [[7, 17]]);   // 6 and 18 are exactly zero at the edges of the sine
  assert.deepEqual(solarRuns(Array(24).fill(0)), []);
  assert.deepEqual(solarRuns([0, 1, 1, 0, 1, 0]), [[1, 2], [4, 4]]);
});

const ctx = {
  nodeInfo: (id) => (id === 'N1' ? { state: 'JALISCO', region: 'OCCIDENTAL' } : null),
  stateRegion: (k) => (k === 'JALISCO' ? 'OCCIDENTAL' : null),
};
test('scope: node -> state -> region -> national, and back only to what was visited', () => {
  const node = { kind: 'node', id: 'N1' };
  assert.deepEqual(targetFor(node, 'state', ctx), { kind: 'state', id: 'JALISCO' });
  assert.deepEqual(targetFor(node, 'region', ctx), { kind: 'region', id: 'OCCIDENTAL' });
  assert.deepEqual(targetFor(node, 'national', ctx), { kind: 'national', id: 'ALL' });
  const state = { kind: 'state', id: 'JALISCO' };
  assert.equal(targetFor(state, 'node', ctx, {}), null);                           // never visited a node
  const memo = remember({}, node, ctx);
  assert.deepEqual(targetFor(state, 'node', ctx, memo), node);                     // restored
  assert.deepEqual(scopeOptions(state, ctx, {}).map((o) => [o.kind, o.enabled]), [['node', false], ['state', true], ['region', true], ['national', true]]);
  assert.deepEqual(LEVELS, ['node', 'state', 'region', 'national']);
});

test('area rows: published fields only, real basis uses *_real, sorting is stable', { skip: !hasData && 'web/data not present' }, () => {
  const an = JSON.parse(readFileSync(join(W, 'data/analysis/analysis.json'), 'utf8'));
  const c = an.ventanas.deck_2025_26.por_config.tracker;
  const rows = areaRows(an, 'Y2', 'state', false), j = rows.find((r) => r.id === 'JALISCO');
  assert.equal(j.base, c.estados.JALISCO.pml_medio); assert.equal(j.cap, c.estados.JALISCO.p_cap);
  assert.equal(j.rev, c.estados.JALISCO.ingreso_mxn_por_mwp); assert.equal(j.n, c.estados.JALISCO.n_nodos);
  const rr = areaRows(an, 'Y2', 'region', true).find((r) => r.id === 'CENTRAL');
  assert.equal(rr.cap, c.regiones.CENTRAL.p_cap_real); assert.equal(rr.rev, c.regiones.CENTRAL.ingreso_real_mxn_por_mwp);
  assert.equal(areaRows(an, 'Y2', 'region', false).length, 7);
  const byVf = sortRows(rows, 'vf', -1);
  for (let i = 1; i < byVf.length; i++) assert.ok(byVf[i - 1].vf >= byVf[i].vf);
  const byName = sortRows(rows, 'name', 1);
  for (let i = 1; i < byName.length; i++) assert.ok(byName[i - 1].name.localeCompare(byName[i].name) <= 0);
});

test('intro copy lives in copy.js, is short plain English and has no equations', () => {
  for (const v of ['explorer', 'revenue']) {
    const t = COPY[v].intro;
    assert.ok(t.length > 120 && t.length < 700, `${v} intro length ${t.length}`);
    assert.doesNotMatch(t, /[=∑√×÷^]|\\\(|\$\$/);
    assert.ok((t.match(/\. /g) || []).length >= 2, 'at least three sentences');
  }
  assert.match(COPY.fixedTip, /fixed facing south/i);
  assert.doesNotMatch(COPY.fixedTip + COPY.mountNote, /[=∑√×÷^]/);
});
