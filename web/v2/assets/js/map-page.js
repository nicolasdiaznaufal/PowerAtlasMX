// #/map page: persistent map + floating panel (selector, metric switch, chips, legend) + zoom controls + tooltip.
import { CONFIG } from '../../config.js';
import { eclipseSVG } from './logo.js';
import { loadAtlas, WINDOW } from './atlas.js';
import { loadGeo } from './geo.js';
import { METRICS, METRIC_ORDER, RAMP } from './metrics.js';
import { createStore, parseSel, serializeSel, MAX_SEL } from './store.js';
import { createSelector, buildEntries } from './selector.js';
import { createMapView, loadDeck, webglAvailable } from './map-view.js';

const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (s) => (s || '').charAt(0) + (s || '').slice(1).toLowerCase();

export function mountMap(root) {
  root.innerHTML = `
  <div class="stage map-stage">
    <div class="map-canvas" id="mapbox"></div>
    <header class="nav">
      <a class="brand" href="#/" aria-label="${CONFIG.PRODUCT}, home">${eclipseSVG()}<span>${CONFIG.PRODUCT}</span></a>
      <span class="spacer"></span>
      <span class="mono scope">MDA reference price (CENACE)</span>
    </header>
    <aside class="panel" aria-label="Map controls">
      <div id="sel-slot"></div>
      <div class="mono lbl" id="metric-lbl">Colour nodes by</div>
      <div class="seg" role="radiogroup" aria-labelledby="metric-lbl" id="seg"></div>
      <p class="hint" id="hint"></p>
      <ul class="chips" id="chips" aria-label="Selection"></ul>
      <p class="live mono" id="live" role="status" aria-live="polite"></p>
      <div class="legend"><div class="ramp" id="ramp"></div><div class="lg mono"><span id="lg-lo"></span><span id="lg-hi"></span></div></div>
      <dl class="facts mono">
        <div><dt>Window</dt><dd>${WINDOW.label}</dd></div>
        <div><dt>Mounting</dt><dd id="cfg">…</dd></div>
        <div><dt>Scope</dt><dd>MDA reference price (CENACE). No capacity, CEL or contracts.</dd></div>
      </dl>
    </aside>
    <div class="zoom" role="group" aria-label="Map zoom">
      <button type="button" id="zin" aria-label="Zoom in">+</button>
      <button type="button" id="zout" aria-label="Zoom out">−</button>
      <button type="button" id="zreset" aria-label="Reset view">⌖</button>
    </div>
    <div class="tip" id="tip" hidden></div>
    <div class="nogl" id="nogl" hidden><p>The map needs WebGL, which this browser has turned off. You can still search and select places on the left.</p></div>
  </div>`;

  const q = (s) => root.querySelector(s);
  const store = createStore(parseSel(new URLSearchParams((location.hash.split('?')[1]) || '').get('sel')));
  let mv = null, atlas = null, geo = null, dead = false, metric = 'vf', selector = null;
  const byId = new Map();

  const hasGL = webglAvailable();
  if (!hasGL) { q('#nogl').hidden = false; q('.zoom').hidden = true; }

  // metric switch
  const seg = q('#seg');
  METRIC_ORDER.forEach((k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.k = k; b.textContent = METRICS[k].short;
    b.addEventListener('click', () => setMetric(k));
    seg.append(b);
  });
  seg.addEventListener('keydown', (e) => {
    const i = METRIC_ORDER.indexOf(metric);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const k = METRIC_ORDER[(i + d + METRIC_ORDER.length) % METRIC_ORDER.length];
    setMetric(k); seg.querySelector(`[data-k="${k}"]`).focus();
  });
  function setMetric(k) {
    metric = k;
    seg.querySelectorAll('button').forEach((b) => { const on = b.dataset.k === k; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    q('#hint').textContent = `${METRICS[k].label} (${METRICS[k].unit}). ${METRICS[k].hint}.`;
    const dom = mv ? mv.setMetric(k) : null;
    legend(dom);
  }
  function legend(dom) {
    q('#ramp').style.background = `linear-gradient(90deg, ${RAMP.dot}, ${RAMP.hi})`;
    const m = METRICS[metric];
    if (metric === 'rank') { q('#lg-lo').textContent = 'Last in region'; q('#lg-hi').textContent = '#1 in region'; }
    else if (dom) { const u = m.unit === 'no unit' ? '' : ` ${m.unit}`; q('#lg-lo').textContent = `${m.fmt(dom[0])}${u}`; q('#lg-hi').textContent = `${m.fmt(dom[1])}${u}`; }
  }

  // chips
  const label = (s) => {
    if (s.kind === 'national') return { t: 'National', k: 'National' };
    if (s.kind === 'region') return { t: title(s.id), k: 'Region' };
    if (s.kind === 'state') { const f = geo && geo.states.features.find((x) => x.properties.key === s.id); return { t: f ? f.properties.name : title(s.id), k: 'State' }; }
    const n = byId.get(s.id); return { t: n ? n.name : s.id, k: `Node · ${s.id}` };
  };
  function renderChips(list) {
    const ul = q('#chips');
    ul.innerHTML = '';
    list.forEach((s, i) => {
      const l = label(s);
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot" style="background:${SERIES[i]}" aria-hidden="true">${i + 1}</span><span class="ct"><span class="mono">${esc(l.k)}</span>${esc(l.t)}</span><button type="button" aria-label="Remove ${esc(l.t)}">×</button>`;
      li.querySelector('button').addEventListener('click', () => store.remove(s));
      ul.append(li);
    });
    history.replaceState(null, '', `#/map${list.length ? `?sel=${serializeSel(list)}` : ''}`);
    if (mv) mv.setSelection(list);
  }
  store.subscribe(renderChips);

  const say = (t) => { q('#live').textContent = t; };
  function pick(x) {
    const s = { kind: x.kind, id: x.id };
    if (!store.add(s)) { say(`Up to ${MAX_SEL} selections. Remove one first.`); return; }
    say(`${x.label} added.`);
    if (!mv) return;
    if (x.kind === 'node') { const n = byId.get(x.id); if (n) mv.flyToNode(n); }
    else if (x.kind === 'national') mv.reset();
    else mv.flyToArea(x.kind, x.id);
  }

  // tooltip
  const tip = q('#tip');
  function onHover(n, x, y) {
    if (!n) { tip.hidden = true; return; }
    const r = (v, m) => (v == null ? '–' : `${METRICS[m].fmt(v)}<small> ${m === 'rank' || METRICS[m].unit === 'no unit' ? '' : METRICS[m].unit}</small>`);
    tip.innerHTML = `<b>${esc(n.name)}</b><span class="mono">${esc(n.id)} · ${esc(title(n.state))} · ${esc(title(n.region))}</span>`
      + (n.has ? `<table>${['pml', 'pcap', 'vf'].map((m) => `<tr><th class="mono">${METRICS[m].label}</th><td>${r(METRICS[m].get(n), m)}</td></tr>`).join('')}`
        + `<tr><th class="mono">${METRICS.rank.label}</th><td>${n.rank == null ? '–' : `#${n.rank}<small> of ${n.rankN}</small>`}</td></tr></table>`
        : '<span class="mono nod">No data in this window</span>');
    tip.hidden = false;
    const w = q('.map-stage').clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.transform = `translate(${Math.min(w - tw - 8, x + 14)}px, ${Math.max(72, y - th - 10)}px)`;
  }

  // zoom controls
  q('#zin').addEventListener('click', () => mv && mv.zoomBy(1));
  q('#zout').addEventListener('click', () => mv && mv.zoomBy(-1));
  q('#zreset').addEventListener('click', () => mv && mv.reset());

  setMetric('vf');
  renderChips(store.get());

  Promise.all([loadAtlas(), loadGeo()]).then(async ([a, g]) => {
    if (dead) return;
    atlas = a; geo = g;
    a.nodes.forEach((n) => byId.set(n.id, n));
    q('#cfg').textContent = `${a.config === 'tracker' ? 'Single-axis tracker' : a.config} (only configuration in the analysis)`;
    selector = createSelector({ entries: buildEntries(g, a.nodes), onPick: pick });
    q('#sel-slot').append(selector.el);
    renderChips(store.get());
    if (!hasGL) return;
    try {
      const deck = await loadDeck();
      if (dead) return;
      const box = q('#mapbox');
      const mob = window.innerWidth < 760;
      mv = createMapView({ deck, container: box, geo: g, atlas: a, callbacks: { onHover, onPickNode: (n) => { store.toggle({ kind: 'node', id: n.id }) || say(`Up to ${MAX_SEL} selections.`); }, onPickState: (k) => pick({ kind: 'state', id: k, label: k }) } });
      mv.setPadding(mob ? { top: 72, right: 12, bottom: 300, left: 12 } : { top: 72, right: 40, bottom: 40, left: 400 });
      mv.reset();
      legend(mv.setMetric(metric));
      mv.setSelection(store.get());
      root.dataset.ready = '1';
    } catch (e) {
      console.error(e);
      q('#nogl').hidden = false;
    }
  }).catch((e) => { console.error(e); say('Data failed to load.'); });

  return { destroy() { dead = true; if (mv) mv.destroy(); } };
}
