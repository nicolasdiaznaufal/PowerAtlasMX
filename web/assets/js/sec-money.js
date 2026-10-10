// Profitability, node P&L and conclusions. Every figure is labelled with the active assumption set and recomputes
// from it (Web Worker for the node universe, finmodel.js for a single place).
import { D, loadNodos, nodeWin, areaStat, px, loadGeo, winCfg } from './data.js';
import { evaluate, verdict, usdToMxn, DECK_FX } from './finmodel.js';
import { status } from './params.js';
import { make, baseOptions, axisTitle, col } from './charts.js';
import { GeoMap } from './geomap.js';
import { rampColor, metricOf } from './sec-map.js';
import { $, esc, seg, segHTML, sig } from './util.js';
import { num, signed, mn } from './format.js';
import { Picker, areaName, assumpBarHTML, assumpLabel } from './common.js';
import { WIN, WIN_J, REGIONS, RN, regName, stName, stAbbr } from './names.js';
import { renderMath } from './tex.js';
import { insightEn, shown } from './analysis.js';

const f0 = (v) => num(v, 0), f1 = (v) => num(v, 1), f2 = (v) => num(v, 2);

/** inputs of one place for one window, in the active price basis. */
export async function placeInputs(level, key, winId, real) {
  const wk = WIN[winId].key;
  if (level === 'node') {
    const nodos = await loadNodos(); const w = nodeWin(nodos, key, wk); if (!w) return null;
    const pcap = real ? w.p_cap_real : w.p_cap, pml = real ? w.pml_medio_real : w.pml_medio;
    return { pcap, pml, vf: pcap / pml, yf: w.y_f, n: 1 };
  }
  const s = areaStat(wk, level, key); if (!s) return null;
  const pcap = px(s, 'p_cap', real), pml = px(s, 'pml_medio', real);
  return { pcap, pml, vf: pcap / pml, yf: s.y_f_mwh_por_mwp, n: s.n_nodos };
}
const verdictChip = (ctx, lcoe, pcap) => {
  const st = ctx.status(), set = ctx.set();
  if (st.level !== 'complete') return st.level === 'deck' ? sig('neutral', 'No verdict: deck scenario shows coverage of the printed LCOE only') : sig('neutral', 'No verdict: assumption set incomplete');
  const v = verdict(lcoe, pcap, set.band_pct);
  if (v === 'ok') return sig('ok', 'Covers its cost, under your assumptions');
  if (v === 'warn') return sig('warn', `Within ${f0(set.band_pct)} % of its cost, under your assumptions`);
  if (v === 'bad') return sig('bad', 'Below its cost, under your assumptions');
  return sig('neutral', 'No verdict');
};
const money = (v) => (v == null ? '—' : `${mn(v, 1)} M`);

