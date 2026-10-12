// Tiny SVG charts (no library): colours come from CSS tokens so they follow the theme and the contrast test.
import { num } from '../../../assets/js/format.js';
import { STYLES, markerPath } from './series-style.js';
import { setHover, takeHover, attachHover } from './hover.js';

export let W = 640;
export const PAD = { l: 52, r: 12, t: 24, b: 48 };
/** the viewBox follows the real pixel width so tick text keeps its size on phones (no shrunken, unreadable labels). */
export const chartWidth = (el) => Math.max(300, Math.min(1000, Math.round((el && el.clientWidth) || 640)));
/** label every n-th tick so that labels keep about `per` px apart in a plot of width `width` (multiple of `unit`, e.g. 6 months). */
export function thin(n, width, per = 54, unit = 1) {
  const plot = Math.max(120, width - PAD.l - PAD.r), every = Math.max(1, Math.ceil((n * per) / plot));
  return Math.ceil(every / unit) * unit;
}
export function renderChart(el, build) {
  W = chartWidth(el); setHover(null); el.innerHTML = build();
  const spec = takeHover();
  if (spec && typeof document !== 'undefined' && el && typeof el.querySelector === 'function') attachHover(el, spec);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
/** round ticks covering [lo, hi] (about n intervals); always contains 0 when lo <= 0 <= hi. */
export function niceTicks(lo, hi, n = 4) {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toFixed(10));
  return { lo: ticks[0], hi: ticks[ticks.length - 1], ticks };
}
const finite = (vals) => vals.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
/** VF axis: 0..max(1, data) in steps of 0.4 (0.25 up to 1); negative values extend the lower bound in the same 0.4 steps. */
export function vfAxis(values) {
  const v = finite(values), m = Math.max(0, ...v), mn = Math.min(0, ...v);
  let hi = m <= 1 ? 1 : Math.round(Math.ceil(m / 0.4 - 1e-9) * 4) / 10;
  if (mn >= 0) return { lo: 0, hi, ticks: hi === 1 ? [0, 0.25, 0.5, 0.75, 1] : Array.from({ length: Math.round(hi / 0.4) + 1 }, (_, i) => Math.round(i * 4) / 10) };
  const lo = -Math.round(Math.ceil(-mn / 0.4 - 1e-9) * 4) / 10;
  hi = Math.max(hi, 1.2);
  const ticks = []; for (let t = lo; t <= hi + 1e-9; t = Math.round((t + 0.4) * 10) / 10) ticks.push(Math.abs(t) < 1e-9 ? 0 : t);
  return { lo, hi: ticks[ticks.length - 1], ticks };
}
export const vfAxisMax = (values) => vfAxis(values).hi;
export const frame = (H, aria, inner, xtitle = '', vbW = W) => `<svg viewBox="0 0 ${vbW} ${H}" role="img" aria-label="${esc(aria)}" preserveAspectRatio="xMidYMid meet">${inner}${xtitle ? `<text x="${((PAD.l + W - PAD.r) / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="atitle xtitle">${esc(xtitle)}</text>` : ''}</svg>`;

