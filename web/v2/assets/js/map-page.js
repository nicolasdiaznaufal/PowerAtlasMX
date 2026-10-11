// #/map overlay: selector, metric switch, chips, legend, zoom controls, tooltip, Continue. The map itself lives in shell.js.
import { CONFIG } from '../../config.js';
import { eclipseSVG } from './logo.js';
import { WINDOW } from './atlas.js';
import { METRICS, METRIC_ORDER, RAMP, valueAt } from './metrics.js';
import { createSelector, buildEntries } from './selector.js';
import { mountChips } from './chips.js';
import { getShell } from './shell.js';
import { hrefFor } from './nav.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (s) => (s || '').charAt(0) + (s || '').slice(1).toLowerCase();

export function mountMap(root) {
  const shell = getShell();
  root.innerHTML = `
  <div class="overlay map-overlay">
    <header class="nav nav-map">
      <a class="brand" href="#/" aria-label="${CONFIG.PRODUCT}, home">${eclipseSVG()}<span>${CONFIG.PRODUCT}</span></a>
      <span class="spacer"></span>
      <span class="mono scope">MDA reference price (CENACE)</span>
    </header>
    <main class="map-main">
    <h1 class="sr">Map</h1>
    <aside class="panel" aria-label="Map controls">
      <div id="sel-slot"></div>
      <div class="mono lbl" id="metric-lbl">Colour nodes by</div>
      <div class="seg" role="radiogroup" aria-labelledby="metric-lbl" id="seg"></div>
      <p class="hint" id="hint"></p>
      <ul class="chips" id="chips" aria-label="Selection"></ul>
      <p class="live mono" id="say" role="status" aria-live="polite"></p>
      <a class="btn btn-cream btn-sm cont" id="cont" href="#/choose" aria-disabled="true">Continue</a>
      <div class="map-legend"><div class="ramp" id="ramp"></div><div class="lg mono" id="lg"></div><p class="lgnote" id="lgnote"></p></div>
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
    <div class="map-loading mono" id="map-loading" role="status">Loading nodes…</div>
    <div class="nogl" id="nogl" hidden><p>The map needs WebGL, which this browser has turned off. You can still search and select places on the left.</p></div>
    </main>
  </div>`;
  const q = (s) => root.querySelector(s);
  let dead = false;
  if (!shell.hasGL) { q('#nogl').hidden = false; q('.zoom').hidden = true; }
  shell.sayFn = (t) => { q('#say').textContent = t; };

  // metric switch
  const seg = q('#seg');
  METRIC_ORDER.forEach((k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.k = k; b.textContent = METRICS[k].short;
    b.addEventListener('click', () => setMetric(k));
    seg.append(b);
  });
  seg.addEventListener('keydown', (e) => {
    const i = METRIC_ORDER.indexOf(shell.metric);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const k = METRIC_ORDER[(i + d + METRIC_ORDER.length) % METRIC_ORDER.length];
    setMetric(k); seg.querySelector(`[data-k="${k}"]`).focus();
  });
  function setMetric(k) {
    const dom = shell.setMetric(k);
    seg.querySelectorAll('button').forEach((b) => { const on = b.dataset.k === k; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    q('#hint').textContent = `${METRICS[k].label} (${METRICS[k].unit}). ${METRICS[k].hint}.`;
    legend(dom || shell.domain());
  }
  function legend(dom) {
    q('#ramp').style.background = `linear-gradient(90deg, ${RAMP.dot}, ${RAMP.hi})`;
    const m = METRICS[shell.metric], lg = q('#lg'), note = q('#lgnote');
    if (shell.metric === 'rank') { lg.innerHTML = '<span>Last in region</span><span>#1 in region</span>'; note.textContent = ''; return; }
    if (!dom) return;
    const u = m.unit === 'no unit' ? '' : ` ${m.unit}`;
    lg.innerHTML = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${m.fmt(valueAt(dom, f))}</span>`).join('');
    note.textContent = `Colours are spread evenly across nodes (lightest = highest values), so the scale is not linear. Labels are real values${u ? ' in' + u : ''}: lowest, quarter, median, three quarters, highest.`;
  }

  // chips + continue
  const cont = q('#cont');
  const syncCont = (list) => {
    cont.setAttribute('aria-disabled', String(!list.length));
    cont.href = hrefFor('/choose', list, shell.store.real);
    cont.tabIndex = list.length ? 0 : -1;
  };
  cont.addEventListener('click', (e) => { if (cont.getAttribute('aria-disabled') === 'true') e.preventDefault(); });
  const chips = mountChips(q('#chips'), shell);
  const offSel = shell.store.subscribe(syncCont);
  syncCont(shell.store.get());

  // tooltip
  const tip = q('#tip');
  shell.hoverFn = (n, x, y) => {
    if (!n) { tip.hidden = true; return; }
    const r = (v, m) => (v == null ? '–' : `${METRICS[m].fmt(v)}<small> ${m === 'rank' || METRICS[m].unit === 'no unit' ? '' : METRICS[m].unit}</small>`);
    tip.innerHTML = `<b>${esc(n.name)}</b><span class="mono">${esc(n.id)} · ${esc(title(n.state))} · ${esc(title(n.region))}</span>`
      + (n.has ? `<table>${['pml', 'pcap', 'vf'].map((m) => `<tr><th class="mono">${METRICS[m].label}</th><td>${r(METRICS[m].get(n), m)}</td></tr>`).join('')}`
        + `<tr><th class="mono">${METRICS.rank.label}</th><td>${n.rank == null ? '–' : `#${n.rank}<small> of ${n.rankN}</small>`}</td></tr></table>`
        : '<span class="mono nod">No data in this window</span>');
    tip.hidden = false;
    const w = root.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.transform = `translate(${Math.min(w - tw - 8, x + 14)}px, ${Math.max(72, y - th - 10)}px)`;
  };

  q('#zin').addEventListener('click', () => shell.mv && shell.mv.zoomBy(1));
  q('#zout').addEventListener('click', () => shell.mv && shell.mv.zoomBy(-1));
  q('#zreset').addEventListener('click', () => shell.mv && shell.mv.reset());

  const loading = q('#map-loading');
  if (shell.mv || !shell.hasGL) loading.hidden = true;
  shell.dataReady().then(() => { if (!dead && !shell.mv) loading.textContent = 'Loading map…'; });
  setMetric(shell.metric);
  shell.init().then(() => {
    loading.hidden = true;
    if (dead || !q('#sel-slot')) return;
    if (shell.failed && !shell.atlas) { shell.say('Data failed to load.'); return; }
    q('#cfg').textContent = `${shell.atlas.config === 'tracker' ? 'Single-axis tracker' : shell.atlas.config} (only configuration in the analysis)`;
    const sel = createSelector({ entries: buildEntries(shell.geo, shell.atlas.nodes), onPick: (x) => shell.pick(x) });
    q('#sel-slot').append(sel.el);
    chips.refresh();
    if (shell.failed) q('#nogl').hidden = false;
    legend(shell.domain());
  });

  return { destroy() { dead = true; shell.hoverFn = null; shell.sayFn = null; offSel(); chips.destroy(); } };
}
