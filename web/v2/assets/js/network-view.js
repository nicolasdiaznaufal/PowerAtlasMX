// Network Atlas window (#/network): every priced node on the grid map, coloured by battery score, real-time gap, congestion or voltage.
// Own deck.gl instance (the shared shell map stays hidden on this route). Data: derived/network.json (catalog + scores + OSM lines).
import { CONFIG } from '../../config.js';
import { eclipseSVG } from './logo.js';
import { getJSON } from './json.js';
import { hrefFor } from './nav.js';
import { loadDeck, webglAvailable } from './map-view.js';
import { loadGeo } from './geo.js';
import { esc } from './score-detail.js';
import { KV_BANDS, METRICS, bandOf, colorOf, domainOf, filterNodes, groupStats, lineStyle, rampCSS, topNodes, LOAD_TXT } from './network-core.js';

const GROUPS = { crc: 'Control region', ent: 'State', zot: 'Transmission zone', zd: 'Distribution zone' };
const num = (v, d = 0) => (v == null ? 'n/a' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
const sgn = (v) => (v == null ? 'n/a' : (v > 0 ? '+' : '') + Math.round(v).toLocaleString('en-US'));
const chip = (attr, id, label, on) => `<button type="button" class="nw-chip" data-${attr}="${id}" aria-pressed="${on}">${label}</button>`;

export function mountNetwork(root) {
  const S = { metric: 'score', bands: new Set(KV_BANDS.map((b) => b.id)), sis: new Set(['SIN', 'BCA', 'BCS']), load: 'all', gen: 'all', q: '', lines: true, group: 'crc', sel: null };
  let D = null, deckInst = null, deck = null, geo = null, dead = false, shown = [], dom = [0, 1];
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
        <div class="nw-legend"><span class="mono" id="nw-lt"></span><div class="nw-ramp" id="nw-ramp" aria-hidden="true"></div><div class="mono nw-lg"><span id="nw-lo"></span><span id="nw-hi"></span></div></div>
        <div class="tip" id="nw-tip" hidden></div>
        <p class="nw-credit mono">Lines © OpenStreetMap contributors (ODbL). Nodes: CENACE catalog <span id="nw-cat"></span>. Screening view, not a revenue forecast.</p>
        <div class="xp-state loading" id="nw-state" role="status">Loading network…</div>
      </section>
      <aside class="nw-panel" aria-label="Filters and statistics">
        <h1>Network Atlas</h1>
        <p class="nw-lead">Every priced node with its voltage, load and generation type, transmission and distribution zone, next to what a battery would see there.</p>
        <div class="nw-blk"><h2 class="mono">Colour by</h2><div class="nw-seg" id="nw-metric">${Object.entries(METRICS).map(([k, m]) => chip('m', k, m.label, k === S.metric)).join('')}</div></div>
        <div class="nw-blk"><h2 class="mono">Voltage</h2><div class="nw-seg" id="nw-bands">${KV_BANDS.map((b) => chip('b', b.id, b.label, true)).join('')}</div></div>
        <div class="nw-blk"><h2 class="mono">System</h2><div class="nw-seg" id="nw-sis">${['SIN', 'BCA', 'BCS'].map((s) => chip('s', s, s, true)).join('')}</div></div>
        <div class="nw-blk nw-two">
          <label class="mono">Load nodes<select id="nw-load"><option value="all">All</option><option value="D">Directly modelled</option><option value="I">Indirectly modelled</option></select></label>
          <label class="mono">Generation<select id="nw-gen"><option value="all">All</option><option value="any">Has generation</option><option value="D">Directly modelled</option><option value="I">Indirectly modelled</option></select></label>
        </div>
        <div class="nw-blk"><input id="nw-q" type="search" placeholder="Search node, municipality, state" aria-label="Search nodes" autocomplete="off">
          <label class="nw-chk"><input type="checkbox" id="nw-lines" checked> Transmission lines (OpenStreetMap)</label></div>
        <div class="nw-blk" id="nw-card" aria-live="polite"><p class="hint">Click a node for its catalog entry and prices.</p></div>
        <div class="nw-blk"><h2 class="mono">Median by <select id="nw-group" aria-label="Group by">${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></h2><div class="nw-tbl" id="nw-stats"></div></div>
        <div class="nw-blk"><h2 class="mono" id="nw-toph"></h2><ol class="nw-top" id="nw-top"></ol></div>
      </aside>
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

  function layers() {
    const m = METRICS[S.metric], L = deck, sel = S.sel ? [S.sel] : [];
    const out = [new L.GeoJsonLayer({ id: 'states', data: geo.states, stroked: true, filled: true, getFillColor: [17, 24, 19, 255], getLineColor: [240, 232, 210, 40], lineWidthUnits: 'pixels', getLineWidth: 1 })];
    if (S.lines) {
      const vis = D.lines.filter((l) => S.bands.has(bandOf(l[0])));
      out.push(new L.PathLayer({ id: 'lines', data: vis, getPath: (l) => l[1].map(([a, o]) => [o, a]), getColor: (l) => lineStyle(l[0]).c, getWidth: (l) => lineStyle(l[0]).w, widthUnits: 'pixels', capRounded: true, updateTriggers: { data: [[...S.bands].join()] } }));
    }
    out.push(
      new L.ScatterplotLayer({ id: 'nodes', data: shown, pickable: true, getPosition: (n) => [n.lo, n.la], getRadius: (n) => (n.kv >= 230 ? 4200 : 2800), radiusUnits: 'meters', radiusMinPixels: 2.5, radiusMaxPixels: 11,
        getFillColor: (n) => colorOf(m, m.get(n), dom), updateTriggers: { getFillColor: [S.metric, dom[0], dom[1]] } }),
      new L.ScatterplotLayer({ id: 'gen', data: shown.filter((n) => n.gen === 'D'), getPosition: (n) => [n.lo, n.la], getRadius: 4200, radiusUnits: 'meters', radiusMinPixels: 5, radiusMaxPixels: 13, filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 1, getLineColor: [237, 230, 208, 170] }),
      new L.ScatterplotLayer({ id: 'sel', data: sel, getPosition: (n) => [n.lo, n.la], getRadius: 5000, radiusUnits: 'meters', radiusMinPixels: 9, radiusMaxPixels: 16, filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2, getLineColor: [232, 162, 102, 255] }));
    return out;
  }

  function refresh(rescale = true) {
    shown = filterNodes(D.nodes, S);
    if (rescale) dom = domainOf(shown.length ? shown : D.nodes, METRICS[S.metric]);
    legend(); stats();
    if (deckInst) deckInst.setProps({ layers: layers() });
    q('#nw-state').hidden = true;
  }
  const pick = (n) => { S.sel = n; q('#nw-card').innerHTML = card(n); if (deckInst) deckInst.setProps({ layers: layers() }); };
  const toggle = (set, id, btn) => { set.has(id) ? set.delete(id) : set.add(id); btn.setAttribute('aria-pressed', set.has(id)); if (!set.size) { set.add(id); btn.setAttribute('aria-pressed', 'true'); } refresh(); };

  q('#nw-metric').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; S.metric = b.dataset.m; q('#nw-metric').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); refresh(); };
  q('#nw-bands').onclick = (e) => { const b = e.target.closest('[data-b]'); if (b) toggle(S.bands, b.dataset.b, b); };
  q('#nw-sis').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) toggle(S.sis, b.dataset.s, b); };
  q('#nw-load').onchange = (e) => { S.load = e.target.value; refresh(); };
  q('#nw-gen').onchange = (e) => { S.gen = e.target.value; refresh(); };
  q('#nw-group').onchange = (e) => { S.group = e.target.value; stats(); };
  q('#nw-lines').onchange = (e) => { S.lines = e.target.checked; refresh(false); };
  let qt = 0;
  q('#nw-q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value; refresh(); }, 160); };
  q('#nw-top').onclick = (e) => {
    const b = e.target.closest('[data-id]'), n = b && D.byId.get(b.dataset.id);
    if (!n) return;
    pick(n);
    if (deckInst) deckInst.setProps({ viewState: { ...vs(), longitude: n.lo, latitude: n.la, zoom: Math.max(7, vs().zoom), transitionDuration: 500, transitionInterpolator: new deck.FlyToInterpolator() } });
  };
  let cur = { longitude: -102, latitude: 23.5, zoom: 4.3, pitch: 0, bearing: 0, minZoom: 3, maxZoom: 12 };
  const vs = () => cur;

  async function load() {
    const [data, g] = await Promise.all([getJSON('../data/derived/network.json'), loadGeo()]);
    if (dead) return;
    D = data; D.byId = new Map(D.nodes.map((n) => [n.id, n])); geo = g;
    q('#nw-cat').textContent = D.meta.catalog.replace(/^.*\((.*)\).*$/, '$1');
    if (!webglAvailable()) { q('#nw-state').textContent = 'WebGL is not available in this browser, so the map cannot be drawn. The tables still work.'; shown = filterNodes(D.nodes, S); dom = domainOf(shown, METRICS[S.metric]); legend(); stats(); return; }
    deck = await loadDeck();
    if (dead) return;
    shown = filterNodes(D.nodes, S); dom = domainOf(shown, METRICS[S.metric]);
    deckInst = new deck.Deck({ parent: q('#nw-map'), views: new deck.MapView({ repeat: false }), controller: { keyboard: true, doubleClickZoom: true, inertia: false, dragRotate: false, touchRotate: false },
      viewState: cur, pickingRadius: 8, layers: layers(), useDevicePixels: Math.min(window.devicePixelRatio || 1, 2),
      onViewStateChange: ({ viewState }) => { cur = viewState; deckInst.setProps({ viewState: cur }); tip.hidden = true; },
      getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
      onHover: (i) => {
        const n = i && i.layer && i.layer.id === 'nodes' ? i.object : null;
        if (!n) { tip.hidden = true; return; }
        const m = METRICS[S.metric], v = m.get(n);
        tip.innerHTML = `<b>${esc(n.n)}</b><span class="mono">${esc(n.id)} · ${n.kv} kV</span><span>${m.label}: ${v == null ? 'n/a' : m.fmt(v)}</span>`;
        tip.style.left = `${i.x + 14}px`; tip.style.top = `${i.y + 14}px`; tip.hidden = false;
      },
      onClick: (i) => pick(i && i.layer && i.layer.id === 'nodes' ? i.object : null) });
    refresh();
  }
  load().catch((e) => { console.error(e); q('#nw-state').textContent = 'Could not load the network data.'; q('#nw-state').classList.remove('loading'); });

  return { destroy() { dead = true; clearTimeout(qt); if (deckInst) deckInst.finalize(); } };
}
