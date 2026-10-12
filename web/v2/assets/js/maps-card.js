// Explorer maps (ported from v1 Map and Geography blocks): the regional map with names, value factor and node dots, and the four
// area maps shown one at a time. Canvas maps, drawn when the card scrolls into view. Published area figures only.
import { WIN, REGIONS, regName, stName } from '../../../assets/js/names.js';
import { metricOf } from '../../../assets/js/sec-map-pure.js';
import { px } from '../../../assets/js/data-pure.js';
import { num } from '../../../assets/js/format.js';
import { segment } from './controls.js';
import { loadFin, loadGeoRaw, areaStat, finEval } from './fin-data.js';
import { createCanvasMap, tipFor, selectionOf, nodeXY, rampColor, labelSize } from './geo-canvas.js';
import { activeSet, subscribe, TAG, statusOf } from './assump.js';
import { esc } from './compare-ui.js';

const f0 = (v) => num(v, 0), f2 = (v) => num(v, 2);
const METRICS = {
  vf: { label: 'Value factor', lo: 0.55, hi: 0.95, f: f2 },
  cap: { label: 'Captured price', lo: 0, hi: 1600, f: f0 },
  cover: { label: '% of nodes covering the LCOE', lo: 0, hi: 100, f: (v) => `${f0(v)} %` },
  spread: { label: 'Price spread, peak − solar', lo: 100, hi: 1500, f: f0 },
};
const ORDER = ['vf', 'cap', 'cover', 'spread'];

export function mapsCardHTML() {
  return `<section class="xp-card maps" id="mp-card" aria-labelledby="mp-h"><div class="xp-vhead"><h2 class="mono" id="mp-h">Maps: value factor by control region and state</h2>
    <div class="seg" role="radiogroup" aria-label="Map level" id="mp-level" style="grid-template-columns:repeat(2,1fr)"></div></div>
    <p class="xp-text" id="mp-note">Maps load when this section comes into view.</p>
    <div class="map-wrap" id="mp-w1"><div id="mp-main" role="img" aria-label="Map of Mexico by control region with value factor and node markers"></div></div>
    <div class="ramp mono" id="mp-l1"></div>
    <h3 class="mono sub" id="mp-sub">One metric at a time</h3>
    <div class="seg seg4 map-tabs" role="radiogroup" aria-label="Map metric" id="mp-metric"></div>
    <p class="xp-text" id="mp-mnote"></p>
    <div class="map-wrap" id="mp-w2"><div id="mp-one" role="img" aria-label="Map of Mexico by area for the selected metric"></div></div>
    <div class="ramp mono" id="mp-l2"></div>
    <details class="mp-table"><summary class="mono">Values as a table</summary><div class="tbl tall" id="mp-tbl"></div></details></section>`;
}

