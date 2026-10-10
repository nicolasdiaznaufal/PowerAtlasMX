// Story sections in deck order: summary figures, prices (synthetic day), explorer, revenue, value factor.
import { D, winCfg, areaStat, loadGeo } from './data.js';
import { make, loadChart, baseOptions, axisTitle, hourAxis, yWidth, compositionChart, col, H } from './charts.js';
import { GeoMap, mix, clamp01 } from './geomap.js';
import { $, esc, seg, segHTML, sig, ICON } from './util.js';
import { num, signed } from './format.js';
import { Picker, areaRecord, areaName, monthlySeries, nodeLab } from './common.js';
import { WIN, REGIONS, RN, regName, stName } from './names.js';
import { renderMath } from './tex.js';

const f0 = (v) => num(v, 0), f2 = (v) => num(v, 2), f1 = (v) => num(v, 1);
const pad = (h) => String(h).padStart(2, '0');
const Nat = (w) => areaStat(WIN[w].key, 'national', null);

/* ---------- clock footnote (index.reloj) ---------- */
export function clockFoot(sistema = 'SIN') {
  const s = D.index && D.index.reloj && D.index.reloj.sistemas && D.index.reloj.sistemas[sistema];
  if (!s) return '';
  return `<p class="clockfoot">${ICON.clock}<span><b>Clock.</b> ${esc(s.nota_en)}</span></p>`;
}

/* ---------- headline figures and narrative bindings ---------- */
export function bindSummary(ctx) {
  const a = D.analysis; if (!a) return;
  const real = ctx.S.get().real;
  const n2 = Nat('Y2'), n1 = Nat('Y1');
  const cv = a.cobertura_lcoe_real_vs_nominal && a.cobertura_lcoe_real_vs_nominal.ventanas;
  const over = n2 ? (1 / n2.vf - 1) * 100 : null;
  const reg = REGIONS.map((r) => [r, areaStat(WIN.Y2.key, 'region', r)]).filter((x) => x[1]).sort((x, y) => x[1].vf - y[1].vf);
  const cells = [];
  if (n2) cells.push(['Value factor, national', f2(n2.vf), `Aug 2025 – Jul 2026${n1 ? `, vs ${f2(n1.vf)} a year earlier` : ''}`]);
  if (over !== null) cells.push(['Shortcut overstates revenue by', `${signed(over, 0)} %`, 'pricing at the average price = 1/VF − 1']);
  if (n2) cells.push(['Nodes analysed', f0(n2.n_nodos), 'SIN nodes with a full year of prices and a solar baseline']);
  if (reg.length) cells.push(['Regional VF range', `${f2(reg[0][1].vf)} – ${f2(reg[reg.length - 1][1].vf)}`, `${regName(reg[0][0])} to ${regName(reg[reg.length - 1][0])}`]);
  if (cv && cv.deck_2025_26) {
    const c2 = cv.deck_2025_26, c1 = cv.deck_2024_25;
    cells.push(['Nodes covering the deck LCOE', `${f0(real ? c1.pct_real : c1.pct_nominal)} → ${f0(real ? c2.pct_real : c2.pct_nominal)} %`, "deck scenario: 714 MXN/MWh (40 USD at 17.84), 2024–25 → 2025–26"]);
  }
  $('#headline').innerHTML = cells.map(([l, v, s]) => `<div class="stat"><span>${esc(l)}</span><strong>${esc(v)}</strong><em class="sub">${esc(s)}</em></div>`).join('');
  const pd = D.index.periodo_datos;
  $('#asof').textContent = `Data ${pd.desde} to ${pd.hasta} (CDMX clock). Figures in ${real ? `today's pesos (base ${D.index.pesos_reales.base_mes})` : 'nominal pesos'}; deck-scenario items use the deck's printed LCOE and exchange rate. Mounting default: ${D.index.config_defecto}.`;
  // narrative bindings
  const set = (k, t) => document.querySelectorAll(`[data-bind="${k}"]`).forEach((e) => { e.textContent = t; });
  const lam = a.lambda_e_sin_2025_26;
  if (lam) set('lambda_txt', `identical at all nodes in every hour; mean ${f0(lam.media)}, range ${f0(Math.max(0, lam.min))}–${f0(lam.max)} MXN/MWh over ${f0(lam.horas)} h of Aug 2025 – Jul 2026`);
  const sp = areaStat(WIN.Y2.key, 'region', 'PENINSULAR'), nr = areaStat(WIN.Y2.key, 'region', 'NOROESTE');
  if (sp) set('cong_pen', signed(sp.congestion_media, 0));
  if (nr) set('cong_noro', signed(nr.congestion_media, 0));
  const tr = a.tendencia_vf_entre_ventanas && a.tendencia_vf_entre_ventanas.deck_2024_25__deck_2025_26;
  if (tr) {
    const pe = tr.regiones.PENINSULAR;
    set('trend_txt', `Between 2024–25 and 2025–26 VF fell at ${f0(tr.pct_nodos_vf_baja)} % of ${f0(tr.n_nodos_comunes)} comparable nodes (median change ${num(tr.delta_vf_mediana, 3)}); Peninsular went from ${f2(pe.vf_a)} to ${f2(pe.vf_b)}.`);
  }
  if (nr) {
    const need = nr.pml_medio_real ? 714 / nr.pml_medio_real : null;
    set('level_txt', `Noroeste: average price ${f0(nr.pml_medio)} MXN/MWh against the deck scenario's LCOE of 714 (40 USD/MWh) would need VF = ${f2(714 / nr.pml_medio)}.`);
  }
  const z = REGIONS.map((r) => [r, areaStat(WIN.Y2.key, 'region', r)]).filter((x) => x[1]).sort((x, y) => y[1].pct_e0 - x[1].pct_e0);
  if (z.length) set('le0_txt', `Share of PV energy produced at PML ≤ 0, Aug 2025 – Jul 2026: ${z.slice(0, 2).map(([r, s]) => `${regName(r)} ${f1(s.pct_e0)} %`).join(', ')}; the other regions ${f1(z[z.length - 1][1].pct_e0)}–${f1(z[2][1].pct_e0)} %.`);
}

