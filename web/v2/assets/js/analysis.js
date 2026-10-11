// #/explorer and #/revenue shell (placeholders until M4/M5): page on black, chips from the query, mini-map top right.
import { CONFIG } from '../../config.js';
import { eclipseSVG } from './logo.js';
import { mountChips } from './chips.js';
import { getShell } from './shell.js';
import { hrefFor } from './nav.js';

const COPY = {
  explorer: { name: 'Explorer', note: 'Price profile, headline tiles and monthly value factor arrive in the next milestone.' },
  revenue: { name: 'Revenue', note: 'Hour-by-hour production times price and revenue per MWp arrive in a later milestone.' },
};

export function mountAnalysis(root, { view }) {
  const shell = getShell();
  const c = COPY[view], other = view === 'explorer' ? 'revenue' : 'explorer';
  const list = shell.store.get();
  root.innerHTML = `
  <div class="page analysis">
    <header class="nav">
      <a class="brand" href="#/" aria-label="${CONFIG.PRODUCT}, home">${eclipseSVG()}<span>${CONFIG.PRODUCT}</span></a>
      <nav class="tabs mono" aria-label="Views">
        <a href="${hrefFor('/explorer', list)}" ${view === 'explorer' ? 'aria-current="page"' : ''}>Explorer</a>
        <a href="${hrefFor('/revenue', list)}" ${view === 'revenue' ? 'aria-current="page"' : ''}>Revenue</a>
      </nav>
    </header>
    <main class="an-body">
      <p class="mono eyebrow">${c.name}</p>
      <h1>${c.name}</h1>
      <ul class="chips chips-row" id="chips" aria-label="Selection"></ul>
      <div id="an-content"></div>
      <p><a class="btn btn-ghost btn-sm" href="${hrefFor('/' + other, list)}">Open ${COPY[other].name}</a></p>
    </main>
    <a class="mini-hit" href="${hrefFor('/map', list)}" aria-label="Back to the map"><span class="mono">Map</span></a>
  </div>`;
  const chips = mountChips(root.querySelector('#chips'), shell, { removable: false });
  const host = root.querySelector('#an-content');
  let child = null, dead = false;
  if (view === 'explorer') import('./explorer.js').then((m) => { if (!dead) child = m.mountExplorer(host, { shell }); });
  else host.innerHTML = `<p class="an-note">${c.note}</p>`;
  return { destroy() { dead = true; chips.destroy(); if (child) child.destroy(); } };
}
