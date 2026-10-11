// Key indicators for the left column: compact, one block per selected slot (same values as the tiles / comparison tables).
import { num } from '../../../assets/js/format.js';
import { compareRows } from './compare-data.js';
import { swatchSVG } from './series-style.js';
import { esc, nameOf, slotNotice } from './compare-ui.js';

const mil = (v) => num(v / 1e6, 2);

/** items [label, text, unit] for one ok row. view = 'explorer' | 'revenue'. */
export function indicatorItems(row, view, real) {
  const t = row.tiles, r = row.rev, pesos = real ? "today's pesos" : 'nominal';
  const prices = [['Average price', t.base.text, `MXN/MWh, ${pesos}`], ['Captured price', t.cap.text, `MXN/MWh, ${pesos}`], ['Value factor', t.vf.text, `captured ÷ average, ${pesos}`]];
  const rest = [['Solar output at price ≤ 0', t.z.text, '% of energy'], ['Value factor, average day', t.vfDay.text, 'nominal']];
  if (view === 'revenue') return [['Revenue per MWp per year', mil(r.total), `M MXN, ${pesos}`], ['Shortcut overstates by', r.over === null ? '—' : num(r.over, 0), '%'], ...prices, ...rest];
  return [...prices, ...rest, ['Evening peak minus solar hours', t.spread.text, 'MXN/MWh, nominal']];
}

export function indicatorsHTML(entries, shell, view) {
  const real = shell.store.real, rows = compareRows(entries, real), multi = entries.length > 1;
  return rows.map((row, k) => {
    const head = `<div class="ind-head">${multi ? swatchSVG(k) : ''}<b>${esc(nameOf(shell, entries[k]))}</b></div>`;
    if (!row.ok) return `<section class="ind">${head}<p class="xp-text">${esc(slotNotice(entries[k]))}</p></section>`;
    const items = indicatorItems(row, view, real).map(([l, v, u]) => `<div class="ind-item"><span class="mono">${esc(l)}</span><strong>${v}</strong><span class="mono u">${esc(u)}</span></div>`).join('');
    return `<section class="ind">${head}${row.partial ? `<p class="xp-warn-inline">${esc(row.partial)}</p>` : ''}<div class="ind-grid">${items}</div></section>`;
  }).join('');
}