/* ---------- 02 Prices: the deck's synthetic day ---------- */
import { syntheticDay } from './sec-story-pure.js';
export { syntheticDay };
export async function initPrices() {
  const c = col();
  const ca = await make($('#c4a'), { type: 'line', data: { labels: H, datasets: [
    { label: 'PML', data: [], borderColor: c.ink, borderWidth: 2.5, pointRadius: 0, tension: 0.3 },
    { label: 'Average', data: [], borderColor: c.ink2, borderDash: [7, 5], borderWidth: 2, pointRadius: 0 },
    { label: 'Captured', data: [], borderColor: c.orange, borderDash: [7, 5], borderWidth: 2.5, pointRadius: 0 }] },
    options: baseOptions({ interaction: { mode: 'index', intersect: false } }) });
  hourAxis(ca); axisTitle(ca, 'Hour of day', 'PML, MXN/MWh');
  ca.options.plugins.tooltip.callbacks = { title: (it) => `${pad(it[0].dataIndex)}:00 h`, label: (it) => `${it.dataset.label}: ${f0(it.raw)} MXN/MWh` };
  const cb = await make($('#c4b'), { type: 'bar', data: { labels: H, datasets: [{ label: 'Production', data: [], backgroundColor: c.sun, barPercentage: 0.8 }] }, options: baseOptions() });
  hourAxis(cb); cb.options.scales.y.min = 0; cb.options.scales.y.max = 1; cb.options.scales.y.ticks.stepSize = 0.5; axisTitle(cb, 'Hour of day', 'yₕ, kWh/kWp');
  cb.options.plugins.tooltip.callbacks = { label: (it) => `${num(it.raw, 2)} kWh/kWp` };
  const upd = () => {
    const D_ = +$('#d4').value, P_ = +$('#p4').value, tr = $('#m4').value === 'track';
    $('#d4o').textContent = f0(D_); $('#p4o').textContent = f0(P_);
    const d = syntheticDay(D_, P_, tr);
    $('#k4a').textContent = f0(d.avg); $('#k4c').textContent = f0(d.cap); $('#k4v').textContent = f2(d.vf); $('#k4z').textContent = `${f0(d.z * 100)} %`;
    ca.data.datasets[0].data = d.pml; ca.data.datasets[1].data = H.map(() => d.avg); ca.data.datasets[2].data = H.map(() => d.cap);
    const lo = Math.min(0, ...d.pml), hi = Math.max(...d.pml);
    ca.options.scales.y.min = Math.floor(Math.min(lo, d.cap) / 200) * 200; ca.options.scales.y.max = Math.ceil(hi / 200) * 200;
    cb.data.datasets[0].data = d.w.map((x) => +x.toFixed(2)); ca.update(); cb.update();
  };
  ['d4', 'p4', 'm4'].forEach((id) => $('#' + id).addEventListener('input', upd));
  upd();
}

