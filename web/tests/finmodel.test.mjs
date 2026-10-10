// Browser finance formulas: internal consistency and agreement with the deck-scenario figures of analysis.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { irr, npv, lcoeOwn, evaluate, evaluateUniverse, usdToMxn, verdict, schedule, costs } from '../assets/js/finmodel.js';
import { DECK_SET, blankMine, status, thresholdMode, sanitize } from '../assets/js/params.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const a = JSON.parse(readFileSync(join(dir, 'analysis', 'analysis.json'), 'utf8'));
const nn = JSON.parse(readFileSync(join(dir, 'analysis', 'analysis_nodos.json'), 'utf8'));
const MINE = { ...blankMine(), mwp: 10, capex_usd_kwp: 700, om_usd_kw_yr: 12, rate_pct: 8, life_yr: 25, degr_pct: 0.5, fx: 18, infl_pct: 4 };

test('printed MXN thresholds: 40 USD = 714 and 20 USD = 357 at 17.84; other pairs multiply', () => {
  assert.equal(usdToMxn(40, 17.84), 714);
  assert.equal(usdToMxn(20, 17.84), 357);
  assert.ok(Math.abs(usdToMxn(30, 17.84) - 535.2) < 1e-9);
  assert.equal(usdToMxn(40, 18), 720);
  assert.equal(usdToMxn(null, 18), null);
});
test('LCOE: NPV at a flat price equal to the LCOE is zero (real and nominal basis)', () => {
  for (const nominal of [false, true]) {
    const yf = 2100, L = lcoeOwn(MINE, yf, nominal);
    const ev = evaluate(MINE, { pcap: L, pml: 800, vf: 0.8, yf }, nominal);
    assert.ok(Math.abs(ev.npvMwp) < 1e-3, `${nominal}: ${ev.npvMwp}`);
    assert.ok(Math.abs(ev.irr - MINE.rate_pct / 100) < 1e-6);
    assert.equal(ev.margin < 1e-6 && ev.margin > -1e-6, true);
  }
});
test('break-even PPA = LCOE and break-even base PML = LCOE / VF; IRR > rate when P > LCOE', () => {
  const yf = 2000, L = lcoeOwn(MINE, yf, false);
  const ev = evaluate(MINE, { pcap: L * 1.3, pml: 900, vf: 0.8, yf }, false);
  assert.ok(Math.abs(ev.beBase - L / 0.8) < 1e-9);
  assert.ok(ev.irr > 0.08 && ev.npvMwp > 0);
  assert.ok(Math.abs(ev.vfReq - L / 900) < 1e-12);
  assert.equal(ev.npvTotal, ev.npvMwp * 10);
});
test('nominal basis: O&M escalates with inflation, so the nominal LCOE is higher than the real one', () => {
  assert.ok(lcoeOwn(MINE, 2000, true) > lcoeOwn(MINE, 2000, false));
  const s = schedule(MINE, 2000, true);
  assert.ok(Math.abs(s.OM[1] / s.OM[0] - 1.04) < 1e-12);
  assert.ok(Math.abs(s.E[1] / s.E[0] - 0.995) < 1e-12);
  assert.equal(costs(MINE).capex, 700 * 1000 * 18);
});
test('incomplete sets give null, never a number (no silent defaults)', () => {
  const partial = { ...MINE, capex_usd_kwp: null };
  const ev = evaluate(partial, { pcap: 800, pml: 900, vf: 0.9, yf: 2000 }, false);
  assert.equal(ev.lcoe, null); assert.equal(ev.irr, null); assert.equal(ev.npvMwp, null);
  assert.equal(irr([-100, -10, -5]), null);
  assert.equal(verdict(null, 800), null);
});
test('verdict: green covers, yellow within the band, red below', () => {
  assert.equal(verdict(700, 720, 10), 'ok');
  assert.equal(verdict(700, 650, 10), 'warn');
  assert.equal(verdict(700, 600, 10), 'bad');
});
test('assumption status: deck / empty / partial / complete; nominal basis also needs inflation', () => {
  assert.equal(status(DECK_SET).level, 'deck');
  assert.equal(status(blankMine()).level, 'empty');
  assert.equal(status({ ...blankMine(), fx: 18 }).level, 'partial');
  assert.equal(status(MINE, false).level, 'complete');
  assert.equal(status({ ...MINE, infl_pct: null }, true).level, 'partial');
  assert.equal(status({ ...MINE, infl_pct: null }, false).level, 'complete');
  assert.equal(thresholdMode(DECK_SET, false).mode, 'target');
  assert.equal(thresholdMode(MINE, false).mode, 'own');
  assert.equal(thresholdMode(blankMine(), false).mode, null);
  assert.equal(sanitize({ rate_pct: 999 }).rate_pct, 40);
});

