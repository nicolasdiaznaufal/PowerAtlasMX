// PML decomposition by hour of the typical day: stacked system energy + losses + congestion, total price line,
// shaded solar hours, solar output on a right axis, average and captured price lines. (v1 section 02, restyled.)
import { num } from '../../../assets/js/format.js';
import { W, PAD, axis, frame, niceMax, niceTicks } from './svg-charts.js';
import { setHover } from './hover.js';

const RIGHT = 50; // extra viewBox width for the output axis

/** hours (0..23) whose output is at least `share` of the peak hour, as [start, end] runs. */
export function solarRuns(y, share = 0.05) {
  const peak = Math.max(...y, 0), runs = [];
  if (!(peak > 0)) return runs;
  let a = null;
  y.forEach((v, h) => {
    const on = v >= peak * share;
    if (on && a === null) a = h;
    if ((!on || h === y.length - 1) && a !== null) { runs.push([a, on ? h : h - 1]); a = null; }
  });
  return runs;
}

export function decompChart({ energia, perdidas, congestion, pml, y, base, cap, H = 340, aria, ghost = null }) {
  const parts = [['System energy', 'var(--c-energy)', energia], ['Losses', 'var(--c-losses)', perdidas], ['Congestion', 'var(--c-cong)', congestion]];
  const pos = energia.map((_, h) => parts.reduce((s, p) => s + Math.max(0, p[2][h]), 0));
  const neg = energia.map((_, h) => parts.reduce((s, p) => s + Math.min(0, p[2][h]), 0));
  const gp = ghost ? ghost.pml : [];
  const sc = niceTicks(Math.min(0, ...neg, ...gp), Math.max(...pos, ...pml, ...gp, base, cap));
  const { g, y: Y } = axis(H, sc.ticks, (v) => num(v, 0), 'MXN/MWh (nominal)');
  const iw = W - PAD.l - PAD.r, step = iw / 24, bw = step * 0.72, top = PAD.t, bot = H - PAD.b;
  const X = (h) => PAD.l + step * h + step / 2;
  let out = g;
  for (const [a, b] of solarRuns(y)) out += `<rect x="${(PAD.l + step * a).toFixed(1)}" y="${top}" width="${(step * (b - a + 1)).toFixed(1)}" height="${bot - top}" class="solar-band"/>`;
  const runs = solarRuns(y);
  if (runs.length) out += `<text x="${(PAD.l + step * runs[0][0] + 6).toFixed(1)}" y="${top + 14}" class="tick solar-label">Solar hours</text>`;
  for (let h = 0; h < 24; h++) {
    const x = PAD.l + step * h + (step - bw) / 2;
    let up = 0, dn = 0;
    for (const [nm, col, arr] of parts) {
      const v = arr[h]; if (!v) continue;
      const a = v >= 0 ? up : dn, b = a + v;
      if (v >= 0) up = b; else dn = b;
      out += `<rect x="${x.toFixed(1)}" y="${Math.min(Y(a), Y(b)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, Math.abs(Y(a) - Y(b))).toFixed(1)}" fill="${col}"><title>${String(h).padStart(2, '0')}:00 ${nm}: ${num(v, 1)} MXN/MWh</title></rect>`;
    }
    if (h % 2 === 0 || W > 560) out += `<text x="${X(h).toFixed(1)}" y="${H - 28}" text-anchor="middle" class="tick">${String(h).padStart(2, '0')}</text>`;
  }
  // the published (real) profile as a ghost line when a scenario is on
  if (ghost) out += `<path d="${ghost.pml.map((v, h) => `${h ? 'L' : 'M'}${X(h).toFixed(1)},${Y(v).toFixed(1)}`).join('')}" class="ghost-line" fill="none"><title>Published price (real values)</title></path>`;
  // total price line
  out += `<path d="${pml.map((v, h) => `${h ? 'L' : 'M'}${X(h).toFixed(1)},${Y(v).toFixed(1)}`).join('')}" class="pml-line" fill="none"><title>Price (PML) by hour</title></path>`;
  out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(base)}" y2="${Y(base)}" class="hline"><title>Average price ${num(base, 0)} MXN/MWh</title></line>`;
  out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(cap)}" y2="${Y(cap)}" class="cline"><title>Captured price ${num(cap, 0)} MXN/MWh</title></line>`;
  // solar output on the right axis
  const ymax = niceMax(Math.max(...y, ...(ghost ? ghost.y : []), 1e-9)), R = (v) => top + (bot - top) * (1 - v / ymax);
  if (ghost) out += `<path d="${ghost.y.map((v, h) => `${h ? 'L' : 'M'}${X(h).toFixed(1)},${R(v).toFixed(1)}`).join('')}" class="ghost-line prod" fill="none"><title>Published solar output (real values)</title></path>`;
  out += `<path d="${y.map((v, h) => `${h ? 'L' : 'M'}${X(h).toFixed(1)},${R(v).toFixed(1)}`).join('')}" class="out-line" fill="none"><title>Solar output (right axis)</title></path>`;
  for (const v of [0, ymax / 2, ymax]) out += `<text x="${W - PAD.r + 8}" y="${(R(v) + 4).toFixed(1)}" class="tick prodtick">${num(v, 2)}</text>`;
  out += `<text x="${W - PAD.r + 8}" y="11" class="atitle prodtick">MWh/MWp</text>`;
  const f1 = (v) => `${num(v, 1)} MXN/MWh`;
  setHover({ vbW: W + RIGHT, H, xs: Array.from({ length: 24 }, (_, h) => X(h)), at: (h) => ({ title: `${String(h).padStart(2, '0')}:00 CDMX`, items: [
    { name: 'System energy', color: 'var(--c-energy)', text: f1(energia[h]) }, { name: 'Losses', color: 'var(--c-losses)', text: f1(perdidas[h]) },
    { name: 'Congestion', color: 'var(--c-cong)', text: f1(congestion[h]) }, { name: 'Price (PML)', color: 'var(--ink)', text: f1(pml[h]) },
    { name: 'Solar output', color: 'var(--c-prod)', text: `${num(y[h], 3)} MWh/MWp` }] }) });
  return frame(H, aria, out, 'Hour of day, Mexico City time (CDMX), hour beginning', W + RIGHT);
}
