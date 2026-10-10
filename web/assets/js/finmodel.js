// Browser finance model (pure, no DOM). Everything per MWp unless stated. Documented in TECNICO-style LaTeX on the page
// (section "Formulas used in this browser") and unit-tested against analysis.json deck-scenario figures.
//
//   E_t     = Y_f (1 - d)^(t-1)                               annual energy, MWh/MWp, t = 1..T
//   OM_t    = OM_1 (1 + pi)^(t-1)   (nominal basis)  |  OM_1 (real basis)
//   CF_0    = -CAPEX ,  CF_t = P E_t - OM_t                    P = captured price, flat in the active price basis
//   NPV     = sum_t CF_t (1+i)^-t        IRR: NPV(IRR) = 0
//   LCOE    = (CAPEX + sum_t OM_t (1+i)^-t) / (sum_t E_t (1+i)^-t)     = break-even PPA (flat price)
//   VF_req  = LCOE / PML_avg  ,  PML_base,BE = LCOE / VF           break-even base price
//   margin  = P - LCOE  (MXN/MWh)       annual margin = E_1 (P - LCOE) only when d = 0 (otherwise use NPV)

/** Deck-printed MXN thresholds at FX 17.84 (the deck prints 714 and 357, not 713.6 and 356.8). */
export const DECK_FX = 17.84;
export const DECK_PRINTED_MXN = { 20: 357, 40: 714 };
export function usdToMxn(usd, fx) {
  if (usd === null || usd === undefined || fx === null || fx === undefined) return null;
  if (Math.abs(fx - DECK_FX) < 1e-9 && DECK_PRINTED_MXN[usd] !== undefined) return DECK_PRINTED_MXN[usd];
  return usd * fx;
}

const ok = (v) => v !== null && v !== undefined && Number.isFinite(v);

export function npv(rate, cf) { let s = 0; for (let t = 0; t < cf.length; t++) s += cf[t] / (1 + rate) ** t; return s; }

