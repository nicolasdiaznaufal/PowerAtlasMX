// M10: mounting configuration x weather variant. Tile values equal the solar_v2 JSON; lazy loading; URL state; irradiance helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { recordFor, tilesOf, annualEquivNote, partialNote } from '../v2/assets/js/explorer-data.js';
import { variantRecord, recordForCtx, isDefaultCtx, loadSourcesCtx, solarUrls } from '../v2/assets/js/solar-data.js';
import { scenarioRecord } from '../v2/assets/js/scenario.js';
import { createStore } from '../v2/assets/js/store.js';
import { createRouter, hrefFor } from '../v2/assets/js/route-logic.js';
import { parseCfg, parseWx } from '../v2/assets/js/query-extras.js';
import { groupChart, lineChart } from '../v2/assets/js/svg-charts.js';
import { monthly, cloudLoss, nodeSolar } from '../v2/assets/js/irradiance.js';

const W = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = join(W, 'data', 'solar_v2');
const skip = !existsSync(join(S, 'variant_scalars_fijo.json')) && 'web/data/solar_v2 not present (git-ignored; build with web/tools/build_solar_web.py)';
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const base = () => ({ nodos: J(join(W, 'data/analysis/analysis_nodos.json')), analysis: J(join(W, 'data/analysis/analysis.json')), profiles: J(join(W, 'data/derived/node_profiles.json')) });
const solar = (cfg, wx) => ({ vs: J(join(S, `variant_scalars_${cfg}.json`)), vx: J(join(S, `variant_extra/${cfg}/${wx}.json`)), vfile: J(join(S, `variants/${wx}.json`)) });
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

test('query parsing: mounting and weather', () => {
  assert.equal(parseCfg('fijo'), 'fijo'); assert.equal(parseCfg('x'), 'tracker'); assert.equal(parseCfg(null), 'tracker');
  for (const v of ['mean', 'win', 'y2015', 'y2025']) assert.equal(parseWx(v), v);
  for (const v of ['y2014', 'y2026', 'clear', '', null]) assert.equal(parseWx(v), 'mean');
  assert.equal(isDefaultCtx({ cfg: 'tracker', wx: 'mean' }), true);
  assert.equal(isDefaultCtx({ cfg: 'fijo', wx: 'mean' }), false);
  assert.equal(hrefFor('/explorer', [{ kind: 'national', id: 'ALL' }], false, { cfg: 'fijo', wx: 'y2019' }), '#/explorer?sel=national&cfg=fijo&wx=y2019');
  assert.equal(hrefFor('/explorer', [{ kind: 'national', id: 'ALL' }], false, { cfg: 'tracker', wx: 'mean' }), '#/explorer?sel=national');
});

test('cfg and wx survive the URL, Back and Forward; explicit entries without them mean tracker / yearly mean', () => {
  const valid = { node: () => true, state: () => true, region: () => true };
  const store = createStore(), hist = []; let i = -1;
  const router = createRouter({ store, valid: () => valid, replace: (h) => { hist[i] = h; }, currentHash: () => hist[i] });
  const push = (h) => { hist.length = i + 1; hist.push(h); i++; router.resolve(h); };
  push('#/explorer?sel=A-1&cfg=fijo&wx=y2020');
  assert.equal(store.cfg, 'fijo'); assert.equal(store.wx, 'y2020');
  store.setCfg('tracker');
  assert.equal(hist[i], '#/explorer?sel=A-1&wx=y2020');
  store.setWx('win');
  assert.equal(hist[i], '#/explorer?sel=A-1&wx=win');
  push('#/revenue?sel=A-1');
  assert.equal(store.cfg, 'tracker'); assert.equal(store.wx, 'mean');
  push('#/revenue?sel=A-1&cfg=fijo');
  i -= 2; router.resolve(hist[i]);
  assert.equal(store.wx, 'win');
  i += 2; router.resolve(hist[i]);
  assert.equal(store.cfg, 'fijo');
  push('#/map');                                   // bare hash inherits
  assert.equal(hist[i], '#/map?sel=A-1&cfg=fijo');
});

const SLOTS = (b) => {
  const ids = b.nodos.ids;
  return [...[0, 321, 777, 1500, 2100, 2430].map((k) => ({ kind: 'node', id: ids[k] })), { kind: 'national', id: 'ALL' }, { kind: 'region', id: 'CENTRAL' }, { kind: 'state', id: 'JALISCO' }];
};

