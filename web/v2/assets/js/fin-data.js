// Revenue economics and map data: v1 pure modules (params, finmodel, finworker.runEval) over the published node and area files.
// Nothing is recomputed differently from v1: same place inputs, same window keys, same universe evaluation.
import { WIN } from '../../../assets/js/names.js';
import { px } from '../../../assets/js/data-pure.js';
import { runEval } from '../../../assets/js/finworker.js';
import { getJSON } from './json.js';

const U = { nodos: '../data/analysis/analysis_nodos.json', analysis: '../data/analysis/analysis.json', geo: '../assets/geo/mx.json' };
export const loadFin = () => Promise.all([getJSON(U.nodos), getJSON(U.analysis)]).then(([nodos, analysis]) => ({ nodos, analysis }));
export const loadGeoRaw = () => getJSON(U.geo);

/** published figures of one area in one window (tracker, the published areas are tracker only). */
export function areaStat(analysis, winId, level, key) {
  const c = analysis.ventanas && analysis.ventanas[WIN[winId].key] && analysis.ventanas[WIN[winId].key].por_config.tracker;
  if (!c) return null;
  if (level === 'national') return c.nacional || null;
  return (level === 'region' ? c.regiones : c.estados)[key] || null;
}

/** inputs of one place for one window in the active price basis (same as v1 placeInputs). */
export function placeInputs(src, level, key, winId, real) {
  const wk = WIN[winId].key;
  if (level === 'node') {
    const i = src.nodos.ids.indexOf(key), w = src.nodos.ventanas[wk];
    if (i < 0 || !w || w.p_cap[i] === null || w.p_cap[i] === undefined) return null;
    const pcap = real ? w.p_cap_real[i] : w.p_cap[i], pml = real ? w.pml_medio_real[i] : w.pml_medio[i];
    return { pcap, pml, vf: pcap / pml, yf: w.y_f ? w.y_f[i] : null, n: 1 };
  }
  const s = areaStat(src.analysis, winId, level, key);
  if (!s) return null;
  const pcap = px(s, 'p_cap', real), pml = px(s, 'pml_medio', real);
  return { pcap, pml, vf: pcap / pml, yf: s.y_f_mwh_por_mwp, n: s.n_nodos };
}

const cache = new Map();
/** whole-universe evaluation under an assumption set: { mode, threshold, national, region, state, margin, lcoe } | { mode: null }. */
export function finEval(nodos, set, winId, real) {
  const key = JSON.stringify([set, winId, !real]);
  if (!cache.has(key)) {
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    cache.set(key, runEval(nodos, { set, winKey: WIN[winId].key, nominal: !real }));
  }
  return cache.get(key);
}
