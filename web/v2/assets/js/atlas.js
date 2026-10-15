// Map data: join index.json (names, coordinates) with analysis_nodos.json (metrics, last 12 months).
// Metrics are read as computed upstream; only the within-region rank is derived here (pure, tested).
import { getJSON } from './json.js';

export const WINDOW = { key: 'deck_2025_26', label: 'Aug 2025 – Jul 2026 · last 12 months' };

/** rank 1 = highest vf within the same region; nodes without vf get null. Returns {rank, size} arrays. */
export function rankInRegion(region, vf) {
  const by = new Map();
  vf.forEach((v, i) => { if (v != null) { const a = by.get(region[i]) || []; a.push(i); by.set(region[i], a); } });
  const rank = new Array(vf.length).fill(null), size = new Array(vf.length).fill(null);
  for (const idx of by.values()) {
    idx.sort((a, b) => vf[b] - vf[a]);
    idx.forEach((i, k) => { rank[i] = k + 1; size[i] = idx.length; });
  }
  return { rank, size };
}

/** Build the node list from the two files. Analysis nodes first; others are kept as dim 'no data' dots. */
export function buildAtlas(index, analysis) {
  const w = analysis.ventanas[WINDOW.key];
  const { rank, size } = rankInRegion(analysis.region, w.vf);
  const byId = new Map(index.nodos.map((n) => [n.id, n]));
  const nodes = [];
  analysis.ids.forEach((id, i) => {
    const n = byId.get(id);
    if (!n || n.lat == null) return;
    nodes.push({ id, name: n.nombre, state: analysis.entidad[i], region: analysis.region[i], muni: n.municipio, lon: n.lon, lat: n.lat,
      pml: w.pml_medio[i], pcap: w.p_cap[i], vf: w.vf[i], rank: rank[i], rankN: size[i], has: w.vf[i] != null });
  });
  const seen = new Set(analysis.ids);
  for (const n of index.nodos) {
    if (seen.has(n.id) || n.lat == null) continue;
    nodes.push({ id: n.id, name: n.nombre, state: n.entidad, region: n.region, muni: n.municipio, lon: n.lon, lat: n.lat,
      pml: null, pcap: null, vf: null, rank: null, rankN: null, has: false });
  }
  return { nodes, config: analysis.config, analysisCount: analysis.ids.length, pesosBase: (index.pesos_reales && index.pesos_reales.base_mes) || null,
    months: index.periodo_datos ? { min: index.periodo_datos.desde, max: index.periodo_datos.hasta } : null };
}

let cache = null;
export function loadAtlas() {
  if (!cache) {
    cache = Promise.all([getJSON('../data/index.json'), getJSON('../data/analysis/analysis_nodos.json')]).then(([i, a]) => buildAtlas(i, a));
    cache.catch(() => { cache = null; });
  }
  return cache;
}