test('node figures equal the solar_v2 JSON for 6 nodes x {tracker, fijo} x {mean, y2015, y2020, win} x {Y1, Y2}', { skip }, () => {
  const b = base(); let n = 0;
  for (const cfg of ['tracker', 'fijo']) for (const wx of ['mean', 'y2015', 'y2020', 'win']) {
    const sl = solar(cfg, wx), src = { ...b, ...sl };
    assert.deepEqual(sl.vs.ids, b.nodos.ids, 'same node order as analysis_nodos');
    for (const slot of SLOTS(b).filter((s) => s.kind === 'node')) for (const win of ['Y1', 'Y2']) {
      const i = sl.vs.ids.indexOf(slot.id), d = sl.vs.data[wx][win], x = sl.vx.data[win], sh = sl.vs.shared[win];
      const rec = variantRecord(src, slot, win, { cfg, wx });
      if (d.p_cap[i] === null) { assert.equal(rec.missing, true); continue; }
      assert.equal(rec.cap, d.p_cap[i]); assert.equal(rec.vf, d.vf[i]); assert.equal(rec.yf, d.y_f[i]); assert.equal(rec.ingreso, d.ingreso[i]);
      assert.equal(rec.z, x.pct_e0[i]); assert.equal(rec.atajo, x.ingreso_atajo[i]); assert.equal(rec.vfDay, x.vf_dia_promedio[i]);
      assert.equal(rec.capReal, x.p_cap_real[i]); assert.equal(rec.ingresoReal, x.ingreso_real[i]);
      assert.equal(rec.base, sh.pml_medio[i]); assert.equal(rec.spread, sh.spread_punta_solar[i]); assert.equal(rec.nHoras, sh.n_horas[i]);
      assert.equal(rec.hours.y, sl.vfile.nodes[slot.id][cfg].y[win]);
      assert.equal(tilesOf(rec, false).find((t) => t.id === 'vf').value, d.vf[i]);
      n++;
    }
  }
  assert.ok(n >= 80, `${n} node checks`);
});

test('default (tracker, yearly mean) goes through the published path and equals the variant path for nodes; areas match to rounding', { skip }, () => {
  const b = base(), sl = solar('tracker', 'mean'), src = { ...b, ...sl };
  for (const slot of SLOTS(b)) for (const win of ['Y1', 'Y2']) {
    const pub = recordFor(b, slot, win), alt = variantRecord(src, slot, win, { cfg: 'tracker', wx: 'mean' });
    assert.equal(recordForCtx(b, slot, win, { cfg: 'tracker', wx: 'mean' }).cap, pub.cap);
    if (pub.missing) continue;
    const tol = slot.kind === 'node' ? 0 : 5e-5;       // areas are re-derived from node values published with 4 decimals
    for (const k of ['base', 'cap', 'vf', 'vfDay', 'z', 'yf', 'ingreso', 'baseReal', 'capReal', 'ingresoReal', 'atajo', 'spread']) assert.ok(near(alt[k], pub[k], tol), `${slot.id} ${win} ${k}: ${alt[k]} vs ${pub[k]}`);
    assert.equal(alt.n, pub.n);
    assert.ok(alt.hours.y.every((v, h) => Math.abs(v - pub.hours.y[h]) < 3e-5));
  }
});

test('fixed tilt yields less than the tracker for every sample slot, variant and window; same prices and hour counts', { skip }, () => {
  const b = base();
  for (const wx of ['mean', 'y2015', 'y2020', 'win']) {
    const t = { ...b, ...solar('tracker', wx) }, f = { ...b, ...solar('fijo', wx) };
    for (const slot of SLOTS(b)) for (const win of ['Y1', 'Y2']) {
      const a = variantRecord(t, slot, win, { cfg: 'tracker', wx }), c = variantRecord(f, slot, win, { cfg: 'fijo', wx });
      if (a.missing || c.missing) continue;
      assert.ok(c.yf < a.yf, `${slot.id} ${wx} ${win}: ${c.yf} vs ${a.yf}`);
      assert.equal(c.base, a.base); assert.equal(c.nHoras, a.nHoras);
      assert.ok(Math.abs(c.vf - a.vf) < 0.15);
    }
  }
});

test('scenario neutral equals the published record for every config and variant', { skip }, () => {
  const b = base();
  for (const cfg of ['tracker', 'fijo']) for (const wx of ['mean', 'y2019', 'win']) {
    const src = { ...b, ...solar(cfg, wx) };
    for (const slot of SLOTS(b).slice(0, 3).concat([{ kind: 'national', id: 'ALL' }])) {
      const rec = variantRecord(src, slot, 'Y2', { cfg, wx });
      if (rec.missing) continue;
      assert.equal(scenarioRecord(rec, { price: 0, dip: 100, yield: 0 }).rec, rec);
      const up = scenarioRecord(rec, { price: 0, dip: 100, yield: 10 }).rec;
      assert.ok(near(up.ingreso, rec.ingreso * 1.1, 1e-12));
    }
  }
});

