// v2 M12 (v1 parity): Explorer layout order, horizontal simulation box, maps, Revenue economics cards, assumptions drawer, appendix route.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveHash, hrefFor, ROUTES } from '../v2/assets/js/route-logic.js';
import { barChart } from '../v2/assets/js/svg-charts.js';
import { verdictPillHTML } from '../v2/assets/js/verdict.js';
import { appendixHTML } from '../v2/assets/js/appendix-text.js';
import { DECK_SET, blankMine, KEY } from '../assets/js/params.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => fs.readFileSync(join(HERE, '..', 'v2', p), 'utf8');
const W = join(HERE, '..', 'data');
const haveData = fs.existsSync(join(W, 'analysis', 'analysis.json')) && fs.existsSync(join(W, 'analysis', 'analysis_nodos.json'));
const skip = haveData ? false : 'web/data absent';

test('Explorer card order: price parts, 7-day plots, value factor by month, maps (then irradiance, comparison)', () => {
  const s = src('assets/js/explorer.js'), i = (t) => s.indexOf(t, s.indexOf('mainHTML'));
  const order = ['decompSectionHTML', "dailyCardHTML('explorer')", 'seriesCardHTML()', 'mapsCardHTML()', 'irradianceCardHTML'].map(i);
  assert.ok(order.every((v) => v > 0), 'all cards present');
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('simulation box: horizontal, in the main column above the first card, not in the left column', () => {
  const s = src('assets/js/view-base.js');
  assert.ok(s.indexOf('id="vb-scn"') > 0 && s.indexOf('id="vb-scn"') < s.indexOf('id="vb-state"'));
  assert.equal(/side\.innerHTML = `[^`]*vb-scn/.test(s), false);
  assert.match(src('assets/css/explorer.css'), /\.scn-wrap \.scn \{[^}]*grid-template-columns: repeat\(3/);
});

test('Explorer daily card: one plot for PML, congestion and losses with three colours; no value-factor average anywhere', () => {
  const s = src('assets/js/daily-card.js');
  assert.match(s, /PARTS = \[\['pml', 'PML', 'var\(--s2\)'\], \['congestion', 'Congestion', 'var\(--s1\)'\], \['losses', 'Losses', 'var\(--s3\)'\]\]/);
  assert.equal(/Daily value factor|dl-month|dl-chips|clampVf|vfAxis/.test(s), false);
  assert.equal(/\bvf\b/.test(src('assets/js/copy.js').split('daily: {')[1].split('lazy:')[0]), false); // no 7-day VF copy left
});

test('Revenue daily card: revenue, captured price, then solar hours and solar output as separate bar charts; no metric toggle', () => {
  const s = src('assets/js/daily-card.js');
  assert.equal(/dl-metric|METRICS|Daily metric/.test(s), false);
  assert.ok(/kind: 'bar'/.test(s) && /barChart\(/.test(s));
  const o = ['g-rev', 'g-cap', 'g-hours', 'g-out'].map((id) => s.indexOf(`id="${id}"`) > 0 || s.indexOf(`'${id}'`) > 0);
  assert.ok(o.every(Boolean));
  assert.ok(s.indexOf("one('g-rev'") < s.indexOf("one('g-cap'") && s.indexOf("one('g-cap'") < s.indexOf("one('g-hours'"));
});

test('barChart: month ticks and date hover title for daily bars', () => {
  const bars = Array.from({ length: 60 }, (_, i) => ({ v: i % 7, label: `2025-0${1 + (i >= 31 ? 1 : 0)}-${String((i % 31) + 1).padStart(2, '0')}`, color: 'red' }));
  const svg = barChart({ bars, ticks: [{ i: 0, text: 'Jan 25' }, { i: 31, text: 'Feb 25' }], minBw: 0.6, aria: 'x', hoverTitle: (l) => `d ${l}` });
  assert.equal((svg.match(/class="tick">(Jan|Feb) 25</g) || []).length, 2);
  assert.equal((svg.match(/<rect /g) || []).length, 60);
  assert.equal(/<title>/.test(svg.replace(/<title>[^<]*(Value factor|value)[^<]*<\/title>/g, '')), false); // no per-bar titles on dense daily bars
});

test('route #/appendix: bare route, no selection, never touches the store', () => {
  assert.ok(ROUTES.includes('/appendix'));
  const r = resolveHash('#/appendix', null, [{ kind: 'node', id: 'X' }], true, { span: null, sc: null, cfg: 'fijo', wx: 'mean' });
  assert.equal(r.path, '/appendix'); assert.equal(r.hash, '#/appendix'); assert.deepEqual(r.list, []); assert.equal(r.hadSel, false);
  assert.equal(hrefFor('/appendix', [{ kind: 'node', id: 'X' }], true), '#/appendix');
  const m = src('main.js');
  assert.match(m, /'\/appendix': async/); assert.match(m, /'\/appendix': 'hidden'/);
});

test('"Open appendix" is a same-origin link opening a new tab, only on Revenue', () => {
  const s = src('assets/js/analysis.js');
  assert.match(s, /href="#\/appendix" target="_blank" rel="noopener"/);
  assert.match(s, /view === 'revenue' \? '<a [^']*Open appendix/);
});

test('appendix: A1 to A4 present, A5 and the shortcut are not; interactive A4 controls exist', () => {
  const h = appendixHTML();
  for (const id of ['a1', 'a2', 'a3', 'a4']) assert.ok(h.includes(`id="${id}"`), id);
  assert.equal(h.includes('id="a5"'), false);
  assert.equal(/shortcut/i.test(h), false);
  for (const id of ['g9', 't9', 'v9', 'y9', 'l9', 'e9', 'r9', 'c9', 'a2-svg', 'a1-map', 'cA3a', 'cA3b']) assert.ok(h.includes(`id="${id}"`), id);
});

test('no "shortcut" in any v2 UI string or module', () => {
  const dir = join(HERE, '..', 'v2', 'assets', 'js');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) assert.equal(/shortcut/i.test(fs.readFileSync(join(dir, f), 'utf8')), false, f);
});

test('verdict pill: neutral styling (class pill only), wording says under your assumptions, none for incomplete sets', () => {
  const set = { ...DECK_SET, band_pct: 10 };
  assert.match(verdictPillHTML({ level: 'deck' }, set, 714, 900), /No verdict: deck scenario/);
  assert.match(verdictPillHTML({ level: 'empty' }, set, null, 900), /No verdict: assumption set incomplete/);
  assert.match(verdictPillHTML({ level: 'complete' }, set, 700, 900), /Covers its cost, under your assumptions/);
  assert.match(verdictPillHTML({ level: 'complete' }, set, 950, 900), /Within 10 % of its cost, under your assumptions/);
  assert.match(verdictPillHTML({ level: 'complete' }, set, 1200, 900), /Below its cost, under your assumptions/);
  assert.equal(/ok|warn|bad|green|red|yellow/.test(verdictPillHTML({ level: 'complete' }, set, 950, 900).replace(/<svg.*<\/svg>/, '').replace(/ its cost/g, '')), false);
});

test('assumptions: v1 storage key and shape, mounting follows the page switch (tracker | fijo)', async () => {
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const A = await import('../v2/assets/js/assump.js');
  assert.equal(KEY, 'nsv4:assumptions');
  assert.equal(A.state().active, 'deck');
  A.setMounting('fijo'); assert.equal(A.state().mine.mounting, 'fixed');
  A.setMounting('tracker'); assert.equal(A.state().mine.mounting, 'tracker');
  A.setActive('mine'); A.setField('target_lcoe_usd', '40'); A.setField('fx', '17.84');
  assert.equal(A.statusOf(true).level, 'partial');
  assert.equal(JSON.parse(store[KEY]).mine.target_lcoe_usd, 40);
  A.clearMine(); assert.equal(A.statusOf(true).level, 'empty');
  assert.deepEqual({ ...A.state().mine, mounting: 'tracker' }, { ...blankMine(), mounting: 'tracker' });
  A.setActive('deck');
  assert.match(A.assumpBarHTML(true), /target LCOE 40 USD\/MWh/);
});

test('economics inputs and coverage equal the published figures (same as v1)', { skip }, async () => {
  const F = await import('../v2/assets/js/fin-data.js');
  const nodos = JSON.parse(fs.readFileSync(join(W, 'analysis', 'analysis_nodos.json'), 'utf8')), analysis = JSON.parse(fs.readFileSync(join(W, 'analysis', 'analysis.json'), 'utf8'));
  const s = { nodos, analysis };
  const i = nodos.ids.indexOf('08NCM-115'), w = nodos.ventanas.deck_2025_26;
  const p = F.placeInputs(s, 'node', '08NCM-115', 'Y2', true);
  assert.equal(p.pcap, w.p_cap_real[i]); assert.equal(p.pml, w.pml_medio_real[i]); assert.equal(p.yf, w.y_f[i]);
  const a = F.areaStat(analysis, 'Y2', 'region', 'ORIENTAL'), q = F.placeInputs(s, 'region', 'ORIENTAL', 'Y2', false);
  assert.equal(q.pcap, a.p_cap); assert.equal(q.yf, a.y_f_mwh_por_mwp); assert.equal(q.n, a.n_nodos);
  for (const [y, k] of [['Y1', 'deck_2024_25'], ['Y2', 'deck_2025_26']]) for (const real of [false, true]) {
    const r = F.finEval(nodos, DECK_SET, y, real), n = analysis.ventanas[k].por_config.tracker.nacional;
    assert.equal(r.mode, 'target'); assert.equal(r.threshold, 714);
    assert.ok(Math.abs(r.national.pct - (real ? n.pct_nodos_cubren_lcoe_real : n.pct_nodos_cubren_lcoe_nominal)) < 1e-3);
  }
});

test('Revenue cards: no Shortcut bar, only real revenue and levelized cost; KPI names as v1', () => {
  const s = src('assets/js/pnl-card.js');
  assert.match(s, /label: 'Real revenue'/); assert.match(s, /label: 'Levelized cost'/);
  for (const t of ['Captured · MXN/MWh', 'Energy · GWh/yr', 'Revenue · M MXN/yr', 'Margin · M MXN/yr']) assert.ok(s.includes(t), t);
  for (const t of ['Average price (PML), MXN/MWh', 'Value factor VF', 'Losses not in the model, %', 'Plant size, MWp', 'LCOE, USD/MWh', 'LCOE, MXN/MWh']) assert.ok(s.includes(t), t);
  const c = src('assets/js/coverage-card.js');
  for (const t of ['Break-even · USD/MWh', 'VF vs VF required', 'Margin · MXN/MWh', 'LCOE · MXN/MWh']) assert.ok(c.includes(t), t);
  assert.equal(/IRR|NPV/.test(s + c), false); // assumptions are pending: no IRR / NPV on screen
});

test('maps card (M13: one map): four metrics, regions | states, hover, lazy', () => {
  const s = src('assets/js/maps-card.js');
  for (const t of ['Value factor', 'Captured price', '% of nodes covering the LCOE', 'Price spread, peak − solar', "'region', 'Regions'", "'state', 'States'", 'IntersectionObserver', 'onHover']) assert.ok(s.includes(t), t);
});

test('precache carries the appendix modules, its stylesheet and the vendored KaTeX files', () => {
  const p = src('precache.js');
  for (const t of ['assets/js/appendix.js', 'assets/js/appendix-live.js', 'assets/css/appendix.css', '../assets/vendor/katex/katex.min.js', '../assets/vendor/katex/katex.min.css']) assert.ok(p.includes(t), t);
});
