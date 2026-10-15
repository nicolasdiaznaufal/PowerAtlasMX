// Interactive parts of the appendix: NASA POWER grid map (A1), tilt sketch (A2), heat and clipping charts (A3), one hour step by step (A4).
// Same arithmetic as v1; charts are the small SVG ones of v2 (no Chart.js).
import { GeoMap, ll2xy } from '../../../assets/js/geomap.js';
import { renderMath } from '../../../assets/js/tex.js';
import { num, signed } from '../../../assets/js/format.js';
import { lineChart, renderChart } from './svg-charts.js';
import { hbarChart } from './hbar-chart.js';
import { loadGeoRaw } from './fin-data.js';
import { loadAtlas } from './atlas.js';

const f0 = (v) => num(v, 0), f1 = (v) => num(v, 1), f2 = (v) => num(v, 2), f3 = (v) => num(v, 3), pad = (h) => String(h).padStart(2, '0');

/** KaTeX is vendored in web/assets/vendor/katex; the v1 renderer finds window.katex once it is loaded here (v2 sits one level down). */
function loadKatex() {
  if (window.katex) return Promise.resolve();
  return new Promise((res) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '../assets/vendor/katex/katex.min.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = '../assets/vendor/katex/katex.min.js'; s.onload = () => res(); s.onerror = () => res(); document.head.appendChild(s);
  });
}

