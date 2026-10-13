// v2 M13 (corrections): one time control, zoom, comparison grids (up to 16), joined simulation + hourly card, one map, inline assumptions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { windowOfSpan, mapWinOfSpan, spanIsWindow, FULL_SPAN, Y1_SPAN } from '../v2/assets/js/query-extras.js';
import { resolveHash, hrefFor } from '../v2/assets/js/route-logic.js';
import { createStore, MAX_SEL, parseSel } from '../v2/assets/js/store.js';
import { indexAt, rangeFromDrag, stepRange, createZoom } from '../v2/assets/js/zoom.js';
import { gridCols, gridRows, cellHeight, gridHTML } from '../v2/assets/js/grid-plots.js';
import { axisTicks } from '../v2/assets/js/daily-card.js';
import { renderChart, lineChart } from '../v2/assets/js/svg-charts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => fs.readFileSync(join(HERE, '..', 'v2', p), 'utf8');

test('time span is the one control: 12-month figures use the window that holds the span end', () => {
  assert.equal(windowOfSpan(null), 'Y2');
  assert.equal(windowOfSpan(Y1_SPAN), 'Y1');
  assert.equal(windowOfSpan({ from: '2024-10', to: '2025-03' }), 'Y1');        // inside Aug 2024 - Jul 2025
  assert.equal(windowOfSpan({ from: '2025-01', to: '2025-09' }), 'Y2');        // reaches past Jul 2025: the current window
  assert.equal(windowOfSpan(FULL_SPAN), 'Y2');
  assert.equal(mapWinOfSpan(FULL_SPAN), 'ALL');                                // published full-history areas feed the maps
  assert.equal(mapWinOfSpan({ from: '2025-08', to: '2025-12' }), 'Y2');
  assert.equal(spanIsWindow(null), true); assert.equal(spanIsWindow(FULL_SPAN), false);
});

test('URL: from/to are kept as given (clamped to the data), nothing for the last 12 months', () => {
  const valid = { node: (id) => id === 'A', state: () => false, region: () => false, months: { min: '2020-01', max: '2026-09' } };
  assert.deepEqual(resolveHash('#/explorer?sel=A&from=2020-01&to=2026-09', valid).span, { from: '2020-01', to: '2026-09' });
  assert.deepEqual(resolveHash('#/explorer?sel=A&from=2025-02&to=2025-05', valid).span, { from: '2025-02', to: '2025-05' });
  assert.equal(resolveHash('#/explorer?sel=A', valid).span, null);
  assert.equal(hrefFor('/revenue', [{ kind: 'node', id: 'A' }], false, { span: { ...FULL_SPAN } }), '#/revenue?sel=A&from=2020-01&to=2026-09');
});

test('weather is fixed: no select, old wx values are ignored and dropped from the URL', () => {
  assert.equal(/ct-wx|Weather year/.test(src('assets/js/controls.js')), false);
  const valid = { node: (id) => id === 'A', state: () => false, region: () => false };
  const r = resolveHash('#/explorer?sel=A&wx=y2020', valid);
  assert.equal(r.wx, 'mean'); assert.equal(r.hash, '#/explorer?sel=A');
  assert.match(src('assets/js/view-base.js'), /MDA reference price \(CENACE\)/);   // the note lives in the data line
});

test('time control: chips + slider + readout, no window toggle, no legend, cards follow the page window', () => {
  const v = src('assets/js/view-base.js'), r = src('assets/js/range-slider.js');
  assert.match(v, /mountRangeSlider/); assert.match(v, /id="vb-span"/);
  assert.equal(/Time span \(monthly value factor\)/.test(r), false);
  assert.match(src('assets/js/span-data.js'), /Previous 12 months/);
  assert.equal(/ct-win|WIN_LABEL/.test(src('assets/js/controls.js')), false);
  for (const f of ['pnl-card.js', 'coverage-card.js']) {
    const s = src(`assets/js/${f}`);
    assert.equal(/WIN\.Y1\.short, WIN\.Y2\.short|pl-yr|cv-yr|Find a place|mountPlacePicker/.test(s), false, f);
  }
});

