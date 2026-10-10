// Boot, global state (price basis, mounting, assumption set), navigation, lazy section init, service worker.
import { D, loadCore } from './data.js';
import { SchemaError } from './contract.js';
import { FinClient } from './finclient.js';
import * as P from './params.js';
import { store, $, $$, esc, debounce } from './util.js';
import { mesLargo } from './format.js';
import { renderMath } from './tex.js';
import { assumpBarHTML, assumpLabel } from './common.js';
import { bindSummary, initPrices, initExplorer, initRevenue, initVF } from './sec-story.js';
import { initMap, initGeography } from './sec-map.js';
import { initProfit, initPnl, initConclusions } from './sec-money.js';
import { initNode, initCompare } from './sec-node.js';
import { initAssumptions, initAssumpSection, initMethods, initSources } from './sec-meta.js';

const S = store({ real: true, cfg: 'tracker' });
let A = P.load();
const handlers = new Set();
const finCache = new Map();
let fin = null;

const ctx = {
  S, D,
  A: () => A,
  set: () => P.activeSet(A),
  status: () => P.status(P.activeSet(A), !S.get().real),
  label: () => assumpLabel(ctx),
  onRefresh(fn) { handlers.add(fn); },
  finEval(winId) {
    const set = P.activeSet(A), nominal = !S.get().real;
    const key = JSON.stringify([set, winId, nominal]);
    if (!finCache.has(key)) {
      if (finCache.size > 12) finCache.delete(finCache.keys().next().value);
      const winKey = { Y1: 'deck_2024_25', Y2: 'deck_2025_26' }[winId];
      finCache.set(key, fin.evaluate(set, winKey, nominal).then((r) => r || null));
    }
    return finCache.get(key);
  },
  setCfg(v) {
    S.set({ cfg: v });
    if (A.active === 'mine') A.mine.mounting = v;
    P.save(A); refreshChrome(); if (ctx.syncCfg) ctx.syncCfg(); if (ctx.onAssumpChange) ctx.onAssumpChange(); refresh();
  },
  setActive(v) { A.active = v; P.save(A); afterAssump(); },
  setField(id, raw) { A.mine = P.sanitize({ ...A.mine, [id]: raw }); A.mine.mounting = S.get().cfg; P.save(A); afterAssump(false); },
  clearMine() { A.mine = P.blankMine(); A.mine.mounting = S.get().cfg; P.save(A); afterAssump(); },
};
const refresh = debounce(() => { handlers.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); refreshChrome(); }, 70);
function afterAssump(redrawPanel = true) {
  if (redrawPanel && ctx.onAssumpChange) ctx.onAssumpChange();
  else if (ctx.onAssumpChange && document.activeElement && !document.activeElement.matches('#assump input')) ctx.onAssumpChange();
  refreshChrome(); refresh();
}
function refreshChrome() {
  const st = ctx.status(), real = S.get().real;
  const short = { deck: 'Deck scenario', partial: 'Mine · incomplete', complete: 'Mine · complete', empty: 'Mine · blank' }[st.level];
  $('#assump-badge').textContent = short;
  $('#rail-assump').innerHTML = `<b>${esc(short)}</b><br><span class="muted">${esc(st.label)}</span>`;
  $('#rail-basis').textContent = real ? "today's pesos" : 'nominal';
  $$('[data-assump-bar]').forEach((e) => { e.innerHTML = assumpBarHTML(ctx); });
}

/* ---------- banners ---------- */
function banner(msg, kind = 'warn') {
  const d = document.createElement('div'); d.className = `banner ${kind === 'bad' ? 'bad' : ''}`; d.setAttribute('role', kind === 'bad' ? 'alert' : 'status'); d.textContent = msg;
  $('#banners').appendChild(d);
}

/* ---------- navigation ---------- */
function buildNav() {
  const secs = $$('main .sec[data-title]');
  $('#rail-list').innerHTML = secs.map((s, i) => `<li><a href="#${s.id}" data-sec="${s.id}"><span class="n">${String(i).padStart(2, '0')}</span>${esc(s.dataset.title.replace('&amp;', '&'))}</a></li>`).join('');
  $('#chips').innerHTML = secs.map((s) => `<a href="#${s.id}" data-sec="${s.id}">${esc(s.dataset.title)}</a>`).join('');
  const links = $$('[data-sec]');
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) { links.forEach((a) => a.setAttribute('aria-current', String(a.dataset.sec === e.target.id))); const c = $(`#chips a[data-sec="${e.target.id}"]`); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', inline: 'center' }); } });
  }, { rootMargin: '-30% 0px -60% 0px' });
  secs.forEach((s) => io.observe(s));
}
const INIT = { prices: initPrices, explorer: initExplorer, revenue: initRevenue, vf: initVF, map: initMap, geography: initGeography, profit: initProfit, pnl: initPnl,
  conclusions: initConclusions, node: initNode, compare: initCompare, assumptions: initAssumpSection, methods: initMethods, sources: initSources };
