// Pure map metric definitions (no DOM): shared by the map, the geography block and the tests.
import { px } from './data-pure.js';
import { mix, clamp01 } from './geomap.js';
const f0 = (v) => Math.round(v).toLocaleString('en-US');
const f1 = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (v, d = 0) => (v < 0 ? '\u2212' : '+') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const LO = '#33443A', HI = '#EDE6D0';
export const METRICS = {
  vf: { name: 'Value factor', unit: 'no unit', lo: 0.55, hi: 0.95, f: f2, dlo: -0.25, dhi: 0.05, d: (v) => signed(v, 2) },
  cap: { name: 'Captured price', unit: 'MXN/MWh', lo: 0, hi: 1600, f: f0, dlo: -550, dhi: 50, d: (v) => signed(v, 0) },
  base: { name: 'Average price', unit: 'MXN/MWh', lo: 0, hi: 1800, f: f0, dlo: -250, dhi: 50, d: (v) => signed(v, 0) },
  le0: { name: 'PV energy at PML ≤ 0', unit: '%', lo: 7, hi: 0, f: f1, dlo: 2, dhi: -2, d: (v) => `${signed(v, 1)} pp` },
  margin: { name: 'Margin vs LCOE', unit: 'MXN/MWh', lo: -800, hi: 400, f: f0, dlo: -400, dhi: 400, d: (v) => signed(v, 0) },
  spread: { name: 'Spread peak − solar', unit: 'MXN/MWh', lo: 100, hi: 1500, f: f0, dlo: -300, dhi: 300, d: (v) => signed(v, 0) },
};
/** metric value of an area stats object under the active basis. */
export function metricOf(s, metric, real, marginOf) {
  if (!s) return null;
  switch (metric) {
    case 'vf': return real && s.p_cap_real != null && s.pml_medio_real ? s.p_cap_real / s.pml_medio_real : s.vf;
    case 'cap': return px(s, 'p_cap', real);
    case 'base': return px(s, 'pml_medio', real);
    case 'le0': return s.pct_e0;
    case 'spread': return s.spread_punta_solar;
    case 'margin': return marginOf ? marginOf(s) : null;
    default: return null;
  }
}
export const rampColor = (v, lo, hi) => mix(LO, HI, clamp01((v - lo) / (hi - lo)));