test('zoom: index mapping, drag threshold, steps, persistence by label', () => {
  const geom = { W: 652, l: 52, r: 0 };                    // 600 units of plot, 60 points -> 10 units each
  assert.equal(indexAt(52, geom, 60), 0); assert.equal(indexAt(52 + 95, geom, 60), 9); assert.equal(indexAt(9999, geom, 60), 59);
  assert.equal(rangeFromDrag(100, 103, geom, 60), null);   // below 8 px: a click, not a zoom
  assert.deepEqual(rangeFromDrag(152, 352, geom, 60), [10, 30]);
  assert.deepEqual(rangeFromDrag(352, 152, geom, 60), [10, 30]); // either direction
  assert.equal(rangeFromDrag(152, 170, geom, 60), null);   // fewer than 5 points
  assert.deepEqual(stepRange(null, 100, 1), [25, 74]);
  assert.equal(stepRange([25, 74], 100, -1), null);        // zooming out of a half range is the whole series
  assert.deepEqual(stepRange([0, 9], 100, 1), [3, 7]);
  let changes = 0; const store = {}, labels = Array.from({ length: 50 }, (_, i) => `d${i}`);
  const z = createZoom({ labels, store, key: 'k', onChange: () => { changes++; } });
  assert.deepEqual(z.range, [0, 49]); assert.equal(z.zoomed, false);
  z.set([10, 19]); assert.deepEqual(z.range, [10, 19]); assert.equal(changes, 1);
  assert.deepEqual(store.k, { from: 'd10', to: 'd19' });
  const z2 = createZoom({ labels, store, key: 'k', onChange: () => {} });   // a repaint restores the same range
  assert.deepEqual(z2.range, [10, 19]);
  z2.reset(); assert.equal(z2.zoomed, false); assert.equal(store.k, null);
  z2.set([0, 49]); assert.equal(z2.zoomed, false);         // the whole series is not a zoom
});

