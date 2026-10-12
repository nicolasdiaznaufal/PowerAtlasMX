// Explorer data layer: one record per slot (node / state / region / national) and window.
// Pure builders (tested against the source JSON) + lazy loaders. Slot-based so compare (M6) is additive.
// Ported from v1 common.js areaRecord / monthlySeries and data.js areaStat / areaProfile.
import { WIN } from '../../../assets/js/names.js';
import { num } from '../../../assets/js/format.js';
import { getJSON } from './json.js';

// Main time window (the only time control): Y2 = Aug 2025 - Jul 2026 (default), Y1 = Aug 2024 - Jul 2025, ALL = the full history.
// ALL has published area and node figures (window 'completo'), but no typical day or solar variants: those use the last 12 months.
if (!WIN.ALL) WIN.ALL = { key: 'completo', label: 'Full history Jan 2020 – Sep 2026', short: '2020–2026', desde: '2020-01', hasta: '2026-09' };
export const WINDOWS = ['Y2', 'Y1', 'ALL'];
const U = { nodos: '../data/analysis/analysis_nodos.json', analysis: '../data/analysis/analysis.json', profiles: '../data/derived/node_profiles.json',
  sNodes: '../data/derived/series_nodes.json', sAreas: '../data/derived/series_areas.json' };
const idxCache = new WeakMap();
const idxOf = (nodos) => { if (!idxCache.has(nodos)) idxCache.set(nodos, new Map(nodos.ids.map((id, i) => [id, i]))); return idxCache.get(nodos); };
const levelOf = (slot) => (slot.kind === 'national' ? 'national' : slot.kind);

/** one record: headline figures + 24-hour profile. `missing: true` when the slot has no data in the window. */
export function recordFor(src, slot, winId) {
  const wk = WIN[winId].key, level = levelOf(slot), key = slot.id;
  if (level === 'node') {
    const i = idxOf(src.nodos).get(key), w = src.nodos.ventanas[wk], p = src.profiles.nodes[key] && src.profiles.nodes[key][winId];
    if (i === undefined || !w || w.p_cap[i] === null || !p) return { level, key, missing: true };
    const [pml, perdidas, congestion, y] = p;
    return { level, key, n: 1, nHoras: w.n_horas[i], base: w.pml_medio[i], cap: w.p_cap[i], vf: w.vf[i], vfDay: w.vf_dia_promedio[i], spread: w.spread_punta_solar[i], z: w.pct_e0[i],
      baseReal: w.pml_medio_real[i], capReal: w.p_cap_real[i], ingreso: w.ingreso[i], ingresoReal: w.ingreso_real[i], atajo: w.ingreso_atajo[i],
      yf: w.y_f[i], region: src.nodos.region[i], entidad: src.nodos.entidad[i],
      hours: { pml, perdidas, congestion, y, energia: pml.map((v, h) => v - perdidas[h] - congestion[h]) } };
  }
  const c = src.analysis.ventanas[wk] && src.analysis.ventanas[wk].por_config && src.analysis.ventanas[wk].por_config.tracker;
  if (!c) return { level, key, missing: true };
  const s = level === 'national' ? c.nacional : (level === 'region' ? c.regiones : c.estados)[key];
  const pr = level === 'national' ? c.perfil_horario_nacional : level === 'region' ? c.perfil_horario_regiones[key] : c.explorador.perfil_horario_estados[key];
  if (!s) return { level, key, missing: true };
  return { level, key, n: s.n_nodos, base: s.pml_medio, cap: s.p_cap, vf: s.vf, vfDay: s.vf_dia_promedio_media_nodos, vfMedian: s.vf_mediana_nodos,
    spread: s.spread_punta_solar, z: s.pct_e0, yf: s.y_f_mwh_por_mwp,
    baseReal: s.pml_medio_real, capReal: s.p_cap_real, ingreso: s.ingreso_mxn_por_mwp, ingresoReal: s.ingreso_real_mxn_por_mwp, atajo: s.ingreso_atajo_mxn_por_mwp,
    hours: pr ? { pml: pr.pml_h, perdidas: pr.perdidas_h, congestion: pr.congestion_h, energia: pr.energia_h, y: pr.y_h_mwh_por_mwp } : null };
}

/** monthly VF (81 months) + calendar-year rows. Years: [avg price, captured price, avg real, captured real, nodes?]. */
export function seriesFor(src, slot) {
  const level = levelOf(slot);
  if (level === 'node') {
    const s = src.sNodes, n = s.nodes[slot.id];
    return n ? { months: s.months, vf: n.m, years: s.years, y: n.y } : null;
  }
  const s = src.sAreas, a = level === 'national' ? s.areas.ALL : s.areas[level][slot.id];
  return a ? { months: s.months, vf: a.m, years: s.years, y: a.y, nn: a.mn } : null;
}

/** calendar years -> {label, vf, cap, base}; only years present in the series. real = today's pesos (as v1). */
export function yearRows(series, real = false) {
  return series.years.filter((y) => series.y[String(y)]).map((y) => {
    const [pm, cp, pmr, cpr] = series.y[String(y)];
    const b = real && pmr ? pmr : pm, c = real && cpr ? cpr : cp;
    return { label: String(y), base: b, cap: c, vf: b ? +(c / b).toFixed(3) : null };
  });
}

