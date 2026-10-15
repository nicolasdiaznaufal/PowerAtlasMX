// Score view: left-card controls (search, weights, strictness, battery economics editor). Writes into the shared state S only;
// the view recomputes through the callbacks.
import { search } from './score-core.js';
import { esc } from './score-detail.js';
import { f } from './score-copy.js';

/** battery economics inputs: display units (percent for rates). */
export const ECON_FIELDS = [
  { k: 'power', label: 'Power equipment', unit: 'MXN/kW', min: 0, max: 50000, step: 100 },
  { k: 'energy', label: 'Cells', unit: 'MXN/kWh', min: 0, max: 50000, step: 100 },
  { k: 'om', label: 'O&M', unit: '% of capex per year', min: 0, max: 20, step: 0.1 },
  { k: 'life', label: 'Life', unit: 'years', min: 1, max: 40, step: 1 },
  { k: 'disc', label: 'Discount rate', unit: '%', min: 0, max: 30, step: 0.5 },
  { k: 'rte', label: 'Round-trip efficiency', unit: '%', min: 40, max: 100, step: 1 },
];
export const econDefaults = (bc) => ({ power: bc.cost.power_mxn_per_kw, energy: bc.cost.energy_mxn_per_kwh, om: bc.cost.om_pct_capex_yr,
  life: bc.cost.life_years, disc: Math.round(bc.cost.discount_rate * 1000) / 10, rte: Math.round(bc.rte * 1000) / 10 });
export const costOf = (E) => ({ power: E.power, energy: E.energy, om: E.om, life: E.life, disc: E.disc / 100 });

/** st: { model, W, mode, tab, E, E0, ents, scoreOf(id) }  cb: { weights(), mode(), econ(), reset(), econReset(), pick(x) } */
export function renderControls(el, st, cb) {
  const m = st.model, w = st.W;
  el.innerHTML = `<label class="mono lbl" for="sc-q">Search nodes, states, regions</label>
    <div class="selector sc-search"><input id="sc-q" type="search" role="combobox" aria-expanded="false" aria-controls="sc-hits" aria-autocomplete="list" autocomplete="off" placeholder="Search a node, state or region"><ul id="sc-hits" role="listbox" aria-label="Results" hidden></ul></div>
    <div class="sc-wh"><div class="mono lbl" id="sc-wl">Weights · ${esc(m.title)}</div><button type="button" class="sc-link" id="sc-reset">Reset weights</button></div>
    <div class="sc-ws" role="group" aria-labelledby="sc-wl">${m.keys.map((k) => `<label class="sc-w"><span>${esc(m.names[k])}</span><input type="range" min="0" max="100" value="${Math.round(w[k] * 100)}" data-c="${k}" aria-label="${esc(m.names[k])} weight"><output>${Math.round(w[k] * 100)}</output></label>`).join('')}</div>
    ${st.tab === 'bat' ? econHTML(st) : ''}
    <div class="mono lbl" id="sc-ml">Combination</div>
    <div class="seg sc-mode" role="radiogroup" aria-labelledby="sc-ml">
      <button type="button" role="radio" data-m="strict" aria-checked="${st.mode === 'strict'}">Strict</button>
      <button type="button" role="radio" data-m="linear" aria-checked="${st.mode === 'linear'}">Balanced</button></div>
    <p class="hint">${st.mode === 'strict' ? 'Weighted geometric mean: one weak component pulls the whole score down.' : 'Weighted average: strengths can offset weaknesses.'}</p>`;
  el.querySelectorAll('.sc-w input').forEach((i) => i.addEventListener('input', () => {
    st.W[i.dataset.c] = i.value / 100; i.nextElementSibling.textContent = i.value; cb.weights();
  }));
  el.querySelector('#sc-reset').onclick = cb.reset;
  el.querySelectorAll('.sc-mode button').forEach((b) => { b.onclick = () => { st.mode = b.dataset.m; cb.mode(); }; });
  if (st.tab === 'bat') wireEcon(el, st, cb);
  wireSearch(el, st, cb);
}

function econHTML(st) {
  return `<section class="sc-econ" role="group" aria-labelledby="sc-el"><div class="mono lbl" id="sc-el">Battery economics · editable</div>
    ${ECON_FIELDS.map((x) => `<label class="sc-e"><span>${x.label}<small>${x.unit}</small></span><input type="number" inputmode="decimal" data-k="${x.k}" min="${x.min}" max="${x.max}" step="${x.step}" value="${st.E[x.k]}"></label>`).join('')}
    <p class="hint" id="sc-esum" aria-live="polite"></p>
    <button type="button" class="btn btn-ghost btn-sm" id="sc-ereset">Reset economics</button></section>`;
}

/** one-line summary of the 4 h system under the current inputs (called by the view after every change) */
export function econSummary(el, E, econ) {
  const p = el && el.querySelector('#sc-esum');
  if (!p) return;
  const e = econ(null, 4, { power: E.power, energy: E.energy, om: E.om, life: E.life, disc: E.disc / 100 });
  p.textContent = `4-hour system: capex ${f(e.capex)} MXN/kW, annual cost ${f(e.annual)} MXN/kW-yr. Day-ahead prices only; costs are placeholders, not a quote.`;
}

function wireEcon(el, st, cb) {
  el.querySelectorAll('.sc-e input').forEach((i) => i.addEventListener('input', () => {
    const x = ECON_FIELDS.find((y) => y.k === i.dataset.k), v = i.value.trim() === '' ? NaN : Number(i.value);
    const ok = Number.isFinite(v) && v >= x.min && v <= x.max;
    i.setAttribute('aria-invalid', String(!ok));
    if (ok) { st.E[x.k] = v; cb.econ(); }
  }));
  el.querySelector('#sc-ereset').onclick = () => { Object.assign(st.E, st.E0); renderControls(el, st, cb); cb.econ(); };
}

function wireSearch(el, st, cb) {
  const inp = el.querySelector('#sc-q'), ul = el.querySelector('#sc-hits');
  let hits = [], act = -1;
  const close = () => { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); act = -1; };
  const pick = (x) => { close(); inp.value = ''; cb.pick(x); };
  const mark = () => { ul.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === act))); if (act >= 0) inp.setAttribute('aria-activedescendant', `sc-h${act}`); };
  inp.addEventListener('input', () => {
    hits = search(st.ents, inp.value);
    if (!hits.length) { ul.innerHTML = inp.value.trim() ? '<li class="empty" role="presentation">No match</li>' : ''; ul.hidden = !inp.value.trim(); inp.setAttribute('aria-expanded', String(!ul.hidden)); return; }
    ul.innerHTML = hits.map((x, i) => { const s = x.kind === 'node' ? st.scoreOf(x.id) : null;
      return `<li role="option" id="sc-h${i}" aria-selected="false" data-i="${i}"><span class="k mono">${x.kind}</span><span>${esc(x.label)}<br><span class="s">${esc(x.sub)}</span></span><b>${s == null ? '' : s.toFixed(0)}</b></li>`; }).join('');
    ul.hidden = false; act = -1; inp.setAttribute('aria-expanded', 'true');
  });
  ul.addEventListener('mousedown', (e) => { e.preventDefault(); const li = e.target.closest('li[data-i]'); if (li) pick(hits[+li.dataset.i]); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!hits.length || ul.hidden) return; e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; mark(); }
    else if (e.key === 'Enter') { const x = hits[act >= 0 ? act : 0]; if (!ul.hidden && x) { e.preventDefault(); pick(x); } }
    else if (e.key === 'Escape' && !ul.hidden) { e.stopPropagation(); close(); }
  });
  inp.addEventListener('blur', close);
}
