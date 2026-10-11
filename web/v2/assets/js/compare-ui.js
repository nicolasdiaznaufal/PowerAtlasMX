// Shared compare UI pieces: legend, per-slot header, comparison table, per-slot notices.
import { num } from '../../../assets/js/format.js';
import { swatchSVG } from './series-style.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const nameOf = (shell, e) => shell.label(e.slot).t;

export function legendHTML(entries, shell) {
  return entries.map((e, k) => `<span>${swatchSVG(k)}${esc(nameOf(shell, e))}</span>`).join('');
}

/** why a slot has no numbers (shown instead of tiles / table figures). */
export function slotNotice(e) {
  if (e.error) return 'The data for this slot could not be loaded.';
  if (e.missing) return 'No data for this slot in the selected window.';
  return '';
}

export function slotHeader(e, k, shell, rowNote) {
  return `<div class="slot-head">${swatchSVG(k)}<b>${esc(nameOf(shell, e))}</b><span class="mono">${esc(shell.label(e.slot).k)}</span>${rowNote ? `<em class="xp-warn-inline">${esc(rowNote)}</em>` : ''}</div>`;
}

export function tileHTML(label, value, unit) {
  return `<div class="tile"><span class="mono">${esc(label)}</span><strong>${value}</strong><span class="mono u">${esc(unit)}</span></div>`;
}

/** columns: [{h, get(row)}]; rows from compareRows. Not-ok rows span the figures with the notice. */
export function tableHTML(rows, entries, shell, columns) {
  const head = `<tr><th>Slot</th>${columns.map((c) => `<th class="n">${esc(c.h)}</th>`).join('')}</tr>`;
  const body = rows.map((r, k) => {
    const nm = `<td>${swatchSVG(k)} ${esc(nameOf(shell, entries[k]))}</td>`;
    if (!r.ok) return `<tr>${nm}<td colspan="${columns.length}">${esc(slotNotice(entries[k]))}</td></tr>`;
    return `<tr>${nm}${columns.map((c) => `<td class="n">${c.get(r)}</td>`).join('')}</tr>`
      + (r.partial ? `<tr class="partial"><td></td><td colspan="${columns.length}">${esc(r.partial)}</td></tr>` : '');
  }).join('');
  return `<div class="tbl cmp"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}
export { num };

/** table cell for a figure that is not meaningful under the active scenario (price <= 0): short text, full reason on hover and for readers. */
export const NA_HTML = '<span title="n/a: price ≤ 0 under this scenario" aria-label="n/a: price ≤ 0 under this scenario">n/a (price ≤ 0)</span>';
