// Assumption sets chosen on the page. Pure (no DOM) except load/save, which use localStorage inside try/catch.
// 'deck'  = only the values the deck prints (LCOE 40 USD/MWh, FX 17.84, 1 MWp, tracker); everything else stays blank.
// 'mine'  = blank until the user types; complete sets unlock IRR / NPV / own LCOE / verdict (never REPSA-validated).
import { DECK_FX } from './finmodel.js';

export const KEY = 'nsv4:assumptions';
export const FIELDS = [
  { id: 'mwp', label: 'Plant size', unit: 'MWp', min: 0.1, step: 0.1, required: true },
  { id: 'capex_usd_kwp', label: 'Capex', unit: 'USD per kWp', min: 0, step: 10, required: true },
  { id: 'om_usd_kw_yr', label: 'O&M', unit: 'USD per kW-year', min: 0, step: 1, required: true },
  { id: 'rate_pct', label: 'Discount rate', unit: '% per year', min: 0, max: 40, step: 0.25, required: true },
  { id: 'infl_pct', label: 'Inflation (nominal basis only)', unit: '% per year', min: 0, max: 30, step: 0.25, required: 'nominal' },
  { id: 'life_yr', label: 'Plant life', unit: 'years', min: 5, max: 50, step: 1, required: true },
  { id: 'degr_pct', label: 'Degradation', unit: '% per year', min: 0, max: 5, step: 0.05, required: true },
  { id: 'fx', label: 'Exchange rate', unit: 'MXN per USD', min: 5, step: 0.01, required: true },
  { id: 'target_lcoe_usd', label: 'Target LCOE (optional)', unit: 'USD per MWh', min: 1, step: 1, required: false },
  { id: 'band_pct', label: 'Yellow band below cost', unit: '% of LCOE', min: 0, max: 50, step: 1, required: false },
];

export const DECK_SET = Object.freeze({ kind: 'deck', mwp: 1, mounting: 'tracker', capex_usd_kwp: null, om_usd_kw_yr: null, rate_pct: null, infl_pct: null,
  life_yr: null, degr_pct: null, fx: DECK_FX, target_lcoe_usd: 40, band_pct: 10 });
export const blankMine = () => ({ kind: 'mine', mwp: null, mounting: 'tracker', capex_usd_kwp: null, om_usd_kw_yr: null, rate_pct: null, infl_pct: null,
  life_yr: null, degr_pct: null, fx: null, target_lcoe_usd: null, band_pct: 10 });

const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(+v) ? null : +v);
export function sanitize(o) {
  const b = blankMine();
  const out = { ...b, kind: 'mine' };
  for (const f of FIELDS) {
    let v = num(o && o[f.id]);
    if (v !== null) { if (f.min !== undefined && v < f.min) v = f.min; if (f.max !== undefined && v > f.max) v = f.max; }
    out[f.id] = v;
  }
  if (out.band_pct === null) out.band_pct = 10;
  out.mounting = o && o.mounting === 'fixed' ? 'fixed' : 'tracker';
  return out;
}

/**
 * level: 'deck' (printed values only) | 'partial' (some fields, no complete financial set) | 'complete' (verdict allowed) | 'empty'.
 * missing: required fields still blank for the active price basis.
 */
export function status(set, nominal = false) {
  if (set.kind === 'deck') return { level: 'deck', missing: [], label: 'Deck scenario (the deck’s printed values only)' };
  const missing = FIELDS.filter((f) => f.required === true || (f.required === 'nominal' && nominal)).filter((f) => set[f.id] === null || set[f.id] === undefined).map((f) => f.id);
  const typed = FIELDS.some((f) => f.id !== 'band_pct' && set[f.id] !== null && set[f.id] !== undefined);
  if (!missing.length) return { level: 'complete', missing, label: 'My assumptions (complete, not validated by REPSA)' };
  if (!typed) return { level: 'empty', missing, label: 'My assumptions (blank)' };
  return { level: 'partial', missing, label: 'My assumptions (incomplete)' };
}

/** Threshold mode for universe tables: own LCOE per node (complete) or one target (deck / partial with target + FX). */
export function thresholdMode(set, nominal) {
  const st = status(set, nominal);
  if (st.level === 'complete') return { mode: 'own' };
  if (set.target_lcoe_usd !== null && set.fx !== null && set.target_lcoe_usd !== undefined && set.fx !== undefined) return { mode: 'target' };
  return { mode: null };
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify({ active: state.active, mine: state.mine })); return true; } catch (e) { return false; }
}
export function load() {
  const base = { active: 'deck', mine: blankMine() };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const o = JSON.parse(raw);
    return { active: o.active === 'mine' ? 'mine' : 'deck', mine: sanitize(o.mine) };
  } catch (e) { return base; }
}
export const activeSet = (state) => (state.active === 'mine' ? state.mine : DECK_SET);
