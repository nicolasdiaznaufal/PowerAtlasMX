// Score view: pure logic (no DOM). Two models (Solar Plant, Battery), strict/balanced combination, search, area summaries.
export const FLOOR = 0.02; // strict mode: a component is never below this, so one zero does not collapse the score to 0

export const NAMES = {
  solar: { land: 'Land', resource: 'Solar resource', market: 'Market price', congestion: 'Congestion', terrain: 'Terrain', grid: 'Grid proximity' },
  bat: { value: 'Arbitrage value', spread: 'Daily spread', predictability: 'Predictability', negative: 'Negative prices', congvol: 'Congestion volatility', grid: 'Grid proximity' },
};

/** Battery economics and trading value, recomputed with the user's round-trip efficiency and costs. */
export const unit = (x, lo, hi) => Math.min(1, Math.max(0, (x - lo) / (hi - lo || 1)));
/** linear-interpolation percentile (p in 0..100), same convention as numpy */
export function percentileLin(vals, p) {
  const s = vals.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const k = (p / 100) * (s.length - 1), i = Math.floor(k), j = Math.min(s.length - 1, i + 1);
  return s[i] + (s[j] - s[i]) * (k - i);
}
/** MXN per kW-year of the out-of-sample rule: discharge revenue minus charging cost grossed up for losses. null = not available. */
export function valueAtRte(b, hours, rte, perfect = false) {
  if (!b || !(rte > 0)) return null;
  const k = perfect ? [`pfdis_${hours}h`, `pfch_${hours}h`] : [`dis_${hours}h`, `ch_${hours}h`];
  const d = b[k[0]], c = b[k[1]];
  return Number.isFinite(d) && Number.isFinite(c) ? d - c / rte : null;
}
/** capital recovery factor */
export const crf = (r, n) => (r > 0 ? r / (1 - (1 + r) ** -n) : 1 / n);
/** cost = {power (MXN/kW), energy (MXN/kWh), om (% of capex per year), life (years), disc (0..1)} */
export function econ(value, hours, cost) {
  const capex = cost.power + cost.energy * hours, annual = capex * crf(cost.disc, cost.life) + (capex * cost.om) / 100;
  const net = value == null ? null : value - (capex * cost.om) / 100;
  return { capex, annual, coverage: value == null ? null : value / annual, payback: net != null && net > 0 ? capex / net : null };
}
/** 10th to 90th percentile (config) of the 4 h value across nodes that have battery data, at this efficiency. */
export function valueScale(nodes, rte, pctl = [10, 90]) {
  const v = nodes.map((n) => valueAtRte(n.bat, 4, rte));
  return [percentileLin(v, pctl[0]), percentileLin(v, pctl[1])];
}

/** Model specs from the loaded scores file. comp/pen/flags read one node; W0 are the default weights.
 *  ctx (mutable, owned by the view): { rte } plus a per-efficiency cache of the value scale; at the file's own efficiency the stored
 *  components are used as they are. */
export function modelsOf(data, ctx = {}) {
  const bc = data.bat_meta.config, pctl = (bc.scales && bc.scales.value_pctl) || [10, 90];
  const batComp = (n) => {
    const b = n.bat;
    if (!b || !b.components) return null;
    const rte = ctx.rte;
    if (!rte || (rte === bc.rte && !ctx.force)) return b.components;
    const v = valueAtRte(b, 4, rte);
    if (v == null) return b.components;
    ctx.cache = ctx.cache || new Map();
    if (!ctx.cache.has(rte)) ctx.cache.set(rte, valueScale(data.nodes, rte, pctl));
    const sc = ctx.cache.get(rte);
    return { ...b.components, value: unit(v, sc[0], sc[1]) };
  };
  return {
    solar: { id: 'solar', title: 'Solar Plant', keys: Object.keys(NAMES.solar), names: NAMES.solar, W0: { ...data.meta.config.weights },
      comp: (n) => n.components || null, pen: () => 0, flags: (n) => n.flags || [] },
    bat: { id: 'bat', title: 'Battery', keys: Object.keys(NAMES.bat), names: NAMES.bat, W0: { ...bc.weights },
      comp: batComp, pen: (n) => (n.bat && n.bat.pen) || 0, flags: (n) => (n.bat ? n.bat.flags || [] : ['no battery data']) },
  };
}

