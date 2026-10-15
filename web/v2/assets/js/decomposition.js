// PML decomposition section (Explorer): one chart per place in a grid (1 -> 1, 2-4 -> 2x2, 5-9 -> 3x3, 10-16 -> 4x4) + a 24-value table each.
import { num } from '../../../assets/js/format.js';
import { decompChart } from './chart-decomp.js';
import { renderChart } from './svg-charts.js';
import { COPY } from './copy.js';
import { esc, nameOf, slotNotice } from './compare-ui.js';
import { gridCols, cellHeight } from './grid-plots.js';

const hh = (h) => String(h).padStart(2, '0');

export function decompTable(rec) {
  const h = rec.hours;
  const rows = h.pml.map((p, i) => `<tr><td>${hh(i)}:00</td><td class="n">${num(h.energia[i], 1)}</td><td class="n">${num(h.perdidas[i], 1)}</td><td class="n">${num(h.congestion[i], 1)}</td><td class="n">${num(p, 1)}</td><td class="n">${num(h.y[i], 3)}</td></tr>`).join('');
  return `<table><thead><tr><th>Hour (CDMX)</th><th class="n">System energy (= price − losses − congestion)</th><th class="n">Losses</th><th class="n">Congestion</th><th class="n">Price (PML)</th><th class="n">Solar output, MWh/MWp</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function decompSectionHTML(entries, shell) {
  const n = entries.length, multi = n > 1, cols = gridCols(n);
  const cards = entries.map((e, k) => {
    const head = multi ? `<div class="slot-head"><b>${esc(nameOf(shell, e))}</b></div>` : '';
    if (e.error || e.missing || !e.rec.hours) return `<div class="decomp-slot">${head}<p class="xp-text">${esc(slotNotice(e) || 'No hourly profile for this selection.')}</p></div>`;
    return `<div class="decomp-slot">${head}<div class="chart" data-decomp="${k}"></div>
      <details><summary class="mono">Hour-by-hour values (24)</summary><div class="tbl">${decompTable(e.rec)}</div></details></div>`;
  }).join('');
  return `<section class="xp-card decomp"><h2 class="mono">${esc(COPY.decomp.title)}</h2>
    <div class="legend mono small"><span><i style="background:var(--c-energy)"></i>System energy</span><span><i style="background:var(--c-losses)"></i>Losses</span><span><i style="background:var(--c-cong)"></i>Congestion</span>
    <span><i class="line ink"></i>Price (PML)</span><span><i class="dash"></i>Average price</span><span><i class="dot"></i>Captured price</span><span><i class="line prod"></i>Solar output</span><span><i class="band"></i>Solar hours</span></div>
    <details class="how"><summary class="mono">How to read this chart</summary><p class="xp-text">${esc(COPY.decomp.note)}</p><p class="xp-text">${esc(COPY.clockNote)}</p></details>
    <div class="pgrid cols-${cols}" style="--cols:${cols}">${cards}</div></section>`;
}

/** draw the charts after the HTML is in the DOM (they need the real width). One place: a compact height so the card fits a viewport with the simulation box. */
export function drawDecomp(root, entries) {
  const n = entries.length, H = n <= 1 ? 280 : cellHeight(n, 280, { reserve: 260 });
  root.querySelectorAll('[data-decomp]').forEach((el) => {
    const e = entries[+el.dataset.decomp];
    if (!e || !e.rec || !e.rec.hours) return;
    renderChart(el, () => decompChart({ ...e.rec.hours, H, ghost: e.real && e.real.hours ? { pml: e.real.hours.pml, y: e.real.hours.y } : null, base: e.rec.base, cap: e.rec.cap, aria: `Typical day: price by hour split into system energy, losses and congestion, with solar output, average price ${num(e.rec.base, 0)} and captured price ${num(e.rec.cap, 0)}` }), { compact: n > 1 });
  });
}
