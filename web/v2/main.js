// v2 entry: hash router + transitions. One persistent map host (shell.js) is never remounted.
//   #/ landing -> #/map -> #/choose -> #/explorer | #/revenue   (selection in ?sel=)
import { renderLanding } from './assets/js/landing.js';
import { getShell, frames, reducedMotion } from './assets/js/shell.js';
import { createRouter } from './assets/js/route-logic.js';

const view = document.getElementById('view');
const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const MODE = { '/': 'hidden', '/map': 'full', '/choose': 'full', '/explorer': 'mini', '/revenue': 'mini' };
const LOADERS = {
  '/': async () => renderLanding,
  '/map': async () => (await import('./assets/js/map-page.js')).mountMap,
  '/choose': async () => (await import('./assets/js/choose.js')).mountChoose,
  '/explorer': async () => { const m = (await import('./assets/js/analysis.js')).mountAnalysis; return (r, o) => m(r, { ...o, view: 'explorer' }); },
  '/revenue': async () => { const m = (await import('./assets/js/analysis.js')).mountAnalysis; return (r, o) => m(r, { ...o, view: 'revenue' }); },
};
const go = (href) => { location.hash = href; };
let cur = null, queue = Promise.resolve();
const live = document.getElementById('live');
const NAMES = { '/': 'Home', '/map': 'Map', '/choose': 'Choose a view', '/explorer': 'Explorer', '/revenue': 'Revenue' };


async function mount(path) {
  const fn = await LOADERS[path]();
  if (cur && cur.destroy) cur.destroy();
  view.innerHTML = '';
  cur = fn(view, { go }) || {};
}
const fade = (el, from, to, ms = 350) => el.animate([{ opacity: from, transform: `translateY(${from < to ? 8 : 0}px)` }, { opacity: to, transform: 'none' }], { duration: ms, easing: EASE }).finished.catch(() => {});

/** transform FLIP of the map host from its old rect to its new rect (fallback when view transitions are missing). */
function flip(host, first) {
  const last = host.getBoundingClientRect();
  if (!first.width || !last.width) return Promise.resolve();
  const dx = first.left - last.left, dy = first.top - last.top, sx = first.width / last.width, sy = first.height / last.height;
  return host.animate([{ transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: 'top left', transform: 'none' }],
    { duration: 450, easing: EASE }).finished.catch(() => {});
}

async function viewSwap(path, shell) {
  const mode = MODE[path];
  const first = shell.host.getBoundingClientRect();
  const wasHidden = shell.host.classList.contains('is-hidden');
  const update = async () => {
    await mount(path);
    shell.setMode(mode);
    if (shell.mv && (mode === 'mini' || path === '/map')) shell.fit(0);
    await frames(2);
  };
  if (reducedMotion()) await update();
  else if (document.startViewTransition) await document.startViewTransition(update).finished.catch(() => {});
  else {
    await update();
    await Promise.all([fade(view, 0, 1), wasHidden ? null : flip(shell.host, first)]);
  }
  if (shell.mv) shell.mv.redraw(); // deck resize at the end of the morph
  if (path === '/choose' && shell.mv) shell.fit(700, 'choose');
}

/** landing -> map: the hero sun scales up as a portal while the map fades in underneath. */
async function portal(shell) {
  shell.setMode('full');
  await Promise.race([shell.init(), new Promise((r) => setTimeout(r, 1500))]);
  if (shell.mv) shell.fit(0);
  const land = view.querySelector('.landing'), sun = view.querySelector('#sun');
  if (!reducedMotion() && land && sun) {
    const o = { duration: 600, easing: EASE };
    shell.host.animate([{ opacity: 0 }, { opacity: 1 }], o);
    sun.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(2.8)', opacity: 0 }], o);
    await land.animate([{ opacity: 1 }, { opacity: 0 }], { ...o, delay: 0 }).finished.catch(() => {});
  }
  await mount('/map');
}

async function toLanding(shell) {
  await mount('/');
  const land = view.querySelector('.landing');
  if (!reducedMotion() && land) await fade(land, 0, 1, 450);
  shell.setMode('hidden');
}

const router = createRouter({
  store: getShell().store,
  valid: () => {
    const sh = getShell();
    if (!sh.atlas || !sh.geo) return null;
    const ids = new Set(sh.atlas.nodes.map((n) => n.id));
    const st = new Set(sh.geo.states.features.map((f) => f.properties.key));
    const rg = new Set(sh.geo.regions.features.map((f) => f.properties.key));
    return { node: (id) => ids.has(id), state: (k) => st.has(k), region: (k) => rg.has(k) };
  },
  replace: (h) => history.replaceState(null, '', h),
  currentHash: () => location.hash,
});

/** move focus to the page heading and announce the route (never while the user is typing). */
function announce(path) {
  const t = NAMES[path];
  document.title = path === '/' ? 'PowerAtlasMx by REPSA Group' : `${t} · PowerAtlasMx`;
  if (live) { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 50); }
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  const h = view.querySelector('h1') || view.querySelector('main');
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
}

async function route() {
  const shell = getShell();
  if (/^#\/(map|choose|explorer|revenue)\?.*sel=/.test(location.hash)) await shell.dataReady(); // ids are validated against atlas + geometry only
  const { path, prev, changed } = router.resolve(location.hash);
  if (prev !== null && !changed) { // same route, other selection (Back/Forward between entries)
    if (path !== '/map' && path !== '/') await mount(path);
    if (path === '/choose' && shell.mv) shell.fit(700, 'choose');
    announce(path);
    return;
  }
  if (prev === null) {
    await mount(path); shell.setMode(MODE[path]);
    if (path === '/') (window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 1500 }) : (f) => setTimeout(f, 600))(() => { shell.init(); import('./assets/js/explorer-data.js').then((m) => m.prefetch()); });
    else shell.init().then(() => shell.fit(0, path === '/choose' ? 'choose' : null));
    announce(path);
    return;
  }
  shell.init();
  if (prev === '/' && path === '/map') await portal(shell);
  else if (path === '/') await toLanding(shell);
  else await viewSwap(path, shell);
  announce(path);
}

window.addEventListener('hashchange', () => { queue = queue.then(route).catch(console.error); });
queue = queue.then(route).catch(console.error);
