// PML decomposition section: one chart per slot (prominent, same in Explorer and Revenue) + a 24-value table.
import { num } from '../../../assets/js/format.js';
import { decompChart } from './chart-decomp.js';
import { renderChart } from './svg-charts.js';
import { COPY } from './copy.js';
import { esc, nameOf, slotNotice } from './compare-ui.js';
import { swatchSVG } from './series-style.js';

const hh = (h) => String(h).padStart(2, '0');

export function decompTable(rec) {
  const h = rec.hours;
  const rows = h.pml.map((p, i) => `<tr><td>${hh(i)}:00</td><td class="n">${num(h.energia[i], 1)}</td><td class="n">${num(h.perdidas[i], 1)}</td><td class="n">${num(h.congestion[i], 1)}</td><td class="n">${num(p, 1)}</td><td class="n">${num(h.y[i], 3)}</td></tr>`).join('');
  return `<table><thead><tr><th>Hour</th><th class="n">System energy (= price − losses − congestion)</th><th class="n">Losses</th><th class="n">Congestion</th><th class="n">Price (PML)</th><th class="n">Solar output, MWh/MWp</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function decompSectionHTML(entries, shell) {
  const multi = entries.length > 1;
  const cards = entries.map((e, k) => {
    const head = multi ? `<div class="slot-head">${swatchSVG(k)}<b>${esc(nameOf(shell, e))}</b></div>` : '';
    if (e.error || e.missing || !e.rec.hours) return `<div class="decomp-slot">${head}<p class="xp-text">${esc(slotNotice(e) || 'No hourly profile for this selection.')}</p></div>`;
    return `<div class="decomp-slot">${head}<div class="chart" data-decomp="${k}"></div>
      <details><summary class="mono">Hour-by-hour values (24)</summary><div class="tbl">${decompTable(e.rec)}</div></details></div>`;
  }).join('');
  return `<section class="xp-card decomp"><h2 class="mono">${esc(COPY.decomp.title)}</h2>
    <div class="legend mono"><span><i style="background:var(--c-energy)"></i>System energy</span><span><i style="background:var(--c-losses)"></i>Losses</span><span><i style="background:var(--c-cong)"></i>Congestion</span>
    <span><i class="line ink"></i>Price (PML)</span><span><i class="dash"></i>Average price</span><span><i class="dot"></i>Captured price</span><span><i class="line prod"></i>Solar output</span><span><i class="band"></i>Solar hours</span></div>
    <p class="xp-text">${esc(COPY.decomp.note)}</p>${cards}</section>`;
}

/** draw the charts after the HTML is in the DOM (they need the real width). */
export function drawDecomp(root, entries) {
  root.querySelectorAll('[data-decomp]').forEach((el) => {
    const e = entries[+el.dataset.decomp];
    if (!e || !e.rec || !e.rec.hours) return;
    renderChart(el, () => decompChart({ ...e.rec.hours, ghost: e.real && e.real.hours ? { pml: e.real.hours.pml, y: e.real.hours.y } : null, base: e.rec.base, cap: e.rec.cap, aria: `Typical day: price by hour split into system energy, losses and congestion, with solar output, average price ${num(e.rec.base, 0)} and captured price ${num(e.rec.cap, 0)}` }));
  });
}
