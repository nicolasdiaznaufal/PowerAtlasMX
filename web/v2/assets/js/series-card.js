// Value factor (and, by year, average and captured price) over time: By month | By year, one or several slots.
import { WIN } from '../../../assets/js/names.js';
import { num, mesCorto } from '../../../assets/js/format.js';
import { priceBasis } from './explorer-data.js';
import { yearAxis } from './compare-data.js';
import { lineChart, vfAxis, renderChart, chartWidth, thin } from './svg-charts.js';
import { paintMonthPrices } from './price-month.js';
import { legendHTML, esc, nameOf } from './compare-ui.js';
import { segment } from './controls.js';
import { COPY } from './copy.js';
import { createZoom } from './zoom.js';
import { gridHTML, cellHeight } from './grid-plots.js';
import { inSpan } from './span-data.js';
import { isNeutral } from './query-extras.js';
import { isDefaultCtx } from './solar-data.js';


export function seriesCardHTML() {
  return `<section class="xp-card series"><div class="xp-vhead"><h2 class="mono" id="sr-title">Value factor over time</h2>
    <div class="seg" role="radiogroup" aria-label="Series by month or by year" id="sr-view" style="grid-template-columns:repeat(2,1fr)"></div></div>
    <div id="sr-zoom"></div><div class="legend mono" id="sr-leg"></div><div class="chart" id="sr-vf"></div><div id="sr-pm" hidden></div><div class="chart" id="sr-px" hidden></div>
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
  const dflt = isDefaultCtx({ cfg: shell.store.cfg, wx: shell.store.wx });
  const ctxLabel = `${shell.store.cfg === 'fijo' ? 'fixed tilt' : 'single-axis tracker'}, ${COPY.wxLabel(shell.store.wx)}`;
  q('#sr-note').textContent = COPY.seriesNote + (dflt ? '' : ` ${COPY.monthlyNote}`) + (sim ? ' The lines and the span summary are published values, not simulated.' : '');
  const px = q('#sr-px'); px.hidden = view !== 'years'; q('#sr-pm').hidden = view !== 'months' || !ok.length;
  if (!ok.length) { q('#sr-vf').innerHTML = '<p class="xp-text">No series for this selection.</p>'; q('#sr-table').innerHTML = ''; return; }
  const multi = entries.length > 1;
  if (view === 'months') {
    const allMonths = ok[0].series.months, keep0 = allMonths.map((m) => inSpan(m, span)), months0 = allMonths.filter((_, i) => keep0[i]);
    const zs = (shell.zoomUi = shell.zoomUi || {});
    const zoom = createZoom({ labels: months0, store: zs, key: 'series-months', onChange: () => paintSeries(root, { entries, shell, winId, view, onView }) });
    const [z0, z1] = zoom.range;
    let c = -1;
    const keep = keep0.map((k) => { if (k) c++; return k && c >= z0 && c <= z1; });
    const months = months0.slice(z0, z1 + 1), every = thin(months.length, chartWidth(q('#sr-vf')), 56, 6);
    q('#sr-zoom').innerHTML = zoom.barHTML(); zoom.wire(q('#sr-zoom'));
    const rb = q('#sr-zoom [data-z="reset"]'); if (rb) rb.disabled = !zoom.zoomed;
    const mk = every > 0 ? every : 1;
    if (!multi) {
      const e = ok[0], pb = priceBasis(e.real || e.rec, real), sb = e.real ? priceBasis(e.rec, real) : null; // the bars are published: so is the line
      const vfs = e.series.vf.filter((_, i) => keep0[i]).slice(z0, z1 + 1);
      const inWin = months.map((m) => m >= w.desde && m <= w.hasta), runs = [];
      inWin.forEach((on, i) => { if (on && (i === 0 || !inWin[i - 1])) runs.push([i, i]); else if (on) runs[runs.length - 1][1] = i; });
      const vfTxt = `${num(pb.vf, 2)}${pb.real ? " (today's pesos)" : ' (nominal)'}`;
      const winLine = dflt
        ? `<span><i class="dash"></i>VF of the window${sim ? ' (published)' : ''}: ${vfTxt}</span>`
        : `<span class="exact">VF of the window, ${esc(ctxLabel)}: ${vfTxt}. The line is tracker, yearly-mean weather.</span>`;
      q('#sr-leg').innerHTML = `<span><i style="background:var(--s1)"></i>Value factor by month</span><span><i style="background:var(--s1);opacity:.35"></i>${esc(w.label)}</span>${winLine}${sb ? `<span class="exact">Simulated VF of the window: ${sb.vf === null ? 'n/a (price ≤ 0)' : num(sb.vf, 2)}</span>` : ''}`;
      const geom = renderChart(q('#sr-vf'), () => lineChart({ series: [{ vals: vfs, label: 'Value factor' }], labels: months.map(mesCorto), bands: runs, hline: dflt ? { v: pb.vf, label: `Window ${num(pb.vf, 2)}` } : null, refs: [1], scale: vfAxis(vfs.concat(dflt ? [pb.vf] : [])), H: 300, xEvery: mk, markEvery: 6, aria: 'Value factor by month', ytitle: 'Value factor', xtitle: 'Month' }));
      zoom.attach(q('#sr-vf'), geom, months.length);
    } else {
      // one plot per place (same value-factor scale in every cell), not an overlay
      q('#sr-leg').innerHTML = '';
      const ser = entries.map((e) => (e.series ? e.series.vf.filter((_, i) => keep0[i]).slice(z0, z1 + 1) : months.map(() => null)));
      const sc = vfAxis(ser.flat()), host = q('#sr-vf');
      host.innerHTML = gridHTML(entries.map((e, k) => ({ title: nameOf(shell, e), id: String(k) })));
      const H = cellHeight(entries.length, 260), ev = Math.max(1, Math.ceil(months.length / 8));
      host.querySelectorAll('[data-cell]').forEach((el) => {
        const k = +el.dataset.cell;
        const geom = renderChart(el, () => lineChart({ series: [{ vals: ser[k], label: 'Value factor' }], labels: months.map(mesCorto), refs: [1], H, scale: sc, xEvery: ev, markEvery: 0, aria: `Value factor by month, ${nameOf(shell, entries[k])}`, ytitle: '', xtitle: '' }), { compact: true });
        zoom.attach(el, geom, months.length);
      });
    }
    paintMonthPrices(q('#sr-pm'), { entries, shell, allMonths, keep, real, zoom });
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
