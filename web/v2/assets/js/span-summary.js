// Span summary table: one row per slot for the selected time span (published window when no span is set).
import { num } from '../../../assets/js/format.js';
import { priceBasis } from './explorer-data.js';
import { vfSummary, loadSheetResult } from './span-data.js';
import { esc, nameOf } from './compare-ui.js';
import { swatchSVG } from './series-style.js';
import { spanText } from './range-slider.js';
import { COPY } from './copy.js';

/** rows for every entry. span = {from,to} | null; win = {desde,hasta}. */
export async function summaryRows(entries, shell, span, win, real) {
  const eff = span || { from: win.desde, to: win.hasta };
  return Promise.all(entries.map(async (e) => {
    if (e.error || e.missing) return { e, ok: false };
    const vf = vfSummary(e.series, eff);
    const row = { e, ok: true, vf, basis: 'Monthly value factors only', exact: false, B: null, C: null, VF: null, cfg: eff };
    if (!span) {
      const pb = priceBasis(e.real || e.rec, real);
      return { ...row, basis: 'Published 12-month window', exact: true, B: pb.base, C: pb.cap, VF: pb.vf };
    }
    if (e.slot.kind === 'node') {
      try {
        const x = await loadSheetResult(e.slot.id, eff.from, eff.to, real);
        if (x) return { ...row, basis: `Exact for this period (node sheet, v1 calculation${x.realUsed === false && real ? '; today\'s pesos unavailable, nominal shown' : ''})`, exact: true, B: x.B, C: x.C, VF: x.VF, x, monthsWithPrices: x.monthsWithData };
      } catch { /* fall through to the monthly summary */ }
    }
    return row;
  }));
}

export function summaryHTML(rows, shell, span, win, real, dflt = true) {
  const eff = span || { from: win.desde, to: win.hasta }, pesos = real ? "today's pesos" : 'nominal';
  const head = ['Slot', 'Months in span', 'Months with data', 'Mean of monthly VF', 'Monthly VF range', `Average price (MXN/MWh, ${pesos})`, `Captured price (MXN/MWh, ${pesos})`, 'Value factor of the period', 'Basis'];
  const body = rows.map((r, k) => {
    const nm = `<td>${swatchSVG(k)} ${esc(nameOf(shell, r.e))}</td>`;
    if (!r.ok) return `<tr>${nm}<td colspan="${head.length - 1}">No data for this slot in the selected window.</td></tr>`;
    const cells = [r.vf.months, r.vf.withData, num(r.vf.mean, 2), r.vf.min === null ? '—' : `${num(r.vf.min, 2)} to ${num(r.vf.max, 2)}`,
      r.B === null ? '—' : num(r.B, 0), r.C === null ? '—' : num(r.C, 0), r.VF === null ? '—' : num(r.VF, 2)];
    return `<tr>${nm}${cells.map((c) => `<td class="n">${c}</td>`).join('')}<td class="${r.exact ? 'exact' : ''}">${esc(r.basis)}</td></tr>`;
  }).join('');
  return `<p class="xp-text">Span: <b>${esc(spanText(eff.from, eff.to))}</b>${span ? '' : ' (the selected 12-month window)'}. Months without complete data are gaps, not zeros.
    Exact period prices exist where the node's monthly sums are published (the node sheets); other slots only carry the monthly value factor, so their span summary is the simple mean of those monthly values, not the period's value factor.</p>
    ${dflt ? '' : `<p class="xp-text"><b>${esc(COPY.monthlyNote)}</b> The prices and value factor of the published window follow the selected mounting and weather.</p>`}
    <div class="tbl cmp"><table><thead><tr>${head.map((h, j) => `<th class="${j && j < head.length - 1 ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}
