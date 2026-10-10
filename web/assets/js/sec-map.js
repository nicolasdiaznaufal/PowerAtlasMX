// Map section (canvas, deck geometry + node markers) and the Geography block (spatial checks + choropleths).
import { D, loadGeo, loadGeography, loadNodos, areaStat, nodeWin } from './data.js';
import { GeoMap, mix, clamp01, ll2xy, lum } from './geomap.js';
import { $, esc, seg, segHTML, sig } from './util.js';
import { num, signed } from './format.js';
import { Picker, areaName, nodeLab } from './common.js';
import { WIN, REGIONS, RN, regName, stName, stAbbr } from './names.js';
import { px } from './data.js';

const f0 = (v) => num(v, 0), f2 = (v) => num(v, 2), f1 = (v) => num(v, 1);
const LO = '#33443A', HI = '#EDE6D0';
import { METRICS, metricOf, rampColor } from './sec-map-pure.js';
export { METRICS, metricOf, rampColor };

export async function initMap(ctx) {
  const root = $('#map-root');
  root.innerHTML = `
    <div class="map-layout">
      <div class="map-side stack">
        <div class="row">${segHTML('mp-y', 'Window', [['Y1', '2024–25'], ['Y2', '2025–26'], ['D', 'Δ 2025–26 vs 2024–25']], 'Y2')}</div>
        <div class="row">${segHTML('mp-l', 'Map level', [['region', 'Regions'], ['state', 'States']], 'region')}${segHTML('mp-n', 'Nodes', [['off', 'Areas only'], ['on', 'Show nodes']], 'on')}</div>
        <div class="ctrl"><label for="mp-m">Metric</label><output></output>
          <select id="mp-m"><option value="vf">Value factor</option><option value="cap">Captured price, MXN/MWh</option><option value="base">Average price, MXN/MWh</option>
          <option value="le0">PV energy at PML ≤ 0, %</option><option value="spread">Spread peak − solar, MXN/MWh</option><option value="margin">Margin vs LCOE, MXN/MWh</option></select></div>
        <p class="fine" id="mp-note"></p>
        <div class="ctrl"><label>Node on the map</label><output></output><div id="mp-pick"></div></div>
        <div class="ramp" id="mp-leg"></div>
        <div class="panel" id="mp-area"></div>
      </div>
      <div class="stack">
        <div class="map-box"><div id="mp-host" role="img" aria-label="Interactive map of Mexico by control region or state with node markers"></div></div>
        <div class="panel" id="mp-node"></div>
      </div>
    </div>
    <p class="fine">Hover or click a region, state or node. Values: tracker, 12-month windows, areas are node averages and VF is the ratio of averages (SIN universe; Cozumel and nodes with fewer than 300 days excluded). Baja California systems are not in the SIN dataset. Node markers are municipal centroids.</p>
    <style>.map-layout{display:grid;grid-template-columns:minmax(320px,380px) minmax(0,1fr);gap:28px;align-items:start}.map-box{width:100%}@media(max-width:1100px){.map-layout{grid-template-columns:minmax(0,1fr)}}</style>`;
  const [geo, nodos] = await Promise.all([loadGeo(), loadNodos()]);
  if (!geo || !nodos) { root.innerHTML = '<p class="callout bad">The map geometry or node table could not be loaded.</p>'; return; }
  const t0 = performance.now();
  const gm = new GeoMap($('#mp-host'), geo, { fontSize: 20, onHover: onHover, onClick: onClick });
  // node coordinates aligned with analysis_nodos ids
  const xs = new Float32Array(nodos.ids.length).fill(NaN), ys = new Float32Array(nodos.ids.length).fill(NaN);
  nodos.ids.forEach((id, i) => { const n = D.byId.get(id); if (n && n.lat != null) { const [x, y] = ll2xy(n.lon, n.lat); xs[i] = x; ys[i] = y; } });
  gm.setNodes({ x: xs, y: ys });
  ctx.mapPerf = { init: performance.now() - t0, gm };
  let yr = 'Y2', lv = 'region', metric = 'vf', showNodes = true, selR = 'PENINSULAR', selS = 'YUCATAN', node = '08NCM-115', fin = {};
  const winKey = (y) => WIN[y === 'D' ? 'Y2' : y].key;
  const tip = $('#tip');

  async function finFor(y) { const r = await ctx.finEval(y === 'D' ? 'Y2' : y); return r; }
  function marginFns(res) {
    return {
      area: (level, key) => (res && res[level] && res[level][key] ? res[level][key].margin : null),
    };
  }
  async function render() {
    const real = ctx.S.get().real, mm = METRICS[metric], D_ = yr === 'D';
    const res = metric === 'margin' ? await finFor(yr) : null;
    const resA = metric === 'margin' && D_ ? await ctx.finEval('Y1') : null;
    $('#mp-note').innerHTML = metric === 'margin'
      ? (res && res.mode ? `${esc(ctx.label())}: threshold ${res.mode === 'own' ? 'is each node’s own LCOE' : `${f0(res.threshold)} MXN/MWh`} (${real ? "today's pesos" : 'nominal'}).` : 'Enter a target LCOE (or a complete set) in Assumptions to colour by margin.') : '';
    const val = (level, key, y) => {
      const s = areaStat(WIN[y].key, level, key);
      if (metric === 'margin') { const r = y === 'Y1' && D_ ? resA : res; return r && r[level] && r[level][key] ? r[level][key].margin : null; }
      return metricOf(s, metric, real);
    };
    const get = (level, key) => {
      if (D_) { const a = val(level, key, 'Y1'), b = val(level, key, 'Y2'); return a == null || b == null ? null : b - a; }
      return val(level, key, yr);
    };
    const lo = D_ ? mm.dlo : mm.lo, hi = D_ ? mm.dhi : mm.hi;
    const fmt = D_ ? mm.d : mm.f;
    gm.setFill({ level: lv, color: (k) => { const v = get(lv, k); return v == null ? null : rampColor(v, lo, hi); }, label: (k) => { const v = get(lv, k); return v == null ? '' : fmt(v); }, name: (k) => RN[k] });
    $('#mp-leg').innerHTML = `<span>${fmt(lo)}</span><i></i><span>${fmt(hi)}</span><span class="muted">${esc(mm.name)} · ${mm.unit}${D_ ? ' · Δ' : ''}</span>`;
    // dots
    if (showNodes) {
      const w = nodos.ventanas[winKey(yr)];
      const dotVal = (i) => {
        if (metric === 'margin') return res && res.margin ? (Number.isNaN(res.margin[i]) ? null : res.margin[i]) : null;
        if (w.p_cap[i] === null) return null;
        const pc = real ? w.p_cap_real[i] : w.p_cap[i], pm = real ? w.pml_medio_real[i] : w.pml_medio[i];
        return metric === 'vf' ? pc / pm : metric === 'cap' ? pc : metric === 'base' ? pm : metric === 'le0' ? w.pct_e0[i] : w.spread_punta_solar[i];
      };
      let dv = dotVal;
      if (D_) {
        const w1 = nodos.ventanas[WIN.Y1.key];
        dv = (i) => {
          if (metric === 'margin') return null;
          if (w1.p_cap[i] === null || w.p_cap[i] === null) return null;
          const f = (ww) => { const pc = real ? ww.p_cap_real[i] : ww.p_cap[i], pm = real ? ww.pml_medio_real[i] : ww.pml_medio[i]; return metric === 'vf' ? pc / pm : metric === 'cap' ? pc : metric === 'base' ? pm : metric === 'le0' ? ww.pct_e0[i] : ww.spread_punta_solar[i]; };
          return f(w) - f(w1);
        };
      }
      gm.setDots({ color: (i) => { const v = dv(i); return v == null ? null : mix(LO, HI, clamp01((v - lo) / (hi - lo))); }, radius: 3.4 });
      gm._dotVal = dv;
    } else { gm.setDots(null); }
    gm.setSelected({ region: lv === 'region' ? selR : null, state: lv === 'state' ? selS : null, node: nodos._idx.get(node) ?? -1, nodeLabel: node });
    cards();
  }
  function areaRow(label, unit, f, g1, g2, node1, node2) { return ''; }
  function cards() {
    const real = ctx.S.get().real;
    const aL = lv === 'region' ? 'region' : 'state', aK = lv === 'region' ? selR : selS;
    const rows = [['Average price', 'MXN/MWh', (s) => px(s, 'pml_medio', real), f0, signed0], ['Captured price', 'MXN/MWh', (s) => px(s, 'p_cap', real), f0, signed0],
      ['Value factor', '–', (s) => metricOf(s, 'vf', real), f2, (v) => signed(v, 2)], ['PV energy at PML ≤ 0', '%', (s) => s.pct_e0, f1, (v) => signed(v, 1)],
      ['Spread peak − solar', 'MXN/MWh', (s) => s.spread_punta_solar, f0, signed0], ['Yield (model)', 'kWh/kWp', (s) => (s.y_f_mwh_por_mwp != null ? s.y_f_mwh_por_mwp : s.y_f), f0, signed0]];
    const a = areaStat(WIN.Y1.key, aL, aK), b = areaStat(WIN.Y2.key, aL, aK);
    $('#mp-area').innerHTML = `<span class="lbl accent">${esc(areaName(aL, aK))} · ${b ? f0(b.n_nodos) : 0} nodes</span>
      <table><thead><tr><th></th><th class="n">24–25</th><th class="n">25–26</th><th class="n">Δ</th></tr></thead><tbody>${rows.map(([l, u, g, f, fd]) => {
        const x = a ? g(a) : null, y = b ? g(b) : null;
        return `<tr><td>${l}<br><span class="muted" style="font-size:12px">${u}</span></td><td class="n">${x == null ? '–' : f(x)}</td><td class="n">${y == null ? '–' : f(y)}</td><td class="n">${x == null || y == null ? '–' : fd(y - x)}</td></tr>`; }).join('')}</tbody></table>`;
    const n = D.byId.get(node), nw = nodeWin(nodos, node, WIN.Y2.key), nw1 = nodeWin(nodos, node, WIN.Y1.key);
    const st = n && areaStat(WIN.Y2.key, 'state', n.entidad), rg = n && areaStat(WIN.Y2.key, 'region', n.region);
    const nv = (w, k) => (w ? (k === 'vf' ? (real ? w.p_cap_real / w.pml_medio_real : w.vf) : k === 'cap' ? (real ? w.p_cap_real : w.p_cap) : k === 'base' ? (real ? w.pml_medio_real : w.pml_medio) : k === 'z' ? w.pct_e0 : k === 'spread' ? w.spread_punta_solar : w.y_f) : null);
    const sv = (s, k) => (s ? (k === 'vf' ? metricOf(s, 'vf', real) : k === 'cap' ? px(s, 'p_cap', real) : k === 'base' ? px(s, 'pml_medio', real) : k === 'z' ? s.pct_e0 : k === 'spread' ? s.spread_punta_solar : s.y_f_mwh_por_mwp ?? s.y_f) : null);
    const R = [['base', 'Average price', f0], ['cap', 'Captured price', f0], ['vf', 'Value factor', f2], ['z', 'PV energy at PML ≤ 0, %', f1], ['spread', 'Spread peak − solar', f0], ['yf', 'Yield (model), kWh/kWp', f0]];
    let rank = '';
    if (nw && rg) {
      const idx = nodos.ids.map((_, i) => i).filter((i) => nodos.region[i] === n.region && nodos.ventanas[WIN.Y2.key].vf[i] !== null);
      const pos = idx.filter((i) => nodos.ventanas[WIN.Y2.key].vf[i] > nw.vf).length + 1;
      rank = `VF rank in ${regName(n.region)}: ${pos} of ${idx.length} (1 = highest).`;
    }
    $('#mp-node').innerHTML = n ? `<span class="lbl accent">Node vs state and region · ${WIN.Y2.short}</span>
      <div style="margin:2px 0 8px"><b>${esc(node)}</b> · ${esc(n.nombre)} · ${esc(n.municipio || '')}, ${esc(n.entidad || '')}
        <div class="row" style="margin-top:8px"><button type="button" class="btn btn-ghost" data-add-compare="${esc(node)}">Add to compare</button><button type="button" class="btn btn-ghost" data-open-explorer="${esc(node)}">Open in explorer</button>${D.available.has(node) ? `<button type="button" class="btn btn-ghost" data-open-node="${esc(node)}">Node sheet</button>` : ''}</div></div>
      <table><thead><tr><th></th><th class="n">Node</th><th class="n">State</th><th class="n">Region</th></tr></thead><tbody>${R.map(([k, l, f]) => {
        const a1 = nv(nw, k), b1 = sv(st, k), c1 = sv(rg, k); const g = (x) => (x == null ? '–' : f(x));
        return `<tr><td>${l}</td><td class="n" style="color:var(--orange-text)">${g(a1)}</td><td class="n">${g(b1)}</td><td class="n">${g(c1)}</td></tr>`; }).join('')}</tbody></table>
      <p class="fine">${rank}${nw ? '' : ' This node has no complete data in that window (outside the universe).'}</p>` : '';
  }
  const signed0 = (v) => signed(v, 0);
  function onHover(h, cx, cy) {
    if (!h) { tip.hidden = true; return; }
    tip.hidden = false;
    if (h.kind === 'node') { const id = nodos.ids[h.i], n = D.byId.get(id), dv = gm._dotVal ? gm._dotVal(h.i) : null; tip.innerHTML = `<b>${esc(id)}</b><br>${esc(n ? n.nombre : '')}<br>${esc(METRICS[metric].name)}: ${dv == null ? '–' : (yr === 'D' ? METRICS[metric].d : METRICS[metric].f)(dv)}`; }
    else tip.innerHTML = `<b>${esc(h.name)}</b><br>${esc(regName(h.region))} region`;
    tip.style.transform = `translate(${Math.min(cx + 14, innerWidth - 270)}px,${cy + 14}px)`;
    if (h.kind === 'state' && !ctx.coarse) { if (lv === 'state') { if (selS !== h.key && areaStat(WIN.Y2.key, 'state', h.key)) { selS = h.key; gm.setSelected({ state: selS }); cards(); } } else if (h.region !== 'BAJA' && selR !== h.region) { selR = h.region; gm.setSelected({ region: selR }); cards(); } }
  }
  function onClick(h) {
    if (h.kind === 'node') { node = nodos.ids[h.i]; const n = D.byId.get(node); if (n) { selR = n.region in RN ? n.region : selR; selS = n.entidad; } pk.set('node', node); }
    else if (lv === 'state' && areaStat(WIN.Y2.key, 'state', h.key)) selS = h.key; else if (h.region !== 'BAJA') selR = h.region;
    render();
  }
  const pk = Picker($('#mp-pick'), { levels: ['node'], init: { level: 'node', key: node }, id: 'mp', onChange: (l, k) => { node = k; const n = D.byId.get(k); if (n) { if (n.region in RN && n.region !== 'BAJA CALIFORNIA') selR = n.region; if (n.entidad) selS = n.entidad; } render(); } });
  seg($('#mp-y'), (v) => { yr = v; render(); });
  seg($('#mp-l'), (v) => { lv = v; render(); });
  seg($('#mp-n'), (v) => { showNodes = v === 'on'; render(); });
  $('#mp-m').addEventListener('input', (e) => { metric = e.target.value; render(); });
  ctx.onRefresh(render);
  await render();
}

