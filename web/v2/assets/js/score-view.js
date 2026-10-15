// #/score: Solar Plant and Battery screening scores over a full-bleed map. Data (scores.json) is fetched only here.
import { CONFIG } from '../../config.js';
import { eclipseSVG } from './logo.js';
import { getShell } from './shell.js';
import { getJSON } from './json.js';
import { hrefFor } from './nav.js';
import { mountChips } from './chips.js';
import { modelsOf, scoreNode, buildSearch, areaSummary, areaMedian, valueAtRte, econ } from './score-core.js';
import { INTRO, INTRO_BOTH, methodSolar, methodBat, f } from './score-copy.js';
import { nodeHTML, areaHTML, compareHTML, esc } from './score-detail.js';
import { renderControls, econDefaults, costOf, econSummary } from './score-panels.js';

const URL_SCORES = '../data/derived/scores.json';
const MAX_PLACES = 2;
const DESKTOP = 900;
// kept for the session: weights, model, strictness and battery inputs survive leaving the page (and Back/Forward remounts)
const S = { tab: 'solar', mode: null, W: null, E: null, E0: null };
// deep link: /v2/?tab=bat#/score opens the Battery model (document query, so hash normalisation never drops it)
try { if (new URLSearchParams(location.search).get('tab') === 'bat') S.tab = 'bat'; } catch { /* default */ }