test('partial-year nodes keep the same hour counts and notes under fixed tilt; annual equivalent is information only', { skip }, () => {
  const b = base(), t = { ...b, ...solar('tracker', 'mean') }, f = { ...b, ...solar('fijo', 'mean') };
  const slot = { kind: 'node', id: '03MMN-230' };
  const a = variantRecord(t, slot, 'Y1', { cfg: 'tracker', wx: 'mean' }), c = variantRecord(f, slot, 'Y1', { cfg: 'fijo', wx: 'mean' });
  assert.ok(a.nHoras < 8760 && a.nHoras === c.nHoras);
  assert.equal(partialNote(a), partialNote(c));
  assert.ok(c.yfEq > c.yf, 'the annual equivalent is larger than the priced-hours yield');
  assert.match(annualEquivNote(c), /For information: annual equivalent/);
  assert.equal(annualEquivNote({ nHoras: 8760, yfEq: 2000 }), null);
  assert.equal(c.yf, solar('fijo', 'mean').vs.data.mean.Y1.y_f[b.nodos.ids.indexOf('03MMN-230')]);   // published figure, not annualised
});

test('lazy loading: no solar_v2 request until fixed tilt or another weather is selected', { skip }, async () => {
  const urls = [];
  globalThis.fetch = async (u) => {
    urls.push(String(u));
    const p = String(u).replace(/^\.\.\//, 'web/').replace(/^web\//, '');
    return { ok: true, status: 200, json: async () => J(join(W, p.startsWith('data') ? p : p)) };
  };
  const { loadSources } = await import('../v2/assets/js/explorer-data.js');
  void loadSources;
  const slot = { kind: 'node', id: '01AAN-85' };
  await loadSourcesCtx(slot, { cfg: 'tracker', wx: 'mean' });
  assert.equal(urls.filter((u) => u.includes('solar_v2')).length, 0);
  await loadSourcesCtx(slot, { cfg: 'fijo', wx: 'mean' });
  const got = urls.filter((u) => u.includes('solar_v2'));
  assert.deepEqual(got.sort(), Object.values(solarUrls({ cfg: 'fijo', wx: 'mean' })).filter((u) => !u.includes('clear')).sort());
  delete globalThis.fetch;
});

test('irradiance helpers: monthly labels, cloud loss, nodeSolar', { skip }, () => {
  const mean = solar('tracker', 'mean').vfile, win = solar('tracker', 'win').vfile, clear = J(join(S, 'variants/clear.json'));
  const id = '01AAN-85';
  const s = nodeSolar({ id, cfg: 'tracker', wx: 'mean', winId: 'Y2', vfile: mean, clear });
  assert.equal(s.mGhi.labels.length, 12); assert.equal(s.mGhi.labels[0], 'Jan');
  assert.ok(s.annual.poa > s.annual.ghi, 'a tracker collects more than the horizontal');
  assert.ok(s.loss.poa > 0 && s.loss.poa < 60 && s.loss.prod > 0);
  const f = nodeSolar({ id, cfg: 'fijo', wx: 'mean', winId: 'Y2', vfile: mean, clear: null });
  assert.ok(f.annual.poa < s.annual.poa, 'fixed tilt collects less than the tracker');
  assert.equal(f.loss, null);
  const w = nodeSolar({ id, cfg: 'tracker', wx: 'win', winId: 'Y2', vfile: win, clear: null });
  assert.equal(w.mGhi.labels[0], 'Aug'); assert.equal(w.mGhi.vals.length, 12);
  assert.equal(cloudLoss([1, 1], [2, 2]), 50);
  assert.equal(cloudLoss(null, [1]), null);
});

test('new charts emit x labels and an x axis title', () => {
  const g = groupChart({ labels: ['Jan', 'Feb', 'Mar'], series: [{ vals: [1, 2, 3], color: 'x' }, { vals: [2, 3, 4], ghost: true }], aria: 'a', xtitle: 'Month' });
  assert.ok((g.match(/class="tick"/g) || []).length >= 3 + 2 && /xtitle/.test(g) && /ghost-bar/.test(g));
  const l = lineChart({ series: [{ vals: [1, 2, 3], label: 'a' }, { vals: [2, 3, 4], label: 'b', style: { color: 'var(--s1)', dash: '2 4', marker: 'triangle' } }], labels: ['a', 'b', 'c'], aria: 'a', xtitle: 'Hour' });
  assert.match(l, /stroke-dasharray="2 4"/); assert.match(l, /xtitle/);
});

test('controls: mounting radiogroup, labelled weather select, announcements', () => {
  const src = readFileSync(join(W, 'v2/assets/js/controls.js'), 'utf8');
  assert.match(src, /role="radiogroup" aria-label="Mounting"/);
  assert.match(src, /<label class="wx" for="ct-wx">/);
  assert.match(src, /<select id="ct-wx">/);
  assert.match(src, /role="status" aria-live="polite"/);
});

test('service worker keeps the data cache bounded: core files are pinned, only variant files are evicted (oldest first)', async () => {
  const { trimCache, evictableUrl } = createRequire(import.meta.url)('../v2/sw-strategy.js');
  const urls = ['http://h/data/index.json', 'http://h/data/analysis/analysis_nodos.json', 'http://h/data/solar_v2/variant_scalars_fijo.json',
    ...Array.from({ length: 8 }, (_, i) => `http://h/data/solar_v2/variants/y20${15 + i}.json`), 'http://h/data/solar_v2/variant_extra/fijo/mean.json', 'http://h/data/derived/series_nodes.json'];
  const store = new Map(urls.map((u, i) => [u, i]));
  const cachesApi = { open: async () => ({ keys: async () => [...store.keys()].map((url) => ({ url })), delete: async (k) => store.delete(k.url) }) };
  const gone = await trimCache(cachesApi, 'v2-data', 5, evictableUrl);
  assert.equal(gone, 4);                                              // 9 evictable -> 5 kept
  for (const u of ['http://h/data/index.json', 'http://h/data/analysis/analysis_nodos.json', 'http://h/data/solar_v2/variant_scalars_fijo.json', 'http://h/data/derived/series_nodes.json']) assert.ok(store.has(u), `${u} is pinned`);
  assert.equal(store.has('http://h/data/solar_v2/variants/y2015.json'), false);   // oldest evicted
  assert.equal(store.has('http://h/data/solar_v2/variants/y2022.json'), true);
  assert.equal(store.has('http://h/data/solar_v2/variant_extra/fijo/mean.json'), true);   // newest evictable kept
  assert.equal(evictableUrl('/data/index.json'), false);
});

test('one navigation that changes mounting and weather notifies once (no in-between context is loaded)', () => {
  const valid = { node: () => true, state: () => true, region: () => true };
  const store = createStore(), ctxs = []; let cur = '#/explorer?sel=A-1';
  const router = createRouter({ store, valid: () => valid, replace: (h) => { cur = h; }, currentHash: () => cur });
  router.resolve(cur);
  store.subscribe(() => ctxs.push(`${store.cfg}|${store.wx}`));
  cur = '#/explorer?sel=A-1&cfg=fijo&wx=win'; router.resolve(cur);
  assert.deepEqual(ctxs, ['fijo|win']);
});

test('series card: under fixed tilt / another weather the window VF is not drawn over the tracker bars and the note is shown', async () => {
  const mk = () => { const el = { innerHTML: '', textContent: '', hidden: false, clientWidth: 640, style: {}, setAttribute() {}, addEventListener() {}, append() {}, focus() {}, querySelector: () => el, closest: () => el }; return el; };
  const els = {};
  const root = { querySelector: (s) => (els[s] || (els[s] = mk())) };
  globalThis.document = { createElement: () => mk(), getElementById: () => null };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const { paintSeries } = await import('../v2/assets/js/series-card.js');
  const months = Array.from({ length: 81 }, (_, i) => `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  const series = { months, vf: months.map(() => 0.8), years: [2020], y: { 2020: [600, 500, 620, 520] } };
  const rec = { base: 600, cap: 500, vf: 0.83, baseReal: 620, capReal: 520, hours: null };
  const entries = [{ slot: { kind: 'node', id: 'X' }, rec, series }];
  const run = (cfg, wx) => {
    Object.keys(els).forEach((k) => delete els[k]);
    const shell = { store: { real: false, span: null, scenario: null, cfg, wx }, label: () => ({ t: 'X', k: 'Node' }) };
    paintSeries(root, { entries, shell, winId: 'Y2', view: 'months', onView() {} });
    return { svg: els['#sr-vf'].innerHTML, leg: els['#sr-leg'].innerHTML, note: els['#sr-note'].textContent };
  };
  const d = run('tracker', 'mean'), f = run('fijo', 'y2020');
  assert.match(d.svg, /class="hline"/);
  assert.doesNotMatch(d.note, /single-axis tracker with yearly-mean weather/);
  assert.doesNotMatch(f.svg, /class="hline"/);
  assert.match(f.leg, /VF of the window, fixed tilt, 2020 weather: 0\.83/);
  assert.match(f.note, /single-axis tracker with yearly-mean weather/);
  delete globalThis.document; delete globalThis.window;
});
