// Network Atlas: pure logic (no DOM). Metrics, colours, filters and grouped statistics over the node catalog + scores.

export const KV_BANDS = [
  { id: '400', label: '400 kV', test: (kv) => kv >= 400 },
  { id: '230', label: '230 kV', test: (kv) => kv >= 230 && kv < 400 },
  { id: '161', label: '138-161 kV', test: (kv) => kv >= 138 && kv < 230 },
  { id: '115', label: '115 kV', test: (kv) => kv >= 100 && kv < 138 },
  { id: '85', label: '34-85 kV', test: (kv) => kv < 100 },
];
export const bandOf = (kv) => (KV_BANDS.find((b) => b.test(kv)) || KV_BANDS[4]).id;

/** colour-by options. dir 'seq' = low to high, 'div' = negative / zero / positive (centred on 0). */
export const METRICS = {
  score: { label: 'Battery score', unit: 'points', get: (n) => n.score, dir: 'seq', fmt: (v) => v.toFixed(0) },
  mtr4: { label: 'Real-time 4 h value', unit: 'MXN per kW-year', get: (n) => n.mtr4, dir: 'seq', fmt: (v) => Math.round(v).toLocaleString('en-US') },
  gap: { label: 'Real-time minus day-ahead', unit: 'MXN/MWh, 2025 mean', get: (n) => n.gap, dir: 'div', fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(0) },
  mtrsp: { label: 'Real-time daily spread', unit: 'MXN/MWh, median', get: (n) => n.mtrsp, dir: 'seq', fmt: (v) => Math.round(v).toLocaleString('en-US') },
  cong: { label: 'Congestion', unit: 'MXN/MWh, mean', get: (n) => n.cong, dir: 'div', fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(0) },
  kv: { label: 'Voltage', unit: 'kV', get: (n) => n.kv, dir: 'seq', fmt: (v) => String(v) },
};

export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p / 100, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
export const median = (vals) => quantile(vals.filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b), 50);

/** robust colour domain: 5th to 95th percentile ('div' is symmetric around 0 so the neutral colour means zero). */
export function domainOf(nodes, m) {
  const v = nodes.map(m.get).filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return [0, 1];
  const lo = quantile(v, 5), hi = quantile(v, 95);
  if (m.dir === 'div') { const a = Math.max(Math.abs(lo), Math.abs(hi)) || 1; return [-a, a]; }
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixc = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const SEQ = [hex('#2F4A3C'), hex('#8DA892'), hex('#E8A266'), hex('#F4E6C4')];   // dark sage -> sage -> sand -> cream
const DIV = [hex('#8DA892'), hex('#3A453E'), hex('#E8A266')];                  // sage (below) / neutral / sand (above)
export const NO_DATA = [58, 69, 62, 150];

export function colorOf(m, v, dom) {
  if (v == null || Number.isNaN(v)) return NO_DATA;
  const t = Math.min(1, Math.max(0, (v - dom[0]) / (dom[1] - dom[0] || 1)));
  const stops = m.dir === 'div' ? DIV : SEQ, x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x));
  return [...mixc(stops[i], stops[i + 1], x - i), 235];
}
export const rampCSS = (m) => `linear-gradient(90deg, ${(m.dir === 'div' ? DIV : SEQ).map((c) => `rgb(${c})`).join(', ')})`;


export function lineStyle(kv) {   // atlas-sen palette and opacities
  if (kv >= 400) return { c: [163, 45, 45, 153], w: 1.6 };
  if (kv >= 230) return { c: [194, 65, 12, 133], w: 1.2 };
  if (kv >= 115) return { c: [124, 138, 160, 117], w: 0.8 };
  return { c: [184, 179, 168, 102], w: 0.6 };
}
export const LINE_LEGEND = [['400 kV', '#A32D2D'], ['230 kV', '#C2410C'], ['115-161 kV', '#7C8AA0'], ['below 115 kV', '#B8B3A8']];

/** f: { bands:Set<string>, sis:Set<string>, load:'all'|'D'|'I', gen:'all'|'D'|'I'|'any', q:string } */
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function filterNodes(nodes, f) {
  const q = norm(f.q).trim();
  return nodes.filter((n) => f.bands.has(bandOf(n.kv)) && f.sis.has(n.sis)
    && (f.load === 'all' || n.carga === f.load)
    && (f.gen === 'all' || (f.gen === 'any' ? !!n.gen : n.gen === f.gen))
    && (!q || norm(`${n.id} ${n.n} ${n.mun} ${n.ent} ${n.zc}`).includes(q)));
}

/** rows per group key (crc, ent, zot, zd ...): count, share with generation, medians. Sorted by median score. */
export function groupStats(nodes, key) {
  const g = new Map();
  nodes.forEach((n) => { const k = n[key] || 'n/a'; (g.get(k) || g.set(k, []).get(k)).push(n); });
  return [...g].map(([k, a]) => ({
    key: k, n: a.length, gen: a.filter((x) => x.gen).length, kv: median(a.map((x) => x.kv)),
    score: median(a.map((x) => x.score)), gap: median(a.map((x) => x.gap)), mtr4: median(a.map((x) => x.mtr4)), cong: median(a.map((x) => x.cong)),
  })).sort((x, y) => (y.score ?? -1) - (x.score ?? -1) || y.n - x.n);
}

export function topNodes(nodes, m, k = 10) {
  return nodes.filter((n) => m.get(n) != null && !Number.isNaN(m.get(n))).sort((a, b) => m.get(b) - m.get(a)).slice(0, k);
}

export const LOAD_TXT = { D: 'Directly modelled', I: 'Indirectly modelled', '': 'Not applicable' };
