// Daily charts (Explorer: value factor, price parts, spread; Revenue: revenue and one metric): 7-day moving averages at DAILY
// resolution over the time-span slider, for the node or area slots. Loaded lazily when the card scrolls into view.
import { WIN } from '../../../assets/js/names.js';
import { num, mesCorto } from '../../../assets/js/format.js';
import { lineChart, vfAxis, renderChart, chartWidth, thin } from './svg-charts.js';
import { dailyView, rangeOf, dayFactors, dateOf, clampVf, VF_AXIS } from './daily-math.js';
import { loadDaily, loadDeflator, shouldLoadDaily } from './daily-load.js';
import { legendHTML, esc, nameOf } from './compare-ui.js';
import { segment } from './controls.js';
import { COPY } from './copy.js';

const C = COPY.daily, XT = 'Date (Mexico City time, CDMX)';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d) => `${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
const COMPS = [['pml', 'PML'], ['congestion', 'Congestion'], ['losses', 'Losses']];
const METRICS = { cap: ['Captured price', 'MXN/MWh', 'cap'], hours: ['Solar hours', 'hours per day', 'hours'], output: ['Solar output', 'MWh per MWp per day', 'output'] };

export function dailyCardHTML(view) {
  const [title, lines] = view === 'explorer' ? ['Daily value factor, 7-day moving average', [C.avg, C.vf]] : ['Daily revenue, 7-day moving average', [C.avg, C.revenue]];
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

/** re-render finished -> put the focus back on the control that was used (keyboard users keep their place). */
export const refocus = (done, body, sel) => done.then(() => { const t = body.querySelector(sel); if (t) t.focus(); });

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
    const q = (s) => body.querySelector(s), again = (sel) => refocus(run(), body, sel);
    if (view === 'explorer') {
      const one = entries.length === 1 && entries[0].series;
      body.innerHTML = `${leg}<label class="chk"><input type="checkbox" id="dl-month"${ui.monthly && one ? ' checked' : ''}${one ? '' : ' disabled'}> <span>Show the monthly value factor behind (single-axis tracker, yearly-mean weather)${one ? '' : '; single selection only'}</span></label>
        <div class="chart" id="dl-vf"></div>
        <h3 class="mono sub">Also show the 7-day average of</h3><div class="presets" id="dl-chips" role="group" aria-label="Price parts to add">${COMPS.map(([k, l]) => `<button type="button" class="chip-btn" data-c="${k}" aria-pressed="${ui.comps.includes(k)}">${l}</button>`).join('')}</div>
        <div id="dl-comp"></div>
        <h3 class="mono sub">Daily price spread (max PML − min PML), 7-day moving average</h3><p class="xp-text">${esc(C.spread)}</p><div class="chart" id="dl-spread"></div>${notes}`;
      const vf = seriesOf('vf').map((sr) => ({ ...sr, ...clampVf(sr.vals) }));
      if (one && ui.monthly) {
        const m = new Map(entries[0].series.months.map((mm, i) => [mm, entries[0].series.vf[i]]));
        vf.push({ ...clampVf(dates.map((d) => (m.has(d.slice(0, 7)) ? m.get(d.slice(0, 7)) : null))), label: 'Monthly value factor (tracker, yearly-mean weather)', style: { color: 'var(--ink-3)', dash: '2 3', marker: 'circle' } });
      }
      const hid = views.reduce((n, v) => n + (v ? v.vfHidden.slice(i0, i1 + 1).filter(Boolean).length : 0), 0), clip = vf.reduce((n, sr) => n + sr.clipped, 0);
      q('#dl-vf').insertAdjacentHTML('beforebegin', `${hid ? `<p class="xp-text">${esc(C.hidden(hid))}</p>` : ''}${clip ? `<p class="xp-text">${esc(C.clipped)}</p>` : ''}`);
      plot(q('#dl-vf'), dates, vf, { fmt: (v) => num(v, 2), unit: '', ytitle: 'Value factor', aria: 'Daily value factor, 7-day moving average', scale: vfAxis(vf.flatMap((sr) => sr.vals)), refs: [1], H: 300 });
      const cmp = q('#dl-comp');
      cmp.innerHTML = COMPS.filter(([k]) => ui.comps.includes(k)).map(([k, l]) => `<h3 class="mono sub">${l}, 7-day moving average (MXN/MWh, ${esc(pesos)})</h3><div class="chart" data-k="${k}"></div>`).join('');
      cmp.querySelectorAll('[data-k]').forEach((el) => plot(el, dates, seriesOf(el.dataset.k), { unit: 'MXN/MWh', ytitle: `MXN/MWh (${pesos})`, aria: `${el.dataset.k} per day, 7-day moving average`, H: 220 }));
      plot(q('#dl-spread'), dates, seriesOf('spread'), { unit: 'MXN/MWh', ytitle: `MXN/MWh (${pesos})`, aria: 'Daily price spread, 7-day moving average', H: 240 });
      q('#dl-month').addEventListener('change', (ev) => { ui.monthly = ev.target.checked; again('#dl-month'); });
      body.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.c; ui.comps = ui.comps.includes(k) ? ui.comps.filter((x) => x !== k) : [...ui.comps, k]; again(`[data-c="${k}"]`); }));
      return;
    }
    const [mt, mu, mkey] = METRICS[ui.metric], hcap = ui.metric === 'cap' ? `, ${pesos}` : '';
    body.innerHTML = `${leg}<h3 class="mono sub">Revenue per MWp per day (${esc(pesos)})</h3><div class="chart" id="dl-rev"></div>
      <div class="xp-vhead"><h3 class="mono sub" id="dl-mt"></h3><div class="seg" role="radiogroup" aria-label="Daily metric" id="dl-metric" style="grid-template-columns:repeat(3,1fr);width:100%;max-width:420px"></div></div>
      <p class="xp-text" id="dl-mx"></p><div class="chart" id="dl-met"></div>${notes}`;
    plot(q('#dl-rev'), dates, seriesOf('revenue'), { fmt: (v) => num(v, 0), unit: 'MXN per MWp', ytitle: `MXN per MWp per day (${pesos})`, aria: 'Daily revenue of 1 MWp, 7-day moving average', H: 300 });
    q('#dl-mt').textContent = `${mt}, 7-day moving average (${mu}${hcap})`;
    q('#dl-mx').textContent = C[ui.metric];
    segment(q('#dl-metric'), Object.entries(METRICS).map(([k, v]) => [k, v[0]]), ui.metric, (k) => { ui.metric = k; again('#dl-metric [aria-checked="true"]'); });
    plot(q('#dl-met'), dates, seriesOf(mkey), { fmt: (v) => num(v, ui.metric === 'output' ? 2 : 1), unit: mu, ytitle: `${mu}${hcap}`, aria: `Daily ${mt.toLowerCase()}, 7-day moving average`, H: 260 });
  };
  const gate = () => { if (hasSlot) run().catch(() => { if (root.isConnected) body.innerHTML = '<p class="xp-text">Daily values could not be loaded.</p>'; }); };
  if (!hasSlot) { body.innerHTML = '<p class="xp-text">No daily data for this selection.</p>'; return; }
  if (typeof IntersectionObserver === 'undefined') { if (shouldLoadDaily(true, hasSlot)) gate(); return; }
  const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && shouldLoadDaily(true, hasSlot)) { io.disconnect(); gate(); } });
  io.observe(card);
}
