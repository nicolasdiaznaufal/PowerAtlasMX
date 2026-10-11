// Explorer data layer: one record per slot (node / state / region / national) and window.
// Pure builders (tested against the source JSON) + lazy loaders. Slot-based so compare (M6) is additive.
// Ported from v1 common.js areaRecord / monthlySeries and data.js areaStat / areaProfile.
import { WIN } from '../../../assets/js/names.js';
import { num } from '../../../assets/js/format.js';
import { getJSON } from './json.js';

export const WINDOWS = ['Y2', 'Y1']; // Y2 = Aug 2025 - Jul 2026 (default), Y1 = Aug 2024 - Jul 2025
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
    return { level, key, n: 1, base: w.pml_medio[i], cap: w.p_cap[i], vf: w.vf[i], vfDay: w.vf_dia_promedio[i], spread: w.spread_punta_solar[i], z: w.pct_e0[i],
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

/** calendar years -> {label, vf, cap, base}; only years present in the series. */
export function yearRows(series) {
  return series.years.filter((y) => series.y[String(y)]).map((y) => {
    const [pm, cp] = series.y[String(y)];
    return { label: String(y), base: pm, cap: cp, vf: pm ? +(cp / pm).toFixed(3) : null };
  });
}

/** headline tiles, in display order. Values are formatted exactly as shown. */
export function tilesOf(rec) {
  return [
    { id: 'base', label: 'Average price', unit: 'MXN/MWh', value: rec.base, text: num(rec.base, 0) },
    { id: 'cap', label: 'Captured price', unit: 'MXN/MWh', value: rec.cap, text: num(rec.cap, 0) },
    { id: 'vf', label: 'Value factor', unit: 'captured ÷ average', value: rec.vf, text: num(rec.vf, 2) },
    { id: 'z', label: 'Solar output at or below zero price', unit: '% of energy', value: rec.z, text: num(rec.z, 1) },
    { id: 'spread', label: 'Evening peak minus solar hours', unit: 'MXN/MWh', value: rec.spread, text: num(rec.spread, 0) },
  ];
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
