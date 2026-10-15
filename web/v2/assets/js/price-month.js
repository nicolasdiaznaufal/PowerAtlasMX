// Average and captured price by month (line plot). Monthly sums exist in the node sheets only (v1 calculation via span-data).
import { num, mesCorto } from '../../../assets/js/format.js';
import { loadSheetResult } from './span-data.js';
import { lineChart, renderChart, chartWidth, thin, niceTicks, niceMax } from './svg-charts.js';
import { STYLES } from './series-style.js';
import { legendHTML, esc, nameOf } from './compare-ui.js';
import { gridHTML, cellHeight } from './grid-plots.js';

/** one entry -> { avg: [...], cap: [...] } over `all` months, or null when the slot has no node sheet. */
async function monthly(e, all, real) {
  if (e.slot.kind !== 'node' || e.error || e.missing) return null;
  try {
    const x = await loadSheetResult(e.slot.id, all[0], all[all.length - 1], real);
    if (!x) return null;
    const by = new Map(x.mensual.map((m) => [m.mes, m]));
    const pick = (k) => all.map((m) => { const r = by.get(m); return r && r[k] !== null && r[k] !== undefined && Number.isFinite(r[k]) ? r[k] : null; });
    return { avg: pick('B'), cap: pick('C'), nominalOnly: real && x.realUsed === false };
  } catch { return null; }
}

/** paints into `el`; `keep` selects the months inside the span. Safe against stale async paints. */
export async function paintMonthPrices(el, { entries, shell, allMonths, keep, real, zoom = null }) {
  const token = (el._pm = (el._pm || 0) + 1);
  el.innerHTML = '<p class="xp-text">Loading monthly prices…</p>';
  const res = await Promise.all(entries.map((e) => monthly(e, allMonths, real)));
  if (token !== el._pm || !el.isConnected) return;
  const months = allMonths.filter((_, i) => keep[i]), sel = (a) => a.filter((_, i) => keep[i]);
  const any = res.some(Boolean), multi = entries.length > 1;
  if (!any) { el.innerHTML = '<p class="xp-text">Monthly average and captured prices are available for the nodes with a published sheet. This selection only carries the monthly value factor.</p>'; return; }
  const series = [];
  res.forEach((r, k) => {
    if (!r) return;
    const nm = multi ? nameOf(shell, entries[k]) : null, st = STYLES[k % 3];
    if (multi) {
      series.push({ vals: sel(r.cap), label: `${nm}, captured`, style: st });
      series.push({ vals: sel(r.avg), label: `${nm}, average`, style: { ...st, dash: '2 3', marker: 'circle' } });
    } else {
      series.push({ vals: sel(r.avg), label: 'Average price', style: { color: 'var(--ink-2)', dash: '7 4', marker: 'square' } });
      series.push({ vals: sel(r.cap), label: 'Captured price', style: STYLES[0] });
    }
  });
  const missing = entries.filter((_, k) => !res[k]).map((e) => nameOf(shell, e));
  const unit = `MXN/MWh${real ? ", today's pesos" : ', nominal'}`;
  const nomNote = res.some((r) => r && r.nominalOnly) ? " Today's pesos are not available for part of this selection; nominal values are shown there." : '';
  el.innerHTML = `<h3 class="mono sub">Average and captured price by month (${esc(unit)})</h3>
    ${multi ? '<div class="legend mono"><span><i style="background:var(--s1)"></i>Captured price</span><span><i class="dot"></i>Average price</span></div>' : '<div class="legend mono"><span><i class="line ink"></i>Average price</span><span><i style="background:var(--s1)"></i>Captured price</span></div>'}
    <div class="chart" data-pm></div>
    <p class="xp-text">MDA reference price (CENACE). ${missing.length ? esc(`No monthly prices for: ${missing.join(', ')}.`) : ''}${esc(nomNote)}</p>`;
  const box = el.querySelector('[data-pm]'), every = thin(months.length, chartWidth(box), 56, 6);
  if (!multi) {
    const geom = renderChart(box, () => lineChart({ series, labels: months.map(mesCorto), H: 260, xEvery: every, markEvery: 6, fmt: (v) => num(v, 0), unit: 'MXN/MWh', aria: 'Average and captured price by month', ytitle: unit, xtitle: 'Month' }));
    if (zoom) zoom.attach(box, geom, months.length);
    return;
  }
  // one plot per place with a published sheet, same price scale in every cell
  const per = entries.map((e, k) => (res[k] ? { k, avg: sel(res[k].avg), cap: sel(res[k].cap) } : null)).filter(Boolean);
  const all = per.flatMap((p) => [...p.avg, ...p.cap]).filter((v) => v !== null && Number.isFinite(v));
  const top = Math.max(...all, 1), sc = niceTicks(Math.min(0, ...all), niceMax(top));
  box.innerHTML = gridHTML(per.map((p) => ({ title: nameOf(shell, entries[p.k]), id: String(p.k) })));
  const H = cellHeight(per.length, 240), ev = Math.max(1, Math.ceil(months.length / 8));
  box.querySelectorAll('[data-cell]').forEach((cell) => {
    const p = per.find((x) => x.k === +cell.dataset.cell);
    const geom = renderChart(cell, () => lineChart({ series: [{ vals: p.avg, label: 'Average price', style: { color: 'var(--ink-2)', dash: '2 3', marker: 'circle' } }, { vals: p.cap, label: 'Captured price', style: STYLES[0] }],
      labels: months.map(mesCorto), H, scale: sc, xEvery: ev, markEvery: 0, fmt: (v) => num(v, 0), unit: 'MXN/MWh', aria: `Average and captured price by month, ${nameOf(shell, entries[p.k])}`, ytitle: '', xtitle: '' }), { compact: true });
    if (zoom) zoom.attach(cell, geom, months.length);
  });
}