test('zoom is wired to every time plot: daily card (shared by the card), monthly series; Escape and double-click reset', () => {
  assert.match(src('assets/js/daily-card.js'), /zoom\.attach\(/);
  assert.match(src('assets/js/series-card.js'), /zoom\.attach\(|\.attach\(/);
  const z = src('assets/js/zoom.js');
  assert.match(z, /dblclick/); assert.match(z, /'Escape'/); assert.match(z, /pointerdown/); assert.match(z, /data-z="in"/);
  assert.equal(/preventDefault\(\)/.test(z), false);       // never blocks the hover box or touch scrolling
});

test('renderChart returns the geometry the zoom needs and restores the margins after a compact plot', () => {
  const el = { clientWidth: 400, innerHTML: '', querySelector: () => null };
  const g = renderChart(el, () => lineChart({ series: [{ vals: [1, 2, 3], label: 'a' }], labels: ['a', 'b', 'c'], aria: 'x' }), { compact: true });
  assert.deepEqual([g.W, g.l, g.r], [400, 42, 8]);
  const g2 = renderChart(el, () => lineChart({ series: [{ vals: [1, 2, 3], label: 'a' }], labels: ['a', 'b', 'c'], aria: 'x' }));
  assert.deepEqual([g2.l, g2.r], [52, 12]);
});

test('comparison grid: 1 -> 1, 2-4 -> 2x2, 5-9 -> 3x3, 10-16 -> 4x4; whole grid in one view; phones stay readable', () => {
  const cols = [1, 2, 3, 4, 5, 9, 10, 16].map((n) => gridCols(n, 1440));
  assert.deepEqual(cols, [1, 2, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual([4, 9, 16].map((n) => gridRows(n, 1440)), [2, 3, 4]);
  assert.equal(gridCols(3, 390), 1); assert.equal(gridCols(9, 390), 2); assert.equal(gridCols(16, 390), 2);
  assert.equal(cellHeight(1, 300), 300);
  for (const n of [2, 4, 9, 16]) {
    const h = cellHeight(n, 300, { height: 900, width: 1440 }), rows = gridRows(n, 1440);
    assert.ok(h >= 110 && h < 300, `${n}: ${h}`);
    assert.ok(rows * (h + 40) <= 900 - 200 + 60 || h === 110, `${n} rows of ${h} fit one view`);
  }
  assert.ok(cellHeight(16, 300, { height: 900, width: 1440 }) < cellHeight(4, 300, { height: 900, width: 1440 }));
  const html = gridHTML(Array.from({ length: 5 }, (_, i) => ({ title: `P${i}`, id: String(i) })), 1440);
  assert.match(html, /--cols:3/); assert.equal((html.match(/<figcaption>/g) || []).length, 5);
  assert.equal(/<figcaption>/.test(gridHTML([{ title: 'solo', id: '0' }], 1440)), false);
});

test('compare limit is 16 and parsing keeps the order; axis ticks adapt to the zoomed range', () => {
  assert.equal(MAX_SEL, 16);
  const s = createStore();
  for (let i = 0; i < 16; i++) assert.equal(s.add({ kind: 'state', id: `S${i}` }), true);
  assert.equal(s.add({ kind: 'state', id: 'S16' }), false);
  assert.equal(parseSel(Array.from({ length: 30 }, (_, i) => `state:S${i}`).join(',')).length, 16);
  const dates = Array.from({ length: 40 }, (_, i) => `2025-03-${String(i + 1).padStart(2, '0')}`.replace(/-(3[2-9]|40)$/, '-28'));
  const t = axisTicks(dates.slice(0, 20), 600);
  assert.ok(t.length >= 3 && t.length <= 12 && /^\d+ Mar$/.test(t[0].text));  // days, not months, when zoomed in
});

test('simulation box is merged into the hourly card, Explorer only; Revenue has no hourly price plot', () => {
  const vb = src('assets/js/view-base.js'), rev = src('assets/js/revenue.js'), exp = src('assets/js/explorer.js');
  assert.match(vb, /view === 'explorer' \? '<div id="vb-scn"/);
  assert.equal(/decompSectionHTML/.test(rev), false);
  assert.match(exp, /decompSectionHTML/);
  assert.match(src('assets/css/explorer.css'), /#vb-body > \.decomp:first-child \{ border-top-left-radius: 0/);
  assert.match(src('assets/js/decomposition.js'), /<details class="how">/);   // the long reading notes are folded away
});

test('one map for the Explorer: metric toggle + Regions | States, one legend, selection outlined, values table kept', () => {
  const s = src('assets/js/maps-card.js');
  assert.equal((s.match(/createCanvasMap\(/g) || []).length, 1);
  assert.equal(/mp-one|mp-w2|mp-l2/.test(s), false);
  for (const t of ['mp-metric', 'mp-level', 'Values as a table', 'setSelected', 'mp-l1']) assert.ok(s.includes(t), t);
});

test('Revenue: assumptions inline at the top, no drawer, no Edit button; same fields and storage key', () => {
  assert.equal(fs.existsSync(join(HERE, '..', 'v2/assets/js/assump-drawer.js')), false);
  const all = fs.readdirSync(join(HERE, '..', 'v2/assets/js')).map((f) => src(`assets/js/${f}`)).join('\n');
  assert.equal(/data-open-assump|close-assump|installDrawer/.test(all), false);
  const i = src('assets/js/assump-inline.js');
  assert.match(i, /FIELDS/); assert.match(i, /Deck scenario/); assert.match(i, /My assumptions/); assert.match(i, /Clear my assumptions/);
  assert.match(src('assets/js/view-base.js'), /view === 'revenue' \? '<div id="vb-assump">/);
});

test('left column: compact, sticky for the whole page, no inner scroll; one-line places, figures of the focused place only', () => {
  const css = src('assets/css/explorer.css'), ind = src('assets/js/indicators.js'), ch = src('assets/js/chips.js');
  assert.match(css, /\.an-side \{ max-height: none !important; overflow: visible !important;/);
  assert.match(css, /\.an-side\.multi \{ position: sticky !important; \}/);
  assert.match(css, /\.an-side \.chips\.dense \{ grid-template-columns: 1fr 1fr; \}/);   // 7 to 16 places: two per line
  assert.match(ind, /multi && k !== fi\) return ''/);
  assert.match(ch, /list\.length > 6/); assert.match(ch, /aria-pressed/);
});

test('M16: assumptions in the left column of Revenue, brand 20% bigger, landing byline halved, appendix pill in Explorer', () => {
  const vb = src('assets/js/view-base.js');
  assert.match(vb, /side\.innerHTML = `[^`]*vb-assump/);
  assert.match(vb, /mountAssumpInline\(side\.querySelector\('#vb-assump'\)/);
  assert.match(src('assets/css/base.css'), /font-size: 16\.8px;[^}]*\}\n\.nav \.brand svg \{ width: 33\.6px; height: 33\.6px;/);
  assert.match(src('assets/css/landing.css'), /clamp\(11px, 1\.525vw, 22px\)/);
  assert.match(src('assets/css/explorer.css'), /\.bar-pair \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('span captured price is a ratio of sums over the span, in the active pesos', async () => {
  const { spanCaptured } = await import('../v2/assets/js/daily-math.js');
  const dec = { tracker: { ingreso_dia: [100, 300, null, 50], y_day: [1, 1, 1, 0.5] } };
  assert.equal(spanCaptured(dec, 'tracker', 0, 3), (100 + 300 + 50) / 2.5);   // the day without revenue is out of both sums
  assert.equal(spanCaptured(dec, 'tracker', 0, 1, [2, 1, 1, 1]), (200 + 300) / 2);
  assert.equal(spanCaptured(dec, 'tracker', 2, 2), null);
});
