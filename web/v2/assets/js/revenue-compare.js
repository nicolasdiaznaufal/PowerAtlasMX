// Revenue with 2-3 slots: revenue per MWp per slot, hour-by-hour revenue overlay, comparison table, scaling disclosure per slot.
import { WIN } from '../../../assets/js/names.js';
import { num } from '../../../assets/js/format.js';
import { compareRows, columnLabels } from './compare-data.js';
import { tableLabels } from './explorer-data.js';
import { lineChart } from './svg-charts.js';
import { legendHTML, slotHeader, slotNotice, tileHTML, tableHTML, esc } from './compare-ui.js';

const mil = (v) => num(v / 1e6, 2);

export function paintRevenueCompare(el, { entries, shell, winId }) {
  const real = shell.store.real, rows = compareRows(entries, real), w = WIN[winId];
  const pesos = real ? "today's pesos" : 'nominal';
  const unit = real ? "MXN/MWh, today's pesos" : 'MXN/MWh';
  const blocks = rows.map((r, k) => `<section class="slot-block">${slotHeader(entries[k], k, shell, r.partial)}${r.ok ? `<div class="tiles">${[
    tileHTML('Revenue per MWp per year', mil(r.rev.total), `M MXN${real ? ", today's pesos" : ''}`),
    tileHTML('Shortcut revenue', mil(r.rev.shortcut), `M MXN${real ? ", today's pesos" : ''}, every hour at the average price`),
    tileHTML('Shortcut overstates by', r.rev.over === null ? '—' : num(r.rev.over, 0), '%'),
    tileHTML('Average price', r.tiles.base.text, unit), tileHTML('Captured price', r.tiles.cap.text, unit), tileHTML('Value factor', r.tiles.vf.text, 'captured ÷ average')].join('')}</div>`
    : `<p class="xp-text">${esc(slotNotice(entries[k]))}</p>`}</section>`).join('');
  const labels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const series = rows.map((r, k) => ({ vals: r.ok && r.rev.hours ? r.rev.hours.real : Array(24).fill(null), label: shell.label(entries[k].slot).t }));
  const chart = lineChart({ series, labels, H: 250, xEvery: 3, fmt: (v) => num(v, 0), aria: 'Typical day: hour-by-hour revenue of 1 MWp for each selected slot', ytitle: `MXN per MWp, per day (${pesos})` });
  const L = columnLabels(real);
  const cols = [
    { h: L.revenue, get: (r) => mil(r.rev.total) }, { h: L.shortcut, get: (r) => mil(r.rev.shortcut) },
    { h: L.over, get: (r) => (r.rev.over === null ? '—' : num(r.rev.over, 0)) },
    { h: L.base, get: (r) => r.tiles.base.text }, { h: L.cap, get: (r) => r.tiles.cap.text }, { h: L.vf, get: (r) => r.tiles.vf.text },
    { h: L.z, get: (r) => r.tiles.z.text }, { h: L.vfDay, get: (r) => r.tiles.vfDay.text },
  ];
  const notes = rows.filter((r) => r.ok && r.rev.scale !== null).map((r, k) => {
    const lab = tableLabels(real, r.rev.scale), gap = r.rev.gap === null ? '' : ` Typical day × 365 is ${num(Math.abs(r.rev.gap), 1)}% ${r.rev.gap >= 0 ? 'above' : 'below'} the published yearly revenue (nominal).`;
    return `<li><b>${esc(shell.label(r.slot).t)}</b>: ${esc(lab.note)}${esc(gap)}</li>`;
  }).join('');
  el.innerHTML = `${blocks}
    <section class="xp-card"><h2 class="mono">Typical day, hour-by-hour revenue of 1 MWp (scaled to the published yearly figure)</h2><div class="legend mono">${legendHTML(entries, shell)}</div><div class="chart narrow">${chart}</div>
      <details><summary class="mono">How the bars are scaled</summary><ul class="xp-text scale-notes">${notes}</ul></details></section>
    <section class="xp-card"><h2 class="mono">${esc(L.heading(w.label))}</h2>${tableHTML(rows, entries, shell, cols)}</section>`;
}
