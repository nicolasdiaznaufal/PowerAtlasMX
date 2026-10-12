// Revenue: PML decomposition by hour (same as Explorer), production x price by hour, revenue per MWp per year, series, comparison table.
import { mountView } from './view-base.js';
import { isNeutral } from './query-extras.js';
import { decompSectionHTML, drawDecomp } from './decomposition.js';
import { seriesCardHTML, paintSeries } from './series-card.js';
import { dailyCardHTML, mountDaily } from './daily-card.js';
import { pnlCardHTML, mountPnl } from './pnl-card.js';
import { coverageCardHTML, mountCoverage } from './coverage-card.js';
import { compareRows, columnLabels } from './compare-data.js';
import { tableLabels } from './explorer-data.js';
import { num } from '../../../assets/js/format.js';
import { pairChart, lineChart, renderChart } from './svg-charts.js';
import { tableHTML, esc, legendHTML, nameOf, NA_HTML } from './compare-ui.js';

const mil = (v) => (v === null || v === undefined ? 'n/a' : num(v / 1e6, 2));
const hh = (i) => String(i).padStart(2, '0');

function revenueCardHTML(entries) {
  return `<section class="xp-card"><h2 class="mono">Production × price, hour by hour (typical day, 1 MWp)</h2>
    ${entries.length > 1 ? `<div class="legend mono" id="rv-leg"></div>` : '<div class="legend mono"><span><i style="background:var(--s1)"></i>Revenue by hour</span></div>'}
    <div class="chart" id="rv-hours"></div><div id="rv-notes" class="xp-text"></div>
    <details><summary class="mono">Hour-by-hour values</summary><div class="tbl" id="rv-table"></div></details></section>`;
}

export function mountRevenue(host, { shell, side }) {
  let seriesView = 'months';
  return mountView({
    host, side, shell, view: 'revenue',
    build: {
      mainHTML: ({ entries }) => `${decompSectionHTML(entries, shell)}${revenueCardHTML(entries)}${pnlCardHTML()}${coverageCardHTML()}${seriesCardHTML()}${dailyCardHTML('revenue')}${entries.length > 1 ? '<section class="xp-card" id="cmp-table"></section>' : ''}`,
      draw(root, { entries, winId, real, w }, { repaint }) {
        drawDecomp(root, entries);
        const rows = compareRows(entries, real), L = columnLabels(real, !isNeutral(shell.store.scenario), { cfg: shell.store.cfg, wx: shell.store.wx }), pesos = real ? "today's pesos" : 'nominal';
        const realRows = compareRows(entries.map((e) => (e.real ? { ...e, rec: e.real } : e)), real);
        const gapText = (r) => (r.rev.gap === null || r.rev.total === null ? '' : ` Typical day × 365 is ${num(Math.abs(r.rev.gap), 1)}% ${r.rev.gap >= 0 ? 'above' : 'below'} the published yearly revenue (nominal).`);
        const labels = Array.from({ length: 24 }, (_, i) => hh(i));
        const hours = root.querySelector('#rv-hours');
        if (entries.length === 1) {
          const r = rows[0], e = entries[0];
          if (r.ok && r.rev.hours) {
            renderChart(hours, () => pairChart({ b: r.rev.hours.real, cb: 'var(--s1)', H: 300, aria: 'Typical day: revenue of 1 MWp by hour', ytitle: `MXN per MWp, per day (${pesos})`, xtitle: 'Hour of day, Mexico City time (CDMX), hour beginning', unit: 'MXN per MWp', ghost: e.real && realRows[0].ok && realRows[0].rev.hours ? realRows[0].rev.hours.real : null }));
            const lab = tableLabels(real, r.rev.scale);
            root.querySelector('#rv-notes').innerHTML = `<b>${esc(nameOf(shell, e))}</b>: 1 MWp earns ${mil(r.rev.total)} M MXN a year (${pesos}). ${esc(lab.note)}${esc(gapText(r))}`;
            const h = e.rec.hours;
            root.querySelector('#rv-table').innerHTML = `<table><thead><tr><th>Hour (CDMX)</th><th class="n">Output, MWh/MWp</th><th class="n">Price (nominal), MXN/MWh</th><th class="n">Output × price, MXN</th><th class="n">${lab.hour}</th></tr></thead><tbody>${h.y.map((y, i) => `<tr><td>${hh(i)}:00</td><td class="n">${num(y, 3)}</td><td class="n">${num(h.pml[i], 0)}</td><td class="n">${num(r.rev.raw[i], 0)}</td><td class="n">${num(r.rev.hours.real[i], 0)}</td></tr>`).join('')}</tbody></table>`;
          } else hours.innerHTML = '<p class="xp-text">No hourly profile for this selection.</p>';
        } else {
          root.querySelector('#rv-leg').innerHTML = legendHTML(entries, shell);
          const series = rows.map((r, k) => ({ vals: r.ok && r.rev.hours ? r.rev.hours.real : Array(24).fill(null), label: nameOf(shell, entries[k]) }));
          renderChart(hours, () => lineChart({ series, labels, H: 300, xEvery: 2, fmt: (v) => num(v, 0), unit: 'MXN', hoverTitle: (l) => `${l}:00 CDMX`, aria: 'Typical day: hour-by-hour revenue of 1 MWp for each selected slot', ytitle: `MXN per MWp, per day (${pesos})`, xtitle: 'Hour of day, Mexico City time (CDMX), hour beginning' }));
          root.querySelector('#rv-notes').innerHTML = `<ul class="scale-notes">${rows.filter((r) => r.ok && r.rev.scale !== null).map((r) => `<li><b>${esc(nameOf(shell, r.slot ? entries[r.k] : entries[0]))}</b>: ${mil(r.rev.total)} M MXN a year (${pesos}); ${esc(tableLabels(real, r.rev.scale).note)}${esc(gapText(r))}</li>`).join('')}</ul>`;
          root.querySelector('#rv-table').innerHTML = '';
          root.querySelector('#rv-table').closest('details').hidden = true;
        }
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
