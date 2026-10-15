// Score view: HTML of the detail card (one place) and the compare card (two places). Pure string builders, every dynamic string escaped.
// item = { label, sub, kind, n (score-file node | null), s (score | null), sum (area summary | null), extra ([[label, value]] | null) }
// ctx  = { cost: {power, energy, om, life, disc}, rte }  (battery inputs, read by the economics rows)
import { f } from './score-copy.js';
import { valueAtRte, econ } from './score-core.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const title = (s) => String(s || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
const mxn = (x) => (x == null ? 'n/a' : `MXN ${f(x)}`);
const rowsHTML = (r) => `<table>${r.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
export const SHORT_DAYS = 500;

/** [label, value] rows of one node under the model (battery rows follow the user's efficiency and costs). */
export function rawRows(model, n, ctx) {
  if (model.id === 'solar') {
    return [['Largest viable patch', `${f(n.max_patch_ha)} ha`], ['Slope over 7 %', `${f(n.steep_pct, 1)} %`], ['Flat (up to 3 %) share', `${f(n.flat3_pct, 1)} %`],
      ['Land cover excluded', `${f(n.landcover_excl_pct, 1)} %`], ['Protected area (federal)', `${f(n.anp_excl_pct, 1)} %`],
      ['Nearest 115 to 400 kV line', `${f(n.dist_hv_line_km, 1)} km`], ['Nearest substation up to 161 kV', `${f(n.dist_substation_km, 1)} km`],
      ['Solar yield (fixed tilt)', `${f(n.yf_kwh_kwp)} kWh/kWp·yr`], ['Captured price (real, MDA reference)', `${f(n.price_mxn_mwh)} MXN/MWh`],
      ['Congestion, solar-weighted', `${f(n.cong_mxn_mwh, 1)} MXN/MWh`], ['Months of price data', f(n.meses)]];
  }
  const b = n.bat;
  if (!b) return [];
  const v2 = valueAtRte(b, 2, ctx.rte), v4 = valueAtRte(b, 4, ctx.rte), pf = valueAtRte(b, 4, ctx.rte, true);
  const e4 = econ(v4, 4, ctx.cost), e2 = econ(v2, 2, ctx.cost);
  const r = [['Median daily spread (max minus min)', `${f(b.spread_med)} MXN/MWh`], ['Daily spread, 90th percentile', `${f(b.spread_p90)} MXN/MWh`],
    ['Congestion: mean · volatility', `${f(b.cong_mean)} · ${f(b.cong_std)} MXN/MWh`], ['Hours at or below 0', `${f(b.neg_pct, 2)} %`],
    ['Share captured vs hindsight (4 h)', `${f(b.capture_4h * 100)} %`],
    ['Value 2025, 2-hour battery (per kW-year)', mxn(v2)], ['Value 2025, 4-hour battery (per kW-year)', mxn(v4)],
    ['4 h with perfect foresight (upper bound)', mxn(pf)],
    ['4 h capex', `${mxn(e4.capex)}/kW`], ['4 h annual cost (capital + O&amp;M)', `${mxn(e4.annual)}/kW-yr`],
    ['4 h revenue ÷ annual cost', e4.coverage == null ? 'n/a' : `${e4.coverage.toFixed(2)}×`],
    ['4 h simple payback', e4.payback == null ? 'none' : `${f(e4.payback, 0)} yr`],
    ['2 h revenue ÷ annual cost', e2.coverage == null ? 'n/a' : `${e2.coverage.toFixed(2)}×`]];
  r.push(b.sat ? ['Substation (verified): capacity · generation', `${f(b.sat.mva)} MVA · ${f(b.sat.gen_mw)} MW`] : ['Grid saturation', 'not available']);
  if (b.sat) r.push(['Saturation', f(b.sat.sat, 2)]);
  return r;
}

export function areaRows(sum, extra) {
  return [['Nodes scored', `${sum.scored} of ${sum.n}`], ['Top 10 % of nodes score above', sum.p90 == null ? '–' : f(sum.p90)],
    ['Best node', sum.best ? `${esc(sum.best[0].nombre)} · ${f(sum.best[1])}` : '–'], ...(extra || [])];
}

const itemRows = (model, it, ctx) => (it.sum ? areaRows(it.sum, it.extra) : it.n ? rawRows(model, it.n, ctx) : []);

/** notes that explain a missing or weak result for one node */
export function notesHTML(model, n) {
  if (model.id === 'solar') { const fl = model.flags(n); return fl.length && !model.comp(n) ? `<p class="flag">Not scored: ${esc(fl.join(', '))}</p>` : ''; }
  if (!n.bat) return '<p class="sc-nodata" role="note"><b>No battery score:</b> not enough 2023–2025 hourly prices for this node.</p>';
  const out = model.flags(n).map((x) => `<p class="flag">${esc(x)}</p>`);
  if (n.bat.days_train != null && n.bat.days_train < SHORT_DAYS) out.push(`<p class="flag">Short price history: trading rule trained on ${f(n.bat.days_train)} days.</p>`);
  return out.join('');
}

export function barsHTML(model, n, W, comp) {
  const cp = comp || model.comp(n);
  if (!cp) return '';
  const tw = model.keys.reduce((a, k) => a + Math.max(0, W[k] || 0), 0) || 1, pen = model.pen(n);
  return `<div class="sc-bars">${model.keys.map((k) => `<div class="bar"><div class="t"><span>${esc(model.names[k])}</span><i>${f(cp[k] * 100)} · weight ${f((Math.max(0, W[k] || 0) / tw) * 100)}</i></div><div class="b"><div style="width:${Math.max(0, Math.min(1, cp[k])) * 100}%"></div></div></div>`).join('')}</div>`
    + (pen ? `<p class="flag">Grid saturation penalty: minus ${f(pen, 1)} points (verified substation)</p>` : '');
}

const CAVEAT = (model) => `<p class="sub sc-caveat">Location is the municipality centroid, not the substation.${model.id === 'bat' ? ' Day-ahead prices only: no capacity, ancillary or real-time income.' : ' MDA reference price (CENACE): no capacity, CEL or contracts.'}</p>`;

export function nodeHTML(model, n, s, W, ctx) {
  const noBat = model.id === 'bat' && !n.bat;
  return `<p class="mono sc-k">${esc(n.id)}</p><h2 class="sc-name">${esc(n.nombre)}</h2>
    <p class="sub">${esc(title(n.municipio))}, ${esc(title(n.entidad))} · ${esc(title(n.region))}</p>
    ${noBat ? '' : `<p class="big">${s == null ? '–' : s.toFixed(0)}<small> / 100 · ${esc(model.title)}</small></p>`}
    ${notesHTML(model, n)}${noBat ? '' : barsHTML(model, n, W)}
    ${noBat ? '' : `<h3 class="mono">${model.id === 'bat' ? 'Prices, value and economics' : 'Raw values · 15 km circle'}</h3>${rowsHTML(rawRows(model, n, ctx))}`}
    ${CAVEAT(model)}`;
}

export function areaHTML(label, kind, sum, extra) {
  const li = ([n, s]) => `<li><button type="button" class="sc-hit" data-id="${esc(n.id)}"><span>${esc(n.nombre)}<br><span class="sub">${esc(title(n.entidad))}</span></span><b>${s.toFixed(0)}</b></button></li>`;
  return `<p class="mono sc-k">${esc(kind)}</p><h2 class="sc-name">${esc(label)}</h2>
    <p class="sub">${sum.n} nodes · ${sum.scored} scored</p>
    <p class="big">${sum.median == null ? '–' : f(sum.median)}<small> median</small></p>
    ${rowsHTML(areaRows(sum, extra))}
    <h3 class="mono">Top 10 nodes</h3><ul class="sc-list">${sum.top.map(li).join('')}</ul>`;
}

/** side-by-side card for two places (node, state or region, any mix) */
export function compareHTML(model, items, W, ctx) {
  const head = items.map((it, i) => `<th scope="col"><span class="sc-dot sc-d${i + 1}" aria-hidden="true">${i + 1}</span><span class="sc-cn">${esc(it.label)}</span><span class="sub">${esc(it.kind)}</span></th>`).join('');
  const big = items.map((it) => {
    if (it.sum) return `<td><span class="big">${it.sum.median == null ? '–' : f(it.sum.median)}</span><span class="sub"> median</span></td>`;
    if (model.id === 'bat' && it.n && !it.n.bat) return '<td><span class="sc-nodata-s">No battery score</span></td>';
    return `<td><span class="big">${it.s == null ? '–' : it.s.toFixed(0)}</span><span class="sub"> / 100</span></td>`;
  }).join('');
  const comp = items.map((it) => (it.n ? model.comp(it.n) : null));
  const bars = comp.some(Boolean) ? model.keys.map((k) => `<tr><th scope="row">${esc(model.names[k])}</th>${comp.map((c, i) => `<td>${c ? `<span class="sc-v">${f(c[k] * 100)}</span><span class="sc-bar"><span class="sc-b${i + 1}" style="width:${Math.max(0, Math.min(1, c[k])) * 100}%"></span></span>` : '–'}</td>`).join('')}</tr>`).join('') : '';
  const rows = items.map((it) => itemRows(model, it, ctx));
  const labels = [];
  rows.forEach((r) => r.forEach(([l]) => { if (!labels.includes(l)) labels.push(l); }));
  const body = labels.map((l) => `<tr><th scope="row">${l}</th>${rows.map((r) => { const x = r.find((y) => y[0] === l); return `<td>${x ? x[1] : '–'}</td>`; }).join('')}</tr>`).join('');
  const notes = items.map((it, i) => (it.n ? notesHTML(model, it.n).replace(/<p class="(flag|sc-nodata)"( role="note")?>/g, `<p class="$1"$2><b>${i + 1}.</b> `) : '')).join('');
  return `<p class="mono sc-k">Compare</p>
    <table class="sc-cmp"><thead><tr><td></td>${head}</tr></thead><tbody><tr><th scope="row">Score</th>${big}</tr>${bars}${body}</tbody></table>
    ${notes}${CAVEAT(model)}`;
}