/** price basis of a record: nominal MXN or today's pesos. VF in real pesos is captured / average of the real figures (as v1). */
export function priceBasis(rec, real) {
  const r = real && rec.baseReal != null && rec.capReal != null;
  return { base: r ? rec.baseReal : rec.base, cap: r ? rec.capReal : rec.cap, vf: rec.simNA ? null : r ? rec.capReal / rec.baseReal : rec.vf, real: r };
}

/** headline tiles, in display order. Values are formatted exactly as shown. Spread, "<= 0" share and VF of the average day are nominal figures. */
export function tilesOf(rec, real = false) {
  const b = priceBasis(rec, real), unit = b.real ? "MXN/MWh, today's pesos" : 'MXN/MWh';
  return [
    { id: 'base', label: 'Average price', unit, value: b.base, text: num(b.base, 0) },
    { id: 'cap', label: 'Captured price', unit, value: b.cap, text: num(b.cap, 0) },
    { id: 'vf', label: 'Value factor', unit: 'captured ÷ average', value: b.vf, text: num(b.vf, 2) },
    { id: 'vfDay', label: 'Value factor, average day', unit: 'captured ÷ average, nominal', value: rec.vfDay, text: num(rec.vfDay, 2) },
    { id: 'z', label: 'Solar output at price ≤ 0', unit: '% of energy', value: rec.z, text: num(rec.z, 1) },
    { id: 'spread', label: 'Evening peak minus solar hours', unit: 'MXN/MWh, nominal', value: rec.spread, text: num(rec.spread, 0) },
  ];
}

/** Labels of the revenue data table, by price basis. The scale factor folds in the nominal -> today's pesos adjustment in real mode. */
export function tableLabels(real, scale) {
  const f = num(scale, 3);
  return real
    ? { hour: "Hour by hour (scaled), MXN (today's pesos)",
        note: `Output × price is the typical-day product in nominal pesos. The "hour by hour (scaled)" column multiplies it by ${f}, which includes the adjustment from nominal to today's pesos, so that the day adds up to the published yearly revenue in today's pesos ÷ 365.` }
    : { hour: 'Hour by hour (scaled), MXN (nominal)',
        note: `Output × price is the typical-day product. The "hour by hour (scaled)" column multiplies it by ${f} so that the day adds up to the published yearly revenue ÷ 365.` };
}

export const FULL_YEAR_HOURS = 8760;
/** Visible note for node-windows with fewer priced hours than a full year (nothing is annualised). Areas publish no hour count. */
export function partialNote(rec) {
  if (rec.nHoras == null || rec.nHoras >= FULL_YEAR_HOURS) return null;
  return `Partial year: ${num(rec.nHoras, 0)} priced hours of ${num(FULL_YEAR_HOURS, 0)}. Revenue covers priced hours only and is understated.`;
}

/** For information only: the variant's 12-month yield for a node with fewer priced hours (published figures are NOT annualised). */
export function annualEquivNote(rec) {
  if (rec.nHoras == null || rec.nHoras >= FULL_YEAR_HOURS || !(rec.yfEq > 0)) return null;
  return `For information: annual equivalent of the yield, ${num(rec.yfEq, 0)} kWh/kWp (the published figures cover priced hours only).`;
}

/** Revenue per MWp per year, from the SAME record (same price, production and profile as Explorer).
 *  Headline figures are the published `ingreso` fields; hourly bars use the typical-day shape (production x price)
 *  scaled so that the day adds up to ingreso / 365 exactly. */
export function revenueOf(rec, real = false) {
  const b = priceBasis(rec, real);
  const total = b.real && rec.ingresoReal != null ? rec.ingresoReal : rec.ingreso;
  const out = { total, real: b.real, base: b.base, cap: b.cap, vf: b.vf, yf: rec.yf, hours: null, raw: null, scale: null, gap: null };
  const h = rec.hours;
  if (h) {
    const wr = h.y.map((y, k) => y * h.pml[k]), sr = wr.reduce((a, c) => a + c, 0);
    out.raw = wr;                                          // typical-day output x price, MXN per MWp per day (nominal)
    out.scale = sr > 0 && total != null ? total / 365 / sr : null; // factor that makes the day add up to the yearly figure
    out.gap = sr > 0 && rec.ingreso ? (sr * 365 / rec.ingreso - 1) * 100 : null; // typical day x 365 vs published nominal ingreso, %
    out.hours = { real: wr.map((v) => (sr > 0 && total != null ? (total / 365) * (v / sr) : null)) };
  }
  return out;
}

const need = (slot) => (slot.kind === 'node' ? ['nodos', 'profiles', 'sNodes'] : ['analysis', 'sAreas']);
/** load what a slot needs (lazy, cached) and return the source bundle. */
export async function loadSources(slot) {
  const keys = need(slot);
  const vals = await Promise.all(keys.map((k) => getJSON(U[k])));
  return Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
}
/** low-priority prefetch after the landing; errors are ignored (the view retries on demand). */
export function prefetch() {
  Object.values(U).forEach((u) => { getJSON(u).catch(() => {}); });
}
