// Assumptions drawer (v1 initAssumptions): Deck scenario | My assumptions, fields, mounting, clear. Opens from every [data-open-assump].
// State and storage are v1's params.js (localStorage key nsv4:assumptions). Mounting is the page's tracker / fixed-tilt switch.
import { FIELDS } from '../../../assets/js/params.js';
import { segment } from './controls.js';
import { state, statusOf, subscribe, setActive, setField, clearMine, setMounting } from './assump.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let installed = false, el = null, scrim = null, opener = null, shellRef = null;

const pill = (txt) => `<span class="pill" role="status">${esc(txt)}</span>`;
const statusHTML = (st, mine) => (mine ? (st.level === 'complete' ? pill('Complete: the verdict is on, under your assumptions') : st.level === 'empty' ? pill('Blank: type your values') : pill(`Incomplete: ${st.missing.length} field${st.missing.length === 1 ? '' : 's'} missing`)) : pill('Deck scenario: coverage of the printed LCOE only, no verdict'));

function paint() {
  if (!el) return;
  const A = state(), real = shellRef.store.real, nominal = !real, st = statusOf(real), mine = A.active === 'mine', miss = new Set(st.missing);
  const panel = el.querySelector('#as-panel');
  const keep = document.activeElement && panel.contains(document.activeElement) && document.activeElement.matches('input[data-f]') ? document.activeElement.dataset.f : null;
  if (keep) { // typing: refresh status and missing marks only, never the field being edited
    panel.querySelector('#as-status').innerHTML = statusHTML(st, mine);
    panel.querySelectorAll('.field').forEach((f) => { const id = f.dataset.id; if (id) f.classList.toggle('missing', miss.has(id)); });
    return;
  }
  panel.innerHTML = `<div class="seg" role="radiogroup" aria-label="Preset" id="as-preset" style="grid-template-columns:repeat(2,1fr)"></div>
    <p class="callout"><b>REPSA's own assumptions are pending</b> (<code>config/supuestos.yaml</code> is <code>PENDIENTE</code>). Nothing here is a validated REPSA value. A verdict appears only when you enter a complete set, and it is labelled <i>under your assumptions</i>.</p>
    <div id="as-status">${statusHTML(st, mine)}</div>
    ${mine ? '' : `<table class="as-deck"><tbody><tr><td>LCOE</td><td class="n">40 USD/MWh = 714 MXN/MWh</td></tr><tr><td>Exchange rate</td><td class="n">17.84 MXN/USD</td></tr>
      <tr><td>Mounting</td><td class="n">Single-axis tracker</td></tr><tr><td>Plant size</td><td class="n">1 MWp</td></tr><tr><td>Capex, O&amp;M, discount rate, life</td><td class="n">not printed in the deck</td></tr></tbody></table>
      <p class="fine">These are the values the deck prints; the project does not endorse them. Switch to <b>My assumptions</b> to enter your own.</p>`}
    ${mine ? `<div class="fields">${FIELDS.filter((f) => !(f.id === 'infl_pct' && !nominal)).map((f) => {
      const need = f.required === true || (f.required === 'nominal' && nominal), lbl = f.id === 'rate_pct' ? `${nominal ? 'Nominal' : 'Real'} discount rate` : f.label;
      return `<div class="field${need && miss.has(f.id) ? ' missing' : ''}" data-id="${f.id}"><label for="as-${f.id}">${esc(lbl)}${need ? '' : ' <span class="muted">(optional)</span>'}</label>
        <input type="number" id="as-${f.id}" data-f="${f.id}" inputmode="decimal" step="${f.step}" min="${f.min ?? ''}" ${f.max !== undefined ? `max="${f.max}"` : ''} value="${A.mine[f.id] ?? ''}" placeholder="${esc(f.unit)}">
        <small>${esc(f.unit)}</small></div>`; }).join('')}
      <div class="field"><label id="as-mlbl">Mounting</label><div class="seg" role="radiogroup" aria-labelledby="as-mlbl" id="as-mount" style="grid-template-columns:repeat(2,1fr)"></div><small>Coverage and map figures for areas are tracker-only; node figures follow this choice.</small></div></div>
      <p class="fine">Price basis: <b>${nominal ? 'nominal' : "today's pesos"}</b>. ${nominal ? 'Enter a nominal rate and inflation; O&amp;M escalates with inflation and the price is held flat in nominal pesos.' : 'Enter a real rate; prices, capex and O&amp;M are constant pesos of the base month.'} Capex and O&amp;M are per kWp and kW of the plant.</p>
      <button type="button" class="btn btn-ghost btn-sm" id="as-clear">Clear my assumptions</button>` : ''}
    <p class="fine">Saved in this browser only (localStorage). The Revenue page (plant economics and coverage) and the Explorer maps recompute live.</p>`;
  segment(panel.querySelector('#as-preset'), [['deck', 'Deck scenario'], ['mine', 'My assumptions']], A.active, (k) => { setActive(k); const b = panel.querySelector('#as-preset [aria-checked="true"]'); if (b) b.focus(); });
  panel.querySelectorAll('input[data-f]').forEach((i) => i.addEventListener('input', () => setField(i.dataset.f, i.value)));
  const m = panel.querySelector('#as-mount');
  if (m) segment(m, [['tracker', 'Tracker'], ['fixed', 'Fixed']], A.mine.mounting, (k) => { shellRef.store.setCfg(k === 'fixed' ? 'fijo' : 'tracker'); });
  const cl = panel.querySelector('#as-clear'); if (cl) cl.addEventListener('click', () => clearMine());
}

function open(from) {
  opener = from || document.activeElement;
  paint();
  el.hidden = false; scrim.hidden = false;
  requestAnimationFrame(() => { el.classList.add('is-open'); scrim.classList.add('is-open'); });
  el.querySelector('#close-assump').focus();
}
function close() {
  el.classList.remove('is-open'); scrim.classList.remove('is-open');
  const done = () => { el.hidden = true; scrim.hidden = true; };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else setTimeout(done, 460);
  if (opener && opener.isConnected) opener.focus();
}

export function installDrawer(shell) {
  shellRef = shell;
  if (installed) return;
  installed = true;
  el = document.createElement('aside');
  el.className = 'drawer'; el.id = 'assump'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'assump-h');
  el.innerHTML = '<div class="drawer-in"><header class="drawer-h"><h2 id="assump-h">Assumptions</h2><button type="button" class="btn btn-ghost btn-sm" id="close-assump">Close</button></header><div id="as-panel"></div></div>';
  scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.hidden = true;
  document.body.append(scrim, el);
  el.querySelector('#close-assump').addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (el.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...el.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  });
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-open-assump]'); if (b) { e.preventDefault(); open(b); } });
  subscribe(paint);
  // mounting follows the page switch (the page is the source: it is also in the URL)
  setMounting(shell.store.cfg);
  shell.store.subscribe(() => setMounting(shell.store.cfg));
}
