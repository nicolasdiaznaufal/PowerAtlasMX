// Chart.js 4.4.1 (vendored) with one shared theme: the deck's palette and fonts, no animation, DM Mono ticks.
// Every chart is a canvas with role="img" + aria-label; key charts also expose their numbers in a <details> table.
import { f0, fx, signed } from './fmt.js';
let loading = null;
export function loadChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (loading) return loading;
  loading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/chartjs/chart.umd.js';
    s.onload = () => { setup(); res(window.Chart); };
    s.onerror = () => rej(new Error('Chart.js failed to load'));
    document.head.appendChild(s);
  });
  return loading;
}
const cssv = (n, fb) => (getComputedStyle(document.documentElement).getPropertyValue(n) || fb).trim() || fb;
export const col = () => ({
  ink: cssv('--ink', '#F0E8D2'), ink2: cssv('--ink-2', '#C3BEA9'), ink3: cssv('--ink-3', '#9C9985'), line: cssv('--line', '#43503F'),
  orange: cssv('--orange', '#C07030'), sun: cssv('--sun', '#E0B33A'), cream: cssv('--cream', '#EDE6D0'), bg: cssv('--bg', '#232E26'),
  energy: cssv('--c-energy', '#5F7A63'), losses: cssv('--c-losses', '#8DA892'), cong: cssv('--c-cong', '#B9A88A'), dark: cssv('--dark', '#1E2820'),
  ok: cssv('--sig-ok-mark', '#4FB868'), warn: cssv('--sig-warn-mark', '#E0B020'), bad: cssv('--sig-bad-mark', '#EF5350'),
});
const registry = new Set();
function setup() {
  const C = window.Chart; const c = col();
  C.defaults.font.family = cssv('--font-mono', 'DM Mono');
  C.defaults.font.size = 12;
  C.defaults.color = c.ink2;
  C.defaults.animation = false;
  if (document.fonts) document.fonts.ready.then(() => registry.forEach((ch) => { try { ch.update('none'); } catch (e) { /* destroyed */ } }));
}
const pad = (h) => String(h).padStart(2, '0');
export const H = [...Array(24).keys()];
export const hourTicks = (v, i) => (i % 3 === 0 ? pad(i) : '');
export function baseOptions(o = {}) {
  const c = col();
  return Object.assign({
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true, backgroundColor: c.cream, titleColor: c.dark, bodyColor: c.dark, footerColor: c.dark, cornerRadius: 4, displayColors: false, padding: 10,
        titleFont: { family: cssv('--font-mono', 'DM Mono'), size: 12 }, bodyFont: { family: cssv('--font-mono', 'DM Mono'), size: 12 }, footerFont: { family: cssv('--font-mono', 'DM Mono'), size: 11, weight: 'normal' } },
    },
    scales: {
      x: { grid: { display: false }, border: { color: c.ink3 }, ticks: { color: c.ink2 } },
      y: { grid: { color: c.line }, border: { display: false }, ticks: { color: c.ink2 } },
    },
  }, o);
}
export function axisTitle(ch, xt, yt) {
  const c = col();
  const t = (s) => ({ display: true, text: s, color: c.ink2, font: { family: cssv('--font-mono', 'DM Mono'), size: 11 }, padding: { top: 4, bottom: 2 } });
  if (xt !== undefined) ch.options.scales.x.title = xt ? t(xt) : { display: false };
  if (yt !== undefined) ch.options.scales.y.title = yt ? t(yt) : { display: false };
}
export function hourAxis(ch) { const x = ch.options.scales.x; x.ticks.autoSkip = false; x.ticks.maxRotation = 0; x.ticks.callback = hourTicks; }
export function yWidth(ch, w) { ch.options.scales.y.afterFit = (s) => { s.width = w; }; }

/** Create a chart on a canvas once Chart.js is loaded. */
export async function make(canvas, config) {
  const Chart = await loadChart();
  const ch = new Chart(canvas, config);
  registry.add(ch);
  return ch;
}
export function destroy(ch) { if (ch) { registry.delete(ch); ch.destroy(); } }

/** Deck price-composition chart: stacked λE, λL, λC by hour + PML line + average + captured price. */
export async function compositionChart(canvas, { unit = 'MXN/MWh', clock = 'Hour of day (start, CDMX clock)' } = {}) {
  const c = col();
  const bp = { barPercentage: 0.92, categoryPercentage: 0.92 };
  const ch = await make(canvas, {
    data: { labels: H, datasets: [
      { type: 'bar', label: 'System energy λE', data: [], backgroundColor: c.energy, stack: 'pml', order: 3, ...bp },
      { type: 'bar', label: 'Losses λL', data: [], backgroundColor: c.losses, stack: 'pml', order: 3, ...bp },
      { type: 'bar', label: 'Congestion λC', data: [], backgroundColor: c.cong, stack: 'pml', order: 3, ...bp },
      { type: 'line', label: 'PML', data: [], stack: 'l1', borderColor: c.ink, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, order: 1 },
      { type: 'line', label: 'Average PML', data: [], stack: 'l2', borderColor: c.ink2, borderDash: [7, 5], borderWidth: 2, pointRadius: 0, pointHoverRadius: 0, order: 1 },
      { type: 'line', label: 'Captured price', data: [], stack: 'l3', borderColor: c.orange, borderDash: [7, 5], borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 0, order: 1 },
    ] },
    options: baseOptions({ interaction: { mode: 'index', intersect: false } }),
  });
  ch.options.scales.x.stacked = true; ch.options.scales.y.stacked = true;
  hourAxis(ch); ch.options.scales.y.ticks.maxTicksLimit = 6; axisTitle(ch, clock, unit); yWidth(ch, 70);
  const rank = { 3: 0, 0: 1, 1: 2, 2: 3, 4: 4, 5: 5 };
  Object.assign(ch.options.plugins.tooltip, {
    displayColors: true, boxWidth: 10, boxHeight: 10, itemSort: (a, b) => rank[a.datasetIndex] - rank[b.datasetIndex], filter: (it) => it.datasetIndex < 4,
    callbacks: {
      title: (it) => `${pad(it[0].dataIndex)}:00–${pad(it[0].dataIndex + 1)}:00 h · average day`,
      label: (it) => `${it.dataset.label}: ${f0(it.raw)} ${unit}`,
      footer: (it) => { const d = ch.data.datasets, i = it[0].dataIndex; return `λE + λL + λC = ${f0(d[0].data[i] + d[1].data[i] + d[2].data[i])} ${unit}`; },
      labelColor: (it) => ({ borderColor: c.dark, backgroundColor: it.dataset.backgroundColor || it.dataset.borderColor }),
    },
  });
  return {
    ch,
    set({ pml, energia, perdidas, congestion, base, cap }) {
      const d = ch.data.datasets;
      d[0].data = energia; d[1].data = perdidas; d[2].data = congestion; d[3].data = pml;
      d[4].data = H.map(() => base); d[5].data = H.map(() => cap);
      ch.update();
    },
  };
}
export { f0, fx, signed };
