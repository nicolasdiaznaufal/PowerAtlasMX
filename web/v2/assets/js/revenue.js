// Revenue: PML decomposition by hour (same as Explorer), production x price by hour, revenue per MWp per year, series, comparison table.
import { mountView } from './view-base.js';
import { isNeutral } from './query-extras.js';
import { seriesCardHTML, paintSeries } from './series-card.js';
import { dailyCardHTML, mountDaily } from './daily-card.js';
import { pnlCardHTML, mountPnl } from './pnl-card.js';
import { coverageCardHTML, mountCoverage } from './coverage-card.js';
import { compareRows, columnLabels } from './compare-data.js';
import { tableLabels } from './explorer-data.js';
import { num } from '../../../assets/js/format.js';
import { pairChart, renderChart } from './svg-charts.js';
import { gridHTML, cellHeight } from './grid-plots.js';
import { tableHTML, esc, legendHTML, nameOf, NA_HTML } from './compare-ui.js';

const mil = (v) => (v === null || v === undefined ? 'n/a' : num(v / 1e6, 2));
const hh = (i) => String(i).padStart(2, '0');

function revenueCardHTML(entries, shell) {
  const cells = entries.map((e, k) => ({ title: nameOf(shell, e), id: String(k) }));
  return `<section class="xp-card"><h2 class="mono">Production × price, hour by hour (typical day, 1 MWp)</h2>
    <div class="legend mono"><span><i style="background:var(--s1)"></i>Revenue by hour</span></div>
    ${gridHTML(cells)}<div id="rv-notes" class="xp-text"></div>
    <details><summary class="mono">Hour-by-hour values</summary><div class="tbl" id="rv-table"></div></details></section>`;
}

export function mountRevenue(host, { shell, side }) {
  let seriesView = 'months';
  return mountView({
    host, side, shell, view: 'revenue',
    build: {
      mainHTML: ({ entries }) => `${revenueCardHTML(entries, shell)}${pnlCardHTML()}${coverageCardHTML()}${seriesCardHTML()}${dailyCardHTML('revenue')}${entries.length > 1 ? '<section class="xp-card" id="cmp-table"></section>' : ''}`,
      draw(root, { entries, winId, real, w }, { repaint }) {
        const rows = compareRows(entries, real), L = columnLabels(real, !isNeutral(shell.store.scenario), { cfg: shell.store.cfg, wx: shell.store.wx }), pesos = real ? "today's pesos" : 'nominal';
        const realRows = compareRows(entries.map((e) => (e.real ? { ...e, rec: e.real } : e)), real);
        const gapText = (r) => (r.rev.gap === null || r.rev.total === null ? '' : ` Typical day × 365 is ${num(Math.abs(r.rev.gap), 1)}% ${r.rev.gap >= 0 ? 'above' : 'below'} the published yearly revenue (nominal).`);
        const n = entries.length, H = cellHeight(n, 300), hoursBox = root.querySelector('#rv-notes').parentNode;
        hoursBox.querySelectorAll('[data-cell]').forEach((el) => {
          const k = +el.dataset.cell, r = rows[k], e = entries[k];
          if (!(r.ok && r.rev.hours)) { el.innerHTML = '<p class="xp-text">No hourly profile for this selection.</p>'; return; }
          renderChart(el, () => pairChart({ b: r.rev.hours.real, cb: 'var(--s1)', H, aria: `Typical day: revenue of 1 MWp by hour, ${nameOf(shell, e)}`, ytitle: n > 1 ? '' : `MXN per MWp, per day (${pesos})`, xtitle: n > 1 ? '' : 'Hour of day, Mexico City time (CDMX), hour beginning', unit: 'MXN per MWp', ghost: e.real && realRows[k].ok && realRows[k].rev.hours ? realRows[k].rev.hours.real : null }), { compact: n > 1 });
        });
        root.querySelector('#rv-notes').innerHTML = `<ul class="scale-notes">${rows.map((r, k) => (r.ok && r.rev.scale !== null ? `<li><b>${esc(nameOf(shell, entries[k]))}</b>: ${mil(r.rev.total)} M MXN a year (${pesos}); ${esc(tableLabels(real, r.rev.scale).note)}${esc(gapText(r))}</li>` : '')).join('')}</ul>`;
        if (n === 1 && rows[0].ok && rows[0].rev.hours) {
          const r = rows[0], e = entries[0], lab = tableLabels(real, r.rev.scale), h = e.rec.hours;
          root.querySelector('#rv-table').innerHTML = `<table><thead><tr><th>Hour (CDMX)</th><th class="n">Output, MWh/MWp</th><th class="n">Price (nominal), MXN/MWh</th><th class="n">Output × price, MXN</th><th class="n">${lab.hour}</th></tr></thead><tbody>${h.y.map((y, i) => `<tr><td>${hh(i)}:00</td><td class="n">${num(y, 3)}</td><td class="n">${num(h.pml[i], 0)}</td><td class="n">${num(r.rev.raw[i], 0)}</td><td class="n">${num(r.rev.hours.real[i], 0)}</td></tr>`).join('')}</tbody></table>`;
        } else { root.querySelector('#rv-table').closest('details').hidden = true; }
        mountPnl(root, { shell, winId });
        mountCoverage(root, { shell, winId });
        mountDaily(root, { entries, shell, winId, view: 'revenue' });
        paintSeries(root, { entries, shell, winId, view: seriesView, onView: (v) => { seriesView = v; repaint(); } });
        if (entries.length > 1) {
          const cols = [{ h: L.revenue, get: (r) => (r.na ? NA_HTML : mil(r.rev.total)) }, 
            { h: L.base, get: (r) => r.tiles.base.text }, { h: L.cap, get: (r) => r.tiles.cap.text }, { h: L.vf, get: (r) => (r.na ? NA_HTML : r.tiles.vf.text) }, { h: L.z, get: (r) => r.tiles.z.text }, { h: L.vfDay, get: (r) => (r.na ? NA_HTML : r.tiles.vfDay.text) }];
          root.querySelector('#cmp-table').innerHTML = `<h2 class="mono">${esc(L.heading(w.label))}</h2>${tableHTML(rows, entries, shell, cols)}`;
        }
      },
    },
  });
}
