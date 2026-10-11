// Explorer with 2-3 slots: tiles per slot, overlaid typical-day price and output, VF over time, comparison table.
// Every figure comes from the same tilesOf / recordFor values Explorer shows for a single slot.
import { WIN } from '../../../assets/js/names.js';
import { num, mesCorto } from '../../../assets/js/format.js';
import { compareRows, yearAxis, columnLabels } from './compare-data.js';
import { priceBasis } from './explorer-data.js';
import { lineChart, vfAxis } from './svg-charts.js';
import { legendHTML, slotHeader, slotNotice, tileHTML, tableHTML, esc } from './compare-ui.js';
import { segment } from './controls.js';

export function paintExplorerCompare(el, { entries, shell, winId, view, onView }) {
  const real = shell.store.real, rows = compareRows(entries, real), ok = entries.filter((e) => !e.error && !e.missing);
  const w = WIN[winId];
  const tiles = rows.map((r, k) => `<section class="slot-block">${slotHeader(entries[k], k, shell, r.partial)}${
    r.ok ? `<div class="tiles">${Object.values(r.tiles).map((t) => tileHTML(t.label, t.text, t.unit)).join('')}</div>` : `<p class="xp-text">${esc(slotNotice(entries[k]))}</p>`}</section>`).join('');
  const hrs = (key) => entries.map((e) => ({ vals: e.rec && e.rec.hours ? e.rec.hours[key] : Array(24).fill(null), label: shell.label(e.slot).t }));
  const hourLabels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const price = lineChart({ series: hrs('pml'), labels: hourLabels, H: 240, xEvery: 3, fmt: (v) => num(v, 0), aria: 'Typical day: price by hour for each selected slot', ytitle: 'MXN/MWh (nominal)' });
  const prod = lineChart({ series: hrs('y'), labels: hourLabels, H: 170, xEvery: 3, fmt: (v) => num(v, 2), aria: 'Typical day: solar output by hour for each selected slot', ytitle: 'MWh per MWp' });
  let vfChart;
  if (view === 'months') {
    const months = ok.length ? ok[0].series.months : [];
    const ser = entries.map((e) => ({ vals: e.series ? e.series.vf : months.map(() => null), label: shell.label(e.slot).t }));
    vfChart = lineChart({ series: ser, labels: months.map(mesCorto), refs: [1],
      H: 240, scale: vfAxis(ser.flatMap((x) => x.vals)), xEvery: 12, markEvery: 6, aria: 'Value factor by month for each selected slot', ytitle: 'Value factor' });
  } else {
    const ya = yearAxis(entries, real);
    const ser = entries.map((e, k) => ({ vals: ya.vals[k], label: shell.label(e.slot).t }));
    vfChart = lineChart({ series: ser, labels: ya.years, refs: [1], H: 240, scale: vfAxis(ser.flatMap((x) => x.vals)), aria: 'Value factor by calendar year for each selected slot', ytitle: 'Value factor' });
  }
  const L = columnLabels(real);
  const cols = [
    { h: L.base, get: (r) => r.tiles.base.text }, { h: L.cap, get: (r) => r.tiles.cap.text }, { h: L.vf, get: (r) => r.tiles.vf.text },
    { h: L.z, get: (r) => r.tiles.z.text }, { h: L.vfDay, get: (r) => r.tiles.vfDay.text },
  ];
  el.innerHTML = `${tiles}
    <div class="xp-cols">
      <section class="xp-card"><h2 class="mono">Typical day, price by hour (nominal MXN)</h2><div class="legend mono">${legendHTML(entries, shell)}</div><div class="chart">${price}</div>
        <h2 class="mono">Typical day, solar output by hour</h2><div class="chart">${prod}</div></section>
      <section class="xp-card"><div class="xp-vhead"><h2 class="mono">Value factor over time (months in nominal MXN)</h2><div class="seg" role="radiogroup" aria-label="Time view" id="cx-view"></div></div>
        <div class="legend mono">${legendHTML(entries, shell)}</div><div class="chart">${vfChart}</div>
        <p class="xp-text">${esc(w.label)}. Same figures as Explorer shows for each slot on its own.</p></section>
    </div>
    <section class="xp-card"><h2 class="mono">${esc(L.heading(w.label))}</h2>${tableHTML(rows, entries, shell, cols)}</section>`;
  segment(el.querySelector('#cx-view'), [['months', 'Months'], ['years', 'Calendar years']], view, onView);
  void priceBasis;
}
