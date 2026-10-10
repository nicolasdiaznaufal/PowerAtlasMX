// v2 entry: hash router + transitions. One persistent map host (shell.js) is never remounted.
//   #/ landing -> #/map -> #/choose -> #/explorer | #/revenue   (selection in ?sel=)
import { renderLanding } from './assets/js/landing.js';
import { getShell, frames, reducedMotion } from './assets/js/shell.js';
import { parseHash, hrefFor } from './assets/js/nav.js';
import { parseSel, serializeSel } from './assets/js/store.js';

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
let cur = null, curPath = null, queue = Promise.resolve();

async function mount(path) {
  const fn = await LOADERS[path]();
  if (cur && cur.destroy) cur.destroy();
  view.innerHTML = '';
  cur = fn(view, { go }) || {};
}
const fade = (el, from, to, ms = 350) => el.animate([{ opacity: from, transform: `translateY(${from < to ? 8 : 0}px)` }, { opacity: to, transform: 'none' }], { duration: ms, easing: EASE }).finished.catch(() => {});

async function viewSwap(path, shell) {
  const mode = MODE[path];
  const update = async () => {
    await mount(path);
    shell.setMode(mode);
    if (shell.mv && (mode === 'mini' || path === '/map')) shell.fit(0);
    await frames(2);
  };
  if (reducedMotion()) await update();
  else if (document.startViewTransition) await document.startViewTransition(update).finished.catch(() => {});
  else { await update(); await fade(view, 0, 1); }
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

async function route() {
  const { path: raw, sel } = parseHash();
  const path = LOADERS[raw] ? raw : '/';
  const shell = getShell();
  if (sel) {
    const list = parseSel(sel);
    if (serializeSel(list) !== serializeSel(shell.store.get())) shell.store.set(list);
  }
  if (MODE[path] !== 'hidden' && path !== '/map' && !shell.store.get().length) { location.replace('#/map'); return; }
  if (path === curPath) return;
  const prev = curPath;
  curPath = path;
  document.title = { '/': 'PowerAtlasMx by REPSA Group', '/map': 'Map · PowerAtlasMx', '/choose': 'Choose · PowerAtlasMx', '/explorer': 'Explorer · PowerAtlasMx', '/revenue': 'Revenue · PowerAtlasMx' }[path];
  if (prev === null) {
    await mount(path); shell.setMode(MODE[path]);
    if (path === '/') (window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 1500 }) : (f) => setTimeout(f, 600))(() => shell.init());
    else shell.init().then(() => shell.fit(0, path === '/choose' ? 'choose' : null));
    return;
  }
  shell.init();
  if (prev === '/' && path === '/map') await portal(shell);
  else if (path === '/') await toLanding(shell);
  else await viewSwap(path, shell);
}

// keep the hash in sync with the selection on every route (replace, no history spam)
getShell().store.subscribe((list) => {
  if (!curPath || curPath === '/') return;
  history.replaceState(null, '', hrefFor(curPath, list));
});
window.addEventListener('hashchange', () => { queue = queue.then(route).catch(console.error); });
queue = queue.then(route).catch(console.error);