export async function initProfit(ctx) {
  const root = $('#profit-root');
  root.innerHTML = `<div class="row">${segHTML('pf-y', 'Window', [['Y1', '2024–25'], ['Y2', '2025–26']], 'Y2')}${segHTML('pf-l', 'Map level', [['region', 'Regions'], ['state', 'States']], 'region')}</div>
    <div class="pick" id="pf-pick"></div>
    <div class="assump-bar" data-assump-bar></div>
    <div id="pf-verdict"></div>
    <div class="stats" id="pf-stats"></div>
    <div class="pf-cols">
      <div class="stack"><div class="mini-host" id="pf-map" role="img" aria-label="Map of Mexico showing which areas cover the LCOE"></div>
        <div class="legend"><span><i class="sq" style="background:var(--cream)"></i>\\(P_{\\mathrm{cap}}\\ge\\) LCOE</span><span><i class="sq" style="background:var(--c-fail)"></i>\\(P_{\\mathrm{cap}}&lt;\\) LCOE</span></div></div>
      <div class="stack"><div class="chart" style="height:300px"><canvas id="pf-bars" role="img" aria-label="Captured solar price by region or state compared with the LCOE"></canvas></div></div>
    </div>
    <ul class="dash" id="pf-text"></ul>
    <h3 class="sub">Share of nodes covering the cost, by cost level</h3>
    <div class="chart" style="height:240px"><canvas id="pf-sens" role="img" aria-label="Share of nodes whose captured price covers an LCOE, by LCOE level"></canvas></div>
    <details open><summary>Regions</summary><div class="in scroll-x" id="pf-reg"></div></details>
    <details><summary>States</summary><div class="in scroll-x" id="pf-st"></div></details>
    <style>.pf-cols{display:grid;grid-template-columns:minmax(0,4fr) minmax(0,7fr);gap:26px}@media(max-width:900px){.pf-cols{grid-template-columns:minmax(0,1fr)}}</style>`;
  renderMath(root);
  const geo = await loadGeo(), nodos = await loadNodos();
  const c = col();
  const gm = geo ? new GeoMap($('#pf-map'), geo, { interactive: true, fontSize: 28, onClick: (h) => { if (h.kind === 'state') { if (lv === 'state') { sl = 'state'; sk = h.key; } else if (h.region !== 'BAJA') { sl = 'region'; sk = h.region; } pk.set(sl, sk); render(); } } }) : null;
  const bars = await make($('#pf-bars'), { data: { labels: [], datasets: [{ type: 'bar', label: 'Captured price', data: [], barPercentage: 0.7, order: 2 }, { type: 'line', label: 'LCOE', data: [], borderColor: c.orange, borderWidth: 2.5, borderDash: [7, 5], pointRadius: 0, order: 1 }] }, options: baseOptions() });
  bars.options.scales.x.ticks.autoSkip = false; bars.options.scales.x.ticks.color = c.ink; bars.options.scales.y.min = 0;
  const sens = await make($('#pf-sens'), { data: { labels: [], datasets: [{ type: 'line', label: 'Share of nodes covering', data: [], borderColor: c.cream, borderWidth: 2.5, pointRadius: 3, backgroundColor: c.cream }, { type: 'line', label: 'Current threshold', data: [], borderColor: c.orange, pointRadius: 7, showLine: false, backgroundColor: c.orange }] }, options: baseOptions() });
  sens.options.scales.y.min = 0; sens.options.scales.y.max = 100; axisTitle(sens, 'LCOE, USD/MWh', '% of nodes');
  let yr = 'Y2', lv = 'region', sl = 'region', sk = 'ORIENTAL', ver = 0;
  async function render() {
    const my = ++ver, real = ctx.S.get().real, set = ctx.set(), st = ctx.status(), wk = WIN[yr].key;
    const res = await ctx.finEval(yr); if (my !== ver) return;
    $$bar();
    const fx = set.fx ?? DECK_FX;
    const place = await placeInputs(sl, sk, yr, real);
    if (!place) { $('#pf-stats').innerHTML = ''; return; }
    const ev = evaluate(set, place, !real);
    // when the universe has a threshold use its figures for the selected area (consistent with the tables)
    const rowRes = res && res.mode && sl !== 'node' ? (sl === 'national' ? res.national : res[sl] && res[sl][sk]) : null;
    const lcoe = rowRes ? rowRes.lcoe : ev.lcoe, margin = lcoe != null ? place.pcap - lcoe : null;
    const tiles = [['Captured · MXN/MWh', f0(place.pcap)], ['LCOE · MXN/MWh', lcoe == null ? '—' : f0(lcoe)],
      ['Margin · MXN/MWh', margin == null ? '—' : `<span class="${margin < 0 ? 'neg' : ''}">${signed(margin, 0)}</span>`],
      ['VF / VF req', lcoe == null ? f2(place.vf) : `${f2(place.vf)}<small>/ ${f2(lcoe / place.pml)}</small>`],
      ['Break-even · USD/MWh', f1(place.pcap / fx)]];
    if (st.level === 'complete' && ev.irr !== undefined) {
      tiles.push(['IRR', ev.irr == null ? 'n/a' : `${f1(ev.irr * 100)} %`], ['NPV · M MXN per MWp', mn(ev.npvMwp, 2)], ['Break-even PML base', ev.beBase == null ? '—' : f0(ev.beBase)]);
    }
    $('#pf-stats').innerHTML = tiles.map(([l, v]) => `<div class="stat"><span>${esc(l)}</span><strong>${v}</strong></div>`).join('');
    $('#pf-verdict').innerHTML = `<div class="row">${verdictChip(ctx, lcoe, place.pcap)}<span class="muted">${esc(areaName(sl, sk))}, ${WIN[yr].label}, ${real ? "today's pesos" : 'nominal'}${st.level === 'complete' && sl !== 'node' ? ' · plant at the area’s average yield' : ''}</span></div>`;
    // area colours
    const cover = (level, k) => { const s = areaStat(wk, level, k); if (!s) return null; const L = res && res.mode && res[level] && res[level][k] ? res[level][k].lcoe : null; const p = px(s, 'p_cap', real); return L == null ? null : p >= L; };
    if (gm) {
      gm.setFill({ level: lv, color: (k) => { const o = cover(lv, k); return o === null ? null : o ? '#EDE6D0' : c.energy; }, label: (k) => { const s = areaStat(wk, 'region', k); const L = res && res.region && res.region[k]; return s && L ? signed(px(s, 'p_cap', real) - L.lcoe, 0) : ''; }, name: (k) => RN[k] });
      gm.setSelected({ region: lv === 'region' && sl === 'region' ? sk : null, state: lv === 'state' && sl === 'state' ? sk : null });
    }
    const cfg = winCfg(wk);
    const keys = (lv === 'region' ? REGIONS.slice() : Object.keys(cfg.estados)).filter((k) => areaStat(wk, lv, k));
    keys.sort((a, b) => px(areaStat(wk, lv, b), 'p_cap', real) - px(areaStat(wk, lv, a), 'p_cap', real));
    const caps = keys.map((k) => px(areaStat(wk, lv, k), 'p_cap', real));
    const Ls = keys.map((k) => (res && res.mode && res[lv] && res[lv][k] ? res[lv][k].lcoe : null));
    bars.data.labels = keys.map((k) => (lv === 'region' ? RN[k] : stAbbr(k)));
    bars.data.datasets[0].data = caps; bars.data.datasets[0].backgroundColor = caps.map((v, i) => (Ls[i] != null && v >= Ls[i] ? '#EDE6D0' : c.energy));
    bars.data.datasets[0].borderColor = keys.map((k) => (sl === lv && k === sk ? c.orange : 'transparent')); bars.data.datasets[0].borderWidth = 3;
    bars.data.datasets[1].data = Ls;
    bars.options.scales.x.ticks.font = { family: 'DM Sans', size: lv === 'region' ? 13 : 11 };
    axisTitle(bars, `${lv === 'region' ? 'Control region' : 'State'} (sorted by captured price)`, `Captured price, MXN/MWh · ${real ? "today's pesos" : 'nominal'}`);
    bars.options.plugins.tooltip.callbacks = { title: (it) => (lv === 'region' ? RN[keys[it[0].dataIndex]] : stName(keys[it[0].dataIndex])), label: (it) => `${it.dataset.label}: ${f0(it.raw)} MXN/MWh` };
    bars.update();
    // bullets
    const nat = res && res.mode ? res.national : null;
    const other = yr === 'Y2' ? 'Y1' : 'Y2';
    const bl = [];
    if (nat) {
      const rpass = REGIONS.filter((r) => res.region[r] && res.region[r].pct > 50);
      bl.push(`<b>Nodes that pay:</b> <span class="muted">${f0(nat.covering)} of ${f0(nat.n)} (${f0(nat.pct)} %) have a captured price at or above the threshold in ${WIN[yr].short}.</span>`);
      bl.push(`<b>Regions:</b> <span class="muted">${rpass.length ? `${rpass.map(regName).join(', ')} ${rpass.length === 1 ? 'covers' : 'cover'} it for most of their nodes.` : 'no region covers it for most of its nodes.'} The best regional captured price is ${f0(Math.max(...REGIONS.map((r) => px(areaStat(wk, 'region', r), 'p_cap', real) || 0))) } MXN/MWh.</span>`);
      if (lcoe != null) bl.push(`<b>${esc(areaName(sl, sk))}:</b> <span class="muted">captured ${f0(place.pcap)} vs cost ${f0(lcoe)} MXN/MWh: ${margin >= 0 ? `covers it with ${f0(margin)} MXN/MWh to spare, and still pays at any cost below ${f1(place.pcap / fx)} USD/MWh` : `falls ${f0(-margin)} MXN/MWh short; it would need a VF of ${f2(lcoe / place.pml)} at its average price`}.</span>`);
    } else bl.push('<span class="muted">Enter a target LCOE and exchange rate, or a complete set, in Assumptions to get coverage figures.</span>');
    $('#pf-text').innerHTML = bl.map((s) => `<li><span>${s}</span></li>`).join('');
    // sensitivity from nodos (main thread, cheap)
    const w = nodos.ventanas[wk], P = real ? w.p_cap_real : w.p_cap;
    const usd = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70], valid = P.filter((v) => v !== null);
    const pct = usd.map((u) => 100 * valid.filter((v) => v >= usdToMxn(u, fx)).length / valid.length);
    sens.data.labels = usd;
    sens.data.datasets[0].data = pct;
    const curUsd = set.target_lcoe_usd;
    sens.data.datasets[1].data = usd.map((u) => (curUsd === u ? pct[usd.indexOf(u)] : null));
    sens.update();
    // tables
    const tbl = (list, level) => `<table class="tbl"><thead><tr><th>${level === 'region' ? 'Region' : 'State'}</th><th class="n">Nodes</th><th class="n">Captured</th><th class="n">LCOE</th><th class="n">Margin</th><th class="n">% covering</th><th class="n">VF</th><th class="n">VF req</th></tr></thead><tbody>
      ${list.map((k) => { const s = areaStat(wk, level, k), r = res && res.mode && res[level] ? res[level][k] : null, p = px(s, 'p_cap', real), m = px(s, 'pml_medio', real);
        return `<tr><td>${esc(level === 'region' ? regName(k) : stName(k))}</td><td class="n">${f0(s.n_nodos)}</td><td class="n">${f0(p)}</td><td class="n">${r ? f0(r.lcoe) : '—'}</td><td class="n">${r ? signed(p - r.lcoe, 0) : '—'}</td><td class="n">${r ? f0(r.pct) + ' %' : '—'}</td><td class="n">${f2(p / m)}</td><td class="n">${r ? f2(r.lcoe / m) : '—'}</td></tr>`; }).join('')}</tbody></table>
      <p class="fine">${esc(assumpLabel(ctx))} · ${WIN[yr].label} · ${real ? "today's pesos" : 'nominal'}. Area LCOE is the average of node LCOEs${res && res.mode === 'own' ? ' (each node’s own yield)' : ''}.</p>`;
    $('#pf-reg').innerHTML = tbl(REGIONS.filter((k) => areaStat(wk, 'region', k)), 'region');
    $('#pf-st').innerHTML = tbl(Object.keys(cfg.estados).sort((a, b) => stName(a).localeCompare(stName(b))), 'state');
  }
  const $$bar = () => { document.querySelectorAll('#profit [data-assump-bar]').forEach((e) => { e.innerHTML = assumpBarHTML(ctx); }); };
  const pk = Picker($('#pf-pick'), { levels: ['node', 'state', 'region', 'national'], init: { level: sl, key: sk }, id: 'pf', onChange: (l, k) => { sl = l; sk = k; render(); } });
  seg($('#pf-y'), (v) => { yr = v; render(); });
  seg($('#pf-l'), (v) => { lv = v; render(); });
  ctx.onRefresh(render);
  await render();
}

