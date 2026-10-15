// #/score: Solar Plant and Battery screening scores on the persistent map. Data (scores.json) is fetched only here.
import { CONFIG } from '../../config.js';
import { eclipseSVG } from './logo.js';
import { getShell } from './shell.js';
import { getJSON } from './json.js';
import { hrefFor } from './nav.js';
import { modelsOf, scoreNode, buildSearch, search, areaSummary } from './score-core.js';
import { INTRO, INTRO_BOTH, methodSolar, methodBat } from './score-copy.js';
import { nodeHTML, areaHTML, esc } from './score-detail.js';

const URL_SCORES = '../data/derived/scores.json';
// kept for the session: weights, model and strictness survive leaving the page (and Back/Forward remounts)
const S = { tab: 'solar', mode: null, W: null };
// deep link: /v2/?tab=bat#/score opens the Battery model (document query, so hash normalisation never drops it)
try { if (new URLSearchParams(location.search).get('tab') === 'bat') S.tab = 'bat'; } catch { /* default */ }

export function mountScore(root) {
  const shell = getShell(), store = shell.store;
  const list = store.get();
  const tab = (to, label, cur) => `<a data-to="${to}" href="${hrefFor(to, list, store.real, store.extras)}"${cur ? ' aria-current="page"' : ''}>${label}</a>`;
  root.innerHTML = `
  <div class="page analysis score">
    <header class="nav">
      <a class="brand" href="#/" aria-label="${CONFIG.PRODUCT}, home">${eclipseSVG()}<span>${CONFIG.PRODUCT}</span></a>
      <nav class="tabs mono" aria-label="Views">${tab('/explorer', 'Explorer')}${tab('/revenue', 'Revenue')}${tab('/score', 'Score', true)}</nav>
    </header>
    <main class="an-body sc-body">
      <p class="mono eyebrow">Score</p>
      <h1>Score</h1>
      <section class="sc-intro" aria-label="What the scores mean">
        <div class="seg sc-tabs" role="tablist" aria-label="Score model" id="sc-tabs">
          <button type="button" role="tab" id="tab-solar" data-t="solar" aria-controls="sc-panel">Solar Plant</button>
          <button type="button" role="tab" id="tab-bat" data-t="bat" aria-controls="sc-panel">Battery</button>
        </div>
        <dl class="sc-ent">${['solar', 'bat'].map((t) => `<div data-e="${t}"><dt class="mono">${INTRO[t].title}</dt><dd>${INTRO[t].text}</dd></div>`).join('')}</dl>
        <p class="sc-both">${INTRO_BOTH}</p>
        <span class="mono sc-draft">Draft copy</span>
      </section>
      <div class="xp-state loading" id="sc-state" role="status">Loading scores…</div>
      <div class="sc-grid" id="sc-panel" role="tabpanel" tabindex="-1">
        <aside class="sc-ctl" id="sc-ctl" aria-label="Search and weights"></aside>
        <div class="sc-map" id="sc-map">
          <div class="map-legend sc-legend"><div class="sc-ramp" aria-hidden="true"></div><div class="lg mono"><span>0</span><span>Score</span><span>80+</span></div><p class="lgnote"><span class="sc-nd" aria-hidden="true"></span> Not scored</p></div>
          <div class="zoom" role="group" aria-label="Map zoom"><button type="button" id="zin" aria-label="Zoom in">+</button><button type="button" id="zout" aria-label="Zoom out">−</button><button type="button" id="zreset" aria-label="Reset view">⌖</button></div>
          <div class="tip" id="sc-tip" hidden></div>
        </div>
        <aside class="sc-detail" id="sc-detail" aria-label="Detail" aria-live="polite"></aside>
      </div>
      <section class="method" id="sc-method" aria-label="How the score is built"></section>
    </main>
  </div>`;
  const q = (s) => root.querySelector(s);
  let dead = false, D = null, M = null, byId = new Map(), ents = [], scores = new Map(), geoNames = new Map();

  // ---- map stage: the persistent host is laid over the placeholder (CSS custom properties, never remounted)
  const mapEl = q('#sc-map'), host = shell.host;
  let lastW = 0;
  const place = () => {
    const r = mapEl.getBoundingClientRect();
    host.style.setProperty('--st-left', `${r.left + window.scrollX}px`); host.style.setProperty('--st-top', `${r.top + window.scrollY}px`);
    host.style.setProperty('--st-w', `${r.width}px`); host.style.setProperty('--st-h', `${r.height}px`);
    return r;
  };
  place();
  let refit = 0;
  const ro = new ResizeObserver(() => {
    const r = place();
    if (shell.mv) shell.mv.redraw();
    if (Math.abs(r.width - lastW) > 2) { lastW = r.width; clearTimeout(refit); refit = setTimeout(() => !dead && shell.fit(0), 150); }
  });
  ro.observe(q('.page')); ro.observe(mapEl);
  const mini = (id) => mapEl.querySelector(id);
  mini('#zin').onclick = () => shell.mv && shell.mv.zoomBy(1);
  mini('#zout').onclick = () => shell.mv && shell.mv.zoomBy(-1);
  mini('#zreset').onclick = () => shell.mv && shell.mv.reset();

  // ---- scores
  const model = () => M[S.tab], W = () => S.W[S.tab];
  const scoreOf = (n) => scoreNode(n, model(), W(), S.mode);
  const recompute = () => { scores = new Map(); D.nodes.forEach((n) => { const v = scoreOf(n); if (v != null) scores.set(n.id, v); }); if (shell.mv) shell.mv.setScores(scores); };
  const cur = () => store.get().filter((s) => s.kind !== 'national').slice(-1)[0] || null;

  // ---- detail card
  function detail() {
    const el = q('#sc-detail'), sel = cur();
    let h;
    if (sel && sel.kind === 'node') {
      const n = byId.get(sel.id), a = shell.byId.get(sel.id);
      h = n ? nodeHTML(model(), n, scores.get(n.id) ?? null, W())
        : `<p class="mono sc-k">${esc(sel.id)}</p><h2 class="sc-name">${esc(a ? a.name : sel.id)}</h2><p class="sub">This node is not in the score file.</p>`;
    } else {
      const lab = sel ? shell.label(sel) : { t: 'Mexico', k: 'National' };
      h = areaHTML(lab.t, lab.k, areaSummary(D.nodes, sel, (n) => scores.get(n.id) ?? null));
    }
    if (sel) h += '<button type="button" class="btn btn-ghost btn-sm" id="sc-clr">Back to national view</button>';
    el.innerHTML = h;
    const c = q('#sc-clr'); if (c) c.onclick = () => store.clear();
    el.querySelectorAll('.sc-hit').forEach((b) => { b.onclick = () => store.set([{ kind: 'node', id: b.dataset.id }]); });
  }

  // ---- controls: search, weights, strictness
  function controls() {
    const m = model(), w = W();
    q('#sc-ctl').innerHTML = `<label class="mono lbl" for="sc-q">Search nodes, states, regions</label>
      <div class="selector sc-search"><input id="sc-q" type="search" role="combobox" aria-expanded="false" aria-controls="sc-hits" aria-autocomplete="list" autocomplete="off" placeholder="Search a node, state or region"><ul id="sc-hits" role="listbox" aria-label="Results" hidden></ul></div>
      <div class="mono lbl" id="sc-wl">Weights · ${esc(m.title)}</div>
      <div class="sc-ws" role="group" aria-labelledby="sc-wl">${m.keys.map((k) => `<label class="sc-w"><span>${esc(m.names[k])}</span><input type="range" min="0" max="100" value="${Math.round(w[k] * 100)}" data-c="${k}" aria-label="${esc(m.names[k])} weight"><output>${Math.round(w[k] * 100)}</output></label>`).join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="sc-reset">Reset weights</button>
      <div class="mono lbl" id="sc-ml">Combination</div>
      <div class="seg sc-mode" role="radiogroup" aria-labelledby="sc-ml">
        <button type="button" role="radio" data-m="strict" aria-checked="${S.mode === 'strict'}">Strict</button>
        <button type="button" role="radio" data-m="linear" aria-checked="${S.mode === 'linear'}">Balanced</button></div>
      <p class="hint">${S.mode === 'strict' ? 'Weighted geometric mean: one weak component pulls the whole score down.' : 'Weighted average: strengths can offset weaknesses.'}</p>`;
    q('#sc-ctl').querySelectorAll('input[type=range]').forEach((i) => i.addEventListener('input', () => {
      S.W[S.tab][i.dataset.c] = i.value / 100; i.nextElementSibling.textContent = i.value; recompute(); detail();
    }));
    q('#sc-reset').onclick = () => { S.W[S.tab] = { ...m.W0 }; controls(); recompute(); detail(); };
    q('#sc-ctl').querySelectorAll('.sc-mode button').forEach((b) => { b.onclick = () => { S.mode = b.dataset.m; controls(); recompute(); detail(); }; });
    wireSearch();
  }

  function wireSearch() {
    const inp = q('#sc-q'), ul = q('#sc-hits');
    let hits = [], act = -1;
    const close = () => { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); act = -1; };
    const pick = (x) => { close(); inp.value = ''; store.set([{ kind: x.kind, id: x.id }]); };
    const mark = () => { ul.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === act))); if (act >= 0) inp.setAttribute('aria-activedescendant', `sc-h${act}`); };
    inp.addEventListener('input', () => {
      hits = search(ents, inp.value);
      if (!hits.length) { ul.innerHTML = inp.value.trim() ? '<li class="empty" role="presentation">No match</li>' : ''; ul.hidden = !inp.value.trim(); inp.setAttribute('aria-expanded', String(!ul.hidden)); return; }
      ul.innerHTML = hits.map((x, i) => { const s = x.kind === 'node' ? scores.get(x.id) : null;
        return `<li role="option" id="sc-h${i}" aria-selected="false" data-i="${i}"><span class="k mono">${x.kind}</span><span>${esc(x.label)}<br><span class="s">${esc(x.sub)}</span></span><b>${s == null ? '' : s.toFixed(0)}</b></li>`; }).join('');
      ul.hidden = false; act = -1; inp.setAttribute('aria-expanded', 'true');
    });
    ul.addEventListener('mousedown', (e) => { e.preventDefault(); const li = e.target.closest('li[data-i]'); if (li) pick(hits[+li.dataset.i]); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!hits.length || ul.hidden) return; e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; mark(); }
      else if (e.key === 'Enter') { const x = hits[act >= 0 ? act : 0]; if (!ul.hidden && x) { e.preventDefault(); pick(x); } }
      else if (e.key === 'Escape') close();
    });
    inp.addEventListener('blur', close);
  }

  // ---- model tabs and method
  function setTab(t, focus = false) {
    S.tab = t;
    root.querySelectorAll('#sc-tabs button').forEach((b) => { const on = b.dataset.t === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    q('#sc-panel').setAttribute('aria-labelledby', `tab-${t}`);
    root.querySelectorAll('.sc-ent > div').forEach((d) => d.classList.toggle('on', d.dataset.e === t));
    if (focus) q(`#tab-${t}`).focus();
    if (!D) return;
    controls(); recompute(); detail();
    q('#sc-method').innerHTML = t === 'bat' ? methodBat(D.bat_meta) : methodSolar(D.meta);
  }
  root.querySelectorAll('#sc-tabs button').forEach((b) => {
    b.addEventListener('click', () => setTab(b.dataset.t));
    b.addEventListener('keydown', (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); setTab(e.key === 'ArrowLeft' || e.key === 'Home' ? 'solar' : 'bat', true); } });
  });
  setTab(S.tab);

  // ---- selection and camera
  let busy = false;
  const onSel = (l) => {
    if (busy) return;
    const real = l.filter((s) => s.kind !== 'national');
    if (real.length > 1) { busy = true; store.set([real[real.length - 1]]); busy = false; return; } // one place at a time
    root.querySelectorAll('a[data-to]').forEach((a) => { a.href = hrefFor(a.dataset.to, store.get(), store.real, store.extras); });
    if (D) detail();
    const s = cur();
    if (!shell.mv) return;
    if (!s) shell.mv.reset(); else if (s.kind === 'node') { const n = shell.byId.get(s.id); if (n) shell.mv.flyToNode(n); } else shell.mv.flyToArea(s.kind, s.id);
  };
  const off = store.subscribe(onSel);
  onSel(store.get());

  // ---- tooltip
  const tip = q('#sc-tip');
  shell.hoverFn = (n, x, y) => {
    if (!n) { tip.hidden = true; return; }
    const s = scores.get(n.id);
    tip.textContent = `${n.name} · ${s == null ? 'not scored' : s.toFixed(0)}`;
    tip.style.left = `${x + 14}px`; tip.style.top = `${y + 14}px`; tip.hidden = false;
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
      D = d; M = modelsOf(d); byId = new Map(d.nodes.map((n) => [n.id, n]));
      if (!S.W) { S.W = { solar: { ...M.solar.W0 }, bat: { ...M.bat.W0 } }; }
      if (!S.mode) S.mode = d.meta.config.mode_default === 'linear' || d.meta.config.mode_default === 'balanced' ? 'linear' : 'strict';
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
      dead = true; off(); ro.disconnect(); clearTimeout(refit);
      shell.hoverFn = null;
      ['--st-left', '--st-top', '--st-w', '--st-h'].forEach((p) => host.style.removeProperty(p));
      if (shell.mv) shell.mv.setScores(null);
    },
  };
}
