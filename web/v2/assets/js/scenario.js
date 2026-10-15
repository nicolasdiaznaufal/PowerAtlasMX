// What-if scenarios on the typical-day hourly profile. Published figures are never recomputed: each simulated figure is
//   published value x (scenario typical-day result / baseline typical-day result),
// so with every slider at its neutral value the ratios are exactly 1 and the published numbers come back unchanged.
// Three levers, applied in this order: midday price depression, price shift, solar yield.
import { solarRuns } from './chart-decomp.js';
import { isNeutral, NEUTRAL } from './query-extras.js';

const sum = (a) => a.reduce((s, v) => s + v, 0);
export { isNeutral, NEUTRAL };

/** hours (0..23) that count as solar hours: output at least 5% of the peak hour (same rule as the chart shading). */
export function solarHours(y) {
  const set = new Set();
  for (const [a, b] of solarRuns(y)) for (let h = a; h <= b; h++) set.add(h);
  return set;
}

/** scenario hourly profile. Neutral levers leave the arrays untouched (same numbers, not just close). */
export function applyScenario(hours, sc) {
  if (isNeutral(sc)) return hours;
  const { pml, y, perdidas, congestion } = hours;
  let p = pml;
  if (sc.dip !== NEUTRAL.dip) {
    const mean = sum(pml) / pml.length, solar = solarHours(y), k = sc.dip / 100;
    p = pml.map((v, h) => (solar.has(h) && v < mean ? mean - (mean - v) * k : v));
  }
  if (sc.price !== NEUTRAL.price) p = p.map((v) => v + sc.price);
  const yy = sc.yield !== NEUTRAL.yield ? y.map((v) => v * (1 + sc.yield / 100)) : y;
  return { pml: p, y: yy, perdidas, congestion, energia: p.map((v, h) => v - perdidas[h] - congestion[h]) };
}

/** typical-day results: average price B, captured price C (output weighted), output x price S (per MWp per day). */
export function typicalStats(hours) {
  const B = sum(hours.pml) / hours.pml.length, Y = sum(hours.y), S = hours.y.reduce((s, v, h) => s + v * hours.pml[h], 0);
  return { B, C: Y > 0 ? S / Y : null, S, Y };
}

/** ratios scenario / baseline; null when the baseline cannot support a ratio (no hours, non-positive average). */
export function scenarioRatios(hours, sc) {
  if (isNeutral(sc) || !hours) return { rB: 1, rC: 1, rVF: 1, rS: 1, yieldK: 1, ok: true };
  const b = typicalStats(hours), s = typicalStats(applyScenario(hours, sc));
  if (!(b.B > 0) || !(b.C > 0) || !(b.S > 0)) return { rB: 1, rC: 1, rVF: 1, rS: 1, yieldK: 1, ok: false };
  return { rB: s.B / b.B, rC: s.C / b.C, rVF: (s.C / s.B) / (b.C / b.B), rS: s.S / b.S, yieldK: 1 + sc.yield / 100, ok: true };
}

/** record with the scenario applied (same shape as explorer-data records). Returns the same object when neutral. */
export function scenarioRecord(rec, sc) {
  if (!rec || rec.missing || isNeutral(sc)) return { rec, ratios: scenarioRatios(null, null) };
  if (!rec.hours) return { rec, ratios: { rB: 1, rC: 1, rVF: 1, rS: 1, yieldK: 1, ok: false } }; // no hourly profile: nothing to simulate
  const r = scenarioRatios(rec.hours, sc);
  if (!r.ok) return { rec, ratios: r };
  const mul = (v, k) => (v === null || v === undefined ? v : v * k);
  // a price that is zero or negative under the scenario makes the ratios (VF, revenue) meaningless: keep the prices, drop the rest
  if (!(rec.base * r.rB > 0) || !(rec.cap * r.rC > 0)) {
    return { rec: { ...rec, simulated: true, simNA: 'n/a: price ≤ 0 under this scenario', hours: applyScenario(rec.hours, sc),
      base: mul(rec.base, r.rB), baseReal: mul(rec.baseReal, r.rB), cap: mul(rec.cap, r.rC), capReal: mul(rec.capReal, r.rC),
      vf: null, vfDay: null, ingreso: null, ingresoReal: null, atajo: null, yf: mul(rec.yf, r.yieldK) }, ratios: { ...r, na: true } };
  }
  const out = {
    ...rec, simulated: true, hours: applyScenario(rec.hours, sc),
    base: mul(rec.base, r.rB), baseReal: mul(rec.baseReal, r.rB), cap: mul(rec.cap, r.rC), capReal: mul(rec.capReal, r.rC),
    vf: mul(rec.vf, r.rVF), vfDay: mul(rec.vfDay, r.rVF),
    ingreso: mul(rec.ingreso, r.rS), ingresoReal: mul(rec.ingresoReal, r.rS),
    atajo: mul(rec.atajo, r.rB * r.yieldK), yf: mul(rec.yf, r.yieldK),
  };
  return { rec: out, ratios: r };
}

/** entries with the scenario applied; each simulated entry keeps `real` = the published record for deltas and ghost lines. */
export function scenarioEntries(entries, sc) {
  if (isNeutral(sc)) return entries;
  return entries.map((e) => {
    if (e.error || e.missing || !e.rec) return e;
    const { rec, ratios } = scenarioRecord(e.rec, sc);
    if (rec === e.rec) return { ...e, noBaseline: !ratios.ok }; // shown as published, and said so
    return { ...e, rec, real: e.rec, ratios };
  });
}