export async function initPnl(ctx) {
  const root = $('#pnl-root');
  root.innerHTML = `<div class="row"><div id="pl-pick"></div>${segHTML('pl-y', 'Window', [['Y1', '2024–25'], ['Y2', '2025–26']], 'Y2')}</div>
    <div class="assump-bar" data-assump-bar></div><div id="pl-verdict"></div>
    <div class="ctrls three">
      <div class="ctrl"><label for="p14">Average price \\(\\overline{\\mathrm{PML}}\\), MXN/MWh</label><output id="p14o"></output><input type="range" id="p14" min="100" max="2000" step="5" value="700"></div>
      <div class="ctrl"><label for="v14">Value factor VF</label><output id="v14o"></output><input type="range" id="v14" min="0.30" max="1.10" step="0.01" value="0.84"></div>
      <div class="ctrl"><label for="l14">Losses not in the model, %</label><output id="l14o"></output><input type="range" id="l14" min="0" max="25" step="0.5" value="0"></div>
      <div class="ctrl"><label for="s14">Plant size \\(P_{\\mathrm{STC}}\\), MWp</label><output id="s14o"></output><input type="range" id="s14" min="1" max="300" step="1" value="50"></div>
      <div class="ctrl"><label for="c14">LCOE, USD/MWh</label><output id="c14o"></output><input type="range" id="c14" min="15" max="70" step="1" value="40"></div>
      <div class="ctrl"><label>LCOE, MXN/MWh</label><output id="c14m"></output></div>
    </div>
    <div class="stats" id="pl-stats"></div>
    <div class="chart" style="height:230px"><canvas id="ch14" role="img" aria-label="Shortcut revenue, real revenue and cost in million MXN per year"></canvas></div>
    <p class="fine" id="pl-fine"></p>`;
  renderMath(root);
  const c = col();
  const ch = await make($('#ch14'), { type: 'bar', data: { labels: ['Shortcut revenue (VF = 1)', 'Real revenue', 'Levelized cost'], datasets: [{ data: [], backgroundColor: [c.ink3, c.orange, c.cream], barPercentage: 0.62 }] }, options: baseOptions({ indexAxis: 'y' }) });
  ch.options.scales.x.grid = { display: true, color: c.line }; ch.options.scales.y.grid = { display: false }; ch.options.scales.x.min = 0;
  axisTitle(ch, 'Million MXN per year', null); ch.options.scales.y.ticks.font = { family: 'DM Sans', size: 14 }; ch.options.scales.y.ticks.color = c.ink;
  ch.options.plugins.tooltip.callbacks = { label: (it) => `${f1(it.raw)} M MXN/yr` };
  let lv = 'node', key = '08NCM-115', yr = 'Y2', place = null, over = false, ver = 0;
  async function load() {
    const my = ++ver, real = ctx.S.get().real, set = ctx.set(), st = ctx.status();
    place = await placeInputs(lv, key, yr, real); if (my !== ver) return;
    if (!place) { $('#pl-stats').innerHTML = ''; $('#pnlNotes').innerHTML = '<li>No complete data for this selection in that window.</li>'; return; }
    $('#p14').value = Math.round(place.pml / 5) * 5; $('#v14').value = place.vf.toFixed(2); over = false;
    if (set.mwp != null) $('#s14').value = Math.min(300, Math.max(1, Math.round(set.mwp)));
    const fx = set.fx ?? DECK_FX;
    const ev = evaluate(set, place, !real);
    if (ev.lcoe != null) $('#c14').value = Math.min(70, Math.max(15, Math.round(ev.lcoe / fx)));
    upd();
  }
  function upd() {
    if (!place) return;
    const real = ctx.S.get().real, set = ctx.set(), st = ctx.status(), fx = set.fx ?? DECK_FX;
    const P = +$('#p14').value, VF = +$('#v14').value, Lp = +$('#l14').value, S = +$('#s14').value, L = +$('#c14').value, Lm = usdToMxn(L, fx);
    const Yf = place.yf * (1 - Lp / 100);
    $('#p14o').textContent = f0(P); $('#v14o').textContent = f2(VF); $('#l14o').textContent = f1(Lp); $('#s14o').textContent = f0(S); $('#c14o').textContent = f0(L); $('#c14m').textContent = f0(Lm);
    const cap = VF * P, E = S * Yf, R = E * cap / 1e6, Rs = E * P / 1e6, C = E * Lm / 1e6, Pi = R - C;
    $('#pl-stats').innerHTML = [['Captured · MXN/MWh', f0(cap)], ['\\(Y_f\\) used · kWh/kWp', f0(Yf)], ['Energy · GWh/yr', f1(E / 1000)], ['Revenue · M MXN/yr', f1(R)], ['Margin · M MXN/yr', `<span class="${Pi < 0 ? 'neg' : ''}">${signed(Pi, 1)}</span>`]]
      .map(([l, v]) => `<div class="stat"><span>${l}</span><strong>${v}</strong></div>`).join('');
    renderMath($('#pl-stats'));
    ch.data.datasets[0].data = [Rs, R, C].map((x) => +x.toFixed(2)); ch.update();
    const req = Lm / P;
    $('#pnlNotes').innerHTML = [
      `<li>Each MWh sells at <b>${f0(cap)} MXN</b> (VF ${f2(VF)} × average price ${f0(P)}) and costs <b>${f0(Lm)} MXN</b> (LCOE ${L} USD): <b class="${cap >= Lm ? '' : 'neg'}">${signed(cap - Lm, 0)} MXN per MWh</b>.</li>`,
      `<li>A ${f0(S)} MWp plant produces ${f1(E / 1000)} GWh a year (Y<sub>f</sub> ${f0(Yf)} kWh/kWp), so it <b>${Pi >= 0 ? 'earns' : 'loses'} ${f1(Math.abs(Pi))} M MXN a year</b> ${Pi >= 0 ? 'above' : 'against'} the return investors require.</li>`,
      `<li class="muted">It breaks even at an LCOE up to ${f1(cap / fx)} USD/MWh, or with VF ≥ ${f2(req)} at this average price${req > 1.05 ? ', out of reach for solar' : ''}.</li>`,
      `<li class="muted">The shortcut (VF = 1) would book ${f1(Rs)} M MXN instead of ${f1(R)}: ${f1(Rs - R)} M MXN (${signed((1 / VF - 1) * 100, 0)} %) of revenue that does not exist.</li>`].join('')
      + (over ? '<li class="muted">Price or VF moved by hand: values no longer match the data of the selected place.</li>' : '');
    const ev = st.level === 'complete' ? evaluate(set, { pcap: cap, pml: P, vf: VF, yf: Yf }, !real) : null;
    $('#pl-verdict').innerHTML = `<div class="row">${verdictChip(ctx, st.level === 'complete' && ev ? ev.lcoe : Lm, cap)}${ev && ev.irr != null ? `<span class="muted">IRR ${f1(ev.irr * 100)} % · NPV ${mn(ev.npvMwp * S, 1)} M MXN for ${f0(S)} MWp (own LCOE ${f0(ev.lcoe)} MXN/MWh)</span>` : ''}</div>`;
    $('#pl-fine').textContent = `${assumpLabel(ctx)}. ${real ? "Today's pesos" : 'Nominal pesos'}. The LCOE slider starts at the active threshold; moving it is a what-if and does not change your assumptions. Merchant energy revenue only.`;
  }
  Picker($('#pl-pick'), { init: { level: lv, key }, id: 'pl', onChange: (l, k) => { lv = l; key = k; load(); } });
  seg($('#pl-y'), (v) => { yr = v; load(); });
  ['p14', 'v14'].forEach((id) => $('#' + id).addEventListener('input', () => { over = true; upd(); }));
  ['l14', 's14', 'c14'].forEach((id) => $('#' + id).addEventListener('input', upd));
  ctx.onRefresh(() => { document.querySelectorAll('#pnl [data-assump-bar]').forEach((e) => { e.innerHTML = assumpBarHTML(ctx); }); load(); });
  document.querySelectorAll('#pnl [data-assump-bar]').forEach((e) => { e.innerHTML = assumpBarHTML(ctx); });
  await load();
}

