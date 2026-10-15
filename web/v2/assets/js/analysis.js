// #/explorer and #/revenue shell (placeholders until M4/M5): page on black, chips from the query, mini-map top right.
import { CONFIG } from '../../config.js';
import { eclipseSVG } from './logo.js';
import { mountChips } from './chips.js';
import { getShell } from './shell.js';
import { hrefFor } from './nav.js';
import { createSelector, buildEntries } from './selector.js';
import { MAX_SEL } from './store.js';
import { COPY } from './copy.js';
import { mountScope } from './scope.js';

export function mountAnalysis(root, { view, go }) {
  const shell = getShell();
  const c = COPY[view], other = view === 'explorer' ? 'revenue' : 'explorer';
  const list = shell.store.get();
  root.innerHTML = `
  <div class="page analysis">
    <header class="nav">
      <a class="brand" href="#/" aria-label="${CONFIG.PRODUCT}, home">${eclipseSVG()}<span>${CONFIG.PRODUCT}</span></a>
      <nav class="tabs mono" aria-label="Views">
        <a data-to="/explorer" href="${hrefFor('/explorer', list, shell.store.real, shell.store.extras)}" ${view === 'explorer' ? 'aria-current="page"' : ''}>Explorer</a>
        <a data-to="/revenue" href="${hrefFor('/revenue', list, shell.store.real, shell.store.extras)}" ${view === 'revenue' ? 'aria-current="page"' : ''}>Revenue</a>
        <a data-to="/score" href="${hrefFor('/score', list, shell.store.real, shell.store.extras)}">Score</a>
      </nav>
    </header>
    <main class="an-body">
      <p class="mono eyebrow">${c.title}</p>
      <h1>${c.title}</h1>
      <div class="an-layout">
        <aside class="an-side ${view === 'revenue' ? 'rev' : ''}" aria-label="Selection, controls and key indicators">
          <ul class="chips" id="chips" aria-label="Selection"></ul>
          <div class="add-row"><button type="button" class="btn btn-ghost btn-sm" id="add-btn" aria-expanded="false">+ Add</button><div id="add-slot"></div><p class="mono xp-scope" id="add-note" role="status"></p></div>
          <div id="scope"></div>
          <div id="an-side-view"></div>
        </aside>
        <div class="an-main" id="an-content"></div>
      </div>
      <footer class="credits mono">${COPY.credits}</footer>
      <p class="foot-btns"><a class="btn btn-ghost btn-sm" data-to="/${other}" href="${hrefFor('/' + other, list, shell.store.real, shell.store.extras)}">Open ${COPY[other].title}</a><a class="btn btn-ghost btn-sm" id="open-appendix" href="#/appendix" target="_blank" rel="noopener">Open appendix<span class="sr"> (opens in a new tab)</span></a></p>
    </main>
    <a class="mini-hit" data-to="/map" href="${hrefFor('/map', list, shell.store.real, shell.store.extras)}" aria-label="Back to the map"><span class="mono">Map</span></a>
  </div>`;
  const chips = mountChips(root.querySelector('#chips'), shell, { removable: true, focusable: true });
  const host = root.querySelector('#an-content');
  let child = null, dead = false;
  const mod = view === 'explorer' ? import('./explorer.js').then((m) => m.mountExplorer) : import('./revenue.js').then((m) => m.mountRevenue);
  const sideHost = root.querySelector('#an-side-view');
  let scope = null;
  shell.dataReady().then(() => { if (!dead) scope = mountScope(root.querySelector('#scope'), shell); });
  mod.then((mount) => { if (!dead) child = mount(host, { shell, side: sideHost }); });
  // keep tab / map links in step with the price basis (it lives in the URL as &real=1)
  const links = () => {
    const l = shell.store.get(), r = shell.store.real;
    root.querySelectorAll('a[data-to]').forEach((a) => { a.href = hrefFor(a.dataset.to, l, r, shell.store.extras); });
  };
  const addBtn = root.querySelector('#add-btn'), addSlot = root.querySelector('#add-slot'), addNote = root.querySelector('#add-note');
  let selector = null;
  const syncAdd = (l) => {
    const full = l.length >= MAX_SEL;
    addBtn.disabled = full;
    addNote.textContent = full ? `Up to ${MAX_SEL} slots. Remove one to add another.` : '';
    if (full && selector) { selector.el.hidden = true; addBtn.setAttribute('aria-expanded', 'false'); }
  };
  addBtn.addEventListener('click', async () => {
    await shell.dataReady();
    if (dead || !shell.atlas) return;
    if (!selector) {
      selector = createSelector({ entries: buildEntries(shell.geo, shell.atlas.nodes), id: 'add', onPick: (x) => { shell.pick(x); selector.el.hidden = true; addBtn.setAttribute('aria-expanded', 'false'); addBtn.focus(); } });
      selector.el.hidden = true; // opened by the toggle below
      addSlot.append(selector.el);
    }
    selector.el.hidden = !selector.el.hidden;
    addBtn.setAttribute('aria-expanded', String(!selector.el.hidden));
    if (!selector.el.hidden) selector.input.focus();
  });
  const sideEl = root.querySelector('.an-side');
  const onSel = (l) => {
    links(); syncAdd(l); sideEl.classList.toggle('multi', l.length > 1);
    if (!l.length) { go(hrefFor('/map', [], shell.store.real, shell.store.extras)); return; }
    shell.fit(500); // mini-map follows the selection
  };
  syncAdd(shell.store.get());
  sideEl.classList.toggle('multi', shell.store.get().length > 1);
  const offLinks = shell.store.subscribe(onSel);
  return { destroy() { dead = true; offLinks(); chips.destroy(); if (child) child.destroy(); if (scope) scope.destroy(); } };
}