/* ---------- 02 Explorer ---------- */
const YSEG = (id) => segHTML(id, 'Year window', [['Y1', '2024–25'], ['Y2', '2025–26']], 'Y2');
export async function initExplorer(ctx) {
  const root = $('#explorer-root');
  root.innerHTML = `
    <div class="row" style="gap:18px"><div id="xp-pick"></div>${YSEG('xp-y')}
      ${segHTML('xp-p', 'Production profile', [['typ', 'Typical year'], ['cs', 'Clear sky', true, 'Not computed in this project: production uses a typical 2015–2025 year of NASA weather']], 'typ')}</div>
    <p class="fine" id="xp-note"></p>
    <div class="stats" id="xp-stats"></div>
    <div class="xp-cols">
      <div class="stack">
        <div class="legend"><span><i class="sq" style="background:var(--c-energy)"></i>System energy \\(\\lambda^E\\)</span><span><i class="sq" style="background:var(--c-losses)"></i>Losses \\(\\lambda^L\\)</span><span><i class="sq" style="background:var(--c-cong)"></i>Congestion \\(\\lambda^C\\)</span><span><i style="background:var(--ink)"></i>PML</span><span><i class="dsh" style="border-color:var(--ink-2)"></i>\\(\\overline{\\mathrm{PML}}\\)</span><span><i class="dsh" style="border-color:var(--orange)"></i>\\(P_{\\mathrm{cap}}\\)</span></div>
        <div class="chart" style="height:290px"><canvas id="cx1" role="img" aria-label="Average day: price components stacked by hour with total price, average price and captured price"></canvas></div>
        <div class="legend"><span><i class="sq" style="background:var(--sun)"></i>Production \\(y_h\\), average day</span></div>
        <div class="chart" style="height:160px"><canvas id="cx2" role="img" aria-label="Average-day production profile"></canvas></div>
        <div id="xp-clock"></div>
      </div>
      <div class="stack">
        <div class="row" style="justify-content:space-between">${segHTML('xp-v', 'VF time view', [['win', 'Window months'], ['l12', 'Last 12 months'], ['yr', 'Calendar years']], 'win')}</div>
        <div class="legend"><span><i class="sq" style="background:var(--orange)"></i><span id="xp-vlab">VF by month</span></span><span><i class="dsh" style="border-color:var(--ink-2)"></i>VF of the period</span></div>
        <div class="chart" style="height:270px"><canvas id="cx3" role="img" aria-label="Value factor over time"></canvas></div>
        <p class="insight" id="xtext"></p>
        <details><summary>Data table</summary><div class="in scroll-x" id="xp-table"></div></details>
      </div>
    </div>
    <style>.xp-cols{display:grid;grid-template-columns:minmax(0,6fr) minmax(0,5fr);gap:34px}@media(max-width:1100px){.xp-cols{grid-template-columns:minmax(0,1fr)}}</style>`;
  renderMath(root);
  let level = 'node', key = '08NCM-115', yr = 'Y2', view = 'win', ver = 0;
  if (!D.byId.has(key)) key = [...D.available][0] || [...D.byId.keys()][0];
  const comp = await compositionChart($('#cx1'));
  const c = col();
  const c2 = await make($('#cx2'), { type: 'bar', data: { labels: H, datasets: [{ label: 'Production', data: [], backgroundColor: c.sun, barPercentage: 0.8 }] }, options: baseOptions() });
  hourAxis(c2); c2.options.scales.y.min = 0; c2.options.scales.y.max = 1; c2.options.scales.y.ticks.stepSize = 0.5; axisTitle(c2, 'Hour of day (start, CDMX clock)', 'yₕ, kWh/kWp'); yWidth(c2, 70);
  c2.options.plugins.tooltip.callbacks = { title: (it) => `${pad(it[0].dataIndex)}:00–${pad(it[0].dataIndex + 1)}:00 h`, label: (it) => `${num(it.raw, 3)} kWh/kWp` };
  const c3 = await make($('#cx3'), { data: { labels: [], datasets: [
    { type: 'bar', label: 'VF', data: [], backgroundColor: c.orange, barPercentage: 0.7, order: 2 },
    { type: 'line', label: 'VF of the period', data: [], borderColor: c.ink2, borderDash: [7, 5], borderWidth: 2, pointRadius: 0, order: 1 }] }, options: baseOptions() });
  c3.options.scales.y.min = 0; c3.options.scales.x.ticks.autoSkip = false; c3.options.scales.x.ticks.maxRotation = 0;
  c3.options.plugins.tooltip.callbacks = { label: (it) => (it.raw === null ? 'no data' : `${it.dataset.label}: ${num(it.raw, 2)}`) };
  const monthLab = (m) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m.slice(5) - 1];

  async function upd() {
    const my = ++ver, real = ctx.S.get().real;
    const rec = await areaRecord(level, key, yr);
    if (my !== ver) return;
    const n = D.byId.get(key);
    $('#xp-note').innerHTML = ctx.S.get().cfg === 'fixed' ? sig('warn', 'Tracker only') + ' The explorer areas and hourly profiles are computed for the single-axis tracker; the Fixed selection applies to the node sheet and compare.' : '';
    if (rec.missing) {
      $('#xp-stats').innerHTML = ''; $('#xtext').innerHTML = level === 'node'
        ? `No explorer data for this node in ${WIN[yr].label}: it is outside the analysis universe (SIN nodes with a solar baseline and ≥ 300 days of prices; Cozumel excluded; Baja California systems are pending a baseline). ${D.available.has(key) ? `<a href="#node" data-node="${esc(key)}">Open its node sheet</a>.` : ''}`
        : 'No complete data for this selection.';
      return;
    }
    const base = real && rec.baseReal != null ? rec.baseReal : rec.base, cap = real && rec.capReal != null ? rec.capReal : rec.cap;
    const tiles = [['Avg price · MXN/MWh', f0(base)], ['Captured · MXN/MWh', f0(cap)], ['VF exact', f2(real && rec.capReal ? rec.capReal / rec.baseReal : rec.vf)],
      ['VF average day', f2(rec.vfDay)], ['Spread peak − solar · MXN/MWh', f0(rec.spread)], ['PV energy at PML ≤ 0', `${f1(rec.z)} %`]];
    $('#xp-stats').innerHTML = tiles.map(([l, v]) => `<div class="stat"><span>${esc(l)}</span><strong>${v}</strong></div>`).join('');
    if (rec.hours) {
      const h = rec.hours; comp.set({ pml: h.pml, energia: h.energia, perdidas: h.perdidas, congestion: h.congestion, base: rec.base, cap: rec.cap });
      c2.data.datasets[0].data = h.y; c2.update();
    }
    $('#xp-clock').innerHTML = `<p class="fine">Hourly profiles are averages over the window days in <b>nominal pesos</b> of each month; the tiles follow the price basis. Spread = mean PML 18–22 h minus mean PML 06–18 h.</p>` + clockFoot(level === 'node' && n ? n.sistema : 'SIN');
    // third chart
    const ms = await monthlySeries(level, key);
    const w = WIN[yr];
    let labels = [], vals = [], per = rec.vf, rows = [];
    $('#xp-vlab').textContent = view === 'yr' ? 'VF by calendar year' : 'VF by month';
    if (ms && view === 'win') {
      const idx = ms.months.map((m, i) => (m >= w.desde && m <= w.hasta ? i : -1)).filter((i) => i >= 0);
      labels = idx.map((i) => monthLab(ms.months[i])); vals = idx.map((i) => ms.vf[i]);
      rows = idx.map((i) => [ms.months[i], ms.vf[i]]);
    } else if (ms && view === 'l12') {
      const end = ms.months.length - 1, idx = [...Array(12).keys()].map((k) => end - 11 + k);
      labels = idx.map((i) => `${monthLab(ms.months[i])} ${ms.months[i].slice(2, 4)}`); vals = idx.map((i) => ms.vf[i]);
      rows = idx.map((i) => [ms.months[i], ms.vf[i]]);
      const L = vals.filter((v) => v !== null); per = L.length ? L.reduce((a, b) => a + b, 0) / L.length : null;
    } else if (ms && view === 'yr') {
      const ys = ms.years.filter((y) => ms.y[String(y)]);
      labels = ys.map(String);
      vals = ys.map((y) => { const r = ms.y[String(y)]; const [pm, cp, pmr, cpr] = r; return +(real ? cpr / pmr : cp / pm).toFixed(3); });
      rows = ys.map((y) => { const r = ms.y[String(y)]; return [String(y), vals[ys.indexOf(y)], real ? r[3] : r[1], real ? r[2] : r[0], r[4] ?? ''] ; });
      const L = vals.filter((v) => v !== null); per = L.length ? L.reduce((a, b) => a + b, 0) / L.length : null;
    }
    c3.data.labels = labels; c3.data.datasets[0].data = vals; c3.data.datasets[1].data = labels.map(() => (per === null ? null : +per.toFixed(3)));
    c3.options.scales.y.suggestedMax = 1; c3.options.scales.y.max = Math.max(1, Math.ceil(Math.max(0, ...vals.filter((v) => v !== null)) * 10) / 10);
    axisTitle(c3, view === 'yr' ? 'Calendar year (complete years only)' : 'Month (CDMX clock)', 'VF, no unit');
    c3.update();
    const hdr = view === 'yr' ? '<th>Year</th><th class="n">VF</th><th class="n">Captured</th><th class="n">Avg price</th><th class="n">Nodes</th>' : '<th>Month</th><th class="n">VF</th>';
    $('#xp-table').innerHTML = `<table><thead><tr>${hdr}</tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="n">${r[1] === null ? '—' : f2(r[1])}</td>${view === 'yr' ? `<td class="n">${f0(r[2])}</td><td class="n">${f0(r[3])}</td><td class="n">${r[4] === '' ? '—' : f0(r[4])}</td>` : ''}</tr>`).join('')}</tbody></table>
      <p class="fine">${view === 'yr' ? `Calendar years 2020–2025 only: a year counts when all 12 months have every hour; 2026 is partial. Yearly VF = ${real ? "today's-pesos" : 'nominal'} captured price over average price, from additive sums.` : view === 'l12' ? `Last 12 complete months, ending ${ms.months[ms.months.length - 1]}. Months without every hour are left empty.` : 'Months of the selected 12-month window.'}</p>`;
    // text
    let txt;
    const gap = rec.vf - rec.vfDay;
    if (level === 'node') txt = `<b>${esc(n ? n.nombre : key)}</b>, ${esc(n ? n.municipio : '')}, ${esc(n ? n.entidad : '')} · ${esc(rec.region || '')} region. `;
    else txt = `<b>${esc(areaName(level, key))}</b> · average of ${f0(rec.n)} nodes${rec.vfMedian ? `; median node VF ${f2(rec.vfMedian)}` : ''}. `;
    txt += `Exact VF ${f2(rec.vf)}; average day ${f2(rec.vfDay)}. ` + (Math.abs(gap) < 0.015 ? 'The seasons barely matter here.' : gap < 0 ? 'The exact value is lower because the sunniest months are also the cheapest.' : 'The exact value is higher because the sunniest months are also the most expensive.');
    $('#xtext').innerHTML = txt;
  }
  const pk = Picker($('#xp-pick'), { init: { level, key }, id: 'xp', onChange: (l, k) => { level = l; key = k; upd(); } });
  seg($('#xp-y'), (v) => { yr = v; upd(); });
  seg($('#xp-v'), (v) => { view = v; upd(); });
  ctx.onRefresh(upd);
  ctx.setExplorer = (id) => { level = 'node'; key = id; pk.set('node', id); upd(); };
  await upd();
}

/* ---------- 03 Revenue ---------- */
export async function initRevenue(ctx) {
  const root = $('#revenue-root');
  root.innerHTML = `<div class="row" style="gap:16px"><div id="rv-pick"></div>${YSEG('rv-y')}</div>
    <div class="stats" id="rv-stats"></div>
    <div class="legend"><span><i class="sq" style="background:var(--c-energy)"></i>System energy \\(\\lambda^E\\)</span><span><i class="sq" style="background:var(--c-losses)"></i>Losses \\(\\lambda^L\\)</span><span><i class="sq" style="background:var(--c-cong)"></i>Congestion \\(\\lambda^C\\)</span><span><i style="background:var(--ink)"></i>PML</span></div>
    <div class="chart" style="height:230px"><canvas id="c5a" role="img" aria-label="Average-day price by hour with its components, average price and captured price"></canvas></div>
    <div class="legend"><span><i class="sq" style="background:var(--ink-3)"></i>Shortcut revenue \\(y_h\\,\\overline{\\mathrm{PML}}\\)</span><span><i class="sq" style="background:var(--orange)"></i>Real revenue \\(y_h\\,\\mathrm{PML}_h\\)</span><span class="muted">1 MWp · average day · MXN</span></div>
    <div class="chart" style="height:200px"><canvas id="c5b" role="img" aria-label="Revenue of 1 MWp by hour of an average day, shortcut versus real"></canvas></div>
    <div class="ctrl"><label for="yf5">\\(Y_f\\) used, kWh/kWp·yr (model yield, drag to override)</label><output id="yf5o"></output><input type="range" id="yf5" min="1200" max="2800" step="10" value="1900"></div>
    <div id="rv-clock"></div>`;
  renderMath(root);
  let level = 'node', key = '04RGU-115', yr = 'Y2', man = false, ver = 0;
  const comp = await compositionChart($('#c5a'));
  const c = col();
  const cb = await make($('#c5b'), { type: 'bar', data: { labels: H, datasets: [
    { label: 'Shortcut', data: [], backgroundColor: c.ink3, barPercentage: 0.9, categoryPercentage: 0.8 },
    { label: 'Real', data: [], backgroundColor: c.orange, barPercentage: 0.9, categoryPercentage: 0.8 }] }, options: baseOptions({ interaction: { mode: 'index', intersect: false } }) });
  hourAxis(cb); cb.options.scales.y.min = 0; cb.options.scales.y.ticks.maxTicksLimit = 4; axisTitle(cb, 'Hour of day (start, CDMX clock)', 'MXN per MWp'); yWidth(cb, 70);
  cb.options.plugins.tooltip.callbacks = { title: (it) => `${pad(it[0].dataIndex)}:00–${pad(it[0].dataIndex + 1)}:00 h · revenue of 1 MWp`, label: (it) => `${it.dataset.label}: ${f0(it.raw)} MXN` };
  async function upd() {
    const my = ++ver, real = ctx.S.get().real;
    const g = await areaRecord(level, key, yr); if (my !== ver) return;
    if (g.missing || !g.hours) { $('#insight5').textContent = 'No complete data for this selection in that window.'; $('#rv-stats').innerHTML = ''; return; }
    if (!man) $('#yf5').value = Math.round(g.yf / 10) * 10;
    const Yf = +$('#yf5').value; $('#yf5o').textContent = f0(Yf);
    const base = real && g.baseReal != null ? g.baseReal : g.base, cap = real && g.capReal != null ? g.capReal : g.cap, vf = cap / base;
    const R = Yf * cap / 1e6, Rs = Yf * base / 1e6, over = (1 / vf - 1) * 100;
    const tiles = [['Avg price · MXN/MWh', f0(base)], ['Captured · MXN/MWh', f0(cap)], ['VF', f2(vf)], ['Real R · M MXN', f2(R)], ['Shortcut · M MXN', f2(Rs)], ['Overstated', `${signed(over, 0)} %`]];
    $('#rv-stats').innerHTML = tiles.map(([l, v]) => `<div class="stat"><span>${esc(l)}</span><strong>${v}</strong></div>`).join('');
    const h = g.hours; comp.set({ pml: h.pml, energia: h.energia, perdidas: h.perdidas, congestion: h.congestion, base: g.base, cap: g.cap });
    const sy = h.y.reduce((a, b) => a + b, 0), k = sy > 0 ? Yf / 365 / sy : 0;
    cb.data.datasets[0].data = h.y.map((y) => y * k * g.base); cb.data.datasets[1].data = h.y.map((y, i) => y * k * h.pml[i]); cb.update();
    $('#insight5').innerHTML = `<b>${esc(areaName(level, key))}, ${WIN[yr].label}.</b> With \\(Y_f\\) = ${f0(Yf)} kWh/kWp, 1 MWp earns ${f2(R)} M MXN a year at the captured price of ${f0(cap)} MXN/MWh (${real ? "today's pesos" : 'nominal'}). The shortcut books ${f2(Rs)} M MXN, ${f2(Rs - R)} M MXN (${signed(over, 0)} %) that the node never pays.`;
    renderMath($('#insight5'));
    $('#rv-clock').innerHTML = `<p class="fine">Bars use the average day (nominal pesos); their sum gives the average-day VF, a few hundredths from the exact VF. Pvlib output already includes system losses (0.904 derate).</p>` + clockFoot(level === 'node' && D.byId.get(key) ? D.byId.get(key).sistema : 'SIN');
  }
  Picker($('#rv-pick'), { init: { level, key }, id: 'rv', onChange: (l, k) => { level = l; key = k; man = false; upd(); } });
  seg($('#rv-y'), (v) => { yr = v; man = false; upd(); });
  $('#yf5').addEventListener('input', () => { man = true; upd(); });
  ctx.onRefresh(upd);
  await upd();
}

/* ---------- 04 Value factor ---------- */
export async function initVF(ctx) {
  const c = col();
  const keys = [...REGIONS.slice().sort((a, b) => (areaStat(WIN.Y2.key, 'region', b)?.vf || 0) - (areaStat(WIN.Y2.key, 'region', a)?.vf || 0)), 'ALL'];
  const g = (k, w) => (k === 'ALL' ? areaStat(WIN[w].key, 'national') : areaStat(WIN[w].key, 'region', k));
  const ch = await make($('#c-vf-region'), { type: 'bar', data: { labels: keys.map((k) => (k === 'ALL' ? 'National' : RN[k])), datasets: [
    { label: WIN.Y1.short, data: keys.map((k) => g(k, 'Y1')?.vf ?? null), backgroundColor: c.ink3, barPercentage: 0.8, categoryPercentage: 0.7 },
    { label: WIN.Y2.short, data: keys.map((k) => g(k, 'Y2')?.vf ?? null), backgroundColor: c.orange, barPercentage: 0.8, categoryPercentage: 0.7 }] },
    options: baseOptions({ interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true, labels: { color: c.ink2 } }, tooltip: baseOptions().plugins.tooltip } }) });
  ch.options.scales.y.min = 0; ch.options.scales.y.max = 1; ch.options.scales.y.ticks.stepSize = 0.2; ch.options.scales.x.ticks.color = c.ink; ch.options.scales.x.ticks.font = { family: 'DM Sans', size: 13 };
  axisTitle(ch, 'Control region (sorted by 2025–26 VF)', 'VF, no unit');
  ch.options.plugins.tooltip.callbacks = { label: (it) => `${it.dataset.label}: VF ${num(it.raw, 2)}` };
  ch.update();
  // mini map
  const geo = await loadGeo(); if (!geo) return;
  const host = $('#vf-mini');
  const gm = new GeoMap(host, geo, { interactive: false, fontSize: 30 });
  const lo = 0.55, hi = 0.95;
  const LO = c.energy ? '#33443A' : '#33443A', HI = '#EDE6D0';
  gm.setFill({ level: 'region', color: (r) => { const s = areaStat(WIN.Y2.key, 'region', r); return s ? mix(LO, HI, clamp01((s.vf - lo) / (hi - lo))) : null; },
    label: (r) => { const s = areaStat(WIN.Y2.key, 'region', r); return s ? f2(s.vf) : ''; }, name: (r) => RN[r] });
  $('#vf-mini-leg').innerHTML = `<span>${lo.toFixed(2)}</span><i></i><span>${hi.toFixed(2)}</span>`;
  $('#vf-mini-title').textContent = `VF by control region · ${WIN.Y2.label}`;
  host.addEventListener('click', () => { location.hash = '#map'; });
}
