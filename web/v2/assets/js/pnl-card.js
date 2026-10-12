// Revenue: one plant at one place, one year (v1 Node P&L). Same inputs and arithmetic as v1; two bars: real revenue and levelized cost.
import { evaluate, usdToMxn, DECK_FX } from '../../../assets/js/finmodel.js';
import { WIN } from '../../../assets/js/names.js';
import { num, signed } from '../../../assets/js/format.js';
import { loadFin, placeInputs } from './fin-data.js';
import { activeSet, statusOf, subscribe, assumpBarHTML } from './assump.js';
import { verdictPillHTML } from './verdict.js';
import { hbarChart } from './hbar-chart.js';
import { esc } from './compare-ui.js';

const placeKey = (p) => (p ? `${p.kind}:${p.id}` : '');

const f0 = (v) => num(v, 0), f1 = (v) => num(v, 1), f2 = (v) => num(v, 2);
const SL = [['p', 'Average price (PML), MXN/MWh', 100, 2000, 5], ['v', 'Value factor VF', 0.3, 1.1, 0.01], ['l', 'Losses not in the model, %', 0, 25, 0.5],
  ['s', 'Plant size, MWp', 1, 300, 1], ['c', 'LCOE, USD/MWh', 15, 70, 1]];
const short = (p) => (p.kind === 'node' ? p.id : p.kind === 'national' ? 'National' : p.id.charAt(0) + p.id.slice(1).toLowerCase());

export function pnlCardHTML() {
  return `<section class="xp-card pnl" id="pl-card" aria-labelledby="pl-h"><h2 class="mono" id="pl-h">Plant economics: one plant, one place, one year</h2>
    <p class="xp-text" id="pl-where"></p>
    <div class="assump-bar" id="pl-bar"></div><div id="pl-verdict"></div>
    <div class="ctrls3">${SL.map(([k, l, mn, mx, st]) => `<label class="pl-ctl" for="pl-${k}"><span>${l}</span><output id="pl-${k}o" class="mono"></output><input type="range" id="pl-${k}" min="${mn}" max="${mx}" step="${st}"></label>`).join('')}
      <div class="pl-ctl"><span>LCOE, MXN/MWh</span><output id="pl-cm" class="mono"></output></div></div>
    <div class="kpis" id="pl-kpi"></div>
    <div class="chart" id="pl-chart"></div><p class="xp-text" id="pl-fine"></p><p class="xp-text" id="pl-msg" role="status"></p></section>`;
}

export function mountPnl(root, { shell, winId }) {
  const card = root.querySelector('#pl-card');
  if (!card) return;
  const q = (s) => card.querySelector(s), ui = ((shell.revUi = shell.revUi || {}).pnl = shell.revUi.pnl || { ovr: {}, key: '' });
  // the place and the window are the page's own: the first selected place and the main time window
  const first = shell.store.get()[0];
  if (!first) return;
  ui.place = { kind: first.kind, id: first.id }; ui.yr = winId;
  let src = null, place = null, off = null;
  const real = () => shell.store.real;
  const paintBar = () => { q('#pl-bar').innerHTML = assumpBarHTML(real()); };

  function load() {
    const k = `${placeKey(ui.place)}|${ui.yr}|${real()}`;
    place = src ? placeInputs(src, ui.place.kind, ui.place.id, ui.yr, real()) : null;
    if (k !== ui.key) { ui.key = k; ui.ovr = {}; }
    q('#pl-msg').textContent = place ? '' : src ? `No complete data for this selection in ${WIN[ui.yr].label}.` : 'Loading…';
    if (place) upd(); else { q('#pl-kpi').innerHTML = ''; q('#pl-chart').innerHTML = ''; q('#pl-verdict').innerHTML = ''; }
  }
  function upd() {
    if (!place) return;
    const set = activeSet(), st = statusOf(real()), fx = set.fx ?? DECK_FX, o = ui.ovr, ev0 = evaluate(set, place, !real());
    const val = { p: o.p ?? Math.round(place.pml / 5) * 5, v: o.v ?? +place.vf.toFixed(2), l: o.l ?? 0,
      s: o.s ?? (set.mwp != null ? Math.min(300, Math.max(1, Math.round(set.mwp))) : 1),
      c: o.c ?? (ev0.lcoe != null ? Math.min(70, Math.max(15, Math.round(ev0.lcoe / fx))) : 40) };
    for (const [k] of SL) { const el = q(`#pl-${k}`); if (+el.value !== val[k]) el.value = val[k]; }
    const P = val.p, VF = val.v, Lp = val.l, S = val.s, L = val.c, Lm = usdToMxn(L, fx), Yf = place.yf * (1 - Lp / 100);
    q('#pl-po').textContent = f0(P); q('#pl-vo').textContent = f2(VF); q('#pl-lo').textContent = f1(Lp); q('#pl-so').textContent = f0(S); q('#pl-co').textContent = f0(L); q('#pl-cm').textContent = f0(Lm);
    const cap = VF * P, E = S * Yf, R = (E * cap) / 1e6, C = (E * Lm) / 1e6, Pi = R - C;
    q('#pl-kpi').innerHTML = [['Captured · MXN/MWh', f0(cap)], ['Yield used · kWh/kWp', f0(Yf)], ['Energy · GWh/yr', f1(E / 1000)], ['Revenue · M MXN/yr', f1(R)], ['Margin · M MXN/yr', signed(Pi, 1)]]
      .map(([l, v]) => `<div class="kpi"><span class="mono">${esc(l)}</span><strong>${v}</strong></div>`).join('');
    hbarChart(q('#pl-chart'), { bars: [{ label: 'Real revenue', v: +R.toFixed(2), color: 'var(--accent)' }, { label: 'Levelized cost', v: +C.toFixed(2), color: 'var(--s2)' }],
      xtitle: 'Million MXN per year', aria: 'Real revenue and levelized cost in million MXN per year', unit: 'M MXN/yr' });
    const ev = st.level === 'complete' ? evaluate(set, { pcap: cap, pml: P, vf: VF, yf: Yf }, !real()) : null;
    q('#pl-verdict').innerHTML = `<div class="row">${verdictPillHTML(st, set, ev && ev.lcoe != null ? ev.lcoe : Lm, cap)}<span class="muted">${esc(short(ui.place))} · ${esc(WIN[ui.yr].label)} · ${real() ? "today's pesos" : 'nominal'}</span></div>`;
    q('#pl-fine').textContent = `The LCOE slider starts at the active threshold; moving it is a what-if and does not change your assumptions. Merchant energy revenue only, on the MDA reference price (CENACE): no capacity, CEL or contracts.${'p' in o || 'v' in o ? ' Price or VF moved by hand: values no longer match the data of the selected place.' : ''}`;
  }

  q('#pl-where').textContent = `${shell.label(first).t} · ${WIN[ui.yr].label}. The place and window are the ones selected on this page.`;
  for (const [k] of SL) q(`#pl-${k}`).addEventListener('input', (e) => { ui.ovr[k] = +e.target.value; upd(); });
  paintBar();
  off = subscribe(() => { if (!card.isConnected) { off(); return; } paintBar(); load(); });
  loadFin().then((s) => { if (card.isConnected) { src = s; load(); } }).catch(() => { q('#pl-msg').textContent = 'The economics could not be loaded.'; });
}
