// Assumption sets (v1 params.js, same localStorage key and shape). One module-level state shared by the Revenue cards and the drawer.
import * as P from '../../../assets/js/params.js';
import { num } from '../../../assets/js/format.js';

let A = P.load();
const subs = new Set();
const emit = () => subs.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

export const state = () => A;
export const activeSet = () => P.activeSet(A);
export const statusOf = (real) => P.status(P.activeSet(A), !real);
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export function setActive(v) { A = { ...A, active: v === 'mine' ? 'mine' : 'deck' }; P.save(A); emit(); }
export function setField(id, raw) { A = { ...A, mine: P.sanitize({ ...A.mine, [id]: raw, mounting: A.mine.mounting }) }; P.save(A); emit(); }
export function clearMine() { A = { ...A, mine: { ...P.blankMine(), mounting: A.mine.mounting } }; P.save(A); emit(); }
/** mounting follows the page toggle ('tracker' | 'fijo' there, 'tracker' | 'fixed' here). */
export function setMounting(cfg) {
  const m = cfg === 'fijo' || cfg === 'fixed' ? 'fixed' : 'tracker';
  if (A.mine.mounting === m) return;
  A = { ...A, mine: { ...A.mine, mounting: m } }; P.save(A); emit();
}

export const TAG = { deck: 'Deck scenario', partial: 'Your assumptions (incomplete)', complete: 'Your assumptions', empty: 'Your assumptions (blank)' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** the strip shown above every economics card: active set, key values, price basis, Edit. */
export function assumpBarHTML(real) {
  const st = statusOf(real), set = activeSet(), parts = [];
  if (set.target_lcoe_usd != null) parts.push(`target LCOE ${num(set.target_lcoe_usd, 0)} USD/MWh`);
  if (set.fx != null) parts.push(`FX ${num(set.fx, 2)}`);
  if (set.capex_usd_kwp != null) parts.push(`capex ${num(set.capex_usd_kwp, 0)} USD/kWp`);
  if (set.rate_pct != null) parts.push(`${real ? 'real' : 'nominal'} rate ${num(set.rate_pct, 2)}%`);
  return `<span class="mono tag">${esc(TAG[st.level])}</span><span>${esc(parts.join(' · ') || 'no values entered')}</span>
    <span class="muted">${real ? "Today's pesos" : 'Nominal pesos'}</span>
    ${st.level === 'deck' ? '<span class="muted">Only the deck’s printed values; no verdict.</span>' : ''}`;
}

let bound = false;
/** mounting follows the page's tracker / fixed-tilt switch (the page is the source: it is also in the URL). Idempotent. */
export function bindMounting(shell) {
  if (bound) return;
  bound = true;
  setMounting(shell.store.cfg);
  shell.store.subscribe(() => setMounting(shell.store.cfg));
}