/** Weights as shares that sum to 1 (negative or missing values count as 0). All zero -> null. */
export function normWeights(keys, W) {
  const w = keys.map((k) => Math.max(0, Number(W[k]) || 0)), t = w.reduce((a, b) => a + b, 0);
  if (!(t > 0)) return null;
  return Object.fromEntries(keys.map((k, i) => [k, w[i] / t]));
}

/** 0..100 combination of components cp (each 0..1). mode 'strict' = weighted geometric mean with a floor, 'linear' = weighted average. */
export function combine(cp, keys, W, mode = 'strict') {
  const nw = normWeights(keys, W);
  if (!cp || !nw) return null;
  let s = 0;
  for (const k of keys) {
    const v = Number(cp[k]);
    if (!Number.isFinite(v)) return null;
    s += mode === 'linear' ? nw[k] * v : nw[k] * Math.log(Math.max(v, FLOOR));
  }
  return 100 * (mode === 'linear' ? s : Math.exp(s));
}

/** Score of one node under a model, weights and mode; the saturation penalty is subtracted and clamped at 0. null = not scored. */
export function scoreNode(n, model, W, mode) {
  const raw = combine(model.comp(n), model.keys, W, mode);
  return raw == null ? null : Math.max(0, raw - model.pen(n));
}

/** accent-insensitive, case-insensitive key */
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** search entries: nodes (name, id, municipality), states, regions. regionLabel makes "NOROESTE" -> "Noroeste". */
export function buildSearch(nodes, states, regions) {
  const title = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  return [
    ...nodes.map((n) => ({ kind: 'node', id: n.id, label: n.nombre, sub: `${n.id} · ${title(n.entidad || '')}`, key: norm(`${n.nombre} ${n.id} ${n.municipio || ''}`) })),
    ...states.map((s) => ({ kind: 'state', id: s.key, label: s.name, sub: 'State', key: norm(s.name) })),
    ...regions.map((k) => ({ kind: 'region', id: k, label: title(k), sub: 'Region', key: norm(k) })),
  ];
}

/** matches containing the query; areas first, then nodes; prefix matches before inner matches. */
export function search(entries, q, limit = 8) {
  const t = norm(q).trim();
  if (!t) return [];
  const rank = (x) => (x.kind === 'node' ? 2 : 0) + (x.key.startsWith(t) ? 0 : 1);
  return entries.filter((x) => x.key.includes(t)).map((x, i) => [x, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).slice(0, limit).map((x) => x[0]);
}

/** value at share p (0..1) of an ascending-sorted copy; null for an empty list. */
export function percentile(vals, p) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** sel: null (national), {kind:'state'|'region', id} or a node (all nodes, not an area). */
export const inArea = (n, sel) => !sel || sel.kind === 'node' || sel.kind === 'national' || (sel.kind === 'state' ? n.state === sel.id : n.region === sel.id);

/** median, top-10 % threshold, best node and top list of an area. scoreOf(n) -> number | null. */
export function areaSummary(nodes, sel, scoreOf, top = 10) {
  const inA = nodes.filter((n) => inArea(n, sel));
  const sc = inA.map((n) => [n, scoreOf(n)]).filter((x) => x[1] != null).sort((a, b) => b[1] - a[1]);
  const v = sc.map((x) => x[1]);
  return { n: inA.length, scored: sc.length, median: percentile(v, 0.5), p90: percentile(v, 0.9), best: sc[0] || null, top: sc.slice(0, top) };
}

/** median of fn(n) over the nodes of an area (nodes where fn gives null are skipped); null when none. */
export function areaMedian(nodes, sel, fn) {
  const v = nodes.filter((n) => inArea(n, sel)).map(fn).filter((x) => x != null && Number.isFinite(x));
  return percentileLin(v, 50);
}
