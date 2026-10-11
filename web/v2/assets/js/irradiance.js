// Solar resource of node slots: GHI and plane-of-array (tracker or fixed per mounting), monthly and typical day, optional clear-sky
// reference (a reference line, not a scenario: no KPIs exist for it) and cloud loss. Areas have no irradiance files.
import { num } from '../../../assets/js/format.js';
import { irradianceOf, isDefaultCtx } from './solar-data.js';
import { groupChart, lineChart, renderChart, chartWidth, thin } from './svg-charts.js';
import { COPY } from './copy.js';
import { esc, nameOf } from './compare-ui.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sum = (a) => (a || []).reduce((s, v) => s + (v || 0), 0);
const rot = (from) => MONTHS.slice(from).concat(MONTHS.slice(0, from)); // Aug..Jul

/** monthly series of one irradiance record for a window: win variants carry the window months (Aug..Jul), others Jan..Dec. */
export function monthly(rec, winId, wx) {
  if (!rec) return null;
  if (wx === 'win' && rec['m' + winId]) return { labels: rot(7), vals: rec['m' + winId] };
  return { labels: MONTHS, vals: rec.m };
}

/** cloud loss in % = 1 - real / clear over the year; null when either side is missing. */
export function cloudLoss(real, clear) {
  const a = sum(real), b = sum(clear);
  return a > 0 && b > 0 ? (1 - a / b) * 100 : null;
}

/** everything the card shows for one node: real and clear series, annual totals, cloud losses. */
export function nodeSolar({ id, cfg, wx, winId, vfile, clear }) {
  const r = irradianceOf(vfile, id, cfg);
  if (!r) return null;
  const c = clear ? irradianceOf(clear, id, cfg) : null;
  // clear sky is a climatology: its monthly values are Jan..Dec even when the weather variant is `win`
  const mRealPoa = monthly(r.poa, winId, wx), mRealGhi = monthly(r.ghi, winId, wx);
  const annual = { ghi: sum(mRealGhi.vals), poa: sum(mRealPoa.vals) };
  const out = { r, c, mGhi: mRealGhi, mPoa: mRealPoa, annual, loss: null };
  if (c) {
    out.mGhiClear = c.ghi.m; out.mPoaClear = c.poa.m;
    out.loss = { ghi: cloudLoss(mRealGhi.vals, c.ghi.m), poa: cloudLoss(mRealPoa.vals, c.poa.m), prod: cloudLoss(r.y && r.y[winId], c.y && c.y[winId]) };
  }
  return out;
}

export function irradianceCardHTML(slots, clearOn) {
  return `<section class="xp-card irr" id="irr-card"><div class="xp-vhead"><h2 class="mono">Solar resource: irradiance and production</h2>
    <label class="chk"><input type="checkbox" id="irr-clear"${clearOn ? ' checked' : ''}> <span>Show clear-sky reference</span></label></div>
    <p class="xp-text">${esc(COPY.irrNote)}</p><div id="irr-body">${slots.some((s) => s.kind === 'node') ? '<p class="xp-text">Irradiance loads when this section comes into view.</p>' : '<p class="xp-text">Irradiance is available for nodes: pick a node to see it.</p>'}</div></section>`;
}

