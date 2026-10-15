// Score view copy: intro and method sections. Numbers come from the loaded file so text and data stay in sync. DRAFT copy.
export const f = (x, d = 0) => (x == null || Number.isNaN(Number(x)) ? 'n/a' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d }));

export const INTRO = {
  solar: { title: 'Solar Plant', text: 'ranks places where a utility-scale PV plant looks most promising. It combines the available flat, unprotected land around each node (15 km circle), the solar resource, the day-ahead price a solar profile captures, congestion at the node and distance to the grid.' },
  bat: { title: 'Battery', text: 'ranks nodes where a stand-alone battery buying cheap hours and selling expensive ones in the day-ahead market looks most attractive, using a trading rule tested out of sample on 2025 prices, plus spread, predictability, negative prices, congestion volatility and grid distance.' },
};
export const INTRO_BOTH = 'Both are relative screening scores for deciding where to look first, not site approvals, revenue forecasts or financial verdicts. Weights are provisional.';

export function methodSolar(M) {
  const c = M.config, s = c.scales, w = c.weights;
  return `<h2>How the score is built</h2>
<p>For each PML node we study the land inside a <b>${c.buffer_km} km circle</b> around its location, add its solar resource and market behaviour, and turn six components into a 0 to 100 score. It ranks places to look at first. It is <b>not</b> a site approval or a financial verdict, and the weights are provisional.</p>
<h2>1 · Land screen: what is removed</h2>
<table><tr><th>Slope</th><td>Cells steeper than ${c.slope_max_pct} %. INEGI relief model 2025 (about 81 m cells, corrected for latitude). Sea ignored.</td></tr>
<tr><th>Land cover</th><td>Forest and jungle (primary and secondary), settlements, water, aquaculture, mangrove, wetland, riparian, irrigated and humidity agriculture, palm groves. Allowed: grassland, scrub, desert, rainfed agriculture. INEGI Serie VII, 1:250,000.</td></tr>
<tr><th>Protected areas</th><td>Federal natural protected areas (CONANP, 2026-09-24). State, municipal, RAMSAR and Indigenous lands are not included.</td></tr>
<tr><th>Patch</th><td>Remaining cells are joined into contiguous patches; the largest is kept. Under ${c.min_patch_ha} ha the node receives no score.</td></tr></table>
<h2>2 · Six components, each scaled 0 to 1</h2>
<table>
<tr><th>Land · ${f(w.land * 100)}</th><td>Largest patch, log scale: ${f(s.land_ha[0])} ha = 0, ${f(s.land_ha[1])} ha = 1.</td></tr>
<tr><th>Solar resource · ${f(w.resource * 100)}</th><td>Yearly yield of a fixed-tilt plant (kWh/kWp·yr, NASA POWER via pvlib): ${f(s.resource_kwh_kwp[0])} = 0, ${f(s.resource_kwh_kwp[1])} = 1.</td></tr>
<tr><th>Market · ${f(w.market * 100)}</th><td>Real MDA reference price (CENACE) captured by a solar profile at that node, ${f(M.price_scale[0])} MXN/MWh = 0 (10th percentile) to ${f(M.price_scale[1])} = 1 (90th). Reference only, not full revenue.</td></tr>
<tr><th>Congestion · ${f(w.congestion * 100)}</th><td>Congestion component of the price, weighted by solar output, ${c.congestion_years[0]} to ${c.congestion_years[1]}. Negative means congestion lowers the price a plant would get: ${f(M.cong_scale[0])} MXN/MWh = 0, ${f(M.cong_scale[1])} = 1 (10th to 90th percentile).</td></tr>
<tr><th>Terrain · ${f(w.terrain * 100)}</th><td>Share of valid land with slope up to 3 %: ${s.flat_pct[0]} % = 0, ${s.flat_pct[1]} % = 1.</td></tr>
<tr><th>Grid · ${f(w.grid * 100)}</th><td>Distance to the nearest 115 to 400 kV line or substation up to 161 kV (OpenStreetMap): up to ${s.grid_km[0]} km = 1, ${s.grid_km[1]} km or more = 0. Says nothing about spare capacity.</td></tr></table>
<h2>3 · Combination</h2>
<p><b>Strict</b> (default): a weighted geometric mean. A node that is poor in one component cannot be rescued by the others, so scores spread out and few nodes reach the top. <b>Balanced</b>: plain weighted average. Weights are normalised to sum to 100 and every slider recalculates the map, ranking and panels live.</p>
<h2>Limits</h2><ul>
<li>Node location is the <b>municipality centroid</b>; the real substation can be tens of km away. Congestion belongs to the node itself, but the land does not.</li>
<li>Land cover is 1:250,000 and slope 81 m: a regional screen, not a site survey. No land ownership, price, water, soil, or interconnection capacity.</li>
<li>Price and congestion scales are relative to this node set; a high score means "good compared with other nodes".</li>
<li>OpenStreetMap grid completeness is unaudited. Data: © OpenStreetMap contributors (ODbL), INEGI, CONANP, CENACE, NASA POWER. Generated ${M.generated}.</li></ul>`;
}

