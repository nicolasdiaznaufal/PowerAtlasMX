// Revenue: where captured price covers the LCOE (v1 Profitability block): map, bars sorted by captured price, KPI strip.
// Financial returns are not shown (assumptions are pending); the verdict pill follows the same rule as the plant card.
import { evaluate, DECK_FX } from '../../../assets/js/finmodel.js';
import { WIN, REGIONS, RN, regName, stName, stAbbr } from '../../../assets/js/names.js';
import { px } from '../../../assets/js/data-pure.js';
import { num, signed } from '../../../assets/js/format.js';
import { segment } from './controls.js';
import { barChart, renderChart, chartWidth, niceTicks, niceMax } from './svg-charts.js';
import { loadFin, loadGeoRaw, placeInputs, areaStat, finEval } from './fin-data.js';
import { activeSet, statusOf, subscribe, assumpBarHTML } from './assump.js';
import { verdictPillHTML } from './verdict.js';
import { createCanvasMap, tipFor, selectionOf, labelSize } from './geo-canvas.js';
import { esc } from './compare-ui.js';

const placeKey = (p) => (p ? `${p.kind}:${p.id}` : '');
const f0 = (v) => num(v, 0), f1 = (v) => num(v, 1), f2 = (v) => num(v, 2);

export function coverageCardHTML() {
  return `<section class="xp-card cover" id="cv-card" aria-labelledby="cv-h"><h2 class="mono" id="cv-h">Where the captured price covers the cost</h2>
    <div class="pl-top"><p class="xp-text" id="cv-where"></p>
      <div class="seg" role="radiogroup" aria-label="Map and bars level" id="cv-lv" style="grid-template-columns:repeat(2,1fr)"></div></div>
    <div class="assump-bar" id="cv-bar"></div><div id="cv-verdict"></div><div class="kpis" id="cv-kpi"></div>
    <div class="cv-cols"><div><div class="map-wrap"><div id="cv-map" role="img" aria-label="Map of Mexico showing which areas cover the LCOE"></div></div>
      <div class="legend mono"><span><i style="background:var(--map-hi)"></i>Captured price at or above the LCOE</span><span><i style="background:var(--c-energy)"></i>Captured price below the LCOE</span></div></div>
      <div><div class="chart" id="cv-bars"></div></div></div>
    <ul class="dash" id="cv-text"></ul></section>`;
}

