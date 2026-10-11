// #/choose: two large cards (Explorer, Revenue). Keys 1 and 2. The map eases to the selection behind them.
import { CONFIG } from '../../config.js';
import { eclipseSVG } from './logo.js';
import { mountChips } from './chips.js';
import { getShell } from './shell.js';
import { hrefFor } from './nav.js';

export function mountChoose(root, { go }) {
  const shell = getShell();
  const sel = () => shell.store.get();
  root.innerHTML = `
  <div class="overlay choose">
    <header class="nav nav-map">
      <a class="brand" href="#/" aria-label="${CONFIG.PRODUCT}, home">${eclipseSVG()}<span>${CONFIG.PRODUCT}</span></a>
      <span class="spacer"></span>
      <a class="mono back" id="back" href="${hrefFor('/map', sel(), shell.store.real)}">← Change selection</a>
    </header>
    <main class="choose-body" aria-labelledby="ch-h">
      <h1 id="ch-h" class="mono">What do you want to see?</h1>
      <ul class="chips chips-row" id="chips" aria-label="Selection"></ul>
      <div class="cards">
        <a class="card" id="c-exp" href="${hrefFor('/explorer', sel(), shell.store.real)}"><span class="key mono">1</span><h2>Explorer</h2><p>Price through the day, captured price and value factor, month by month.</p></a>
        <a class="card" id="c-rev" href="${hrefFor('/revenue', sel(), shell.store.real)}"><span class="key mono">2</span><h2>Revenue</h2><p>Production times price, hour by hour, and what it adds up to per MWp.</p></a>
      </div>
    </main>
  </div>`;
  const chips = mountChips(root.querySelector('#chips'), shell, { removable: false });
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '1') go(hrefFor('/explorer', sel(), shell.store.real));
    else if (e.key === '2') go(hrefFor('/revenue', sel(), shell.store.real));
  };
  document.addEventListener('keydown', onKey);
  return { destroy() { document.removeEventListener('keydown', onKey); chips.destroy(); } };
}