export async function initConclusions(ctx) {
  const a = D.analysis, root = $('#con-root');
  if (!a) { root.innerHTML = '<p class="callout bad">analysis.json is not available.</p>'; return; }
  const real = ctx.S.get().real;
  const n1 = areaStat(WIN_J.Y1.key, 'national'), n2 = areaStat(WIN_J.Y2.key, 'national');
  const r2 = REGIONS.map((r) => [r, areaStat(WIN_J.Y2.key, 'region', r)]).filter((x) => x[1]);
  const T = a.tendencia_vf_entre_ventanas.deck_2024_25_ago_jun__deck_2025_26_ago_jun;
  const cov = (w) => areaStat(w, 'national');
  const c1 = cov(WIN_J.Y1.key), c2 = cov(WIN_J.Y2.key);
  const pct = (s) => (real ? s.pct_nodos_cubren_lcoe_real : s.pct_nodos_cubren_lcoe_nominal), cnt = (s) => (real ? s.n_nodos_cubren_lcoe_real : s.n_nodos_cubren_lcoe_nominal);
  const lowVf = r2.slice().sort((x, y) => x[1].vf - y[1].vf), hi = lowVf[lowVf.length - 1];
  const over = (v) => (1 / v - 1) * 100;
  const pen = areaStat(WIN_J.Y2.key, 'region', 'PENINSULAR'), nor = areaStat(WIN_J.Y2.key, 'region', 'NOROESTE'), nte = areaStat(WIN_J.Y2.key, 'region', 'NORTE');
  const rk = a.ventanas.deck_2025_26.por_config.tracker.ranking_atajo_vs_real;
  const ori = rk && rk.ORIENTAL;
  const boxes = [
    ['1 · The shortcut', `${signed(over(n2.vf), 0)} %`, `Pricing solar energy at the average price overstates revenue by ${f0(over(n2.vf))} % nationally in 2025–26 (VF ${f2(n2.vf)}), and by ${f0(over(Math.max(...lowVf.slice(0, 3).map((x) => x[1].vf))))}–${f0(over(lowVf[0][1].vf))} % in ${lowVf.slice(0, 3).map((x) => regName(x[0])).join(', ')} (VF ${f2(lowVf[0][1].vf)}–${f2(lowVf[2][1].vf)}).`],
    ['2 · The trend', `${f0(T.pct_nodos_vf_baja)} %`, `of nodes saw their VF fall from 2024–25 to 2025–26. National VF went from ${f2(n1.vf)} to ${f2(n2.vf)}; Peninsular from ${f2(T.regiones.PENINSULAR.vf_a)} to ${f2(T.regiones.PENINSULAR.vf_b)}${pen ? `, while its average price stayed near ${f0(pen.pml_medio)} MXN/MWh` : ''}. Over complete years 2020–2025 the slope is negative at ${f0(a.tendencia_vf_anual_tracker.pct_pendiente_negativa)} % of nodes.`],
    ['3 · Profitability (deck scenario)', `${f0(pct(c1))} → ${f0(pct(c2))} %`, `Share of nodes whose captured price covers an LCOE of 40 USD/MWh (714 MXN/MWh, deck scenario, ${real ? "today's pesos" : 'nominal'}): ${f0(cnt(c1))} of ${f0(c1.n_nodos)} in 2024–25 and ${f0(cnt(c2))} of ${f0(c2.n_nodos)} in 2025–26 (Aug–Jun days). Test your own numbers in Assumptions.`],
    ['4 · Price level', `${f0(px(nor, 'p_cap', real))}`, `MXN/MWh: Noroeste's captured price in 2025–26 (Norte: ${f0(px(nte, 'p_cap', real))}). Both are below a 20 USD/MWh LCOE (357 MXN/MWh). There the problem is the price level, not the timing of production.`],
    ['5 · Node choice', ori ? `${f0(ori.top20_comunes)} of 20` : '—', ori ? `In Oriental, the top 20 nodes by shortcut revenue and by real revenue share ${f0(ori.top20_comunes)} node${ori.top20_comunes === 1 ? '' : 's'} (2025–26). Nationally the ranking barely changes (Spearman ${f2(rk.nacional.spearman_atajo_vs_real)}): the shortcut finds the region, not the node.` : ''],
  ];
  root.innerHTML = `<div class="grid g3 con-grid">${boxes.map(([l, v, t]) => `<article class="panel"><span class="lbl accent">${esc(l)}</span><strong class="big">${esc(v)}</strong><p class="muted">${esc(t)}</p></article>`).join('')}</div>
    <div class="split"><div class="stack"><div class="lbl accent">What to do next</div>
      <div class="panel"><p><b>Screen with captured price.</b> <span class="muted">Replace the average price with \\(P_{\\mathrm{cap}}\\) per node (explorer) in office prospection.</span></p>
      <p><b>Model the trend.</b> <span class="muted">Project VF downward over the plant life, not flat at today's value.</span></p>
      <p><b>Add storage and contracts.</b> <span class="muted">Value BESS shifting to the 18–22 h peak, and PPAs where VF is low.</span></p>
      <p><b>Tighten the yield.</b> <span class="muted">Full pvlib ModelChain with losses and inverter, P50/P90 weather years, and bankable irradiance data.</span></p></div></div>
      <div class="stack"><p class="fine">Figures: NASA POWER weather (typical year), pvlib single-axis tracker, CENACE MDA prices; Aug–Jun days of each year for the printed-LCOE comparison; nodes with at least 300 complete days, Cozumel excluded. Ranking test: shortcut revenue \\(Y_f\\cdot\\overline{\\mathrm{PML}}\\) vs real revenue \\(Y_f\\cdot P_{\\mathrm{cap}}\\).</p></div></div>
    <details><summary>All generated findings (${shown(a).length})</summary><div class="in"><ul class="dash">${shown(a).map((i) => `<li><span>${esc(insightEn(i))}</span></li>`).join('')}</ul></div></details>
    <style>.con-grid .big{display:block;font:800 clamp(32px,3.4vw,46px)/1 var(--font-display);letter-spacing:-.02em;margin:6px 0 10px}</style>`;
  renderMath(root);
  $('#con-lead').textContent = `Five findings from ${f0(Math.min(c1.n_nodos, c2.n_nodos))}–${f0(Math.max(c1.n_nodos, c2.n_nodos))} nodes with complete data, and what they mean for origination.`;
  if (!ctx._conRefresh) { ctx._conRefresh = true; ctx.onRefresh(() => { initConclusions(ctx); }); }
}