/** y grid + labels at the given ticks. */
export function axis(H, ticks, fmt, ytitle) {
  const lo = ticks[0], hi = ticks[ticks.length - 1], ih = H - PAD.t - PAD.b, y = (v) => PAD.t + ih * (1 - (v - lo) / (hi - lo));
  let g = '';
  for (const v of ticks) {
    const yy = y(v);
    g += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" class="${v === 0 && lo < 0 ? 'zero' : 'grid'}"/><text x="${PAD.l - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" class="tick">${fmt(v)}</text>`;
  }
  if (ytitle) g += `<text x="${PAD.l}" y="11" class="atitle">${esc(ytitle)}</text>`;
  return { g, y, ih, lo, hi };
}

/** bars: [{v, label, color, tip}], hline: {v, label}. xEvery: label every n bars. */
export function barChart({ bars, hline = null, refs = [], H = 220, scale = null, fmt = (v) => num(v, 2), xEvery = 1, aria, ytitle = '', xtitle = '', ticks = null, hoverTitle = (l) => l, minBw = 1.5, hoverName = '' }) {
  const vals = finite(bars.map((b) => b.v));
  const sc = scale || niceTicks(Math.min(0, ...vals), niceMax(Math.max(...vals, hline ? hline.v : 0, 0)));
  const { g, y } = axis(H, sc.ticks, fmt, ytitle);
  const iw = W - PAD.l - PAD.r, step = iw / bars.length, bw = Math.max(minBw, step * 0.7), y0 = y(Math.max(sc.lo, Math.min(0, sc.hi)));
  const tk = ticks ? new Map(ticks.map((t) => [t.i, t.text])) : null; // ticks: [{i, text}] overrides xEvery (daily bars: month labels)
  let out = g;
  bars.forEach((b, i) => {
    const x = PAD.l + step * i + (step - bw) / 2;
    if (b.v !== null && b.v !== undefined) {
      const y1 = y(Math.min(sc.hi, Math.max(sc.lo, b.v)));
      const h = Math.max(0.5, Math.abs(y0 - y1)), top = Math.min(Math.min(y0, y1), H - PAD.b - h);
      out += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${b.color}"${b.stroke ? ` stroke="${b.stroke}" stroke-width="3"` : ''}>${ticks ? '' : `<title>${esc(b.tip || `${b.label}: ${fmt(b.v)}`)}</title>`}</rect>`;
    }
    if (tk ? tk.has(i) : i % xEvery === 0) out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 28}" text-anchor="middle" class="tick">${esc(tk ? tk.get(i) : b.label)}</text>`;
  });
  for (const r of refs) out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(r)}" y2="${y(r)}" class="refline"><title>Value factor 1.0</title></line>`;
  if (hline && hline.v !== null) out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(hline.v)}" y2="${y(hline.v)}" class="hline"><title>${esc(hline.label)}</title></line>`;
  setHover({ vbW: W, H, xs: bars.map((_, i) => PAD.l + step * i + step / 2), at: (i) => ({ title: hoverTitle(bars[i].label), items: [{ name: hoverName || ytitle || 'Value', color: bars[i].color, text: bars[i].v === null || bars[i].v === undefined ? 'no data' : fmt(bars[i].v) }] }) });
  return frame(H, aria, out, xtitle);
}

/** stacked hourly composition: energy + losses + congestion (negative congestion hangs below zero), with two reference lines. */
export function stackChart({ energia, perdidas, congestion, base, cap, H = 260, aria, ytitle = 'MXN/MWh', xtitle = '' }) {
  const parts = [['energia', 'var(--c-energy)', energia], ['perdidas', 'var(--c-losses)', perdidas], ['congestion', 'var(--c-cong)', congestion]];
  const pos = energia.map((_, h) => parts.reduce((s, p) => s + Math.max(0, p[2][h]), 0)), neg = energia.map((_, h) => parts.reduce((s, p) => s + Math.min(0, p[2][h]), 0));
  const sc = niceTicks(Math.min(0, ...neg), Math.max(...pos, base, cap));
  const { g, y } = axis(H, sc.ticks, (v) => num(v, 0), ytitle);
  const iw = W - PAD.l - PAD.r, step = iw / 24, bw = step * 0.72;
  let out = g;
  for (let h = 0; h < 24; h++) {
    const x = PAD.l + step * h + (step - bw) / 2;
    let up = 0, dn = 0;
    for (const [nm, col, arr] of parts) {
      const v = arr[h]; if (!v) continue;
      const a = v >= 0 ? up : dn, b = a + v;
      if (v >= 0) up = b; else dn = b;
      out += `<rect x="${x.toFixed(1)}" y="${Math.min(y(a), y(b)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Math.abs(y(a) - y(b))).toFixed(1)}" fill="${col}"><title>${String(h).padStart(2, '0')}:00 ${nm}: ${num(v, 1)} MXN/MWh</title></rect>`;
    }
    if (h % 3 === 0) out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 28}" text-anchor="middle" class="tick">${String(h).padStart(2, '0')}</text>`;
  }
  out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(base)}" y2="${y(base)}" class="hline"><title>Average price ${num(base, 0)} MXN/MWh</title></line>`;
  out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(cap)}" y2="${y(cap)}" class="cline"><title>Captured price ${num(cap, 0)} MXN/MWh</title></line>`;
  return frame(H, aria, out, xtitle);
}