/** body: fills #irr-body once the files are loaded. data = {vfile, clear}; entries = scenario/real entries with slots. */
export function paintIrradiance(root, { entries, shell, winId, cfg, wx, data, clearOn }) {
  const body = root.querySelector('#irr-body');
  if (!body) return;
  const nodes = entries.map((e, k) => ({ e, k })).filter(({ e }) => e.slot.kind === 'node' && !e.error && !e.missing);
  if (!nodes.length) { body.innerHTML = `<p class="xp-text">${esc(COPY.irrNote)}</p>`; return; }
  const plane = cfg === 'fijo' ? 'plane of array, fixed tilt' : 'plane of array, tracker';
  body.innerHTML = nodes.map(({ e, k }) => `<div class="irr-slot"><h3 class="mono sub">${esc(nameOf(shell, e))}</h3><div class="irr-sum" data-sum="${k}"></div>
    <div class="legend mono"><span><i style="background:var(--s1)"></i>Plane of array (solid)</span><span><i style="background:var(--s2)"></i>Global horizontal (dashed)</span>${clearOn ? '<span><i class="outline"></i>Clear sky: outline bars, dotted lines</span>' : ''}</div>
    <div class="chart" data-m="${k}"></div><div class="chart" data-h="${k}"></div><div class="chart" data-p="${k}"></div></div>`).join('');
  for (const { e, k } of nodes) {
    const s = nodeSolar({ id: e.slot.id, cfg, wx, winId, vfile: data.vfile, clear: clearOn ? data.clear : null });
    const sum = body.querySelector(`[data-sum="${k}"]`);
    if (!s) { sum.textContent = 'No irradiance for this node.'; continue; }
    const wxNote = wx === 'win' ? ' (window months, Aug to Jul)' : '';
    sum.innerHTML = `Yearly total${esc(wxNote)}: <b>${num(s.annual.ghi, 0)}</b> kWh/m² global horizontal · <b>${num(s.annual.poa, 0)}</b> kWh/m² ${plane}`
      + (s.loss ? ` · cloud loss vs clear sky: <b>${s.loss.poa === null ? '—' : num(s.loss.poa, 1)}%</b> of yearly plane-of-array irradiance, <b>${s.loss.prod === null ? '—' : num(s.loss.prod, 1)}%</b> of typical-day production (1 − real ÷ clear)` : '');
    const ghost = clearOn && s.c;
    renderChart(body.querySelector(`[data-m="${k}"]`), () => groupChart({ labels: s.mGhi.labels, H: 230, fmt: (v) => num(v, 0), xEvery: thin(12, chartWidth(body.querySelector(`[data-m="${k}"]`)), 44),
      series: [{ vals: s.mGhi.vals, color: 'var(--s2)', label: 'GHI' }, { vals: s.mPoa.vals, color: 'var(--s1)', label: 'POA' }, ...(ghost ? [{ vals: s.mGhiClear, ghost: true, label: 'GHI, clear sky' }, { vals: s.mPoaClear, ghost: true, label: 'POA, clear sky' }] : [])],
      aria: 'Monthly irradiance in kWh per square metre: global horizontal and plane of array', ytitle: 'kWh/m² per month', xtitle: wx === 'win' ? 'Month of the window' : 'Month (typical year)' }));
    const hrs = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
    const hs = [{ vals: s.r.poa[winId], label: 'POA' }, { vals: s.r.ghi[winId], label: 'GHI', style: { color: 'var(--s2)', dash: '7 4', marker: 'square' } }];
    if (ghost) hs.push({ vals: s.c.poa[winId], label: 'POA, clear sky', style: { color: 'var(--s1)', dash: '2 4', marker: 'triangle' } }, { vals: s.c.ghi[winId], label: 'GHI, clear sky', style: { color: 'var(--s2)', dash: '2 4', marker: 'triangle' } });
    renderChart(body.querySelector(`[data-h="${k}"]`), () => lineChart({ series: hs, labels: hrs, H: 230, xEvery: 2, markEvery: 2, fmt: (v) => num(v, 2), aria: 'Typical day irradiance by hour in kWh per square metre', ytitle: 'kWh/m² per hour', xtitle: 'Hour of day, CDMX clock (start of hour)' }));
    const ps = [{ vals: s.r.y && s.r.y[winId], label: 'Production' }];
    if (ghost && s.c.y) ps.push({ vals: s.c.y[winId], label: 'Production, clear sky', style: { color: 'var(--s1)', dash: '2 4', marker: 'triangle' } });
    renderChart(body.querySelector(`[data-p="${k}"]`), () => lineChart({ series: ps, labels: hrs, H: 200, xEvery: 2, markEvery: 2, fmt: (v) => num(v, 2), aria: 'Typical day production by hour in megawatt hours per megawatt peak', ytitle: 'MWh per MWp', xtitle: 'Hour of day, CDMX clock (start of hour)' }));
  }
}

/** the irradiance files (4-5 MB) are fetched only when the card is visible, or when a non-default option already fetched that file. */
export const shouldLoadIrradiance = (ctx, visible) => !!visible || !isDefaultCtx(ctx);
