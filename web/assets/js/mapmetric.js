// Map metric values and colour domain (pure, tested). Index 1.2.0 carries today's-pesos fields per config.
/** metric: 'vf' | 'cap'; real: prefer today's pesos when the node has them. Returns a number or null. */
export function metricValue(node, cfg, metric, real) {
  const k = node && node.kpis && node.kpis[cfg];
  if (!k) return null;
  const v = metric === 'vf'
    ? (real && k.vf_real != null ? k.vf_real : k.vf)
    : (real && k.precio_capturado_real_mxn_mwh != null ? k.precio_capturado_real_mxn_mwh : k.precio_capturado_mxn_mwh);
  return v === undefined ? null : v;
}
/** 2nd..98th percentile range of the metric over the given nodes. */
export function metricDomain(nodes, cfg, metric, real) {
  const vs = nodes.map((n) => metricValue(n, cfg, metric, real)).filter((v) => v !== null).sort((a, b) => a - b);
  if (!vs.length) return [0, 1];
  const q = (p) => vs[Math.min(vs.length - 1, Math.floor(p * vs.length))];
  return [q(0.02), q(0.98)];
}