export function methodBat(B) {
  const c = B.config, w = c.weights, s = c.scales, k = c.cost, sc = B.scales;
  return `<h2>How the Battery Score is built</h2>
<p>A screening of how attractive each PML node looks for a stand-alone battery that buys cheap hours and sells expensive ones in the <b>day-ahead market (MDA)</b>. It ranks nodes against each other. It is <b>not</b> a revenue forecast: capacity payments, ancillary services and real-time imbalance are not included.</p>
<h2>1 · Realistic trading rule, tested out of sample</h2>
<p>For every month we learn which hours of the day were cheapest and most expensive in ${c.train_years[0]} to ${c.train_years[1]}, then trade exactly those hours on the real prices of ${c.test_year}. No look-ahead. Round-trip efficiency ${f(c.rte * 100)} %. The perfect-foresight spread (best against worst hour of each day, what is often quoted) is shown only as an upper bound.</p>
<h2>2 · Six components, each scaled 0 to 1</h2><table>
<tr><th>Value · ${f(w.value * 100)}</th><td>Rule-based 4-hour value, MXN per kW-year. ${f(sc.value[0])} = 0, ${f(sc.value[1])} = 1 (10th to 90th percentile).</td></tr>
<tr><th>Spread · ${f(w.spread * 100)}</th><td>Median daily max minus min price, MXN/MWh. ${f(sc.spread[0])} = 0, ${f(sc.spread[1])} = 1.</td></tr>
<tr><th>Predictability · ${f(w.predictability * 100)}</th><td>Share of the hindsight value that the rule captures: ${s.capture[0] * 100} % = 0, ${s.capture[1] * 100} % = 1. Stable daily shapes are easier to trade.</td></tr>
<tr><th>Negative prices · ${f(w.negative * 100)}</th><td>Share of hours at or below zero (free charging). ${f(sc.negative[0], 2)} % = 0, ${f(sc.negative[1], 2)} % = 1.</td></tr>
<tr><th>Congestion volatility · ${f(w.congvol * 100)}</th><td>Standard deviation of the congestion component: ${f(sc.congvol[0])} = 0, ${f(sc.congvol[1])} = 1 MXN/MWh. A battery earns where congestion moves.</td></tr>
<tr><th>Grid · ${f(w.grid * 100)}</th><td>Distance to the nearest 115 to 400 kV line or substation up to 161 kV: up to ${s.grid_km[0]} km = 1, ${s.grid_km[1]} km or more = 0.</td></tr></table>
<h2>3 · Combination and saturation rule</h2>
<p>Same strict (weighted geometric mean) or balanced (average) options as the solar score. Only ${B.verified_subs} nodes could be checked against substation saturation (name, voltage and CFE zone matched) and ${B.saturated} are saturated. Those lose ${c.saturation_penalty_pts[0]} to ${c.saturation_penalty_pts[1]} points; nodes without data are <b>not</b> rewarded or penalised.</p>
<h2>4 · Illustrative economics (MXN, editable)</h2><table>
<tr><th>Capex</th><td>${f(k.power_mxn_per_kw)} MXN/kW for power equipment plus ${f(k.energy_mxn_per_kwh)} MXN/kWh for the cells: a 4-hour system is ${f(k.power_mxn_per_kw + 4 * k.energy_mxn_per_kwh)} MXN/kW (about USD 1,000 to 1,100/kW at 18 to 19 MXN/USD).</td></tr>
<tr><th>Annual cost</th><td>Capex spread over ${k.life_years} years at ${f(k.discount_rate * 100)} % plus ${k.om_pct_capex_yr} % O&amp;M. "Revenue ÷ annual cost" below 1 means the day-ahead arbitrage alone does not pay for the battery.</td></tr></table>
<h2>Limits</h2><ul>
<li>Costs are illustrative placeholders, not a quote. Rates and costs live in <code>config/battery_score.json</code>.</li>
<li>Prices are the node's own; a battery changes the prices it trades against, which this screen ignores.</li>
<li>Peninsular 34.5 kV nodes show structurally high congestion (flagged). The values are real market outputs but may reflect isolated or constrained pockets that a project could not exploit at scale.</li>
<li>Location is the municipality centroid. Data: CENACE MDA, CENACE node catalogue, Batu Energy open substations. Generated ${B.generated}.</li></ul>`;
}