export function mountLive(root) {
  const q = (s) => root.querySelector(s);
  let dead = false, gm = null;
  const math = () => loadKatex().then(() => { if (!dead && window.katex) return renderMath(root); }).catch(() => {});
  // A1: NASA POWER one-degree grid and two example nodes
  const a1 = async () => {
    const [raw, atlas] = await Promise.all([loadGeoRaw(), loadAtlas()]);
    if (dead || !q('#a1-map')) return;
    const byId = new Map(atlas.nodes.map((n) => [n.id, n]));
    gm = new GeoMap(q('#a1-map'), raw, { interactive: false, labels: false });
    const ex = [['04RGU-115', 'Hermosillo'], ['08NCM-115', 'Mérida']].map(([id, t]) => { const n = byId.get(id); return n && n.lat != null ? { t, lon: n.lon, lat: n.lat } : null; }).filter(Boolean);
    gm.setFill({ level: 'region', color: () => '#3A4C3D', label: () => '' });
    gm.setExtra((c) => {
      c.strokeStyle = 'rgba(240,232,210,.28)'; c.lineWidth = 1; c.beginPath();
      for (let lon = -118; lon <= -86; lon++) { const [x] = ll2xy(lon + 0.5, 0); c.moveTo(x, 0); c.lineTo(x, raw.vb[1]); }
      for (let lat = 15; lat <= 32; lat++) { const [, y] = ll2xy(0, lat + 0.5); c.moveTo(0, y); c.lineTo(raw.vb[0], y); }
      c.stroke();
      ex.forEach((e) => {
        const cx = Math.round(e.lon), cy = Math.round(e.lat), [x0, y0] = ll2xy(cx - 0.5, cy + 0.5), [x1, y1] = ll2xy(cx + 0.5, cy - 0.5);
        c.fillStyle = 'rgba(232,162,102,.38)'; c.strokeStyle = '#E8A266'; c.lineWidth = 2; c.fillRect(x0, y0, x1 - x0, y1 - y0); c.strokeRect(x0, y0, x1 - x0, y1 - y0);
        const [x, y] = ll2xy(e.lon, e.lat);
        c.beginPath(); c.arc(x, y, 7, 0, 6.3); c.fillStyle = '#E8A266'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = '#111813'; c.stroke();
        c.font = '500 24px "Geist Mono", monospace'; c.textAlign = x > 600 ? 'left' : 'right'; c.lineWidth = 4; c.strokeStyle = '#111813'; c.fillStyle = '#F0E8D2';
        const tx = x > 600 ? x + 20 : x - 20; c.strokeText(e.t, tx, y - 20); c.fillText(e.t, tx, y - 20);
      });
    });
  };
  // A2: tilt sketch
  const svg = q('#a2-svg');
  const sketch = () => {
    const b = +q('#a2-b').value, z = +q('#a2-z').value, br = (b * Math.PI) / 180, zr = (z * Math.PI) / 180;
    q('#a2-bo').textContent = `${b}°`; q('#a2-zo').textContent = `${z}°`;
    const P = [350, 235], L = 100, n = [Math.sin(br), -Math.cos(br)], ax = [Math.cos(br), Math.sin(br)];
    const p1 = [P[0] - ax[0] * L, P[1] - ax[1] * L], p2 = [P[0] + ax[0] * L, P[1] + ax[1] * L], sun = [P[0] + 250 * Math.sin(zr), P[1] - 250 * Math.cos(zr)], nt = [P[0] + n[0] * 150, P[1] + n[1] * 150], ti = Math.abs(z - b);
    const arc = (r, a0, a1) => `M ${P[0] + r * Math.sin(a0)} ${P[1] - r * Math.cos(a0)} A ${r} ${r} 0 0 ${a1 > a0 ? 1 : 0} ${P[0] + r * Math.sin(a1)} ${P[1] - r * Math.cos(a1)}`;
    svg.innerHTML = `<line x1="20" y1="280" x2="560" y2="280" stroke="#9C9985" stroke-width="2"/>
      <line x1="${P[0]}" y1="${P[1]}" x2="${P[0]}" y2="40" stroke="#9C9985" stroke-dasharray="5 6"/><text x="${P[0] + 8}" y="52" fill="#C3BEA9" font-size="15">vertical (zenith)</text>
      <line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="#F0E8D2" stroke-width="7" stroke-linecap="round"/>
      <line x1="${P[0]}" y1="${P[1]}" x2="${nt[0]}" y2="${nt[1]}" stroke="#F0E8D2" stroke-width="1.6" stroke-dasharray="4 5"/><text x="${nt[0] + 6}" y="${nt[1] - 4}" fill="#F0E8D2" font-size="15">panel normal</text>
      <circle cx="${sun[0]}" cy="${sun[1]}" r="22" fill="#E8A266"/><line x1="${sun[0]}" y1="${sun[1]}" x2="${P[0]}" y2="${P[1]}" stroke="#E8A266" stroke-width="2.6"/>
      <path d="${arc(110, 0, zr)}" fill="none" stroke="#F0E8D2" stroke-width="1.6"/><text x="${P[0] + 110 * Math.sin(zr / 2) + 6}" y="${P[1] - 110 * Math.cos(zr / 2) - 4}" fill="#F0E8D2" font-size="20" font-style="italic">θz</text>
      <path d="${arc(70, br, zr)}" fill="none" stroke="#E8A266" stroke-width="2.4"/><text x="${P[0] + 90 * Math.sin((br + zr) / 2) + 4}" y="${P[1] - 90 * Math.cos((br + zr) / 2)}" fill="#E8A266" font-size="20" font-style="italic">θi</text>
      <text x="${P[0] - 36}" y="268" fill="#F0E8D2" font-size="20" font-style="italic">β = ${b}°</text>
      <text x="30" y="312" fill="#C3BEA9" font-size="14">flat ground: GHI is measured here · panel tilted by β</text>`;
    const cos = Math.cos((ti * Math.PI) / 180);
    q('#a2-read').innerHTML = `Sun in the plane facing the panel (\\(\\varphi_s=\\varphi_p\\)): \\(\\theta_i=${ti}^\\circ\\), \\(\\cos\\theta_i=${f2(cos)}\\). The panel catches ${f0(cos * 100)} % of the direct beam per unit area${ti >= 90 ? '; the sun is behind the panel' : ''}.`;
    if (window.katex) renderMath(q('#a2-read'));
  };
  ['a2-b', 'a2-z'].forEach((i) => q('#' + i).addEventListener('input', sketch)); sketch();
  // A3: heat factor and clipping
  const draw3 = () => {
    const T = Array.from({ length: 17 }, (_, i) => i * 5);
    renderChart(q('#cA3a'), () => lineChart({ series: [{ vals: T.map((t) => 1 - 0.0035 * (t - 25)), label: 'Heat factor', style: { color: 'var(--accent)', dash: '', marker: 'circle' } }], labels: T.map(String), xEvery: 2, markEvery: 4, H: 240,
      scale: { lo: 0.8, hi: 1.1, ticks: [0.8, 0.9, 1, 1.1] }, fmt: (v) => f3(v), hoverTitle: (l) => `Cell temperature ${l} °C`, ytitle: 'Heat factor', xtitle: 'Cell temperature, °C', aria: 'Power factor as a function of cell temperature' }));
    const hrs = Array.from({ length: 15 }, (_, i) => i + 5), G = hrs.map((h) => (h <= 6 || h >= 18 ? 0 : (1050 * Math.sin((Math.PI * (h - 6)) / 12) ** 1.2) / 1000));
    const dc = G.map((g) => g * 0.95), lim = 1 / 1.3, ac = dc.map((x) => Math.min(x * 0.97 * 0.9, lim));
    renderChart(q('#cA3b'), () => lineChart({ series: [{ vals: dc, label: 'DC power', style: { color: 'var(--ink-3)', dash: '', marker: 'circle' } }, { vals: ac, label: 'AC delivered', style: { color: 'var(--accent)', dash: '', marker: 'square' } },
      { vals: hrs.map(() => lim), label: 'Inverter limit', style: { color: 'var(--ink)', dash: '6 4', marker: 'triangle' } }], labels: hrs.map(pad), xEvery: 3, markEvery: 0, H: 240, scale: { lo: 0, hi: 1.1, ticks: [0, 0.25, 0.5, 0.75, 1] },
      fmt: (v) => f2(v), unit: 'kW/kWp', hoverTitle: (l) => `${l}:00 h`, ytitle: 'kW per kWp', xtitle: 'Hour of day', aria: 'Clear-day DC power, AC power and the inverter limit' }));
  };
  // A4: one hour
  const upd9 = () => {
    const g = +q('#g9').value, ta = +q('#t9').value, v = +q('#v9').value, gam = +q('#y9').value / 100, L = +q('#l9').value / 100, eta = +q('#e9').value / 100, r = +q('#r9').value;
    q('#g9o').textContent = f0(g); q('#t9o').textContent = f0(ta); q('#v9o').textContent = f1(v); q('#y9o').textContent = f2(gam * 100); q('#l9o').textContent = f1(L * 100); q('#e9o').textContent = f1(eta * 100); q('#r9o').textContent = f2(r);
    const tc = ta + g / (25 + 6.84 * v), tf = 1 + gam * (tc - 25), p0 = g / 1000, p1 = p0 * tf, p2 = p1 * (1 - L), p3 = p2 * eta, p4 = Math.min(p3, 1 / r);
    q('#k9t').textContent = f1(tc); q('#k9f').textContent = f3(tf); q('#k9a').textContent = f3(p4); q('#k9p').textContent = g > 0 ? `${f0((p4 / p0) * 100)} %` : '–';
    const labels = ['Sunlight only (irradiance)', 'After heat, eq. (4)–(5)', 'After system losses', 'After inverter', 'After clipping = AC'], colors = ['var(--ink-3)', 'var(--accent)', 'var(--accent)', 'var(--accent)', 'var(--s2)'];
    hbarChart(q('#c9'), { bars: [p0, p1, p2, p3, p4].map((x, i) => ({ label: labels[i], v: +x.toFixed(3), color: colors[i] })), xtitle: 'Power, kW per kWp installed', fmt: (x) => f3(x), unit: 'kW per kWp', max: 1.25, aria: 'Power per kWp after each loss step' });
  };
  ['g9', 't9', 'v9', 'y9', 'l9', 'e9', 'r9'].forEach((i) => q('#' + i).addEventListener('input', upd9));
  upd9(); draw3();
  const onResize = () => { draw3(); upd9(); };
  window.addEventListener('resize', onResize);
  a1().catch(() => {});
  math();
  void signed;
  return { destroy() { dead = true; window.removeEventListener('resize', onResize); if (gm) { try { gm.destroy(); } catch { /* gone */ } } } };
}
