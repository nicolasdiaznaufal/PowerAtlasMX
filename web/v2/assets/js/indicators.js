// Key indicators for the left column: compact, one block per selected slot (same values as the tiles / comparison tables).
import { num } from '../../../assets/js/format.js';
import { compareRows } from './compare-data.js';
import { swatchSVG } from './series-style.js';
import { esc, nameOf, slotNotice } from './compare-ui.js';

const mil = (v) => num(v / 1e6, 2);

/** items [label, text, unit] for one ok row. view = 'explorer' | 'revenue'. */
export function indicatorItems(row, view, real, base = null) {
  const t = row.tiles, r = row.rev, pesos = real ? "today's pesos" : 'nominal';
  const d = (v, b, dec) => (base && v !== null && b !== null && v !== undefined && b !== undefined ? `${v - b >= 0 ? '+' : '−'}${num(Math.abs(v - b), dec)}` : '');
  const prices = [['Average price', t.base.text, `MXN/MWh, ${pesos}`, d(t.base.value, base && base.tiles.base.value, 0)], ['Captured price', t.cap.text, `MXN/MWh, ${pesos}`, d(t.cap.value, base && base.tiles.cap.value, 0)],
    ['Value factor', t.vf.text, `captured ÷ average, ${pesos}`, d(t.vf.value, base && base.tiles.vf.value, 2)]];
  const sim = base ? ' · not simulated' : '';
  const rest = [['Solar output at price ≤ 0', t.z.text, `% of energy${sim}`], ['Value factor, average day', t.vfDay.text, 'nominal', d(t.vfDay.value, base && base.tiles.vfDay.value, 2)]];
  if (view === 'revenue') return [['Revenue per MWp per year', mil(r.total), `M MXN, ${pesos}`, base ? d(r.total / 1e6, base.rev.total / 1e6, 2) : ''], ['Shortcut overstates by', r.over === null ? '—' : num(r.over, 0), '%', ''], ...prices, ...rest];
  return [...prices, ...rest, ['Evening peak minus solar hours', t.spread.text, `MXN/MWh, nominal${sim}`, '']];
}

export function indicatorsHTML(entries, shell, view) {
  const real = shell.store.real, rows = compareRows(entries, real), multi = entries.length > 1;
  const base = compareRows(entries.map((e) => (e.real ? { ...e, rec: e.real } : e)), real);
  return rows.map((row, k) => {
    const head = `<div class="ind-head">${multi ? swatchSVG(k) : ''}<b>${esc(nameOf(shell, entries[k]))}</b>${entries[k].real ? '<span class="badge">Simulated</span>' : ''}</div>`;
    if (!row.ok) return `<section class="ind">${head}<p class="xp-text">${esc(slotNotice(entries[k]))}</p></section>`;
    const sim = !!entries[k].real;
    const items = indicatorItems(row, view, real, sim && base[k].ok ? base[k] : null).map(([l, v, u, dl]) => `<div class="ind-item"><span class="mono">${esc(l)}</span><strong>${v}</strong>${dl ? `<span class="mono delta">${esc(dl)} vs real</span>` : ''}<span class="mono u">${esc(u)}</span></div>`).join('');
    return `<section class="ind">${head}${row.partial ? `<p class="xp-warn-inline">${esc(row.partial)}</p>` : ''}<div class="ind-grid">${items}</div></section>`;
  }).join('');
}
