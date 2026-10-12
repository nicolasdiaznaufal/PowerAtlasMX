// Assumption inputs inline at the top of Revenue (replaces the v1 drawer): Deck scenario | My assumptions, the same fields, validation
// (params.js sanitize) and localStorage key. Typing never rebuilds the field being edited.
import { FIELDS } from '../../../assets/js/params.js';
import { segment } from './controls.js';
import { state, statusOf, subscribe, setActive, setField, clearMine } from './assump.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pill = (t) => `<span class="pill" role="status">${esc(t)}</span>`;
export const statusPill = (st, mine) => (mine ? (st.level === 'complete' ? pill('Complete: the verdict is on, under your assumptions') : st.level === 'empty' ? pill('Blank: type your values') : pill(`Incomplete: ${st.missing.length} field${st.missing.length === 1 ? '' : 's'} missing`)) : pill('Deck scenario: coverage of the printed LCOE only, no verdict'));

export function mountAssumpInline(el, shell) {
  el.innerHTML = '<section class="xp-card assump-inline" aria-labelledby="ai-h"><div class="ai-head"><h2 class="mono" id="ai-h">Assumptions</h2><div class="seg" role="radiogroup" aria-label="Preset" id="ai-preset"></div><span id="ai-status"></span></div><div id="ai-body"></div></section>';
  const q = (s) => el.querySelector(s);
  const paint = () => {
    const A = state(), real = shell.store.real, nominal = !real, st = statusOf(real), mine = A.active === 'mine', miss = new Set(st.missing);
    q('#ai-status').innerHTML = statusPill(st, mine);
    const body = q('#ai-body');
    const typing = document.activeElement && body.contains(document.activeElement) && document.activeElement.matches('input[data-f]');
    if (typing) { body.querySelectorAll('.field').forEach((f) => f.classList.toggle('missing', miss.has(f.dataset.id))); return; }
    segment(q('#ai-preset'), [['deck', 'Deck scenario'], ['mine', 'My assumptions']], A.active, (k) => { setActive(k); const b = q('#ai-preset [aria-checked="true"]'); if (b) b.focus(); });
    if (!mine) {
      body.innerHTML = `<p class="fine">Deck scenario: LCOE 40 USD/MWh = 714 MXN/MWh at 17.84 MXN/USD, single-axis tracker, 1 MWp. Capex, O&amp;M, discount rate and life are not printed in the deck. REPSA's own assumptions are pending (<code>config/supuestos.yaml</code>); switch to <b>My assumptions</b> to type yours.</p>`;
      return;
    }
    body.innerHTML = `<div class="ai-grid">${FIELDS.filter((f) => !(f.id === 'infl_pct' && !nominal)).map((f) => {
      const need = f.required === true || (f.required === 'nominal' && nominal), lbl = f.id === 'rate_pct' ? `${nominal ? 'Nominal' : 'Real'} discount rate` : f.label.replace(' (optional)', '');
      return `<div class="field${need && miss.has(f.id) ? ' missing' : ''}" data-id="${f.id}"><label for="ai-${f.id}">${esc(lbl)}${need ? '' : ' <span class="muted">(optional)</span>'}</label>
        <input type="number" id="ai-${f.id}" data-f="${f.id}" inputmode="decimal" step="${f.step}" min="${f.min ?? ''}" ${f.max !== undefined ? `max="${f.max}"` : ''} value="${A.mine[f.id] ?? ''}" placeholder="${esc(f.unit)}"><small>${esc(f.unit)}</small></div>`; }).join('')}
      <div class="field"><label id="ai-mlbl">Mounting</label><div class="seg" role="radiogroup" aria-labelledby="ai-mlbl" id="ai-mount"></div><small>Same as the Mounting switch.</small></div></div>
      <div class="ai-foot"><button type="button" class="btn btn-ghost btn-sm" id="ai-clear">Clear my assumptions</button>
      <span class="fine">Price basis: <b>${nominal ? 'nominal' : "today's pesos"}</b>. ${nominal ? 'Enter a nominal rate and inflation.' : 'Enter a real rate; prices, capex and O&amp;M are constant pesos of the base month.'} Capex and O&amp;M are per kWp and kW. Saved in this browser only. Not validated by REPSA.</span></div>`;
    body.querySelectorAll('input[data-f]').forEach((i) => i.addEventListener('input', () => setField(i.dataset.f, i.value)));
    segment(q('#ai-mount'), [['tracker', 'Tracker'], ['fixed', 'Fixed']], A.mine.mounting, (k) => shell.store.setCfg(k === 'fixed' ? 'fijo' : 'tracker'));
    q('#ai-clear').addEventListener('click', () => clearMine());
  };
  paint();
  const off = subscribe(() => { if (!el.isConnected) return; paint(); });
  const offStore = shell.store.subscribe(() => { if (el.isConnected) paint(); });
  return { destroy() { off(); offStore(); } };
}