/* ---------- Geography block ---------- */
export async function initGeography(ctx) {
  const root = $('#geo-root');
  const [gx, geo] = await Promise.all([loadGeography(), loadGeo()]);
  if (!gx || !geo) { root.innerHTML = '<p class="callout bad">Geography checks are not available in this package.</p>'; return; }
  const P = gx.point_in_polygon.deck, alts = Object.keys(gx.point_in_polygon).filter((k) => k !== 'deck');
  const span = Object.entries(gx.states_spanning_regions).sort((a, b) => b[1].n - a[1].n);
  const nc = gx.nodes_without_coordinates;
  const best = alts.map((k) => [k, gx.point_in_polygon[k]]).sort((a, b) => a[1].mismatch_n - b[1].mismatch_n)[0];
  root.innerHTML = `
    <div class="callout clock"><b>Read this before trusting a dot.</b> Node coordinates are <b>municipal centroids</b> (INEGI), not substations. A node can sit tens of kilometres from the real equipment, and several nodes of one municipality share one point. Region and state labels come from CENACE, not from the map.</div>
    <div class="stats" id="geo-stats">
      <div class="stat"><span>Nodes with coordinates</span><strong>${f0(gx.nodes_with_coordinates)}</strong><em class="sub">of ${f0(gx.nodes_total)}; ${f0(nc.length)} have none</em></div>
      <div class="stat"><span>Inside their declared state</span><strong>${num(100 - P.mismatch_pct, 1)} %</strong><em class="sub">deck geometry; ${f0(P.mismatch_n)} outside, ${f0(P.within_5km)} within 5 km of the border</em></div>
      <div class="stat"><span>States spanning regions</span><strong>${span.length}</strong><em class="sub">${f0(gx.sin_nodes_outside_deck_state_region)} of ${f0(gx.sin_nodes_total)} SIN nodes sit outside the region the map assigns to their state</em></div>
      <div class="stat"><span>Mismatch in every geometry</span><strong>${gx.mismatch_in_every_geometry.length}</strong><em class="sub">${esc(gx.mismatch_in_every_geometry.join(', ') || 'none')}</em></div>
    </div>
    <div class="grid g2">
      <div class="panel"><span class="lbl accent">Interpretation</span>
        <p>${f0(P.mismatch_n)} of ${f0(P.checked)} nodes fall just outside their declared state on the deck's simplified outline (${f0(P.in_other_state)} inside a neighbour, ${f0(P.in_no_polygon)} in the sea or a gap). Every one is within ${f0(Math.max(...P.mismatches.map((m) => m.dist_to_declared_km)))} km of the declared state, and ${f0(P.within_5km)} within 5 km: they are coastal or border municipalities whose centroid lies on the generalised line, not data errors.${best ? ` A finer public outline (${f0(gx.geometries[best[0]].vertices)} vertices against ${f0(gx.geometries.deck.vertices)}) leaves only ${f0(best[1].mismatch_n)}.` : ''}</p>
        <p>Control regions are not unions of whole states: ${span.map(([k, v]) => `${stName(k)} (${Object.entries(v.regions).map(([r, c]) => `${regName(r)} ${c}`).join(', ')})`).slice(0, 4).join('; ')} and ${span.length - 4} more. Colouring by state therefore averages nodes of different regions; colouring by region follows the node's own CENACE region.</p></div>
      <div class="panel"><span class="lbl accent">States that span control regions</span>
        <div class="scroll-x"><table><thead><tr><th>State</th><th class="n">Nodes</th><th>Regions (nodes)</th><th class="n">Map's region</th></tr></thead><tbody>
        ${span.map(([k, v]) => `<tr><td>${esc(stName(k))}</td><td class="n">${f0(v.n)}</td><td>${Object.entries(v.regions).filter(([r]) => r !== 'null').map(([r, c]) => `${esc(regName(r))} ${c}`).join(', ')}</td><td class="n">${esc(regName(v.deck_region))}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
    <h3 class="sub">By state and by region</h3>
    <div class="row">${segHTML('gg-y', 'Window', [['Y1', '2024–25'], ['Y2', '2025–26']], 'Y2')}${segHTML('gg-l', 'Level', [['state', 'States'], ['region', 'Regions']], 'state')}</div>
    <div class="assump-bar" data-assump-bar></div>
    <div class="geo-panels" id="gg-panels"></div>
    <p class="insight" id="gg-text"></p>
    <details><summary>Nodes outside their declared state (${f0(P.mismatch_n)}) and nodes without coordinates (${f0(nc.length)})</summary><div class="in scroll-x">
      <table><thead><tr><th>Node</th><th>Declared state</th><th>Municipality</th><th>Inside polygon of</th><th class="n">km to declared</th></tr></thead><tbody>
      ${P.mismatches.slice(0, 25).map((m) => `<tr><td>${esc(m.id)}</td><td>${esc(stName(m.declared))}</td><td>${esc(m.municipio || '')}</td><td>${esc(m.in_polygon_of ? stName(m.in_polygon_of) : 'none (sea / gap)')}</td><td class="n">${num(m.dist_to_declared_km, 1)}</td></tr>`).join('')}</tbody></table>
      <p class="fine">Top 25 by distance. Without coordinates: ${nc.slice(0, 12).map((n) => esc(n.id)).join(', ')}${nc.length > 12 ? ` and ${nc.length - 12} more` : ''} (${nc.filter((n) => n.has_sheet).length} have a sheet). They are listed in the index and never drawn.</p></div></details>
    <style>.geo-panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}@media(max-width:820px){.geo-panels{grid-template-columns:minmax(0,1fr)}}.geo-panels h4{font-size:15px}</style>`;
  const defs = [['vf', 'Value factor'], ['cap', "Captured price, today's pesos"], ['cover', '% of nodes covering the LCOE'], ['spread', 'Price spread, peak − solar']];
  const host = $('#gg-panels');
  defs.forEach(([k, t], i) => { host.insertAdjacentHTML('beforeend', `<div class="stack"><h4>${esc(t)}</h4><div class="mini-host gm-wrap" id="gg-m${i}" role="img" aria-label="${esc(t)} map"></div><div class="ramp" id="gg-l${i}"></div></div>`); });
  const maps = defs.map((_, i) => new GeoMap($(`#gg-m${i}`), geo, { interactive: false, labels: false }));
  let yr = 'Y2', lv = 'state';
  async function draw() {
    const real = ctx.S.get().real, key = WIN[yr].key, res = await ctx.finEval(yr);
    const gv = (k, level, a) => {
      const s = areaStat(key, level, a); if (!s) return null;
      if (k === 'vf') return metricOf(s, 'vf', real);
      if (k === 'cap') return px(s, 'p_cap', real);
      if (k === 'spread') return s.spread_punta_solar;
      if (res && res.mode && res[level] && res[level][a]) return res[level][a].pct;
      return real ? s.pct_nodos_cubren_lcoe_real : s.pct_nodos_cubren_lcoe_nominal;
    };
    const dom = { vf: [0.55, 0.95, f2], cap: [0, 1600, f0], cover: [0, 100, (v) => `${f0(v)} %`], spread: [100, 1500, f0] };
    const keys = lv === 'state' ? Object.keys(D.analysis.ventanas[key].por_config.tracker.estados) : REGIONS;
    defs.forEach(([k], i) => {
      const [lo, hi, f] = dom[k];
      maps[i].setFill({ level: lv, color: (a) => { const v = gv(k, lv, a); return v == null ? null : rampColor(v, lo, hi); }, label: () => '', name: (r) => RN[r] });
      $(`#gg-l${i}`).innerHTML = `<span>${f(lo)}</span><i></i><span>${f(hi)}</span>`;
    });
    // interpretation
    const rank = (k) => keys.map((a) => [a, gv(k, lv, a)]).filter((x) => x[1] != null).sort((a, b) => b[1] - a[1]);
    const nm = (a) => (lv === 'state' ? stName(a) : regName(a));
    const v = rank('vf'), c = rank('cap'), s = rank('spread'), cv = rank('cover');
    const thr = res && res.mode ? (res.mode === 'own' ? 'each node’s own LCOE' : `${f0(res.threshold)} MXN/MWh`) : 'the deck-scenario LCOE (714 MXN/MWh)';
    $('#gg-text').innerHTML = `<b>${WIN[yr].label}, by ${lv}.</b> VF is highest in ${esc(nm(v[0][0]))} (${f2(v[0][1])}) and lowest in ${esc(nm(v[v.length - 1][0]))} (${f2(v[v.length - 1][1])}). The captured price runs from ${f0(c[c.length - 1][1])} (${esc(nm(c[c.length - 1][0]))}) to ${f0(c[0][1])} MXN/MWh (${esc(nm(c[0][0]))}): a price-level story, not only a timing one. The spread between the evening peak and solar hours is widest in ${esc(nm(s[0][0]))} (${f0(s[0][1])} MXN/MWh). Against ${esc(thr)}, ${cv.filter((x) => x[1] > 0).length} of ${cv.length} ${lv === 'state' ? 'states' : 'regions'} have at least one node covering the cost; the best is ${esc(nm(cv[0][0]))} (${f0(cv[0][1])} % of its nodes). State averages mix regions; read them with the table above. Coordinates are municipal centroids, so border states are the least reliable.`;
  }
  seg($('#gg-y'), (v) => { yr = v; draw(); });
  seg($('#gg-l'), (v) => { lv = v; draw(); });
  ctx.onRefresh(draw);
  await draw();
}
