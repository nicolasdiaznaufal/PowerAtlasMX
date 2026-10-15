// Daily charts (Explorer: PML / congestion / losses and price spread; Revenue: revenue, captured price, solar hours, solar output):
// 7-day moving averages at DAILY resolution over the main window, one plot per place in a grid, drag-to-zoom shared by the card.
// Loaded lazily when the card scrolls into view.
import { WIN } from '../../../assets/js/names.js';
import { num, mesCorto } from '../../../assets/js/format.js';
import { lineChart, barChart, renderChart, chartWidth, thin, niceTicks, niceMax } from './svg-charts.js';
import { dailyView, rangeOf, dayFactors, dateOf, dayDiff, spanCaptured } from './daily-math.js';
import { loadDaily, loadDeflator, shouldLoadDaily } from './daily-load.js';
import { esc, nameOf } from './compare-ui.js';
import { COPY } from './copy.js';
import { createZoom } from './zoom.js';
import { gridHTML, cellHeight } from './grid-plots.js';
import { swatchStyle } from './series-style.js';

const C = COPY.daily, XT = 'Date (Mexico City time, CDMX)';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d) => `${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
const PARTS = [['pml', 'PML', 'var(--s2)'], ['congestion', 'Congestion', 'var(--s1)'], ['losses', 'Losses', 'var(--s3)']];
const BAR = { hours: ['Solar hours', 'hours per day', 'var(--c-prod)', 1], output: ['Solar output (NASA POWER)', 'MWh per MWp per day', 'var(--s3)', 2] };

export function dailyCardHTML(view) {
  const [title, lines] = view === 'explorer' ? ['Daily price parts, 7-day moving average', [C.avg, C.parts]] : ['Daily captured price, 7-day moving average', [C.avg, C.cap]];
  return `<section class="xp-card daily" id="dl-card"><h2 class="mono">${esc(title)}</h2>${lines.map((l) => `<p class="xp-text">${esc(l)}</p>`).join('')}
    <p class="xp-text">${esc(C.weather)}</p><div id="dl-body"><p class="xp-text">${esc(C.lazy)}</p></div></section>`;
}

/** tick labels: first day of each month for long ranges, else evenly spaced days. */
export function axisTicks(dates, width) {
  const per = 56;
  if (dates.length > 150) {
    const first = dates.map((d, i) => (d.slice(8) === '01' ? i : -1)).filter((i) => i >= 0), every = thin(first.length, width, 50);
    return first.filter((_, j) => j % every === 0).map((i) => ({ i, text: mesCorto(dates[i].slice(0, 7)) }));
  }
  const step = Math.max(1, Math.ceil((dates.length * per) / Math.max(120, width - 60)));
  return dates.map((d, i) => (i % step === 0 ? { i, text: `${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]}` } : null)).filter(Boolean);
}
export const monthTicks = (dates, width) => axisTicks(dates, width);

/** control region of a slot (null for national or unknown). */
export function regionOfSlot(slot, shell) {
  if (slot.kind === 'region') return slot.id;
  if (slot.kind === 'node') { const n = shell.byId && shell.byId.get(slot.id); return n ? n.region : null; }
  if (slot.kind === 'state') { const f = shell.geo && shell.geo.states.features.find((x) => x.properties.key === slot.id); return f ? f.properties.region : null; }
  return null;
}
const title = (s) => (s || '').charAt(0) + (s || '').slice(1).toLowerCase();

export function mountDaily(root, { entries, shell, winId, view }) {
  const card = root.querySelector('#dl-card'), body = card && card.querySelector('#dl-body');
  if (!body) return;
  const slots = entries.map((e) => e.slot), hasSlot = slots.some((s) => s.kind);
  const run = async () => {
    const regKeys = view === 'revenue' ? [...new Set(slots.map((s) => regionOfSlot(s, shell)).filter(Boolean))] : [];
    const [docs, defl, nat, regDocs] = await Promise.all([Promise.all(slots.map((s) => loadDaily(s).catch(() => null))), loadDeflator().catch(() => null),
      view === 'revenue' ? loadDaily({ kind: 'national', id: 'ALL' }).catch(() => null) : null, Promise.all(regKeys.map((k) => loadDaily({ kind: 'region', id: k }).catch(() => null)))]);
    if (!root.isConnected) return;
    const real = shell.store.real, cfg = shell.store.cfg === 'fijo' ? 'fijo' : 'tracker', span = shell.store.span || { from: WIN[winId].desde, to: WIN[winId].hasta };
    const ref = docs.find(Boolean);
    if (!ref) { body.innerHTML = '<p class="xp-text">No daily data for this selection.</p>'; return; }
    const [i0, i1] = rangeOf(ref.start, ref.n, span), dates = Array.from({ length: i1 - i0 + 1 }, (_, i) => dateOf(ref.start, i0 + i));
    const fac = real && defl ? dayFactors(ref.start, ref.n, defl) : null;
    const views = docs.map((d) => (d ? dailyView(d, cfg, { real: !!fac, factors: fac }) : null));
    const vals = (key, k) => (views[k] ? views[k][key].slice(i0, i1 + 1) : dates.map(() => null));
    const pesos = real && defl ? "today's pesos" : 'nominal';
    const missing = entries.filter((_, k) => !docs[k]).map((e) => nameOf(shell, e));
    const notes = `<p class="xp-text">${esc(C.end)} ${esc(C.scope)} Money is shown in ${esc(pesos)}.${missing.length ? esc(` No daily data for: ${missing.join(', ')}.`) : ''}</p>`;
    const zs = (shell.zoomUi = shell.zoomUi || {});
    const n = entries.length, multi = n > 1;
    const cells = entries.map((e, k) => ({ title: nameOf(shell, e), id: String(k) }));
    const zoom = createZoom({ labels: dates, store: zs, key: `daily-${view}`, onChange: () => draw() });
    function plotGrid(host, { key, kind = 'line', fmt, unit, scaleOf, build, H }) {
      const [z0, z1] = zoom.range, d = dates.slice(z0, z1 + 1), tick = axisTicks(d, chartWidth(host.querySelector('.chart')) || 600);
      const all = entries.flatMap((_, k) => vals(key, k).slice(z0, z1 + 1));
      const sc = scaleOf ? scaleOf(all) : null;
      host.querySelectorAll('[data-cell]').forEach((el) => {
        const k = +el.dataset.cell, v = vals(key, k).slice(z0, z1 + 1);
        const geom = renderChart(el, () => (kind === 'bar'
          ? barChart({ bars: d.map((x, i) => ({ v: v[i], label: x, color: build.color })), H, scale: sc, fmt, ytitle: multi ? '' : build.ytitle, xtitle: multi ? '' : XT, aria: build.aria, ticks: tick, hoverTitle: fmtDate, minBw: 0.6, hoverName: build.name })
          : lineChart({ series: build.series(k, v, z0, z1), labels: d, ticks: tick, markEvery: 0, H, fmt, unit, ytitle: multi ? '' : build.ytitle, xtitle: multi ? '' : XT, aria: build.aria, scale: sc, hoverTitle: fmtDate })), { compact: multi });
        zoom.attach(el, geom, d.length);
      });
    }
    const scale0 = (all) => { const f = all.filter((v) => v !== null && Number.isFinite(v)); return niceTicks(Math.min(0, ...f), niceMax(Math.max(...f, 1e-9))); };
    function draw() {
      const grid = () => gridHTML(cells, body.clientWidth || 900);
      const lh = cellHeight(n, 300), sh = cellHeight(n, 240), bh = cellHeight(n, 240);
      if (view === 'explorer') {
        const leg = `<div class="legend mono">${PARTS.map(([, l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;
        body.innerHTML = `${zoom.barHTML()}<h3 class="mono sub">PML, congestion and losses, 7-day moving average (MXN/MWh, ${esc(pesos)})</h3>${leg}<div id="g-parts">${grid()}</div>
          <h3 class="mono sub">Daily price spread (max PML − min PML), 7-day moving average</h3><p class="xp-text">${esc(C.spread)}</p><div id="g-spread">${grid()}</div>${notes}`;
        const partsAll = entries.flatMap((_, k) => PARTS.flatMap(([key]) => vals(key, k).slice(zoom.range[0], zoom.range[1] + 1)));
        const f = partsAll.filter((v) => v !== null && Number.isFinite(v)), psc = niceTicks(Math.min(0, ...f), niceMax(Math.max(...f, 1e-9)));
        const [z0, z1] = zoom.range, d = dates.slice(z0, z1 + 1), host = body.querySelector('#g-parts');
        const tick = axisTicks(d, chartWidth(host.querySelector('.chart')) || 600);
        host.querySelectorAll('[data-cell]').forEach((el) => {
          const k = +el.dataset.cell;
          const series = PARTS.map(([key, l, color]) => ({ vals: vals(key, k).slice(z0, z1 + 1), label: l, style: { color, dash: '', marker: 'circle' } }));
          const geom = renderChart(el, () => lineChart({ series, labels: d, ticks: tick, markEvery: 0, H: lh, fmt: (v) => num(v, 0), unit: 'MXN/MWh', ytitle: multi ? '' : `MXN/MWh (${pesos})`, xtitle: multi ? '' : XT, aria: 'PML, congestion and losses per day, 7-day moving average', scale: psc, hoverTitle: fmtDate }), { compact: multi });
          zoom.attach(el, geom, d.length);
        });
        plotGrid(body.querySelector('#g-spread'), { key: 'spread', fmt: (v) => num(v, 0), unit: 'MXN/MWh', scaleOf: scale0, H: sh,
          build: { ytitle: `MXN/MWh (${pesos})`, aria: 'Daily price spread, 7-day moving average', series: (k, v) => [{ vals: v, label: 'Price spread', style: { color: 'var(--s1)', dash: '', marker: 'circle' } }] } });
      } else {
        const one = (id, title, text = '', wide = null) => `<h3 class="mono sub">${esc(title)}</h3>${text ? `<p class="xp-text">${esc(text)}</p>` : ''}<div id="${id}">${gridHTML(cells, wide || body.clientWidth || 900)}</div>`;
        body.innerHTML = `${zoom.barHTML()}<h3 class="mono sub">Captured price, 7-day moving average, with the span average, national and control-region averages (MXN/MWh, ${esc(pesos)})</h3><p class="xp-text">${esc(C.cap)}</p><div id="cap-leg"></div><div id="g-cap">${grid()}</div>
          <div class="bar-pair"><div>${one('g-hours', `${BAR.hours[0]}, 7-day moving average (${BAR.hours[1]})`, C.hours, (body.clientWidth || 900) / 2)}</div><div>${one('g-out', `${BAR.output[0]}, 7-day moving average (${BAR.output[1]})`, C.output, (body.clientWidth || 900) / 2)}</div></div>${notes}`;
        // captured price: the place, its average over the span (ratio of sums), the national line and the control-region line (existing daily area files)
        const capOf = (doc) => { if (!doc) return null; const off = dayDiff(ref.start, doc.start); if (off !== 0 || doc.n !== ref.n) return null; return dailyView(doc, cfg, { real: !!fac, factors: fac }).cap.slice(i0, i1 + 1); };
        const natCap = capOf(nat), regCap = new Map(regKeys.map((k, j) => [k, capOf(regDocs[j])]));
        const [z0, z1] = zoom.range, d = dates.slice(z0, z1 + 1), host = body.querySelector('#g-cap'), tick = axisTicks(d, chartWidth(host.querySelector('.chart')) || 600);
        const STY = { place: { color: 'var(--s1)', dash: '', marker: 'circle' }, avg: { color: 'var(--ink-2)', dash: '7 4', marker: 'square' }, nat: { color: 'var(--s2)', dash: '2 4', marker: 'triangle' }, reg: { color: 'var(--s3)', dash: '10 3 2 3', marker: 'circle' } };
        const linesOf = (k) => {
          const slot = slots[k], lines = [{ vals: vals('cap', k).slice(z0, z1 + 1), label: nameOf(shell, entries[k]), style: STY.place }];
          const avg = docs[k] ? spanCaptured(docs[k], cfg, i0, i1, fac) : null;
          if (avg !== null) lines.push({ vals: d.map(() => avg), label: 'Average over the span', style: STY.avg });
          if (natCap && slot.kind !== 'national') lines.push({ vals: natCap.slice(z0, z1 + 1), label: 'National', style: STY.nat });
          const rk = regionOfSlot(slot, shell), rc = rk && slot.kind !== 'region' && slot.kind !== 'national' ? regCap.get(rk) : null;
          if (rc) lines.push({ vals: rc.slice(z0, z1 + 1), label: `${title(rk)} region`, style: STY.reg });
          return lines;
        };
        const all = entries.flatMap((_, k) => linesOf(k).flatMap((l) => l.vals)).filter((v) => v !== null && Number.isFinite(v));
        const sc = niceTicks(Math.min(0, ...all), niceMax(Math.max(...all, 1e-9)));
        body.querySelector('#cap-leg').innerHTML = `<div class="legend mono">${[['Place', STY.place], ['Average over the span', STY.avg], ['National', STY.nat], ['Control region', STY.reg]].map(([l, st]) => `<span>${swatchStyle(st)}${esc(l)}</span>`).join('')}</div>`;
        host.querySelectorAll('[data-cell]').forEach((el) => {
          const k = +el.dataset.cell, H = cellHeight(n, 300);
          const geom = renderChart(el, () => lineChart({ series: linesOf(k), labels: d, ticks: tick, markEvery: 0, H, fmt: (v) => num(v, 0), unit: 'MXN/MWh', ytitle: multi ? '' : `MXN/MWh (${pesos})`, xtitle: multi ? '' : XT, aria: `Captured price per day, 7-day moving average, with the span average, national and region lines, ${nameOf(shell, entries[k])}`, scale: sc, hoverTitle: fmtDate }), { compact: multi });
          zoom.attach(el, geom, d.length);
        });
        for (const [id, key] of [['#g-hours', 'hours'], ['#g-out', 'output']]) {
          const [t, u, color, dg] = BAR[key];
          plotGrid(body.querySelector(id), { key, kind: 'bar', fmt: (v) => num(v, dg), scaleOf: scale0, H: bh, build: { color, ytitle: u, name: t, aria: `Daily ${t.toLowerCase()}, 7-day moving average` } });
        }
      }
      zoom.wire(body);
      body.querySelectorAll('[data-z="reset"]').forEach((b) => { b.disabled = !zoom.zoomed; });
    }
    draw();
  };
  const gate = () => { if (hasSlot) run().catch((e) => { console.error(e); if (root.isConnected) body.innerHTML = '<p class="xp-text">Daily values could not be loaded.</p>'; }); };
  if (!hasSlot) { body.innerHTML = '<p class="xp-text">No daily data for this selection.</p>'; return; }
  if (typeof IntersectionObserver === 'undefined') { if (shouldLoadDaily(true, hasSlot)) gate(); return; }
  const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && shouldLoadDaily(true, hasSlot)) { io.disconnect(); gate(); } });
  io.observe(card);
}