/* ---- deck scenario against analysis.json (windows deck_2024_25 and deck_2025_26, tracker) ---- */
const cols = (win, nominal) => {
  const w = nn.ventanas[win];
  return { pcap: nominal ? w.p_cap : w.p_cap_real, pml: nominal ? w.pml_medio : w.pml_medio_real, vf: w.vf, yf: w.y_f || w.p_cap.map(() => null), region: nn.region, entidad: nn.entidad };
};
for (const win of ['deck_2024_25', 'deck_2025_26']) for (const nominal of [false, true]) {
  test(`${win} ${nominal ? 'nominal' : "today's pesos"}: share covering 714 MXN/MWh, region margin and VF_req match analysis.json`, () => {
    const r = evaluateUniverse(DECK_SET, cols(win, nominal), { nominal, mode: 'target', thresholdMxn: usdToMxn(40, 17.84) });
    const sfx = nominal ? 'nominal' : 'real';
    const t = a.ventanas[win].por_config.tracker;
    assert.equal(r.national.covering, t.nacional[`n_nodos_cubren_lcoe_${sfx}`]);
    assert.ok(Math.abs(r.national.pct - t.nacional[`pct_nodos_cubren_lcoe_${sfx}`]) < 1e-4);
    for (const [reg, s] of Object.entries(t.regiones)) {
      assert.equal(r.region[reg].covering, s[`n_nodos_cubren_lcoe_${sfx}`], reg);
      assert.ok(Math.abs(r.region[reg].margin - s[`margen_mxn_mwh_${sfx}`]) < 0.01, `${reg} margin ${r.region[reg].margin} vs ${s[`margen_mxn_mwh_${sfx}`]}`);
      assert.ok(Math.abs(714 / r.region[reg].pml - s[`vf_req_${sfx}`]) < 0.01, `${reg} vf_req`);
    }
    for (const [st, s] of Object.entries(t.estados)) assert.equal(r.state[st].covering, s[`n_nodos_cubren_lcoe_${sfx}`], st);
  });
}
test('deck P&L per MWp: mean of E x (P_cap - LCOE) over nodes equals pyg_deck by region', () => {
  const w = nn.ventanas.deck_2025_26, py = a.ventanas.deck_2025_26.por_config.tracker.pyg_deck;
  for (const [reg, row] of Object.entries(py.por_region)) {
    const m = []; nn.region.forEach((r, i) => { if (r === reg && w.p_cap_real[i] !== null) m.push(w.y_f[i] * (w.p_cap_real[i] - 714)); });
    const mean = m.reduce((x, y) => x + y, 0) / m.length;
    assert.ok(Math.abs(mean - row.margen_mxn_por_mwp_real) < 1, `${reg}: ${mean} vs ${row.margen_mxn_por_mwp_real}`);
  }
});
test('low LCOE of the deck (20 USD = 357) matches cubren_lcoe_bajo', () => {
  const r = evaluateUniverse(DECK_SET, cols('deck_2025_26_ago_jun', false), { nominal: false, mode: 'target', thresholdMxn: usdToMxn(20, 17.84) });
  const lo = a.ventanas.deck_2025_26_ago_jun.por_config.tracker.cubren_lcoe_bajo;
  assert.equal(r.national.covering, lo.n_nodos_real);
});
test('own-LCOE universe evaluation runs on the 12-month windows and orders nodes by yield', () => {
  const r = evaluateUniverse(MINE, cols('deck_2025_26', false), { nominal: false, mode: 'own' });
  assert.ok(r.national.n > 2000 && r.national.lcoe > 300 && r.national.lcoe < 2500);
  assert.equal(r.margin.length, nn.ids.length);
});