export function mountMaps(root, { shell, winId }) {
  const card = root.querySelector('#mp-card');
  if (!card) return;
  const ui = (shell.mapsUi = shell.mapsUi || { level: 'region', metric: 'vf' });
  let maps = [], off = null, ver = 0;
  const q = (s) => card.querySelector(s);
  const destroy = () => { maps.forEach((m) => { try { m.destroy(); } catch { /* detached */ } }); maps = []; };
  const run = async () => {
    const my = ++ver;
    const [src, raw] = await Promise.all([loadFin(), loadGeoRaw()]);
    if (!card.isConnected || my !== ver) return;
    destroy();
    q('#mp-main').innerHTML = ''; q('#mp-one').innerHTML = '';
    const real = shell.store.real, w = WIN[winId], slot = shell.store.get()[0], nodos = src.nodos, wk = w.key;
    const xy = nodeXY(nodos, shell.byId), sel = selectionOf(slot, shell, nodos), lv = ui.level;
    q('#mp-note').textContent = `${w.label}, ${real ? "today's pesos" : 'nominal MXN'}, single-axis tracker. Areas are node averages; the value factor of an area is the ratio of its averages. Hover a region, state or node.`;
    segment(q('#mp-level'), [['region', 'Regions'], ['state', 'States']], lv, (k) => { ui.level = k; run(); });
    segment(q('#mp-metric'), ORDER.map((k) => [k, k === 'cap' ? `Captured price, ${real ? "today's pesos" : 'nominal'}` : METRICS[k].label]), ui.metric, (k) => { ui.metric = k; run().then(() => { const b = q('#mp-metric [aria-checked="true"]'); if (b) b.focus(); }); });
    const res = finEval(nodos, activeSet(), winId, real);
    const val = (k, level, key) => {
      const s = areaStat(src.analysis, winId, level, key);
      if (!s) return null;
      if (k === 'vf') return metricOf(s, 'vf', real);
      if (k === 'cap') return px(s, 'p_cap', real);
      if (k === 'spread') return s.spread_punta_solar;
      if (res && res.mode && res[level] && res[level][key]) return res[level][key].pct;
      return real ? s.pct_nodos_cubren_lcoe_real : s.pct_nodos_cubren_lcoe_nominal;
    };
    const key = (h) => (lv === 'region' ? h.region : h.key), name = (h) => (lv === 'region' ? regName(h.region) : stName(h.key));
    // 1. regional map with names, value factor and node dots
    const m1 = METRICS.vf, wrap1 = q('#mp-w1'), tip1 = tipFor(wrap1), width = q('#mp-main').clientWidth || 900;
    const a = createCanvasMap(q('#mp-main'), raw, { fontSize: labelSize(width), onHover: (h, cx, cy) => {
      if (!h) return tip1(null);
      if (h.kind === 'node') { const id = nodos.ids[h.i], n = shell.byId.get(id), d = dotVal(h.i); return tip1(`<b>${esc(id)}</b><span class="hv-row"><em>${esc(n ? n.name : '')}</em></span><span class="hv-row"><em>Value factor</em><strong>${d == null ? 'no data' : f2(d)}</strong></span>`, cx, cy); }
      const v = h.region === 'BAJA' && lv === 'region' ? null : val('vf', lv, key(h));
      return tip1(`<b>${esc(name(h))}${lv === 'state' ? ` · ${esc(regName(h.region))} region` : ''}</b><span class="hv-row"><em>Value factor</em><strong>${v == null ? 'no data' : f2(v)}</strong></span>${lv === 'region' ? `<span class="hv-row"><em>State</em><strong>${esc(h.name)}</strong></span>` : ''}`, cx, cy);
    } });
    const wn = nodos.ventanas[wk];
    const dotVal = (i) => { if (!wn || wn.p_cap[i] === null || wn.p_cap[i] === undefined) return null; const pc = real ? wn.p_cap_real[i] : wn.p_cap[i], pm = real ? wn.pml_medio_real[i] : wn.pml_medio[i]; return pm ? pc / pm : null; };
    a.setNodes(xy);
    a.setFill({ level: lv, color: (k) => { const v = val('vf', lv, k); return v == null ? null : rampColor(v, m1.lo, m1.hi); }, label: (k) => { const v = val('vf', lv, k); return v == null ? '' : f2(v); }, name: (k) => regName(k) });
    a.setDots({ color: (i) => { const v = dotVal(i); return v == null ? null : rampColor(v, m1.lo, m1.hi); }, radius: 3.4 });
    a.setSelected({ region: lv === 'region' ? sel.region : null, state: lv === 'state' ? sel.state : null, node: sel.node, nodeLabel: sel.nodeLabel });
    q('#mp-l1').innerHTML = `<span>${f2(m1.lo)}</span><i></i><span>${f2(m1.hi)}</span><span class="muted">Value factor · node dots use the same scale</span>`;
    // 2. one metric at a time
    const mk = METRICS[ui.metric], tip2 = tipFor(q('#mp-w2'));
    const b = createCanvasMap(q('#mp-one'), raw, { labels: false, onHover: (h, cx, cy) => {
      if (!h) return tip2(null);
      const v = h.region === 'BAJA' && lv === 'region' ? null : val(ui.metric, lv, key(h));
      return tip2(`<b>${esc(name(h))}${lv === 'state' ? ` · ${esc(regName(h.region))} region` : ''}</b><span class="hv-row"><em>${esc(mk.label)}</em><strong>${v == null ? 'no data' : mk.f(v)}</strong></span>`, cx, cy);
    } });
    b.setFill({ level: lv, color: (k) => { const v = val(ui.metric, lv, k); return v == null ? null : rampColor(v, mk.lo, mk.hi); }, label: () => '', name: (k) => regName(k) });
    b.setSelected({ region: lv === 'region' ? sel.region : null, state: lv === 'state' ? sel.state : null });
    q('#mp-l2').innerHTML = `<span>${mk.f(mk.lo)}</span><i></i><span>${mk.f(mk.hi)}</span><span class="muted">${esc(mk.label)}${ui.metric === 'cap' ? ` · MXN/MWh` : ui.metric === 'spread' ? ' · MXN/MWh' : ''}</span>`;
    const st = statusOf(real), thr = res && res.mode ? (res.mode === 'own' ? 'each node’s own LCOE' : `${f0(res.threshold)} MXN/MWh`) : 'the deck-scenario LCOE (714 MXN/MWh)';
    q('#mp-mnote').textContent = ui.metric === 'cover' ? `Share of the area's nodes whose captured price covers ${thr} (${TAG[st.level]}). Change it in the Assumptions of the Revenue page.` : '';
    // the same figures as a table: the canvas maps are hover-only, this is the keyboard and screen-reader path
    const keys = lv === 'region' ? REGIONS.slice() : Object.keys(src.analysis.ventanas[wk].por_config.tracker.estados).sort((x, y) => stName(x).localeCompare(stName(y)));
    const cell = (k, key) => { const v = val(k, lv, key); return v == null ? '—' : METRICS[k].f(v); };
    q('#mp-tbl').innerHTML = `<table><thead><tr><th>${lv === 'region' ? 'Region' : 'State'}</th>${ORDER.map((k) => `<th class="n">${esc(METRICS[k].label)}</th>`).join('')}</tr></thead><tbody>${keys.map((key) => `<tr><td>${esc(lv === 'region' ? regName(key) : stName(key))}</td>${ORDER.map((k) => `<td class="n">${cell(k, key)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    maps = [a, b];
  };
  const go = () => run().catch((e) => { if (card.isConnected) { console.error(e); q('#mp-note').textContent = 'The maps could not be loaded.'; } });
  off = subscribe(() => { if (!card.isConnected) { off(); destroy(); return; } if (card.dataset.ready) go(); });
  const start = () => { card.dataset.ready = '1'; go(); };
  if (typeof IntersectionObserver === 'undefined') start();
  else { const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); start(); } }); io.observe(card); }
}
void REGIONS;
