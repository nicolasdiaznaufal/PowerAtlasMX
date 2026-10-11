// Tiny SVG charts (no library): colours come from CSS tokens so they follow the theme and the contrast test.
import { num } from '../../../assets/js/format.js';
import { STYLES, markerPath } from './series-style.js';

const W = 640, PAD = { l: 52, r: 12, t: 24, b: 34 };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const frame = (H, aria, inner) => `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;

/** y grid + labels. min..max, 4 intervals. */
function axis(H, lo, hi, fmt, ytitle) {
  const ih = H - PAD.t - PAD.b, y = (v) => PAD.t + ih * (1 - (v - lo) / (hi - lo));
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4, yy = y(v);
    g += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${yy}" y2="${yy}" class="grid"/><text x="${PAD.l - 8}" y="${yy + 4}" text-anchor="end" class="tick">${fmt(v)}</text>`;
  }
  if (ytitle) g += `<text x="${PAD.l}" y="11" class="atitle">${esc(ytitle)}</text>`;
  return { g, y, ih };
}

/** bars: [{v, label, color, tip}], hline: {v, label}. xEvery: label every n bars. */
export function barChart({ bars, hline = null, refs = [], H = 220, yMax = null, yMin = 0, fmt = (v) => num(v, 2), xEvery = 1, aria, ytitle = '' }) {
  const vals = bars.map((b) => b.v).filter((v) => v !== null && v !== undefined);
  const hi = yMax || niceMax(Math.max(...vals, hline ? hline.v : 0)), lo = yMin;
  const { g, y } = axis(H, lo, hi, fmt, ytitle);
  const iw = W - PAD.l - PAD.r, step = iw / bars.length, bw = Math.max(1.5, step * 0.7);
  let out = g;
  bars.forEach((b, i) => {
    const x = PAD.l + step * i + (step - bw) / 2;
    if (b.v !== null && b.v !== undefined) {
      const y0 = y(Math.max(lo, 0)), y1 = y(b.v);
      out += `<rect x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Math.abs(y0 - y1)).toFixed(1)}" fill="${b.color}"><title>${esc(b.tip || `${b.label}: ${fmt(b.v)}`)}</title></rect>`;
    }
    if (i % xEvery === 0) out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="tick">${esc(b.label)}</text>`;
  });
  for (const r of refs) out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(r)}" y2="${y(r)}" class="refline"><title>Value factor 1.0</title></line>`;
  if (hline && hline.v !== null) out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(hline.v)}" y2="${y(hline.v)}" class="hline"><title>${esc(hline.label)}</title></line>`;
  return frame(H, aria, out);
}

/** stacked hourly composition: energy + losses + congestion (negative congestion hangs below zero), with two reference lines. */
export function stackChart({ energia, perdidas, congestion, base, cap, H = 260, aria, ytitle = 'MXN/MWh' }) {
  const parts = [['energia', 'var(--c-energy)', energia], ['perdidas', 'var(--c-losses)', perdidas], ['congestion', 'var(--c-cong)', congestion]];
  const pos = energia.map((_, h) => parts.reduce((s, p) => s + Math.max(0, p[2][h]), 0)), neg = energia.map((_, h) => parts.reduce((s, p) => s + Math.min(0, p[2][h]), 0));
  const hi = niceMax(Math.max(...pos, base, cap)), lo = Math.min(0, ...neg) < 0 ? -niceMax(-Math.min(...neg)) : 0;
  const { g, y } = axis(H, lo, hi, (v) => num(v, 0), ytitle);
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
    if (h % 3 === 0) out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="tick">${String(h).padStart(2, '0')}</text>`;
  }
  out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(base)}" y2="${y(base)}" class="hline"><title>Average price ${num(base, 0)} MXN/MWh</title></line>`;
  out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(cap)}" y2="${y(cap)}" class="cline"><title>Captured price ${num(cap, 0)} MXN/MWh</title></line>`;
  return frame(H, aria, out);
}

/** two bars per hour (a = left, b = right). Used for shortcut vs hour-by-hour revenue. */
export function pairChart({ a, b, ca, cb, H = 220, aria, ytitle = 'MXN per MWp', unit = 'MXN' }) {
  const hi = niceMax(Math.max(...a, ...b, 0)), { g, y } = axis(H, 0, hi, (v) => num(v, 0), ytitle);
  const iw = W - PAD.l - PAD.r, step = iw / 24, bw = step * 0.38;
  let out = g;
  for (let h = 0; h < 24; h++) {
    const x = PAD.l + step * h + step * 0.08, hh = String(h).padStart(2, '0');
    [[a[h], ca, 'shortcut'], [b[h], cb, 'hour by hour']].forEach(([v, c, nm], k) => {
      if (v === null || v === undefined) return;
      out += `<rect x="${(x + k * (bw + 1)).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, y(0) - y(v)).toFixed(1)}" fill="${c}"><title>${hh}:00 ${nm}: ${num(v, 0)} ${unit}</title></rect>`;
    });
    if (h % 3 === 0) out += `<text x="${(x + bw).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="tick">${hh}</text>`;
  }
  return frame(H, aria, out);
}

/** overlay of up to 3 series. series: [{vals, label}] in slot order (style i). nulls break the line. markEvery: marker every n points. */
export function lineChart({ series, labels, refs = [], H = 220, yMin = 0, yMax = null, fmt = (v) => num(v, 2), xEvery = 1, markEvery = 1, aria, ytitle = '' }) {
  const all = series.flatMap((s) => s.vals).filter((v) => v !== null && v !== undefined);
  const hi = yMax || niceMax(Math.max(...all, 0)), lo = Math.min(yMin, ...all, 0) < 0 ? -niceMax(-Math.min(...all)) : yMin;
  const { g, y } = axis(H, lo, hi, fmt, ytitle);
  const n = labels.length, iw = W - PAD.l - PAD.r, step = iw / n, X = (i) => PAD.l + step * i + step / 2;
  let out = g;
  labels.forEach((l, i) => { if (i % xEvery === 0) out += `<text x="${X(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="tick">${esc(l)}</text>`; });
  for (const r of refs) out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(r)}" y2="${y(r)}" class="refline"><title>Value factor 1.0</title></line>`;
  series.forEach((sr, k) => {
    const st = STYLES[k % 3];
    let d = '', pen = false;
    sr.vals.forEach((v, i) => { if (v === null || v === undefined) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    out += `<path d="${d}" fill="none" stroke="${st.color}" stroke-width="2" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''} stroke-linejoin="round"/>`;
    sr.vals.forEach((v, i) => {
      if (v === null || v === undefined) return;
      const tip = `<title>${esc(sr.label)} · ${esc(labels[i])}: ${fmt(v)}</title>`;
      if (i % markEvery === 0) out += `<path transform="translate(${X(i).toFixed(1)} ${y(v).toFixed(1)})" d="${markerPath(st.marker)}" fill="${st.color}">${tip}</path>`;
    });
  });
  return frame(H, aria, out);
}

/** VF axis: at least 1, otherwise the next multiple of 0.4 so four grid intervals stay round (1.2, 1.6, 2.0 ...). */
export function vfAxisMax(values) {
  const m = Math.max(0, ...values.filter((v) => v !== null && v !== undefined && Number.isFinite(v)));
  return m <= 1 ? 1 : Math.round(Math.ceil(m / 0.4 - 1e-9) * 0.4 * 10) / 10;
}