export function mountScore(root) {
  const shell = getShell(), store = shell.store, list = store.get();
  const tab = (to, label, cur) => `<a data-to="${to}" href="${hrefFor(to, list, store.real, store.extras)}"${cur ? ' aria-current="page"' : ''}>${label}</a>`;
  const ent = (t) => `<button type="button" role="tab" id="tab-${t}" data-t="${t}" aria-controls="sc-stage"><span class="mono">${INTRO[t].title}</span><span class="sc-et">${INTRO[t].text}</span></button>`;
  root.innerHTML = `
  <div class="page analysis score">
    <header class="nav">
      <a class="brand" href="#/" aria-label="${CONFIG.PRODUCT}, home">${eclipseSVG()}<span>${CONFIG.PRODUCT}</span></a>
      <nav class="tabs mono" aria-label="Views">${tab('/explorer', 'Explorer')}${tab('/revenue', 'Revenue')}${tab('/score', 'Score', true)}</nav>
    </header>
    <main class="sc-main">
      <section class="sc-intro" aria-label="What the scores mean">
        <h1>Score</h1>
        <div class="sc-ents" role="tablist" aria-label="Score model" id="sc-tabs">${ent('solar')}${ent('bat')}</div>
        <p class="sc-both">${INTRO_BOTH} <span class="mono sc-draft">Draft copy</span></p>
      </section>
      <div class="xp-state loading" id="sc-state" role="status">Loading scores…</div>
      <div class="sc-stage" id="sc-stage" role="tabpanel">
        <div class="sc-mapbox" id="sc-map">
          <div class="map-legend sc-legend"><div class="sc-ramp" aria-hidden="true"></div><div class="lg mono"><span>0</span><span>Score</span><span>80+</span></div><p class="lgnote"><span class="sc-nd" aria-hidden="true"></span> Not scored</p></div>
          <div class="zoom" role="group" aria-label="Map zoom"><button type="button" id="zin" aria-label="Zoom in">+</button><button type="button" id="zout" aria-label="Zoom out">−</button><button type="button" id="zreset" aria-label="Reset view">⌖</button></div>
          <div class="tip" id="sc-tip" hidden></div>
        </div>
        <aside class="sc-float sc-left" aria-label="Selection, search and weights">
          <div class="sc-selbox"><ul class="chips" id="sc-chips" aria-label="Selected places (up to ${MAX_PLACES})"></ul><p class="hint" id="sc-selhint">Click a node or a state on the map, or search. Pick up to ${MAX_PLACES} to compare.</p><button type="button" class="btn btn-ghost btn-sm" id="sc-clear" hidden>Clear</button></div>
          <div class="sc-ctl" id="sc-ctl"></div>
        </aside>
        <aside class="sc-float sc-right" id="sc-detail" aria-label="Detail" aria-live="polite"></aside>
      </div>
      <section class="method" id="sc-method" aria-label="How the score is built"></section>
    </main>
  </div>`;
  const q = (s) => root.querySelector(s);
  let dead = false, D = null, M = null, byId = new Map(), scores = new Map(), ents = [];
  const ctx = { rte: null }; // battery efficiency for the model (fraction)

  // ---- stage: the persistent map host is laid over the map box (custom properties; never remounted)
  const stage = q('#sc-stage'), mapEl = q('#sc-map'), host = shell.host;
  let lastW = 0, refit = 0;
  const place = () => {
    if (window.innerWidth >= DESKTOP) { // full-bleed: the stage fills the viewport under the intro strip
      const top = stage.getBoundingClientRect().top + window.scrollY;
      stage.style.height = `${Math.max(520, window.innerHeight - top)}px`;
    } else stage.style.height = '';
    const r = mapEl.getBoundingClientRect();
    host.style.setProperty('--st-left', `${r.left + window.scrollX}px`); host.style.setProperty('--st-top', `${r.top + window.scrollY}px`);
    host.style.setProperty('--st-w', `${r.width}px`); host.style.setProperty('--st-h', `${r.height}px`);
    return r;
  };
  place();
  const ro = new ResizeObserver(() => {
    const r = place();
    if (shell.mv) shell.mv.redraw();
    if (Math.abs(r.width - lastW) > 2) { lastW = r.width; clearTimeout(refit); refit = setTimeout(() => !dead && shell.fit(0), 150); }
  });
  ro.observe(q('.page')); ro.observe(mapEl);
  q('#zin').onclick = () => shell.mv && shell.mv.zoomBy(1);
  q('#zout').onclick = () => shell.mv && shell.mv.zoomBy(-1);
  q('#zreset').onclick = () => shell.mv && shell.mv.reset();

  // ---- scores
  const model = () => M[S.tab];
  const bctx = () => ({ cost: costOf(S.E), rte: S.E.rte / 100 });
  const scoreOf = (n) => scoreNode(n, model(), S.W[S.tab], S.mode);
  const recompute = () => {
    ctx.rte = S.E.rte / 100;
    scores = new Map(); D.nodes.forEach((n) => { const v = scoreOf(n); if (v != null) scores.set(n.id, v); });
    if (shell.mv) shell.mv.setScores(scores);
  };
  const places = () => store.get().filter((s) => s.kind !== 'national');

  // ---- detail / compare card
  function itemOf(sel) {
    if (sel.kind === 'node') {
      const n = byId.get(sel.id), a = shell.byId.get(sel.id);
      return { label: n ? n.nombre : a ? a.name : sel.id, kind: `Node · ${sel.id}`, n: n || null, s: n ? scores.get(n.id) ?? null : null, missing: !n };
    }
    const lab = shell.label(sel), sum = areaSummary(D.nodes, sel, (n) => scores.get(n.id) ?? null);
    let extra = null;
    if (S.tab === 'bat') {
      const c = bctx(), v = areaMedian(D.nodes, sel, (n) => valueAtRte(n.bat, 4, c.rte));
      extra = [['Median 4 h value (per kW-year)', v == null ? 'n/a' : `MXN ${f(v)}`], ['Median 4 h revenue ÷ annual cost', v == null ? 'n/a' : `${econ(v, 4, c.cost).coverage.toFixed(2)}×`]];
    }
    return { label: lab.t, kind: lab.k, sum, extra, n: null, s: null };
  }
  function detail() {
    const el = q('#sc-detail'), pl = places().slice(-MAX_PLACES), c = bctx();
    let h = '';
    if (pl.length === 2) h = compareHTML(model(), pl.map(itemOf), S.W[S.tab], c);
    else if (pl.length === 1) {
      const it = itemOf(pl[0]);
      if (it.missing) h = `<p class="mono sc-k">${esc(pl[0].id)}</p><h2 class="sc-name">${esc(it.label)}</h2><p class="sc-nodata" role="note">This node is not in the score file.</p>`;
      else if (it.sum) h = areaHTML(it.label, it.kind, it.sum, it.extra);
      else h = nodeHTML(model(), it.n, it.s, S.W[S.tab], c);
    } else h = areaHTML('Mexico', 'National', areaSummary(D.nodes, null, (n) => scores.get(n.id) ?? null), itemOf({ kind: 'national' }).extra);
    if (pl.length) h += '<button type="button" class="btn btn-ghost btn-sm" id="sc-back">Back to national view</button>';
    el.innerHTML = h;
    const b = q('#sc-back'); if (b) b.onclick = () => store.clear();
    el.querySelectorAll('.sc-hit').forEach((x) => { x.onclick = () => store.set([...places().slice(-(MAX_PLACES - 1)), { kind: 'node', id: x.dataset.id }].slice(-MAX_PLACES)); });
  }

  // ---- left card: controls
  const st = () => ({ model: model(), W: S.W[S.tab], mode: S.mode, tab: S.tab, E: S.E, E0: S.E0, ents, scoreOf: (id) => scores.get(id) ?? null });
  const refresh = () => { recompute(); detail(); econSummary(q('#sc-ctl'), S.E, econ); };
  const cb = {
    weights: refresh, econ: refresh,
    mode: () => { drawControls(); refresh(); },
    reset: () => { S.W[S.tab] = { ...model().W0 }; drawControls(); refresh(); },
    pick: (x) => store.set([...places().slice(-(MAX_PLACES - 1)), { kind: x.kind, id: x.id }].slice(-MAX_PLACES)),
  };
  const drawControls = () => { renderControls(q('#sc-ctl'), st(), cb); econSummary(q('#sc-ctl'), S.E, econ); };

  // ---- model tabs and method
  function setTab(t, focus = false) {
    S.tab = t;
    root.querySelectorAll('#sc-tabs button').forEach((b) => { const on = b.dataset.t === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    stage.setAttribute('aria-labelledby', `tab-${t}`);
    if (focus) q(`#tab-${t}`).focus();
    if (!D) return;
    drawControls(); refresh();
    q('#sc-method').innerHTML = t === 'bat' ? methodBat(D.bat_meta) : methodSolar(D.meta);
  }
  root.querySelectorAll('#sc-tabs button').forEach((b) => {
    b.addEventListener('click', () => setTab(b.dataset.t));
    b.addEventListener('keydown', (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); setTab(e.key === 'ArrowLeft' || e.key === 'Home' ? 'solar' : 'bat', true); } });
  });
  setTab(S.tab);

  // ---- selection (max two places), chips, clear, camera
  const chips = mountChips(q('#sc-chips'), shell, { removable: true });
  let busy = false;
  const onSel = (l) => {
    if (busy) return;
    const pl = l.filter((s) => s.kind !== 'national');
    if (pl.length > MAX_PLACES) { busy = true; try { store.set(pl.slice(-MAX_PLACES)); } finally { busy = false; } return; } // a third replaces the oldest
    root.querySelectorAll('a[data-to]').forEach((a) => { a.href = hrefFor(a.dataset.to, store.get(), store.real, store.extras); });
    q('#sc-clear').hidden = !pl.length;
    q('#sc-selhint').hidden = pl.length > 0;
    if (D) detail();
    if (!shell.mv) return;
    const s = pl[pl.length - 1];
    if (!s) shell.mv.reset(); else if (pl.length === 2) shell.fit(500); else if (s.kind === 'node') { const n = shell.byId.get(s.id); if (n) shell.mv.flyToNode(n); } else shell.mv.flyToArea(s.kind, s.id);
  };
  const off = store.subscribe(onSel);
  q('#sc-clear').onclick = () => store.clear();
  const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && places().length) { store.clear(); } };
  document.addEventListener('keydown', onKey);
  shell.noneFn = () => { if (places().length) store.clear(); };
  onSel(store.get());

  // ---- tooltip
  const tip = q('#sc-tip');
  shell.hoverFn = (n, x, y) => {
    if (!n) { tip.hidden = true; return; }
    const s = scores.get(n.id);
    tip.textContent = `${n.name} · ${s == null ? 'not scored' : s.toFixed(0)}`;
    tip.style.left = `${Math.min(x + 14, mapEl.clientWidth - 160)}px`; tip.style.top = `${y + 14}px`; tip.hidden = false;
  };

  // ---- data (lazy: only when this route opens)
  const state = q('#sc-state');
  const fail = (e) => {
    const missing = /HTTP 404/.test(String(e && e.message));
    state.className = 'xp-state err'; state.hidden = false;
    state.innerHTML = missing ? 'Scores not built: run <code>pipeline/export_scores.py</code>.' : 'The scores could not be loaded. <button type="button" class="btn btn-ghost btn-sm" id="sc-retry">Try again</button>';
    const r = q('#sc-retry'); if (r) r.onclick = load;
    q('#sc-ctl').innerHTML = ''; q('#sc-detail').innerHTML = '';
  };
  async function load() {
    state.className = 'xp-state loading'; state.hidden = false; state.textContent = 'Loading scores…';
    try {
      const [d] = await Promise.all([getJSON(URL_SCORES), shell.dataReady()]);
      if (dead) return;
      D = d; M = modelsOf(d, ctx); byId = new Map(d.nodes.map((n) => [n.id, n]));
      if (!S.W) S.W = { solar: { ...M.solar.W0 }, bat: { ...M.bat.W0 } };
      if (!S.E0) { S.E0 = econDefaults(d.bat_meta.config); S.E = { ...S.E0 }; }
      if (!S.mode) S.mode = ['linear', 'balanced'].includes(d.meta.config.mode_default) ? 'linear' : 'strict';
      const states = shell.geo.states.features.map((x) => ({ key: x.properties.key, name: x.properties.name }));
      ents = buildSearch(d.nodes, states, shell.geo.regions.features.map((x) => x.properties.key));
      state.hidden = true;
      setTab(S.tab);
      shell.init().then(() => { if (!dead && shell.mv) { shell.mv.setScores(scores); shell.fit(0); } });
    } catch (e) { if (!dead) { console.error(e); fail(e); } }
  }
  load();

  return {
    destroy() {
      dead = true; off(); chips.destroy(); ro.disconnect(); clearTimeout(refit);
      document.removeEventListener('keydown', onKey);
      shell.hoverFn = null; shell.noneFn = null;
      ['--st-left', '--st-top', '--st-w', '--st-h'].forEach((p) => host.style.removeProperty(p));
      if (shell.mv) shell.mv.setScores(null);
    },
  };
}
