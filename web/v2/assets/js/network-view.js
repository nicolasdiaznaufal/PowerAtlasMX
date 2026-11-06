// Network Atlas window (#/network): every priced node on the grid map, coloured by battery score, real-time gap, congestion or voltage.
// Own deck.gl instance (the shared shell map stays hidden on this route). Data: derived/network.json (catalog + scores + OSM lines).
import { CONFIG } from '../../config.js';
import { eclipseSVG } from './logo.js';
import { getJSON } from './json.js';
import { hrefFor } from './nav.js';
import { loadDeck, webglAvailable } from './map-view.js';
import { loadGeo } from './geo.js';
import { esc } from './score-detail.js';
import { KV_BANDS, METRICS, LINE_LEGEND, bandOf, colorOf, domainOf, filterNodes, groupStats, lineStyle, rampCSS, topNodes, LOAD_TXT } from './network-core.js';
import { PERMIT_GROUPS, TECHS, filterPlants, plantCard, techColor, techFam, ringOf, radiusOf, permitType } from './network-plants.js';
import { titleCard, legendCard, panel, nodeBlock } from './network-panel.js';
import { cityLayer, tierAt } from './cities.js';

const GROUPS = { crc: 'Control region', ent: 'State', zot: 'Transmission zone', zd: 'Distribution zone' };
const num = (v, d = 0) => (v == null ? 'n/a' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
const sgn = (v) => (v == null ? 'n/a' : (v > 0 ? '+' : '') + Math.round(v).toLocaleString('en-US'));

export function mountNetwork(root) {
  const S = { metric: 'score', bands: new Set(KV_BANDS.map((b) => b.id)), sis: new Set(['SIN', 'BCA', 'BCS']), load: 'all', gen: 'all', q: '', lines: true, group: 'crc', sel: null, selP: null,
    nodes: false, subs: true, arch: false, indig: false, roads: false, ties: false, pf: { groups: new Set(PERMIT_GROUPS.map((g) => g.id)), techs: new Set(TECHS.map((t) => t[0])), mkt: 'all', ptype: 'all', exp: 'all', mw: 0, reg: 'all', q: '' } };
  let plantsAll = [], pShown = [], D = null, L2 = null, deckInst = null, deck = null, geo = null, dead = false, shown = [], dom = [0, 1];
  const tab = (to, label, cur) => `<a href="${hrefFor(to, [])}"${cur ? ' aria-current="page"' : ''}>${label}</a>`;
  root.innerHTML = `
  <div class="page analysis network">
    <header class="nav">
      <a class="brand" href="#/" aria-label="${CONFIG.PRODUCT}, home">${eclipseSVG()}<span>${CONFIG.PRODUCT}</span></a>
      <nav class="tabs mono" aria-label="Views">${tab('/explorer', 'Explorer')}${tab('/revenue', 'Revenue')}${tab('/score', 'Score')}${tab('/network', 'Network Atlas', true)}</nav>
    </header>
    <main class="nw-main">
      <section class="nw-stage" aria-label="Grid map">
        <div class="nw-map" id="nw-map"></div>
        <div class="nw-left">${titleCard()}${legendCard()}<p class="nw-credit mono" id="nw-credit"></p></div>
        <div class="tip" id="nw-tip" hidden></div>
        <div class="xp-state loading" id="nw-state" role="status">Loading network…</div>
        <div id="nw-side"></div>
      </section>
    </main>
  </div>`;
  const q = (s) => root.querySelector(s);
  const tip = q('#nw-tip');

  function card(n) {
    if (!n) return '<p class="hint">Click a node for its catalog entry and prices.</p>';
    const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
    return `<h2 class="nw-nh">${esc(n.n)} <span class="mono">${esc(n.id)}</span></h2><table class="nw-kv">
      ${row('Voltage', `${n.kv} kV`)}${row('Place', `${esc(n.mun)}, ${esc(n.ent)}`)}
      ${row('Load type', LOAD_TXT[n.carga])}${row('Generation', LOAD_TXT[n.gen])}
      ${row('Control region / load zone', `${esc(n.crc)} / ${esc(n.zc)}`)}${row('Transmission', `${esc(n.zot)} (${esc(n.grt)})`)}${row('Distribution', `${esc(n.zd)} (${esc(n.gdd)})`)}
      ${row('Battery score', num(n.score))}${row('4 h value, day-ahead', n.mda4 == null ? 'n/a' : `${num(n.mda4)} MXN/kW-yr`)}
      ${row('4 h value, real-time', n.mtr4 == null ? 'n/a (no MTR here)' : `${num(n.mtr4)} MXN/kW-yr`)}
      ${row('Real-time minus day-ahead', n.gap == null ? 'n/a' : `${sgn(n.gap)} MXN/MWh`)}${row('Congestion, mean', n.cong == null ? 'n/a' : `${sgn(n.cong)} MXN/MWh`)}
      ${row('Substation saturation', n.sat == null ? 'not checked' : n.sat > 0 ? `${num(n.sat, 1)}x` : 'none')}</table>`;
  }

  function stats() {
    const m = METRICS[S.metric];
    q('#nw-stats').innerHTML = `<table><thead><tr class="mono"><th>${GROUPS[S.group]}</th><th>Nodes</th><th>Gen.</th><th>Score</th><th>Gap</th></tr></thead><tbody>${groupStats(shown, S.group).slice(0, 12)
      .map((r) => `<tr><th>${esc(r.key)}</th><td>${r.n}</td><td>${r.gen}</td><td>${num(r.score)}</td><td>${sgn(r.gap)}</td></tr>`).join('')}</tbody></table>`;
    q('#nw-toph').textContent = `Top 10 · ${m.label}`;
    q('#nw-top').innerHTML = topNodes(shown, m).map((n) => `<li><button type="button" data-id="${esc(n.id)}"><span>${esc(n.n)} <i class="mono">${esc(n.id)}</i></span><b class="mono">${m.fmt(m.get(n))}</b></button></li>`).join('');
  }

  function legend() {
    const m = METRICS[S.metric];
    q('#nw-lt').textContent = `${m.label} · ${m.unit}`;
    q('#nw-ramp').style.background = rampCSS(m);
    q('#nw-lo').textContent = m.fmt(dom[0]); q('#nw-hi').textContent = m.fmt(dom[1]);
  }

  const sc = (L, id, data, pos, r, rmin, rmax, fill, extra = {}) => new L.ScatterplotLayer({ id, data, getPosition: pos, getRadius: r, radiusUnits: 'meters', radiusMinPixels: rmin, radiusMaxPixels: rmax, getFillColor: fill, ...extra });
  function layers() {
    const m = METRICS[S.metric], L = deck, sel = S.sel ? [S.sel] : [];
    const out = [new L.GeoJsonLayer({ id: 'states', data: geo.states, stroked: true, filled: true, getFillColor: [17, 24, 19, 255], getLineColor: [240, 232, 210, 40], lineWidthUnits: 'pixels', getLineWidth: 1 })];
    if (S.roads) out.push(sc(L, 'roads', L2.roads, (r) => [r[1], r[0]], 1500, 1, 2, [154, 163, 155, 120]));
    if (S.indig) out.push(sc(L, 'indig', L2.indig, (r) => [r[1], r[0]], (r) => 600 + Math.sqrt(r[2]) * 90, 2, 12, [240, 166, 200, 120], { pickable: true, stroked: false }));
    if (S.lines) {
      const vis = D.lines.filter((l) => S.bands.has(bandOf(l[0])));
      out.push(new L.PathLayer({ id: 'lines', data: vis, getPath: (l) => l[1].map(([a, o]) => [o, a]), getColor: (l) => lineStyle(l[0]).c, getWidth: (l) => lineStyle(l[0]).w, widthUnits: 'pixels', capRounded: true, updateTriggers: { data: [[...S.bands].join()] } }));
    }
    if (S.ties) out.push(new L.GeoJsonLayer({ id: 'ties', data: L2.ties, stroked: true, filled: false, getLineColor: [232, 162, 102, 230], lineWidthUnits: 'pixels', getLineWidth: 2.2, lineDashJustified: true }));
    if (S.subs) {
      out.push(sc(L, 'subs', L2.subs, (r) => [r[1], r[0]], (r) => (r[2] ? 1800 : 1100), 1.5, 6, (r) => (r[2] ? [232, 162, 102, 230] : [244, 230, 196, 210]), { pickable: true }),
        sc(L, 'tsubs', D.nodes.filter((n) => n.kv >= 230), (n) => [n.lo, n.la], 4200, 4, 9, [0, 0, 0, 0], { filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 1.4, getLineColor: [255, 255, 255, 235] }));
    }
    if (S.arch) out.push(sc(L, 'arch', L2.arch, (r) => [r[1], r[0]], 1800, 3, 7, (r) => (r[3] ? [216, 180, 254, 235] : [216, 180, 254, 140]), { pickable: true, stroked: true, getLineColor: [60, 40, 90, 200], lineWidthUnits: 'pixels', getLineWidth: 1 }));
    out.push(new L.ScatterplotLayer({ id: 'plants', data: pShown, pickable: true, getPosition: (p) => [p.lo, p.la], getRadius: radiusOf, radiusUnits: 'meters', radiusMinPixels: 3, radiusMaxPixels: 18,
      getFillColor: (p) => techColor(p.t), stroked: true, lineWidthUnits: 'pixels', getLineWidth: 1.5, getLineColor: ringOf, updateTriggers: { getData: [pShown] } }));
    if (S.nodes) {
      out.push(sc(L, 'nodes', shown, (n) => [n.lo, n.la], (n) => (n.kv >= 230 ? 4200 : 2800), 2.5, 11, (n) => colorOf(m, m.get(n), dom), { pickable: true, updateTriggers: { getFillColor: [S.metric, dom[0], dom[1]] } }),
        sc(L, 'sel', sel, (n) => [n.lo, n.la], 5000, 9, 16, [0, 0, 0, 0], { filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2, getLineColor: [232, 162, 102, 255] }));
    }
    out.push(sc(L, 'selp', S.selP ? [S.selP] : [], (p) => [p.lo, p.la], 9000, 10, 18, [0, 0, 0, 0], { filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2, getLineColor: [237, 230, 208, 255] }), cityLayer(L, cur.zoom));
    return out;
  }

  function sidebar() {   // counts and MW per technology under the other active filters; header subtitle
    const f = { ...S.pf, techs: null }, base = filterPlants(plantsAll, f), by = {};
    base.forEach((p) => { const k = techFam(p.t); (by[k] = by[k] || { n: 0, mw: 0 }); by[k].n++; by[k].mw += p.mw || 0; });
    root.querySelectorAll('#nw-techs [data-n]').forEach((el) => { const v = by[el.dataset.n]; el.textContent = v ? Math.round(v.mw).toLocaleString('en-US') : '0'; el.title = v ? `${v.n} plants, MW` : ''; });
    const mw = pShown.reduce((a, p) => a + (p.mw || 0), 0);
    q('#nw-sub').textContent = `${pShown.length.toLocaleString('en-US')} plants · ${(mw / 1000).toFixed(1)} GW`;
    q('#nw-pn').textContent = `${pShown.length.toLocaleString('en-US')} of ${plantsAll.length.toLocaleString('en-US')} plants in the CRE list`;
    const act = [S.arch && ['#D8B4FE', 'Archaeological site (filled: INAH open zone)'], S.indig && ['#F0A6C8', 'Indigenous locality (size: speakers)'], S.roads && ['#9AA39B', 'Main road cell (~5 km)'], S.ties && ['#E8A266', 'International interconnection']].filter(Boolean);
    q('#nw-lgx').innerHTML = act.map(([c, t]) => `<div class="nw-lg"><i class="nw-dot" style="background:${c}"></i>${t}</div>`).join('');
  }

  function refresh(rescale = true) {
    shown = filterNodes(D.nodes, S);
    if (rescale) dom = domainOf(shown.length ? shown : D.nodes, METRICS[S.metric]);
    pShown = filterPlants(plantsAll, S.pf);
    sidebar();
    if (S.nodes) { legend(); stats(); }
    if (deckInst) deckInst.setProps({ layers: layers() });
    q('#nw-state').hidden = true;
  }
  const redraw = () => deckInst && deckInst.setProps({ layers: layers() });
  const pickP = (p) => { S.selP = p; S.sel = null; q('#nw-pcard').innerHTML = p ? plantCard(p, esc) : ''; q('#nw-pcard').hidden = !p; redraw(); };
  const pick = (n) => { S.sel = n; S.selP = null; q('#nw-pcard').hidden = true; q('#nw-card').innerHTML = card(n); redraw(); };
  const toggle = (set, id, btn) => { set.has(id) ? set.delete(id) : set.add(id); btn.setAttribute('aria-pressed', set.has(id)); if (!set.size) { set.add(id); btn.setAttribute('aria-pressed', 'true'); } refresh(); };
  const one = (box, attr, key, parse = (v) => v) => { box.onclick = (e) => { const b = e.target.closest(`[data-${attr}]`); if (!b) return; S.pf[key] = parse(b.dataset[attr]); box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); refresh(false); }; };

  function bind() {
    one(q('#nw-mkt'), 'k', 'mkt'); one(q('#nw-exp'), 'e', 'exp'); one(q('#nw-mw'), 'w', 'mw', Number);
    q('#nw-pt').onchange = (e) => { S.pf.ptype = e.target.value; refresh(false); };
    q('#nw-reg').onchange = (e) => { S.pf.reg = e.target.value; refresh(false); };
    q('#nw-pg').onclick = (e) => { const b = e.target.closest('[data-g]'); if (b) toggle(S.pf.groups, b.dataset.g, b); };
    q('#nw-techs').onchange = (e) => { const t = e.target.dataset.t; if (t) { e.target.checked ? S.pf.techs.add(t) : S.pf.techs.delete(t); refresh(false); } };
    const all = (on) => { root.querySelectorAll('#nw-techs [data-t]').forEach((c) => { c.checked = on; on ? S.pf.techs.add(c.dataset.t) : S.pf.techs.delete(c.dataset.t); }); refresh(false); };
    q('#nw-all').onclick = () => all(true); q('#nw-none').onclick = () => all(false);
    [['lines', 'nw-lines'], ['subs', 'nw-subs'], ['arch', 'nw-arch'], ['indig', 'nw-indig'], ['roads', 'nw-roads'], ['ties', 'nw-ties']].forEach(([k, id]) => { q('#' + id).onchange = (e) => { S[k] = e.target.checked; refresh(false); }; });
    q('#nw-nodes').onchange = (e) => { S.nodes = e.target.checked; q('#nw-nbox').hidden = !S.nodes; if (!S.nodes) pick(null); refresh(); };
    q('#nw-bands').onclick = (e) => { const b = e.target.closest('[data-b]'); if (b) toggle(S.bands, b.dataset.b, b); };
    q('#nw-metric').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; S.metric = b.dataset.m; q('#nw-metric').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); refresh(); };
    q('#nw-sis').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) toggle(S.sis, b.dataset.s, b); };
    q('#nw-load').onchange = (e) => { S.load = e.target.value; refresh(); };
    q('#nw-gen').onchange = (e) => { S.gen = e.target.value; refresh(); };
    q('#nw-group').onchange = (e) => { S.group = e.target.value; stats(); };
    let qt = 0;
    q('#nw-q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { S.pf.q = e.target.value; refresh(false); }, 160); };
    q('#nw-nq').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value; refresh(); }, 160); };
    q('#nw-top').onclick = (e) => {
      const b = e.target.closest('[data-id]'), n = b && D.byId.get(b.dataset.id);
      if (!n) return;
      pick(n);
      if (deckInst) deckInst.setProps({ viewState: { ...cur, longitude: n.lo, latitude: n.la, zoom: Math.max(7, cur.zoom), transitionDuration: 500, transitionInterpolator: new deck.FlyToInterpolator() } });
    };
  }
  let cur = { longitude: -102, latitude: 23.5, zoom: 4.3, pitch: 0, bearing: 0, minZoom: 3, maxZoom: 12 };
  const place = (i) => { tip.style.left = `${i.x + 14}px`; tip.style.top = `${i.y + 14}px`; tip.hidden = false; };
  const TIPS = {
    plants: (p) => `<b>${esc(p.n)}</b><span class="mono">${esc(p.t || '')} · ${p.mw == null ? 'n/a' : p.mw + ' MW'}</span><span>${esc(p.fase)}</span>${p.exp ? `<span>Permit expires ${p.exp}</span>` : ''}`,
    subs: (r) => `<b>${esc(r[3] || 'Substation')}</b><span class="mono">${esc(r[4] || (r[2] ? '69-161 kV' : '34.5 kV or less'))}</span>`,
    arch: (r) => `<b>${esc(r[2])}</b><span>${r[3] ? 'INAH open zone' : 'OpenStreetMap site'}</span>`,
    indig: (r) => `<b>Indigenous locality</b><span>${r[2].toLocaleString('en-US')} speakers of an indigenous language</span>`,
    nodes: (n) => { const m = METRICS[S.metric], v = m.get(n); return `<b>${esc(n.n)}</b><span class="mono">${esc(n.id)} · ${n.kv} kV</span><span>${m.label}: ${v == null ? 'n/a' : m.fmt(v)}</span>`; },
  };

  async function load() {
    const [data, g, pl, ly] = await Promise.all([getJSON('../data/derived/network.json'), loadGeo(), getJSON('../data/derived/plants.json').catch(() => ({ plants: [] })), getJSON('../data/derived/layers.json').catch(() => ({ subs: [], arch: [], indig: [], roads: [], ties: { features: [] }, meta: {} }))]);
    if (dead) return;
    plantsAll = pl.plants; D = data; L2 = ly; D.byId = new Map(D.nodes.map((n) => [n.id, n])); geo = g;
    const regions = [...new Set(plantsAll.map((p) => p.reg).filter(Boolean))].sort(), ptypes = [...new Set(plantsAll.map(permitType).filter(Boolean))].sort();
    q('#nw-side').innerHTML = panel(S, regions, ptypes, nodeBlock(S, false)).replace('</aside>', '<div id="nw-pcard" class="nw-pcard" hidden></div></aside>');
    q('#nw-credit').textContent = `${(ly.meta && ly.meta.credit) || ''} Lines © OpenStreetMap contributors (ODbL). Plants: CRE list; permit dates: CNE via atlas-sen (CC-BY). Nodes: CENACE catalog ${D.meta.catalog.replace(/^.*\((.*)\).*$/, '$1')}. Screening view, not a revenue forecast.`;
    bind();
    if (!webglAvailable()) { q('#nw-state').textContent = 'WebGL is not available in this browser, so the map cannot be drawn. The filters still work.'; shown = filterNodes(D.nodes, S); pShown = filterPlants(plantsAll, S.pf); sidebar(); return; }
    deck = await loadDeck();
    if (dead) return;
    shown = filterNodes(D.nodes, S); dom = domainOf(shown, METRICS[S.metric]); pShown = filterPlants(plantsAll, S.pf);
    deckInst = new deck.Deck({ parent: q('#nw-map'), views: new deck.MapView({ repeat: false }), controller: { keyboard: true, doubleClickZoom: true, inertia: false, dragRotate: false, touchRotate: false },
      viewState: cur, pickingRadius: 8, layers: layers(), useDevicePixels: Math.min(window.devicePixelRatio || 1, 2),
      onViewStateChange: ({ viewState }) => { const t = tierAt(cur.zoom); cur = viewState; deckInst.setProps(tierAt(cur.zoom) !== t ? { viewState: cur, layers: layers() } : { viewState: cur }); tip.hidden = true; },
      getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
      onHover: (i) => { const f = i && i.layer && TIPS[i.layer.id]; if (!f || !i.object) { tip.hidden = true; return; } tip.innerHTML = f(i.object); place(i); },
      onClick: (i) => { const id = i && i.layer && i.layer.id; if (id === 'plants') pickP(i.object); else if (id === 'nodes') pick(i.object); else { pickP(null); if (S.nodes) pick(null); } } });
    refresh();
  }
  load().catch((e) => { console.error(e); q('#nw-state').textContent = 'Could not load the network data.'; q('#nw-state').classList.remove('loading'); });

  return { destroy() { dead = true; if (deckInst) deckInst.finalize(); } };
}
