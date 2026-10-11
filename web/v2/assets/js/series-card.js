// Value factor (and, by year, average and captured price) over time: By month | By year, one or several slots.
import { WIN } from '../../../assets/js/names.js';
import { num, mesCorto } from '../../../assets/js/format.js';
import { priceBasis } from './explorer-data.js';
import { yearAxis } from './compare-data.js';
import { barChart, lineChart, vfAxis, renderChart, chartWidth, thin } from './svg-charts.js';
import { legendHTML, esc, nameOf } from './compare-ui.js';
import { segment } from './controls.js';
import { COPY } from './copy.js';
import { inSpan } from './span-data.js';
import { isNeutral } from './query-extras.js';

const SAND = 'var(--s1)', MUTED = 'var(--c-energy)';

export function seriesCardHTML() {
  return `<section class="xp-card series"><div class="xp-vhead"><h2 class="mono" id="sr-title">Value factor over time</h2>
    <div class="seg" role="radiogroup" aria-label="Series by month or by year" id="sr-view" style="grid-template-columns:repeat(2,1fr)"></div></div>
    <div class="legend mono" id="sr-leg"></div><div class="chart" id="sr-vf"></div><div class="chart" id="sr-px" hidden></div>
    <p class="xp-text" id="sr-note"></p><details><summary class="mono">Data table</summary><div class="tbl" id="sr-table"></div></details>
    <h3 class="mono sub">Summary of the time span</h3><div id="sr-summary" aria-live="polite"></div></section>`;
}

