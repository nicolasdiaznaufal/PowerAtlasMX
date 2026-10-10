// Map metrics: label, unit, value, colour position. Colours via the v1 ramp helper (mix/clamp01).
import { mix, clamp01 } from '../../../assets/js/geomap.js';

const f0 = (v) => Math.round(v).toLocaleString('en-US');
const f2 = (v) => v.toFixed(2);
export const RAMP = { lo: '#1E2B23', dot: '#4F6B5A', hi: '#EDE6D0' };

export const METRICS = {
  vf: { label: 'Value factor', short: 'VF', unit: 'no unit', fmt: f2, get: (n) => n.vf, hint: 'Captured price divided by average price' },
  pcap: { label: 'Captured price', short: 'Captured', unit: 'MXN/MWh', fmt: f0, get: (n) => n.pcap, hint: 'Average price weighted by solar output' },
  pml: { label: 'Average price', short: 'Average', unit: 'MXN/MWh', fmt: f0, get: (n) => n.pml, hint: 'MDA reference price (CENACE), all hours' },
  rank: { label: 'VF rank in region', short: 'Rank', unit: '1 = best', fmt: (v) => `#${v}`, get: (n) => n.rank, hint: 'Position of VF among nodes in the same region' },
};
export const METRIC_ORDER = ['vf', 'pcap', 'pml', 'rank'];

/** 2nd..98th percentile of a metric over nodes that have it (rank uses 1..max instead). */
export function domainOf(nodes, key) {
  if (key === 'rank') return [1, Math.max(1, ...nodes.filter((n) => n.rank != null).map((n) => n.rankN))];
  const vs = nodes.filter((n) => n.has).map((n) => METRICS[key].get(n)).filter((v) => v != null).sort((a, b) => a - b);
  if (!vs.length) return [0, 1];
  const q = (p) => vs[Math.min(vs.length - 1, Math.floor(p * vs.length))];
  const dom = [q(0.02), q(0.98)];
  dom.sorted = vs; // quantile scale: colour = share of nodes below, so the ramp is spread evenly
  return dom;
}

/** Value at ramp fraction f (0..1) of the quantile scale; falls back to the linear domain. */
export function valueAt(dom, f) {
  if (!dom.sorted) return dom[0] + f * (dom[1] - dom[0]);
  const s = dom.sorted;
  return s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))];
}

function share(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  const a = lo; hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; }
  return sorted.length > 1 ? ((a + lo - 1) / 2) / (sorted.length - 1) : 1;
}

/** 0 (low) .. 1 (high). For rank, best (#1) is high. */
export function position(n, key, dom) {
  const v = METRICS[key].get(n);
  if (v == null) return null;
  if (key === 'rank') return n.rankN > 1 ? 1 - (v - 1) / (n.rankN - 1) : 1;
  if (dom.sorted) return share(dom.sorted, v);
  return clamp01((v - dom[0]) / (dom[1] - dom[0] || 1));
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** RGBA array for deck.gl. Dots use a lifted low end so they stay visible on the canvas. */
export function colorOf(t, lo = RAMP.dot, alpha = 235) {
  return [...hex(mix(lo, RAMP.hi, t)), alpha];
}
