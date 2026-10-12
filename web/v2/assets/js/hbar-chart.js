// Horizontal bars with a value axis (Revenue economics card). Colours come from tokens; text values are in the labels.
import { num } from '../../../assets/js/format.js';
import { niceTicks, niceMax, chartWidth } from './svg-charts.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** bars: [{label, v, color}] (v in axis units). Returns an SVG string sized to the element width. */
export function hbarChart(el, { bars, xtitle, aria, fmt = (v) => num(v, 1), unit = '', max = null }) {
  const w = chartWidth(el), longest = Math.max(...bars.map((b) => String(b.label).length)), L = Math.max(90, Math.min(Math.round(w * 0.5), longest * 7.6 + 18)), R = 24, T = 14, B = 52, rowH = 52, H = T + B + rowH * bars.length;
  const top = max || niceMax(Math.max(1e-9, ...bars.map((b) => b.v || 0))), sc = niceTicks(0, top, 5), span = sc.hi - sc.lo, x = (v) => L + ((w - L - R) * (v - sc.lo)) / span;
  let out = '';
  for (const t of sc.ticks) out += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${T}" y2="${H - B}" class="grid"/><text x="${x(t).toFixed(1)}" y="${H - B + 18}" text-anchor="middle" class="tick">${num(t, t % 1 ? (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6 ? 2 : 1) : 0)}</text>`;
  bars.forEach((b, i) => {
    const y = T + rowH * i + 8, v = Math.max(0, b.v || 0);
    out += `<text x="${L - 10}" y="${y + 22}" text-anchor="end" class="hlabel">${esc(b.label)}</text>
      <rect x="${x(0).toFixed(1)}" y="${y}" width="${Math.max(1, x(v) - x(0)).toFixed(1)}" height="32" fill="${b.color}"><title>${esc(b.label)}: ${fmt(b.v)}${unit ? ` ${unit}` : ''}</title></rect>
      <text x="${(x(v) + 6).toFixed(1)}" y="${y + 21}" class="tick">${fmt(b.v)}</text>`;
  });
  out += `<line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" class="zero"/><text x="${((L + w - R) / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="atitle">${esc(xtitle)}</text>`;
  el.innerHTML = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(aria)}" preserveAspectRatio="xMidYMid meet">${out}</svg>`;
}
