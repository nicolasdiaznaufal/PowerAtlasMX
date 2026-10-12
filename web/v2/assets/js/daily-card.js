// Daily charts (Explorer: value factor, price parts, spread; Revenue: revenue and one metric): 7-day moving averages at DAILY
// resolution over the time-span slider, for the node or area slots. Loaded lazily when the card scrolls into view.
import { WIN } from '../../../assets/js/names.js';
import { num, mesCorto } from '../../../assets/js/format.js';
import { lineChart, barChart, renderChart, chartWidth, thin } from './svg-charts.js';
import { dailyView, rangeOf, dayFactors, dateOf } from './daily-math.js';
import { loadDaily, loadDeflator, shouldLoadDaily } from './daily-load.js';
import { legendHTML, esc, nameOf } from './compare-ui.js';
import { STYLES, swatchStyle } from './series-style.js';
import { COPY } from './copy.js';

const C = COPY.daily, XT = 'Date (Mexico City time, CDMX)';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d) => `${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
// the three price parts share one plot: one colour per part (line style and marker tell the slots apart when several are selected)
const PARTS = [['pml', 'PML', 'var(--s2)'], ['congestion', 'Congestion', 'var(--s1)'], ['losses', 'Losses', 'var(--s3)']];
const BAR = { hours: ['Solar hours', 'hours per day', 'var(--c-prod)', 1], output: ['Solar output (NASA POWER)', 'MWh per MWp per day', 'var(--s3)', 2] };

export function dailyCardHTML(view) {
  const [title, lines] = view === 'explorer' ? ['Daily price parts, 7-day moving average', [C.avg, C.parts]] : ['Daily revenue, 7-day moving average', [C.avg, C.revenue]];
  return `<section class="xp-card daily" id="dl-card"><h2 class="mono">${esc(title)}</h2>${lines.map((l) => `<p class="xp-text">${esc(l)}</p>`).join('')}
    <p class="xp-text">${esc(C.weather)}</p><div id="dl-body"><p class="xp-text">${esc(C.lazy)}</p></div></section>`;
}

/** month tick labels at the first day of each month, thinned to the chart width. */
export function monthTicks(dates, width) {
  const first = dates.map((d, i) => (d.slice(8) === '01' ? i : -1)).filter((i) => i >= 0);
  const every = thin(first.length, width, 50);
  return first.filter((_, j) => j % every === 0).map((i) => ({ i, text: mesCorto(dates[i].slice(0, 7)) }));
}

function plot(el, dates, series, { fmt = (v) => num(v, 1), unit, ytitle, aria, scale = null, refs = [], H = 260 }) {
  renderChart(el, () => lineChart({ series, labels: dates, ticks: monthTicks(dates, chartWidth(el)), markEvery: 0, H, fmt, unit, ytitle, aria, xtitle: XT, scale, refs, hoverTitle: fmtDate }));
}

export function mountDaily(root, { entries, shell, winId, view }) {
  const card = root.querySelector('#dl-card'), body = card && card.querySelector('#dl-body');
  if (!body) return;
  const slots = entries.map((e) => e.slot), hasSlot = slots.some((s) => s.kind);
  const ui = (shell.dailyUi = shell.dailyUi || { monthly: true, comps: [], metric: 'cap' });
  const run = async () => {
    const [docs, defl] = await Promise.all([Promise.all(slots.map((s) => loadDaily(s).catch(() => null))), loadDeflator().catch(() => null)]);
    if (!root.isConnected) return;
    const real = shell.store.real, cfg = shell.store.cfg === 'fijo' ? 'fijo' : 'tracker', span = shell.store.span || { from: WIN[winId].desde, to: WIN[winId].hasta };
    const ref = docs.find(Boolean);
    if (!ref) { body.innerHTML = '<p class="xp-text">No daily data for this selection.</p>'; return; }
    const [i0, i1] = rangeOf(ref.start, ref.n, span), dates = Array.from({ length: i1 - i0 + 1 }, (_, i) => dateOf(ref.start, i0 + i));
    const fac = real && defl ? dayFactors(ref.start, ref.n, defl) : null;
    const views = docs.map((d) => (d ? dailyView(d, cfg, { real: !!fac, factors: fac }) : null));
    const seriesOf = (key) => entries.map((e, k) => ({ vals: views[k] ? views[k][key].slice(i0, i1 + 1) : dates.map(() => null), label: nameOf(shell, e) }));
    const pesos = real && defl ? "today's pesos" : 'nominal';
    const missing = entries.filter((_, k) => !docs[k]).map((e) => nameOf(shell, e));
    const notes = `<p class="xp-text">${esc(C.end)} ${esc(C.scope)} Money is shown in ${esc(pesos)}.${missing.length ? esc(` No daily data for: ${missing.join(', ')}.`) : ''}</p>`;
    const leg = `<div class="legend mono">${entries.length > 1 ? legendHTML(entries, shell) : '<span><i style="background:var(--s1)"></i>7-day moving average</span>'}</div>`;
    const q = (s) => body.querySelector(s);
    if (view === 'explorer') {
      const multi = entries.length > 1;
      const parts = PARTS.flatMap(([k, l, color]) => entries.map((e, j) => ({ vals: views[j] ? views[j][k].slice(i0, i1 + 1) : dates.map(() => null), label: multi ? `${l} · ${nameOf(shell, e)}` : l, style: { ...STYLES[multi ? j % 3 : 0], color, dash: multi ? STYLES[j % 3].dash : '' } })));
      const pleg = `<div class="legend mono">${parts.map((sr) => `<span>${swatchStyle(sr.style)}${esc(sr.label)}</span>`).join('')}</div>`;
      body.innerHTML = `<h3 class="mono sub">PML, congestion and losses, 7-day moving average (MXN/MWh, ${esc(pesos)})</h3>${pleg}<div class="chart" id="dl-parts"></div>
        <h3 class="mono sub">Daily price spread (max PML − min PML), 7-day moving average</h3><p class="xp-text">${esc(C.spread)}</p>${leg}<div class="chart" id="dl-spread"></div>${notes}`;
      plot(q('#dl-parts'), dates, parts, { fmt: (v) => num(v, 0), unit: 'MXN/MWh', ytitle: `MXN/MWh (${pesos})`, aria: 'PML, congestion and losses per day, 7-day moving average', H: 300 });
      plot(q('#dl-spread'), dates, seriesOf('spread'), { fmt: (v) => num(v, 0), unit: 'MXN/MWh', ytitle: `MXN/MWh (${pesos})`, aria: 'Daily price spread, 7-day moving average', H: 240 });
      return;
    }
    const bars = (key) => entries.map((e, k) => {
      const [t, u, color, dg] = BAR[key], v = views[k] ? views[k][key].slice(i0, i1 + 1) : dates.map(() => null);
      return `<div class="bar-one"><h3 class="mono sub">${esc(t)}, 7-day moving average (${esc(u)})${entries.length > 1 ? ` · ${esc(nameOf(shell, e))}` : ''}</h3><p class="xp-text">${esc(C[key])}</p><div class="chart" data-b="${key}" data-k="${k}"></div></div>`;
    }).join('');
    body.innerHTML = `${leg}<h3 class="mono sub">Revenue per MWp per day (${esc(pesos)})</h3><div class="chart" id="dl-rev"></div>
      <h3 class="mono sub">Captured price, 7-day moving average (MXN/MWh, ${esc(pesos)})</h3><p class="xp-text">${esc(C.cap)}</p><div class="chart" id="dl-cap"></div>
      <div class="bar-pair"><div>${bars('hours')}</div><div>${bars('output')}</div></div>${notes}`;
    plot(q('#dl-rev'), dates, seriesOf('revenue'), { fmt: (v) => num(v, 0), unit: 'MXN per MWp', ytitle: `MXN per MWp per day (${pesos})`, aria: 'Daily revenue of 1 MWp, 7-day moving average', H: 300 });
    plot(q('#dl-cap'), dates, seriesOf('cap'), { fmt: (v) => num(v, 0), unit: 'MXN/MWh', ytitle: `MXN/MWh (${pesos})`, aria: 'Captured price per day, 7-day moving average', H: 280 });
    body.querySelectorAll('[data-b]').forEach((el) => {
      const key = el.dataset.b, [t, u, color, dg] = BAR[key], v = views[+el.dataset.k];
      const vals = v ? v[key].slice(i0, i1 + 1) : dates.map(() => null);
      renderChart(el, () => barChart({ bars: dates.map((d, i) => ({ v: vals[i], label: d, color })), H: 240, fmt: (x) => num(x, dg), ytitle: u, xtitle: XT, aria: `Daily ${t.toLowerCase()}, 7-day moving average`, ticks: monthTicks(dates, chartWidth(el)), hoverTitle: fmtDate, minBw: 0.6, hoverName: t }));
    });
  };
  const gate = () => { if (hasSlot) run().catch(() => { if (root.isConnected) body.innerHTML = '<p class="xp-text">Daily values could not be loaded.</p>'; }); };
  if (!hasSlot) { body.innerHTML = '<p class="xp-text">No daily data for this selection.</p>'; return; }
  if (typeof IntersectionObserver === 'undefined') { if (shouldLoadDaily(true, hasSlot)) gate(); return; }
  const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && shouldLoadDaily(true, hasSlot)) { io.disconnect(); gate(); } });
  io.observe(card);
}