/** one bar per hour (b) in the real/published revenue, optionally with the published value as an outline (ghost). */
export function pairChart({ b, cb, H = 220, aria, ytitle = 'MXN per MWp', unit = 'MXN', xtitle = '', ghost = null }) {
  const vals = finite([...b, ...(ghost || [])]);
  const sc = niceTicks(Math.min(0, ...vals), Math.max(...vals, 1e-9));
  const { g, y } = axis(H, sc.ticks, (v) => num(v, 0), ytitle);
  const iw = W - PAD.l - PAD.r, step = iw / 24, bw = step * 0.7, y0 = y(0);
  let out = g;
  for (let h = 0; h < 24; h++) {
    const x = PAD.l + step * h + (step - bw) / 2, hh = String(h).padStart(2, '0');
    const v = b[h];
    if (v !== null && v !== undefined) {
      const y1 = y(v), top = Math.min(y0, y1), hgt = Math.max(0.5, Math.abs(y0 - y1));
      out += `<rect x="${x.toFixed(1)}" y="${Math.min(top, H - PAD.b - hgt).toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" fill="${cb}"><title>${hh}:00 CDMX: ${num(v, 0)} ${unit}</title></rect>`;
    }
    if (ghost && ghost[h] !== null && ghost[h] !== undefined) { const g1 = y(ghost[h]), gt = Math.min(y0, g1); out += `<rect x="${x.toFixed(1)}" y="${gt.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Math.abs(y0 - g1)).toFixed(1)}" class="ghost-bar"><title>${hh}:00 CDMX published: ${num(ghost[h], 0)} ${unit}</title></rect>`; }
    if (h % 3 === 0) out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 28}" text-anchor="middle" class="tick">${hh}</text>`;
  }
  setHover({ vbW: W, H, xs: Array.from({ length: 24 }, (_, h) => PAD.l + step * h + step / 2), at: (h) => ({ title: `${String(h).padStart(2, '0')}:00 CDMX`, items: [{ name: 'Revenue', color: cb, text: b[h] == null ? 'n/a' : `${num(b[h], 0)} ${unit}` }, ...(ghost && ghost[h] != null ? [{ name: 'Published', color: 'var(--ink-2)', text: `${num(ghost[h], 0)} ${unit}` }] : [])] }) });
  return frame(H, aria, out, xtitle);
}

