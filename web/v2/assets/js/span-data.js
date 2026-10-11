// Time span: month helpers, presets and the span summary of a slot.
// Exact period prices need additive monthly sums, which exist only in the node sheets (20 nodes in this package):
// for those nodes v1's own compute() (calc.js) is used, so the numbers equal v1's "One node in detail, for any period".
// Every other slot only has the monthly value factor: the span summary shows its simple mean and range, labelled as such.
import { adaptNode, ctxFor } from '../../../assets/js/contract.js';
import { compute } from '../../../assets/js/calc.js';
import { getJSON } from './json.js';

export const inSpan = (m, span) => !span || (m >= span.from && m <= span.to);

/** presets: last 12 months (the selected window), all months, and each calendar year present. */
export function presetSpans(months, win) {
  const first = months[0], last = months[months.length - 1];
  const out = [{ id: 'l12', label: 'Last 12 months', from: win.desde, to: win.hasta }, { id: 'all', label: 'All', from: first, to: last }];
  for (let y = +first.slice(0, 4); y <= +last.slice(0, 4); y++) {
    const from = `${y}-01` < first ? first : `${y}-01`, to = `${y}-12` > last ? last : `${y}-12`;
    out.push({ id: String(y), label: String(y), from, to });
  }
  return out;
}

/** value-factor summary of one slot inside the span. series = {months, vf}. */
export function vfSummary(series, span) {
  if (!series) return { months: 0, withData: 0, mean: null, min: null, max: null };
  const idx = series.months.map((m, i) => (inSpan(m, span) ? i : -1)).filter((i) => i >= 0);
  const v = idx.map((i) => series.vf[i]).filter((x) => x !== null && x !== undefined);
  return { months: idx.length, withData: v.length, mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
}

let ids = null;
/** ids that have a node sheet (the package's data/disponibles.json). */
export async function sheetIds() {
  if (!ids) ids = getJSON('../data/disponibles.json').then((j) => new Set(j.nodos || [])).catch(() => new Set());
  return ids;
}

/** v1 compute() over [from, to] for a node sheet. Returns null when the node has no data in the span. */
export function exactSpan(raw, index, from, to, real = false) {
  const model = adaptNode(raw);
  const res = compute(model, 'tracker', from, to, ctxFor(index, model), { real });
  if (!res || !res.n) return null;
  return { B: res.B, C: res.C, VF: res.VF, n: res.n, monthsWithData: res.mesesConDatos, monthsInRange: res.mesesEnRango, pctMissing: res.pctFaltantes, realUsed: res.real, mensual: res.mensual.map((m) => ({ mes: m.mes, B: m.B, C: m.C, VF: m.VF, n: m.n, borde: m.borde, completo: m.completo })) };
}

export async function loadSheetResult(id, from, to, real) {
  if (!(await sheetIds()).has(id)) return null;
  const [raw, index] = await Promise.all([getJSON(`../data/nodes/${id}.json`), getJSON('../data/index.json')]);
  return exactSpan(raw, index, from, to, real);
}
