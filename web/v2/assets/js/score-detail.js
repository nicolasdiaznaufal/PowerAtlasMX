// Score view: HTML of the detail card (node or area). Pure string builders, every dynamic string escaped.
import { f } from './score-copy.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (s) => String(s || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
const mxn = (x) => (x == null ? 'n/a' : `MXN ${f(x)}`);
const rows = (r) => `<table>${r.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;

export function barsHTML(model, n, W) {
  const cp = model.comp(n);
  if (!cp) return '';
  const tw = model.keys.reduce((a, k) => a + Math.max(0, W[k] || 0), 0) || 1, pen = model.pen(n);
  return `<div class="sc-bars">${model.keys.map((k) => `<div class="bar"><div class="t"><span>${esc(model.names[k])}</span><i>${f(cp[k] * 100)} · weight ${f((Math.max(0, W[k] || 0) / tw) * 100)}</i></div><div class="b"><div style="width:${Math.max(0, Math.min(1, cp[k])) * 100}%"></div></div></div>`).join('')}</div>`
    + (pen ? `<p class="flag">Grid saturation penalty: minus ${f(pen, 1)} points (verified substation)</p>` : '');
}

function flagsHTML(model, n) {
  const fl = model.flags(n);
  if (model.id === 'solar') return fl.length ? `<p class="flag">Not scored: ${esc(fl.join(', '))}</p>` : '';
  return fl.map((x) => `<p class="flag">${esc(x)}</p>`).join('');
}

function rawBat(n) {
  const b = n.bat;
  if (!b) return '<p class="sub">No hourly price history for this node.</p>';
  const e2 = b.econ_2h, e4 = b.econ_4h;
  return `<h3 class="mono">Prices · 2023 to 2025 day-ahead (MDA)</h3>${rows([
    ['Median daily spread (max minus min)', `${f(b.spread_med)} MXN/MWh`],
    ['Daily spread, 90th percentile', `${f(b.spread_p90)} MXN/MWh`],
    ['Congestion: mean · volatility', `${f(b.cong_mean)} · ${f(b.cong_std)} MXN/MWh`],
    ['Hours at or below 0', `${f(b.neg_pct, 2)} %`],
    ['Share captured vs hindsight (4 h)', `${f(b.capture_4h * 100)} %`]])}
  <h3 class="mono">Rule-based value 2025 · per kW-year</h3>${rows([
    ['2-hour battery', mxn(b.rule_2h)], ['4-hour battery', mxn(b.rule_4h)],
    ['4 h with perfect foresight (upper bound)', mxn(b.pf_4h)]])}
  <h3 class="mono">Illustrative economics · editable in config</h3>${rows([
    ['4 h capex', `${mxn(e4.capex_mxn_kw)}/kW`], ['4 h annual cost (capital + O&amp;M)', `${mxn(e4.annual_cost_mxn_kw)}/kW-yr`],
    ['4 h revenue ÷ annual cost', `${Number(e4.coverage).toFixed(2)}×`],
    ['4 h simple payback', e4.payback_yr == null ? 'none' : `${f(e4.payback_yr, 0)} yr`],
    ['2 h revenue ÷ annual cost', `${Number(e2.coverage).toFixed(2)}×`]])}
  ${b.sat ? `<h3 class="mono">Substation (verified)</h3>${rows([['Capacity · connected generation', `${f(b.sat.mva)} MVA · ${f(b.sat.gen_mw)} MW`], ['Saturation', f(b.sat.sat, 2)]])}`
    : '<p class="sub">Grid saturation: not available for this node.</p>'}`;
}

function rawSolar(n) {
  return `<h3 class="mono">Raw values · 15 km circle</h3>${rows([
    ['Largest viable patch', `${f(n.max_patch_ha)} ha`], ['Slope over 7 %', `${f(n.steep_pct, 1)} %`], ['Flat (up to 3 %) share', `${f(n.flat3_pct, 1)} %`],
    ['Land cover excluded', `${f(n.landcover_excl_pct, 1)} %`], ['Protected area (federal)', `${f(n.anp_excl_pct, 1)} %`],
    ['Nearest 115 to 400 kV line', `${f(n.dist_hv_line_km, 1)} km`], ['Nearest substation up to 161 kV', `${f(n.dist_substation_km, 1)} km`],
    ['Solar yield (fixed tilt)', `${f(n.yf_kwh_kwp)} kWh/kWp·yr`], ['Captured price (real, MDA reference)', `${f(n.price_mxn_mwh)} MXN/MWh`],
    ['Congestion, solar-weighted', `${f(n.cong_mxn_mwh, 1)} MXN/MWh`], ['Months of price data', f(n.meses)]])}`;
}

export function nodeHTML(model, n, s, W) {
  return `<p class="mono sc-k">${esc(n.id)}</p><h2 class="sc-name">${esc(n.nombre)}</h2>
    <p class="sub">${esc(title(n.municipio))}, ${esc(title(n.entidad))} · ${esc(title(n.region))}</p>
    <p class="big">${s == null ? '–' : s.toFixed(0)}<small> / 100 · ${esc(model.title)}</small></p>
    ${flagsHTML(model, n)}${barsHTML(model, n, W)}${model.id === 'bat' ? rawBat(n) : rawSolar(n)}
    <p class="sub sc-caveat">Location is the municipality centroid, not the substation.${model.id === 'bat' ? ' Day-ahead prices only: no capacity, ancillary or real-time income.' : ' MDA reference price (CENACE): no capacity, CEL or contracts.'}</p>`;
}

export function areaHTML(label, kind, sum) {
  const li = ([n, s]) => `<li><button type="button" class="sc-hit" data-id="${esc(n.id)}"><span>${esc(n.nombre)}<br><span class="sub">${esc(title(n.entidad))}</span></span><b>${s.toFixed(0)}</b></button></li>`;
  return `<p class="mono sc-k">${esc(kind)}</p><h2 class="sc-name">${esc(label)}</h2>
    <p class="sub">${sum.n} nodes · ${sum.scored} scored</p>
    <p class="big">${sum.median == null ? '–' : f(sum.median)}<small> median</small></p>
    ${rows([['Top 10 % of nodes score above', sum.p90 == null ? '–' : f(sum.p90)], ['Best node', sum.best ? `${esc(sum.best[0].nombre)} · ${f(sum.best[1])}` : '–']])}
    <h3 class="mono">Top 10 nodes</h3><ul class="sc-list">${sum.top.map(li).join('')}</ul>`;
}