/** overlay of up to 3 series. series: [{vals, label}] in slot order (style i). nulls break the line. markEvery: marker every n points. */
export function lineChart({ series, labels, refs = [], H = 220, scale = null, fmt = (v) => num(v, 2), xEvery = 1, markEvery = 1, aria, ytitle = '', xtitle = '', unit = '', hline = null, bands = [], hoverTitle = (l) => l, ticks = null }) {
  const all = finite(series.flatMap((s) => s.vals));
  const sc = scale || niceTicks(Math.min(0, ...all), Math.max(...all, 1e-9));
  const { g, y } = axis(H, sc.ticks, fmt, ytitle);
  const n = labels.length, iw = W - PAD.l - PAD.r, step = iw / n, X = (i) => PAD.l + step * i + step / 2;
  let out = g;
  for (const [a, b] of bands) out += `<rect x="${(PAD.l + step * a).toFixed(1)}" y="${PAD.t}" width="${(step * (b - a + 1)).toFixed(1)}" height="${H - PAD.t - PAD.b}" class="win-band"/>`;
  const tk = ticks ? new Map(ticks.map((t) => [t.i, t.text])) : null; // ticks: [{i, text}] overrides xEvery (daily plots: month labels)
  labels.forEach((l, i) => { if (tk ? tk.has(i) : i % xEvery === 0) out += `<text x="${X(i).toFixed(1)}" y="${H - 28}" text-anchor="middle" class="tick">${esc(tk ? tk.get(i) : l)}</text>`; });
  for (const r of refs) out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(r)}" y2="${y(r)}" class="refline"><title>Value factor 1.0</title></line>`;
  series.forEach((sr, k) => {
    const st = sr.style || STYLES[k % 3];
    let d = '', pen = false;
    sr.vals.forEach((v, i) => { if (v === null || v === undefined) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    out += `<path d="${d}" fill="none" stroke="${st.color}" stroke-width="2" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''} stroke-linejoin="round"/>`;
    if (sr.raw) sr.raw.forEach((rv, i) => { // clamped points: triangle at the edge (hover gives the true value)
      if (rv !== null && rv !== undefined && sr.vals[i] !== null && rv !== sr.vals[i]) out += `<path transform="translate(${X(i).toFixed(1)} ${y(sr.vals[i]).toFixed(1)})" d="${markerPath('triangle', 4)}" fill="${st.color}"><title>${esc(sr.label)} · ${esc(labels[i])}: ${fmt(rv)}</title></path>`;
    });
    sr.vals.forEach((v, i) => {
      if (v === null || v === undefined) return;
      const tip = `<title>${esc(sr.label)} · ${esc(labels[i])}: ${fmt(v)}</title>`;
      if (markEvery && i % markEvery === 0) out += `<path transform="translate(${X(i).toFixed(1)} ${y(v).toFixed(1)})" d="${markerPath(st.marker)}" fill="${st.color}">${tip}</path>`;
    });
  });
  if (hline && hline.v !== null && hline.v !== undefined) out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(hline.v)}" y2="${y(hline.v)}" class="hline"><title>${esc(hline.label)}</title></line>`;
  const u = unit ? ` ${unit}` : '';
  setHover({ vbW: W, H, xs: labels.map((_, i) => X(i)), at: (i) => ({ title: hoverTitle(labels[i]), items: series.map((sr, k) => ({ name: sr.label, color: (sr.style || STYLES[k % 3]).color, text: (sr.raw ? sr.raw[i] : sr.vals[i]) === null || (sr.raw ? sr.raw[i] : sr.vals[i]) === undefined ? 'no data' : `${fmt(sr.raw ? sr.raw[i] : sr.vals[i])}${u}` })) }) });
  return frame(H, aria, out, xtitle);
}

/** grouped bars: labels x series [{vals, color, ghost: bool}] (ghost = outline only, e.g. the clear-sky reference). */
export function groupChart({ labels, series, H = 240, fmt = (v) => num(v, 0), xEvery = 1, aria, ytitle = '', xtitle = '', unit = '' }) {
  const all = finite(series.flatMap((s) => s.vals)), sc = niceTicks(0, Math.max(...all, 1e-9));
  const { g, y } = axis(H, sc.ticks, fmt, ytitle);
  const iw = W - PAD.l - PAD.r, step = iw / labels.length, n = series.length, bw = Math.max(2, (step * 0.8) / n), y0 = y(0);
  let out = g;
  labels.forEach((l, i) => {
    const x0 = PAD.l + step * i + (step - bw * n) / 2;
    series.forEach((sr, k) => {
      const v = sr.vals[i];
      if (v === null || v === undefined) return;
      const y1 = y(v), top = Math.min(y0, y1), h = Math.max(0.5, Math.abs(y0 - y1));
      out += `<rect x="${(x0 + k * bw).toFixed(1)}" y="${top.toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}" ${sr.ghost ? 'class="ghost-bar"' : `fill="${sr.color}"`}><title>${esc(sr.label || '')} ${esc(l)}: ${fmt(v)}</title></rect>`;
    });
    if (i % xEvery === 0) out += `<text x="${(PAD.l + step * i + step / 2).toFixed(1)}" y="${H - 28}" text-anchor="middle" class="tick">${esc(l)}</text>`;
  });
  const u = unit ? ` ${unit}` : '';
  setHover({ vbW: W, H, xs: labels.map((_, i) => PAD.l + step * i + step / 2), at: (i) => ({ title: labels[i], items: series.map((sr) => ({ name: sr.label || '', color: sr.ghost ? 'var(--ink-2)' : sr.color, text: sr.vals[i] == null ? 'no data' : `${fmt(sr.vals[i])}${u}` })) }) });
  return frame(H, aria, out, xtitle);
}