function lazyInit() {
  const done = new Set();
  const run = async (el) => {
    const k = el.dataset.init; if (!k || done.has(k)) return; done.add(k);
    const t0 = performance.now();
    try { await INIT[k](ctx); } catch (e) { console.error(k, e); el.insertAdjacentHTML('beforeend', `<p class="callout bad">This section could not be drawn: ${esc(e.message)}</p>`); }
    (ctx.timings ||= {})[k] = performance.now() - t0;
    refreshChrome();
  };
  ctx.initSection = (id) => run(document.getElementById(id));
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); run(e.target); } }), { rootMargin: '600px 0px' });
  $$('[data-init]').forEach((s) => io.observe(s));
  // a deep link must initialise its section even if far below
  const hash = location.hash.slice(1);
  if (hash && document.getElementById(hash)) run(document.getElementById(hash));
}

/* ---------- drawer ---------- */
let lastFocus = null;
function openDrawer() {
  lastFocus = document.activeElement;
  $('#assump').hidden = false; $('#scrim').hidden = false; $('#open-assump').setAttribute('aria-expanded', 'true');
  const f = $('#assump').querySelector('button,input,select'); if (f) f.focus();
}
function closeDrawer() {
  $('#assump').hidden = true; $('#scrim').hidden = true; $('#open-assump').setAttribute('aria-expanded', 'false');
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

function wireGlobal() {
  $('#open-assump').addEventListener('click', () => ($('#assump').hidden ? openDrawer() : closeDrawer()));
  $('#close-assump').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#assump').hidden) closeDrawer(); });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open-assump],[data-add-compare],[data-open-explorer],[data-open-node],a[data-node]');
    if (!t) return;
    if (t.matches('[data-open-assump]')) { e.preventDefault(); openDrawer(); }
    else if (t.dataset.addCompare) { e.preventDefault(); ctx.initSection('compare').then(() => { ctx.addCompare(t.dataset.addCompare); document.getElementById('compare').scrollIntoView(); }); }
    else if (t.dataset.openExplorer) { e.preventDefault(); ctx.initSection('explorer').then(() => { ctx.setExplorer(t.dataset.openExplorer); document.getElementById('explorer').scrollIntoView(); }); }
    else if (t.dataset.openNode || t.dataset.node) { e.preventDefault(); const id = t.dataset.openNode || t.dataset.node; ctx.initSection('node').then(() => ctx.openNode(id)); }
  });
  $('#basis').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    $$('#basis button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    S.set({ real: b.dataset.v === 'real' });
    if (ctx.onAssumpChange) ctx.onAssumpChange();
    refreshChrome(); refresh();
  });
}

async function boot() {
  try { await loadCore(); } catch (e) {
    $('#main').insertAdjacentHTML('afterbegin', `<div class="banner bad" role="alert">${esc(e instanceof SchemaError ? e.message : `Could not load data/index.json (${e.message}).`)}</div>`);
    return;
  }
  D.warnings.forEach((w) => banner(w));
  S.set({ cfg: D.index.config_defecto || 'tracker' });
  if (A.active === 'mine') S.set({ cfg: A.mine.mounting });
  $('#basis-real').textContent = `Today's pesos (${mesLargo(D.index.pesos_reales.base_mes)})`;
  $('#foot-schema').textContent = D.index.schema_version; $('#foot-gen').textContent = (D.index.generated_at || '').slice(0, 10);
  $('#rail-data').textContent = `Data ${mesLargo(D.index.periodo_datos.desde)} – ${mesLargo(D.index.periodo_datos.hasta)}`;
  fin = new FinClient();
  buildNav(); wireGlobal(); bindSummary(ctx); initAssumptions(ctx); refreshChrome();
  ctx.onRefresh(() => bindSummary(ctx));
  lazyInit();
  renderMath(document.querySelector('main')).catch(() => {});
  registerSW();
  window.__nsv = ctx;
}
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