/** entries: slot entries (series may be null); view 'months' | 'years'. */
export function paintSeries(root, { entries, shell, winId, view, onView }) {
  const q = (s) => root.querySelector(s), real = shell.store.real, w = WIN[winId], span = shell.store.span;
  const ok = entries.filter((e) => e.series);
  segment(q('#sr-view'), [['months', 'By month'], ['years', 'By year']], view, onView);
  q('#sr-title').textContent = view === 'months' ? `Value factor by month${span ? ` (${span.from} to ${span.to})` : ''} (nominal MXN)` : `Value factor, average and captured price by calendar year${real ? " (today's pesos)" : ' (nominal MXN)'}`;
  const sim = !isNeutral(shell.store.scenario);
  q('#sr-note').textContent = COPY.seriesNote + (sim ? ' The bars, lines and the span summary are published values, not simulated.' : '');
  const px = q('#sr-px'); px.hidden = view !== 'years';
  if (!ok.length) { q('#sr-vf').innerHTML = '<p class="xp-text">No series for this selection.</p>'; q('#sr-table').innerHTML = ''; return; }
  const multi = entries.length > 1;
  if (view === 'months') {
    const allMonths = ok[0].series.months, keep = allMonths.map((m) => inSpan(m, span)), months = allMonths.filter((_, i) => keep[i]), every = thin(months.length, chartWidth(q('#sr-vf')), 56, 6);
    if (!multi) {
      const e = ok[0], pb = priceBasis(e.real || e.rec, real), sb = e.real ? priceBasis(e.rec, real) : null; // the bars are published: so is the line
      const vfs = e.series.vf.filter((_, i) => keep[i]);
      const bars = months.map((m, i) => { const inW = m >= w.desde && m <= w.hasta, v = vfs[i]; return { v, label: mesCorto(m), color: inW ? SAND : MUTED, tip: `${mesCorto(m)}: ${v === null ? 'no data' : num(v, 2)}${inW ? ' (in window)' : ''}` }; });
      q('#sr-leg').innerHTML = `<span><i style="background:${SAND}"></i>${esc(w.label)}</span><span><i style="background:${MUTED}"></i>Other months</span><span><i class="dash"></i>VF of the window${sim ? ' (published)' : ''}: ${num(pb.vf, 2)}${pb.real ? " (today's pesos)" : ' (nominal)'}</span>${sb ? `<span class="exact">Simulated VF of the window: ${sb.vf === null ? 'n/a (price ≤ 0)' : num(sb.vf, 2)}</span>` : ''}`;
      renderChart(q('#sr-vf'), () => barChart({ bars, hline: { v: pb.vf, label: `Window ${num(pb.vf, 2)}` }, refs: [1], scale: vfAxis(bars.map((b) => b.v).concat([pb.vf])), H: 300, xEvery: every, aria: 'Value factor by month', ytitle: 'Value factor', xtitle: 'Month' }));
    } else {
      q('#sr-leg').innerHTML = legendHTML(entries, shell);
      const ser = entries.map((e) => ({ vals: e.series ? e.series.vf.filter((_, i) => keep[i]) : months.map(() => null), label: nameOf(shell, e) }));
      renderChart(q('#sr-vf'), () => lineChart({ series: ser, labels: months.map(mesCorto), refs: [1], H: 300, scale: vfAxis(ser.flatMap((x) => x.vals)), xEvery: every, markEvery: 6, aria: 'Value factor by month for each selected slot', ytitle: 'Value factor', xtitle: 'Month' }));
    }
    q('#sr-table').innerHTML = tableHTML(['Month', ...entries.map((e) => nameOf(shell, e))], months.map((m, i) => [mesCorto(m), ...entries.map((e) => (e.series ? e.series.vf.filter((_, j) => keep[j])[i] : null))]), 2);
    return;
  }
  const ya0 = yearAxis(entries, real), yKeep = ya0.years.map((y) => !span || (`${y}-01` >= span.from && `${y}-12` <= span.to));
  const sel = yKeep.some(Boolean) ? yKeep : ya0.years.map(() => true);
  if (span && !yKeep.some(Boolean)) q('#sr-note').textContent = `No full calendar year in this span; showing all years. ${q('#sr-note').textContent}`;
  const ya = { years: ya0.years.filter((_, i) => sel[i]), vals: ya0.vals.map((v) => v.filter((_, i) => sel[i])) };
  q('#sr-leg').innerHTML = multi ? legendHTML(entries, shell) : '<span><i style="background:var(--s1)"></i>Value factor</span>';
  const vser = entries.map((e, k) => ({ vals: ya.vals[k], label: nameOf(shell, e) }));
  renderChart(q('#sr-vf'), () => lineChart({ series: vser, labels: ya.years, refs: [1], H: 280, scale: vfAxis(vser.flatMap((x) => x.vals)), aria: 'Value factor by calendar year', ytitle: 'Value factor', xtitle: 'Calendar year' }));
  // average and captured price by year (published yearly sums)
  const rows = entries.map((e) => (e.series ? e.series.years.filter((y) => e.series.y[String(y)]).map((y) => { const r = e.series.y[String(y)]; return { y: String(y), b: real && r[2] ? r[2] : r[0], c: real && r[3] ? r[3] : r[1] }; }) : []));
  const at = (k, key) => ya.years.map((y) => { const r = rows[k].find((x) => x.y === y); return r ? r[key] : null; });
  const k0 = entries.findIndex((e) => e.series), nm = multi ? ` (${nameOf(shell, entries[k0])})` : '';
  const pser = [{ vals: at(k0, 'b'), label: `Average price${nm}` }, { vals: at(k0, 'c'), label: `Captured price${nm}` }];
  renderChart(px, () => lineChart({ series: pser, labels: ya.years, H: 260, fmt: (v) => num(v, 0), aria: 'Average and captured price by calendar year', ytitle: `MXN/MWh${real ? ", today's pesos" : ', nominal'}`, xtitle: 'Calendar year' }));
  if (multi) px.insertAdjacentHTML('beforeend', '<p class="xp-text">With several slots the price chart shows the first slot; all slots are in the table.</p>');
  q('#sr-table').innerHTML = tableHTML(['Year', ...entries.flatMap((e) => [`${nameOf(shell, e)} VF`, 'Average', 'Captured'])],
    ya.years.map((y, i) => [y, ...entries.flatMap((_, k) => [ya.vals[k][i], at(k, 'b')[i], at(k, 'c')[i]])]), 2);
}

function tableHTML(head, rows, d) {
  const cell = (v, j) => (j === 0 ? esc(v) : v === null || v === undefined ? '—' : num(v, /Average|Captured/.test(head[j]) ? 0 : d));
  return `<table><thead><tr>${head.map((h, j) => `<th class="${j ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v, j) => `<td class="${j ? 'n' : ''}">${cell(v, j)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