export function mountCoverage(root, { shell, winId }) {
  const card = root.querySelector('#cv-card');
  if (!card) return;
  const q = (s) => card.querySelector(s), ui = ((shell.revUi = shell.revUi || {}).cov = shell.revUi.cov || { lv: 'region' });
  const first = shell.store.get()[0];
  if (!first) return;
  ui.place = { kind: first.kind, id: first.id }; ui.yr = winId;
  const placeName = (sh, p) => sh.label(p).t;
  let src = null, raw = null, gm = null, off = null, ver = 0;
  const real = () => shell.store.real;

  function paint() {
    if (!src || !raw || !card.isConnected) return;
    const rl = real(), set = activeSet(), st = statusOf(rl), fx = set.fx ?? DECK_FX, pl = ui.place, yr = ui.yr, lv = ui.lv;
    q('#cv-bar').innerHTML = assumpBarHTML(rl);
    const place = placeInputs(src, pl.kind, pl.id, yr, rl);
    const res = finEval(src.nodos, set, yr, rl);
    if (!place) { q('#cv-kpi').innerHTML = ''; q('#cv-verdict').innerHTML = `<p class="xp-text">No complete data for ${esc(placeName(shell, pl))} in ${esc(WIN[yr].label)}.</p>`; }
    else {
      const ev = evaluate(set, place, !rl);
      const rowRes = res && res.mode && pl.kind !== 'node' ? (pl.kind === 'national' ? res.national : res[pl.kind] && res[pl.kind][pl.id]) : null;
      const lcoe = rowRes ? rowRes.lcoe : ev.lcoe, margin = lcoe != null ? place.pcap - lcoe : null;
      q('#cv-kpi').innerHTML = [['Captured · MXN/MWh', f0(place.pcap)], ['LCOE · MXN/MWh', lcoe == null ? '—' : f0(lcoe)], ['Margin · MXN/MWh', margin == null ? '—' : signed(margin, 0)],
        ['VF vs VF required', lcoe == null ? f2(place.vf) : `${f2(place.vf)} <small>vs ${f2(lcoe / place.pml)}</small>`], ['Break-even · USD/MWh', f1(place.pcap / fx)]]
        .map(([l, v]) => `<div class="kpi"><span class="mono">${esc(l)}</span><strong>${v}</strong></div>`).join('');
      q('#cv-verdict').innerHTML = `<div class="row">${verdictPillHTML(st, set, lcoe, place.pcap)}<span class="muted">${esc(placeName(shell, pl))}, ${esc(WIN[yr].label)}, ${rl ? "today's pesos" : 'nominal'}${st.level === 'complete' && pl.kind !== 'node' ? ' · plant at the area’s average yield' : ''}</span></div>`;
      const nat = res && res.mode ? res.national : null, bl = [];
      if (nat) {
        const rp = REGIONS.filter((r) => res.region[r] && res.region[r].pct > 50);
        bl.push(`<b>Nodes that pay:</b> ${f0(nat.covering)} of ${f0(nat.n)} (${f0(nat.pct)} %) have a captured price at or above the threshold in ${WIN[yr].short}.`);
        bl.push(`<b>Regions:</b> ${rp.length ? `${rp.map(regName).join(', ')} ${rp.length === 1 ? 'covers' : 'cover'} it for most of their nodes.` : 'no region covers it for most of its nodes.'}`);
        if (lcoe != null) bl.push(`<b>${esc(placeName(shell, pl))}:</b> captured ${f0(place.pcap)} vs cost ${f0(lcoe)} MXN/MWh: ${margin >= 0 ? `covers it with ${f0(margin)} MXN/MWh to spare, and still pays at any cost below ${f1(place.pcap / fx)} USD/MWh` : `falls ${f0(-margin)} MXN/MWh short; it would need a VF of ${f2(lcoe / place.pml)} at its average price`}.`);
      } else bl.push('Enter a target LCOE and exchange rate, or a complete set, in Assumptions to get coverage figures.');
      q('#cv-text').innerHTML = bl.map((s) => `<li><span>${s}</span></li>`).join('');
    }
    // map
    const cover = (level, k) => { const s = areaStat(src.analysis, yr, level, k); if (!s) return null; const L = res && res.mode && res[level] && res[level][k] ? res[level][k].lcoe : null; return L == null ? null : px(s, 'p_cap', rl) >= L; };
    const sel = selectionOf(pl.kind === 'national' ? null : pl, shell, src.nodos);
    if (gm) { try { gm.destroy(); } catch { /* detached */ } gm = null; }
    q('#cv-map').innerHTML = '';
    const tip = tipFor(q('#cv-map').parentElement), my = ++ver;
    gm = createCanvasMap(q('#cv-map'), raw, { fontSize: labelSize(q("#cv-map").clientWidth || 400),
      onHover: (h, cx, cy) => {
        if (!h || h.kind !== 'state') return tip(null);
        const k = lv === 'region' ? h.region : h.key, s = areaStat(src.analysis, yr, lv, k);
        if (!s || (lv === 'region' && h.region === 'BAJA')) return tip(`<b>${esc(lv === 'region' ? regName(h.region) : stName(h.key))}</b><span class="hv-row"><em>no data</em></span>`, cx, cy);
        const L = res && res.mode && res[lv] && res[lv][k] ? res[lv][k].lcoe : null, p = px(s, 'p_cap', rl);
        return tip(`<b>${esc(lv === 'region' ? regName(k) : stName(k))}</b><span class="hv-row"><em>Captured price</em><strong>${f0(p)}</strong></span>${L == null ? '' : `<span class="hv-row"><em>LCOE</em><strong>${f0(L)}</strong></span><span class="hv-row"><em>Margin</em><strong>${signed(p - L, 0)}</strong></span>`}`, cx, cy);
      },
      onClick: (h) => { if (h.kind !== 'state') return; const t = lv === 'state' ? { kind: 'state', id: h.key } : h.region !== 'BAJA' ? { kind: 'region', id: h.region } : null; if (t && areaStat(src.analysis, yr, t.kind, t.id)) shell.store.set([t, ...shell.store.get().slice(1).filter((x) => !(x.kind === t.kind && x.id === t.id))]); } });
    gm.setFill({ level: lv, color: (k) => { const o = cover(lv, k); return o === null ? null : o ? '#EDE6D0' : '#658169'; },
      label: (k) => { const s = areaStat(src.analysis, yr, 'region', k), L = res && res.region && res.region[k]; return s && L && lv === 'region' ? signed(px(s, 'p_cap', rl) - L.lcoe, 0) : ''; }, name: (k) => RN[k] });
    gm.setSelected({ region: lv === 'region' && pl.kind === 'region' ? pl.id : lv === 'region' && sel.region ? sel.region : null, state: lv === 'state' && (pl.kind === 'state' || pl.kind === 'node') ? sel.state : null });
    void my;
    // bars sorted by captured price, the selected one outlined
    const keys = (lv === 'region' ? REGIONS.slice() : Object.keys(src.analysis.ventanas[WIN[yr].key].por_config.tracker.estados)).filter((k) => areaStat(src.analysis, yr, lv, k));
    keys.sort((a, b) => px(areaStat(src.analysis, yr, lv, b), 'p_cap', rl) - px(areaStat(src.analysis, yr, lv, a), 'p_cap', rl));
    const selKey2 = pl.kind === lv ? pl.id : lv === 'region' ? sel.region : sel.state;
    const bars = keys.map((k) => { const s = areaStat(src.analysis, yr, lv, k), v = px(s, 'p_cap', rl), L = res && res.mode && res[lv] && res[lv][k] ? res[lv][k].lcoe : null;
      return { v, label: lv === 'region' ? RN[k] : stAbbr(k), color: L != null && v >= L ? '#EDE6D0' : 'var(--c-energy)', stroke: k === selKey2 ? 'var(--accent)' : null,
        tip: `${lv === 'region' ? regName(k) : stName(k)}: ${f0(v)} MXN/MWh${L != null ? `, LCOE ${f0(L)}` : ''}` }; });
    const el = q('#cv-bars'), w = chartWidth(el), every = Math.max(1, Math.ceil((bars.length * (lv === 'region' ? 70 : 30)) / Math.max(120, w - 64)));
    const top = Math.max(...bars.map((b) => b.v), res && res.mode === 'target' ? res.threshold : 0);
    renderChart(el, () => barChart({ bars, H: 320, scale: niceTicks(0, niceMax(top)), fmt: (v) => f0(v), xEvery: every, hline: res && res.mode === 'target' ? { v: res.threshold, label: `LCOE ${f0(res.threshold)} MXN/MWh` } : null,
      aria: 'Captured solar price by region or state, sorted, with the selected area outlined', ytitle: `Captured price, MXN/MWh · ${rl ? "today's pesos" : 'nominal'}`, xtitle: `${lv === 'region' ? 'Control region' : 'State'} (sorted by captured price)` }));
  }
  q('#cv-where').textContent = `${placeName(shell, first)} · ${WIN[ui.yr].label}. Place and window are the page's own.`;
  const drawSegs = () => segment(q('#cv-lv'), [['region', 'Regions'], ['state', 'States']], ui.lv, (k) => { ui.lv = k; drawSegs(); paint(); });
  drawSegs();
  off = subscribe(() => { if (!card.isConnected) { off(); return; } paint(); });
  Promise.all([loadFin(), loadGeoRaw()]).then(([s, g]) => { if (card.isConnected) { src = s; raw = g; paint(); } }).catch(() => { q('#cv-text').innerHTML = '<li>The coverage view could not be loaded.</li>'; });
}