/** IRR by bisection on (-0.99, 10]; null unless the flows change sign exactly once. */
export function irr(cf) {
  let changes = 0;
  for (let i = 1; i < cf.length; i++) if (Math.sign(cf[i]) !== 0 && Math.sign(cf[i - 1]) !== 0 && Math.sign(cf[i]) !== Math.sign(cf[i - 1])) changes++;
  if (changes !== 1) return null;
  let lo = -0.99, hi = 10, flo = npv(lo, cf);
  const fhi = npv(hi, cf);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid, cf);
    if (fm * flo > 0) { lo = mid; flo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Cost side per MWp from an assumption set. Returns {capex, om1} in MXN, or null if incomplete. */
export function costs(p) {
  if (![p.capex_usd_kwp, p.om_usd_kw_yr, p.fx].every(ok)) return null;
  return { capex: p.capex_usd_kwp * 1000 * p.fx, om1: p.om_usd_kw_yr * 1000 * p.fx };
}

/** Annual vectors for t = 1..T: energy (MWh/MWp) and O&M (MXN/MWp). */
export function schedule(p, yf, nominal) {
  const T = Math.round(p.life_yr), d = (p.degr_pct || 0) / 100, pi = nominal ? (p.infl_pct || 0) / 100 : 0;
  const c = costs(p);
  const E = [], OM = [];
  for (let t = 1; t <= T; t++) { E.push(yf * (1 - d) ** (t - 1)); OM.push(c.om1 * (1 + pi) ** (t - 1)); }
  return { E, OM, capex: c.capex, T };
}

/** Levelized cost (MXN/MWh) for a node/area with annual yield yf (MWh/MWp). */
export function lcoeOwn(p, yf, nominal) {
  if (!ok(yf) || yf <= 0 || !ok(p.rate_pct) || !ok(p.life_yr) || !costs(p)) return null;
  const i = p.rate_pct / 100, { E, OM, capex } = schedule(p, yf, nominal);
  let num = capex, den = 0;
  for (let t = 1; t <= E.length; t++) { const v = (1 + i) ** -t; num += OM[t - 1] * v; den += E[t - 1] * v; }
  return den > 0 ? num / den : null;
}

/**
 * Full evaluation of one place. in: {pcap, pml, vf, yf} (MXN/MWh in the active basis, yield MWh/MWp-year).
 * Returns {lcoe, margin, vfReq, beBase, npvMwp, npvTotal, irr, ...}; fields stay null when an input is missing.
 */
export function evaluate(p, inp, nominal) {
  const out = { lcoe: null, margin: null, vfReq: null, beBase: null, npvMwp: null, npvTotal: null, irr: null, annualRevenue: null, annualMargin: null, energy: null };
  const complete = ok(p.rate_pct) && ok(p.life_yr) && costs(p) && ok(p.degr_pct);
  if (complete && ok(inp.yf) && ok(inp.pcap)) {
    const i = p.rate_pct / 100, { E, OM, capex } = schedule(p, inp.yf, nominal);
    const cf = [-capex];
    for (let t = 1; t <= E.length; t++) cf.push(inp.pcap * E[t - 1] - OM[t - 1]);
    out.lcoe = lcoeOwn(p, inp.yf, nominal);
    out.npvMwp = npv(i, cf);
    out.irr = irr(cf);
    const mwp = ok(p.mwp) ? p.mwp : 1;
    out.npvTotal = out.npvMwp * mwp;
    out.annualRevenue = inp.pcap * E[0] * mwp;
    out.annualMargin = cf[1] * mwp;      // year-1 cash flow after O&M
    out.energy = E[0] * mwp;
  } else if (ok(p.target_lcoe_usd) && ok(p.fx)) {
    out.lcoe = usdToMxn(p.target_lcoe_usd, p.fx);
    if (ok(inp.yf)) { const mwp = ok(p.mwp) ? p.mwp : 1; out.energy = inp.yf * mwp; out.annualRevenue = ok(inp.pcap) ? inp.pcap * inp.yf * mwp : null; }
  }
  if (out.lcoe !== null && ok(inp.pcap)) out.margin = inp.pcap - out.lcoe;
  if (out.lcoe !== null && ok(inp.pml) && inp.pml > 0) out.vfReq = out.lcoe / inp.pml;
  if (out.lcoe !== null && ok(inp.vf) && inp.vf > 0) out.beBase = out.lcoe / inp.vf;
  return out;
}

/** Traffic light from the margin: green covers the cost, yellow is within `band` of it, red is further below. null = no verdict. */
export function verdict(lcoe, pcap, bandPct = 10) {
  if (!ok(lcoe) || !ok(pcap) || lcoe <= 0) return null;
  if (pcap >= lcoe) return 'ok';
  return pcap >= lcoe * (1 - (bandPct || 0) / 100) ? 'warn' : 'bad';
}

/**
 * Whole-universe evaluation over analysis_nodos columns. cols: {pcap[], pml[], vf[], yf[], region[], entidad[]} (null = not in universe).
 * mode 'own'   -> LCOE per node from its own yield;  'target' -> one threshold (MXN/MWh) for everybody.
 * Returns national / region / state aggregates and per-node margin and lcoe arrays (Float32Array, NaN = no data).
 */
export function evaluateUniverse(p, cols, { nominal = false, mode = 'target', thresholdMxn = null } = {}) {
  const N = cols.pcap.length;
  const margin = new Float32Array(N).fill(NaN), lcoe = new Float32Array(N).fill(NaN);
  const acc = (store, key) => (store[key] ||= { n: 0, cov: 0, sumP: 0, sumL: 0, sumM: 0, sumVf: 0, sumPml: 0, sumYf: 0 });
  const agg = { national: { n: 0, cov: 0, sumP: 0, sumL: 0, sumM: 0, sumVf: 0, sumPml: 0, sumYf: 0 }, region: {}, state: {} };
  for (let i = 0; i < N; i++) {
    const P = cols.pcap[i];
    if (!ok(P)) continue;
    const L = mode === 'own' ? lcoeOwn(p, cols.yf[i], nominal) : thresholdMxn;
    if (!ok(L)) continue;
    lcoe[i] = L; margin[i] = P - L;
    const cov = P >= L ? 1 : 0;
    for (const a of [agg.national, acc(agg.region, cols.region[i]), acc(agg.state, cols.entidad[i])]) {
      a.n++; a.cov += cov; a.sumP += P; a.sumL += L; a.sumM += P - L; a.sumVf += cols.vf[i]; a.sumPml += cols.pml[i]; a.sumYf += ok(cols.yf[i]) ? cols.yf[i] : 0;
    }
  }
  const fin = (a) => ({ n: a.n, covering: a.cov, pct: a.n ? 100 * a.cov / a.n : null, pcap: a.n ? a.sumP / a.n : null, lcoe: a.n ? a.sumL / a.n : null,
    margin: a.n ? a.sumM / a.n : null, vf: a.n ? a.sumVf / a.n : null, pml: a.n ? a.sumPml / a.n : null, yf: a.n ? a.sumYf / a.n : null });
  const mapObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fin(v)]));
  return { national: fin(agg.national), region: mapObj(agg.region), state: mapObj(agg.state), margin, lcoe };
}
