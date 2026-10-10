// Data layer: index, analysis (schema 1.1.0), derived series (built by web/tools/build_derived.py), geometry, node sheets.
// Everything lazy except index + analysis. All loaders return null (never throw) so one failed file never blanks the page.
import { checkSchema, checkAnalysisSchema, SchemaError, adaptNode } from './contract.js';
import { REGIONS } from './names.js';

export const D = { index: null, byId: new Map(), available: new Set(), analysis: null, warnings: [], sheet: new Map() };
const cache = new Map();
async function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  cache.set(url, p);
  return p;
}
export const loadGeo = () => getJSON('assets/geo/mx.json');
export const loadGeography = () => getJSON('data/derived/geography.json');
export const loadProfiles = () => getJSON('data/derived/node_profiles.json');
export const loadSeriesNodes = () => getJSON('data/derived/series_nodes.json');
export const loadSeriesAreas = () => getJSON('data/derived/series_areas.json');

export async function loadCore() {
  const r = await fetch('data/index.json', { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`data/index.json: HTTP ${r.status}`);
  const index = await r.json();
  const chk = checkSchema(index.schema_version);          // throws SchemaError on another major
  if (chk.aviso) D.warnings.push(chk.aviso);
  D.index = index;
  index.nodos.forEach((n) => D.byId.set(n.id, n));
  const av = await getJSON('data/disponibles.json');
  D.available = new Set((av && (av.nodos || av)) || []);
  const an = await getJSON('data/analysis/analysis.json');
  if (an) {
    try { const w = checkAnalysisSchema(an.schema_version); if (w) D.warnings.push(w); D.analysis = an; } catch (e) { D.warnings.push(e.message); D.analysis = null; }
  } else D.warnings.push('analysis.json could not be loaded: the story sections show no analysis figures.');
  return D;
}

/** Node sheet JSON (one per node in the package) adapted to the typed model; null when the node has no sheet here. */
export async function loadSheet(id) {
  if (D.sheet.has(id)) return D.sheet.get(id);
  const n = D.byId.get(id);
  const url = n && n.ficha ? `data/${n.ficha}` : `data/nodes/${id}.json`;
  const raw = await getJSON(url);
  const out = raw ? { raw, model: adaptNode(raw) } : null;
  D.sheet.set(id, out);
  return out;
}

/* ---------- analysis helpers ---------- */
export const winCfg = (key, cfg = 'tracker') => {
  const a = D.analysis;
  return (a && a.ventanas && a.ventanas[key] && a.ventanas[key].por_config && a.ventanas[key].por_config[cfg]) || null;
};
/** level: 'national' | 'region' | 'state'. */
export function areaStat(winKey, level, key, cfg = 'tracker') {
  const c = winCfg(winKey, cfg);
  if (!c) return null;
  if (level === 'national') return c.nacional || null;
  return (level === 'region' ? c.regiones : c.estados)?.[key] || null;
}
export function areaProfile(winKey, level, key, cfg = 'tracker') {
  const c = winCfg(winKey, cfg);
  if (!c) return null;
  if (level === 'national') return c.perfil_horario_nacional || null;
  if (level === 'region') return c.perfil_horario_regiones?.[key] || null;
  return c.explorador?.perfil_horario_estados?.[key] || null;
}
export function areaMonthly(winKey, level, key, cfg = 'tracker') {
  const c = winCfg(winKey, cfg);
  if (!c) return null;
  if (level === 'national') return c.vf_mensual_nacional || null;
  if (level === 'region') return c.explorador?.vf_mensual_regiones?.[key] || null;
  return c.explorador?.vf_mensual_estados?.[key] || null;
}
/** price-basis aware pick of an area figure: base 'p_cap' | 'pml_medio' -> *_real when real. */
export { px, rn } from './data-pure.js';

export const listRegions = () => REGIONS.slice();
export function listStates() {
  const a = winCfg('deck_2025_26');
  return a && a.estados ? Object.keys(a.estados).sort() : [];
}
export const clockNote = (sistema) => {
  const s = D.index && D.index.reloj && D.index.reloj.sistemas && D.index.reloj.sistemas[sistema];
  return s ? s.nota_en || s.nota_es : '';
};

/* ---------- per-node analysis columns (analysis_nodos.json, main-thread copy; the worker keeps its own) ---------- */
export const loadNodos = async () => {
  const n = await getJSON('data/analysis/analysis_nodos.json');
  if (n && !n._idx) Object.defineProperty(n, '_idx', { value: new Map(n.ids.map((id, i) => [id, i])), enumerable: false });
  return n;
};
/** one node's window KPIs from analysis_nodos (null if the node is outside the universe of that window). */
export function nodeWin(nodos, id, winKey) {
  const i = nodos && nodos._idx.get(id), w = nodos && nodos.ventanas[winKey];
  if (i === undefined || !w || w.p_cap[i] === null) return null;
  const o = { i, region: nodos.region[i], entidad: nodos.entidad[i] };
  for (const k of Object.keys(w)) o[k] = w[k][i];
  return o;
}
