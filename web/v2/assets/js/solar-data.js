// Configuration (single-axis tracker | fixed tilt) x weather variant records (M10). Same record shape as explorer-data.recordFor,
// so tiles, revenue, scenarios and compare work unchanged. Values come from the published JSON (web/data/solar_v2): nothing is
// approximated. Areas follow the published definition: the mean over the member nodes that have data (checked against analysis.json).
import { WIN } from '../../../assets/js/names.js';
import { getJSON } from './json.js';
import { loadSources, recordFor } from './explorer-data.js';

export const SOLAR_BASE = '../data/solar_v2/';
export const isDefaultCtx = (ctx) => !ctx || ((ctx.cfg || 'tracker') === 'tracker' && (ctx.wx || 'mean') === 'mean');
export const solarUrls = (ctx) => ({
  vs: `${SOLAR_BASE}variant_scalars_${ctx.cfg}.json`,
  vx: `${SOLAR_BASE}variant_extra/${ctx.cfg}/${ctx.wx}.json`,
  vfile: `${SOLAR_BASE}variants/${ctx.wx}.json`,
  clear: `${SOLAR_BASE}variants/clear.json`,
});

const idxCache = new WeakMap();
const idxOf = (vs) => { if (!idxCache.has(vs)) idxCache.set(vs, new Map(vs.ids.map((id, i) => [id, i]))); return idxCache.get(vs); };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** base sources + the solar files for a non-default (cfg, wx). */
export async function loadSourcesCtx(slot, ctx) {
  const base = await loadSources(slot);
  if (isDefaultCtx(ctx)) return base;
  const u = solarUrls(ctx);
  const [vs, vx, vfile, nodos] = await Promise.all([getJSON(u.vs), getJSON(u.vx), getJSON(u.vfile), base.nodos ? Promise.resolve(base.nodos) : getJSON('../data/analysis/analysis_nodos.json')]);
  return { ...base, nodos, vs, vx, vfile };
}

/** the figures of node index i (variant_scalars order) for a window. null when the node has no data in the window. */
function nodeFigures(src, i, winId) {
  const { vs, vx } = src, sh = vs.shared[winId], d = vs.data[src.ctx.wx][winId], x = vx.data[winId];
  if (d.p_cap[i] === null || d.p_cap[i] === undefined) return null;
  return { nHoras: sh.n_horas[i], base: sh.pml_medio[i], baseReal: sh.pml_medio_real[i], spread: sh.spread_punta_solar[i],
    cap: d.p_cap[i], vf: d.vf[i], yf: d.y_f[i], ingreso: d.ingreso[i], yfEq: d.yf_annual_equiv[i],
    z: x.pct_e0[i], atajo: x.ingreso_atajo[i], vfDay: x.vf_dia_promedio[i], capReal: x.p_cap_real[i], ingresoReal: x.ingreso_real[i] };
}

export function variantRecord(src0, slot, winId, ctx) {
  const src = { ...src0, ctx };
  const level = slot.kind, key = slot.id, idx = idxOf(src.vs);
  if (level === 'node') {
    const i = idx.get(key), f = i === undefined ? null : nodeFigures(src, i, winId);
    const p = src.profiles && src.profiles.nodes[key] && src.profiles.nodes[key][winId];
    const vy = src.vfile.nodes[key] && src.vfile.nodes[key][ctx.cfg] && src.vfile.nodes[key][ctx.cfg].y[winId];
    if (!f || !p || !vy) return { level, key, missing: true };
    const [pml, perdidas, congestion] = p;
    const ni = src.nodos.ids.indexOf(key);
    return { level, key, n: 1, ...f, region: src.nodos.region[ni], entidad: src.nodos.entidad[ni],
      hours: { pml, perdidas, congestion, y: vy, energia: pml.map((v, h) => v - perdidas[h] - congestion[h]) } };
  }
  // area: members = nodes with data in the window that belong to it
  const wk = WIN[winId].key;
  const members = [];
  for (let i = 0; i < src.vs.ids.length; i++) {
    const ni = src.nodos.ids[i] === src.vs.ids[i] ? i : src.nodos.ids.indexOf(src.vs.ids[i]);
    const ok = level === 'national' || (level === 'state' ? src.nodos.entidad[ni] === key : src.nodos.region[ni] === key);
    if (!ok) continue;
    const f = nodeFigures(src, i, winId);
    if (f) members.push({ id: src.vs.ids[i], f });
  }
  if (!members.length) return { level, key, missing: true };
  const m = (k) => mean(members.map((o) => o.f[k]));
  const c = src.analysis.ventanas[wk].por_config.tracker;
  const pr = level === 'national' ? c.perfil_horario_nacional : level === 'region' ? c.perfil_horario_regiones[key] : c.explorador.perfil_horario_estados[key];
  let hours = null;
  if (pr) {
    const ys = members.map((o) => src.vfile.nodes[o.id] && src.vfile.nodes[o.id][ctx.cfg] && src.vfile.nodes[o.id][ctx.cfg].y[winId]).filter(Boolean);
    hours = { pml: pr.pml_h, perdidas: pr.perdidas_h, congestion: pr.congestion_h, energia: pr.energia_h, y: ys.length ? pr.pml_h.map((_, h) => mean(ys.map((y) => y[h]))) : pr.y_h_mwh_por_mwp };
  }
  const cap = m('cap'), base = m('base');
  return { level, key, n: members.length, nHoras: null, base, cap, vf: base ? cap / base : null, vfMedian: median(members.map((o) => o.f.vf)), vfDay: m('vfDay'),
    spread: m('spread'), z: m('z'), yf: m('yf'), yfEq: m('yfEq'), baseReal: m('baseReal'), capReal: m('capReal'), ingreso: m('ingreso'), ingresoReal: m('ingresoReal'), atajo: m('atajo'), hours };
}

/** default (tracker, yearly mean) goes through the published path unchanged; everything else through the variant files. */
export function recordForCtx(src, slot, winId, ctx) {
  return isDefaultCtx(ctx) ? recordFor(src, slot, winId) : variantRecord(src, slot, winId, ctx);
}

/** irradiance of one node: {ghi, poa:{m, Y1, Y2}...} for the selected variant file (cfg picks the plane of array). */
export function irradianceOf(vfile, id, cfg) {
  const n = vfile && vfile.nodes && vfile.nodes[id];
  if (!n || !n.irr) return null;
  const poa = cfg === 'fijo' ? n.irr.poa_fixed : n.irr.poa_tracker;
  return { ghi: n.irr.ghi, poa, y: n[cfg] && n[cfg].y };
}

export async function loadIrradiance(ctx, clear = false) {
  const u = solarUrls({ cfg: ctx.cfg, wx: ctx.wx });
  const [v, c] = await Promise.all([getJSON(u.vfile), clear ? getJSON(u.clear) : Promise.resolve(null)]);
  return { vfile: v, clear: c };
}
