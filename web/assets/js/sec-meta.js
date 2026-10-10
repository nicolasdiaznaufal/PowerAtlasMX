// Assumptions panel + section, methods/appendix (A1-A5 plots and sketches), formulas used in the browser, sources.
import { D, loadGeo, areaStat, winCfg } from './data.js';
import { FIELDS, DECK_SET, status, blankMine } from './params.js';
import { DECK_FX } from './finmodel.js';
import { make, baseOptions, axisTitle, col, hourTicks } from './charts.js';
import { GeoMap, ll2xy, PX_LON, PX_LAT, LON0, LAT0 } from './geomap.js';
import { $, esc, seg, segHTML, sig, ext } from './util.js';
import { num, signed } from './format.js';
import { WIN, REGIONS, RN, regName } from './names.js';
import { renderMath } from './tex.js';

const f0 = (v) => num(v, 0), f1 = (v) => num(v, 1), f2 = (v) => num(v, 2), f3 = (v) => num(v, 3);
const pad = (h) => String(h).padStart(2, '0');

/* ---------- Assumptions drawer ---------- */
export function initAssumptions(ctx) {
  const panel = $('#assump-panel');
  function draw() {
    const A = ctx.A(), nominal = !ctx.S.get().real, st = ctx.status();
    const mine = A.active === 'mine';
    const miss = new Set(st.missing);
    panel.innerHTML = `
      ${segHTML('as-preset', 'Preset', [['deck', 'Deck scenario'], ['mine', 'My assumptions']], A.active)}
      <p class="callout info" style="margin-top:12px"><b>REPSA's own assumptions are pending</b> (<code>config/supuestos.yaml</code> is <code>PENDIENTE</code>). Nothing here is a validated REPSA value. A verdict appears only when you enter a complete set, and it is labelled <i>under your assumptions</i>.</p>
      <div style="margin:12px 0">${mine ? (st.level === 'complete' ? sig('ok', 'Complete: IRR, NPV, own LCOE and verdict are on') : st.level === 'empty' ? sig('neutral', 'Blank: type your values') : sig('warn', `Incomplete: ${st.missing.length} field${st.missing.length === 1 ? '' : 's'} missing`)) : sig('neutral', 'Deck scenario: coverage of the printed LCOE only, no verdict')}</div>
      ${mine ? '' : `<table><tbody>
        <tr><td>LCOE</td><td class="n">40 USD/MWh = 714 MXN/MWh</td></tr><tr><td>Exchange rate</td><td class="n">17.84 MXN/USD</td></tr>
        <tr><td>Mounting</td><td class="n">Single-axis tracker</td></tr><tr><td>Plant size</td><td class="n">1 MWp</td></tr>
        <tr><td>Capex, O&amp;M, discount rate, life</td><td class="n">not printed in the deck</td></tr></tbody></table>
        <p class="fine">These are the values the deck prints; the project does not endorse them. Switch to <b>My assumptions</b> to enter your own; IRR and NPV need capex, O&amp;M, rate and life, which the deck does not give.</p>`}
      ${mine ? `<div class="fields">${FIELDS.map((f) => {
        const need = f.required === true || (f.required === 'nominal' && nominal);
        const hide = f.id === 'infl_pct' && !nominal;
        if (hide) return '';
        const lbl = f.id === 'rate_pct' ? `${nominal ? 'Nominal' : 'Real'} discount rate` : f.label;
        return `<div class="field${need && miss.has(f.id) ? ' missing' : ''}"><label for="as-${f.id}">${esc(lbl)}${need ? '' : ' <span class="muted">(optional)</span>'}</label>
          <input type="number" id="as-${f.id}" data-f="${f.id}" inputmode="decimal" step="${f.step}" min="${f.min ?? ''}" ${f.max !== undefined ? `max="${f.max}"` : ''} value="${A.mine[f.id] ?? ''}" placeholder="${esc(f.unit)}">
          <small>${esc(f.unit)}</small></div>`; }).join('')}
        <div class="field"><label>Mounting</label>${segHTML('as-mount', 'Mounting', [['tracker', 'Tracker'], ['fixed', 'Fixed']], A.mine.mounting)}<small>Area tables and maps are tracker-only; the node sheet follows this choice.</small></div></div>
        <p class="fine">Price basis: <b>${nominal ? 'nominal' : "today's pesos"}</b>. ${nominal ? 'Enter a nominal rate and inflation; O&M escalates with inflation and the price is held flat in nominal pesos.' : 'Enter a real rate; prices, capex and O&M are constant pesos of the base month.'} Capex and O&M are per kWp and kW of the plant.</p>
        <button type="button" class="btn btn-ghost" id="as-clear">Clear my assumptions</button>` : ''}
      <p class="fine">Saved in this browser only (localStorage). Outputs in Profitability, Node P&amp;L, the map margin, Geography and the node sheet recompute live.</p>`;
    seg($('#as-preset'), (v) => ctx.setActive(v));
    panel.querySelectorAll('input[data-f]').forEach((i) => i.addEventListener('input', () => ctx.setField(i.dataset.f, i.value)));
    const m = $('#as-mount'); if (m) seg(m, (v) => ctx.setCfg(v));
    const cl = $('#as-clear'); if (cl) cl.addEventListener('click', () => ctx.clearMine());
  }
  ctx.onAssumpChange = draw;
  draw();
}

/* ---------- Assumptions section ---------- */
export function initAssumpSection(ctx) {
  const a = D.analysis, esc_ = a && a.escenario_deck;
  $('#assump-root').innerHTML = `
    <div class="grid g2">
      <div class="panel"><span class="lbl accent">How it works</span>
        <ul class="dash"><li>Open the <b>Assumptions</b> panel from the header, the side rail or any profitability block.</li>
        <li><b>Deck scenario</b>: only what the deck prints. Shows coverage of a 40 USD/MWh LCOE (714 MXN/MWh at 17.84).</li>
        <li><b>My assumptions</b>: blank until you type. With capex, O&amp;M, rate, life, degradation, exchange rate and plant size the page computes IRR, NPV, LCOE, break-even PPA (= LCOE), break-even base PML (= LCOE / VF), margin and a traffic light.</li>
        <li>The price basis (today's pesos or nominal) decides whether the rate is real or nominal; the two are never mixed.</li></ul>
        <div class="row"><button type="button" class="btn" data-open-assump>Open assumptions</button></div></div>
      <div class="panel"><span class="lbl accent">What the deck prints</span>
        ${esc_ ? `<ul class="dash">${esc_.citas.map((c) => `<li><span>${esc(c)}</span></li>`).join('')}</ul>
        <p class="fine">Not printed by the deck: capex, O&amp;M, discount rate, plant life. Without them the deck scenario cannot give IRR, NPV or an own LCOE.</p>` : '<p class="muted">analysis.json not loaded.</p>'}</div>
    </div>
    <div class="callout">${sig('warn', 'Not validated by REPSA')} <span>The traffic light, IRR and NPV exist only under values you type. They are screening aids on the MDA reference price, not an investment verdict.</span></div>`;
}

/* ---------- Methods and appendix ---------- */
const EQ = (lbl, tex, note = '') => `<div class="eq-card"><span class="lbl">${lbl}</span>\\[ ${tex} \\]${note ? `<p class="note">${note}</p>` : ''}</div>`;
const VARS = (items) => `<div class="grid g3 vars">${items.map(([s, t]) => `<p><b>\\(${s}\\)</b> ${t}</p>`).join('')}</div>`;

export async function initMethods(ctx) {
  const root = $('#methods-root');
  root.innerHTML = `
  <details open id="a1"><summary>A1 · pvlib and NASA POWER: where \\(y_h\\) comes from</summary><div class="in">
    <div class="grid g2" style="align-items:start">
      <div class="stack">
        <div class="row" style="gap:20px"><span class="paper" style="padding:10px 14px"><img src="assets/img/pvlib-logo.png" alt="pvlib" width="120" height="51" style="display:block;height:51px;width:auto"></span>
          <span class="paper" style="padding:12px 16px"><b style="font:800 22px var(--font-display);color:var(--dark)">NASA POWER</b><br><span class="lbl" style="margin:4px 0 0">Prediction Of Worldwide Energy Resources</span></span></div>
        <p>Open-source Python library for photovoltaic modelling, maintained by Sandia National Laboratories, NREL and contributors [1]. Its <code>ModelChain</code> runs the calculation from three inputs: <b>Location</b> (where), <b>PVSystem</b> (what is built: panels, tracker, inverter) and <b>Weather</b> (what happened). Documentation: ${ext('https://pvlib-python.readthedocs.io', 'pvlib-python.readthedocs.io')}.</p>
        <div class="lbl">The chain for every hour and every node</div>
        <ol class="chain" id="a1-chain">
          <li><b>1 · Weather</b>NASA POWER hourly GHI (W/m²) and air temperature \\(T_a\\) (°C), UTC</li>
          <li><b>2 · Sun position</b>zenith \\(\\theta_z\\) and azimuth \\(\\varphi_s\\) from date, time and location</li>
          <li><b>3 · Split the light</b>GHI into direct (DNI) and diffuse (DHI)</li>
          <li><b>4 · Tracker angle</b>single axis N–S, ±60°, backtracking to avoid shading</li>
          <li><b>5 · Light on the panel</b>\\(G_{\\mathrm{POA}}\\), W/m², eq. (1)–(3)</li>
          <li><b>6 · Heat and power</b>cell temperature, DC and AC power, eq. (4)–(6)</li>
          <li><b>7 · Energy per kWp</b>\\(y_h\\), kWh/kWp, eq. (7)</li>
          <li class="hl"><b>8 · Revenue</b>\\(y_h\\times\\mathrm{PML}_h\\), summed over the year</li>
        </ol>
        <p class="fine">NASA POWER data: hourly, UTC, 1° × 1° for solar parameters; ${ext('https://power.larc.nasa.gov', 'power.larc.nasa.gov')}. Missing values are never used as numbers. Hours are shifted to the CDMX clock and centred on each hour.</p>
      </div>
      <div class="stack"><div class="lbl">NASA POWER · 1° solar grid over Mexico</div>
        <div class="mini-host" id="a1-map" role="img" aria-label="Mexico with the NASA POWER one-degree solar grid and two example nodes" style="max-width:none"></div>
        <p class="fine">Each square is one NASA POWER solar cell, 1° × 1° (about 100 × 110 km); every node inside it receives the same weather series. Fine for screening; for ranking nodes inside a region use a finer source such as NSRDB (2–4 km); for financing, measured or bankable data. Cells are drawn centred on the whole degree this project requests.</p></div>
    </div></div></details>

  <details id="a2"><summary>A2 · Light on the panel: tilt and tracking</summary><div class="in">
    <p class="muted">Weather data give sunlight on flat ground. A panel converts only the light that hits its own surface, so we move the light onto the panel plane.</p>
    <div class="split">
      <div class="stack">
        ${EQ('(1) How head-on the sun hits the panel · pvlib.irradiance.aoi', '\\cos\\theta_i=\\cos\\theta_z\\cos\\beta+\\sin\\theta_z\\sin\\beta\\cos(\\varphi_s-\\varphi_p)', '<b>In words:</b> \\(\\theta_i\\) is the angle between the sun\'s rays and the line perpendicular to the panel. At \\(\\theta_i=0\\) the panel catches the full direct beam; at 60° only half (\\(\\cos 60^\\circ=0.5\\)). A tracker turns the panel every hour to keep \\(\\theta_i\\) small.')}
        ${EQ('(2) Sunlight on the panel, isotropic sky · pvlib.irradiance.get_total_irradiance', 'G_{\\mathrm{POA}}=\\underbrace{\\mathrm{DNI}\\cos\\theta_i}_{\\text{direct}}+\\underbrace{\\mathrm{DHI}\\,\\tfrac{1+\\cos\\beta}{2}}_{\\text{sky diffuse}}+\\underbrace{\\rho\\,\\mathrm{GHI}\\,\\tfrac{1-\\cos\\beta}{2}}_{\\text{ground reflected}}', '<b>In words:</b> three sources add up (sketch): the direct beam, scaled by eq. (1); light scattered by the sky, of which a tilted panel sees a fraction; and light reflected by the ground. For a tracker in Mexico, \\(G_{\\mathrm{POA}}\\) is about 20–30 % above GHI over a year.')}
        ${EQ('(3) Light that actually enters the cell · pvlib.iam', 'G_{\\mathrm{eff}}=\\bigl(\\mathrm{DNI}\\cos\\theta_i\\cdot\\mathrm{IAM}(\\theta_i)+G_{\\mathrm{diff}}\\bigr)(1-L_{\\mathrm{soil}})', '<b>In words:</b> glass reflects more light at grazing angles (IAM &lt; 1) and dust blocks a few percent.')}
        ${VARS([['\\theta_z', 'solar zenith angle (sun vs vertical)'], ['\\theta_i', 'angle of incidence (sun vs panel normal)'], ['\\beta,\\ \\varphi_p', 'panel tilt and the direction it faces'], ['\\varphi_s', 'solar azimuth'], ['\\mathrm{DNI}', 'direct normal irradiance, W/m²'], ['\\mathrm{DHI},\\ \\mathrm{GHI}', 'diffuse and global horizontal irradiance, W/m²'], ['\\rho', 'ground albedo, ≈ 0.2'], ['\\mathrm{IAM}', 'incidence-angle modifier, ≤ 1'], ['L_{\\mathrm{soil}}', 'soiling loss fraction']])}
      </div>
      <div class="stack">
        <div class="lbl">Angles of eq. (1) · move the panel and the sun</div>
        <svg id="a2-svg" class="sketch" viewBox="0 0 580 330" role="img" aria-label="Tilted panel facing the sun with the zenith angle, the tilt angle and the angle of incidence"></svg>
        <div class="ctrls">
          <div class="ctrl"><label for="a2-b">Tilt \\(\\beta\\), °</label><output id="a2-bo"></output><input type="range" id="a2-b" min="0" max="60" step="1" value="27"></div>
          <div class="ctrl"><label for="a2-z">Sun zenith \\(\\theta_z\\), °</label><output id="a2-zo"></output><input type="range" id="a2-z" min="0" max="80" step="1" value="45"></div>
        </div>
        <p class="insight" id="a2-read"></p>
        <div class="lbl">Three sources of eq. (2)</div>
        <svg viewBox="0 0 580 250" class="sketch" role="img" aria-label="Direct beam, sky diffuse and ground reflected light reaching a tilted panel">
          <defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#E8A266"/></marker></defs>
          <path d="M 40 210 Q 290 -60 540 210" fill="none" stroke="#9C9985" stroke-dasharray="4 6"/>
          <text x="60" y="110" fill="#C3BEA9" font-size="15">sky dome</text>
          <line x1="20" y1="210" x2="560" y2="210" stroke="#9C9985" stroke-width="2"/>
          <polygon points="230,170 380,210 376,220 226,180" fill="#2E3D30" stroke="#F0E8D2" stroke-width="2"/>
          <circle cx="500" cy="40" r="20" fill="#C07030"/>
          <line x1="485" y1="54" x2="320" y2="182" stroke="#E8A266" stroke-width="3" marker-end="url(#ah)"/>
          <text x="400" y="110" fill="#E8A266" font-size="15">direct DNI·cos θi</text>
          <line x1="200" y1="70" x2="280" y2="168" stroke="#F0E8D2" stroke-width="1.6" stroke-dasharray="5 4"/>
          <line x1="290" y1="50" x2="300" y2="168" stroke="#F0E8D2" stroke-width="1.6" stroke-dasharray="5 4"/>
          <text x="150" y="58" fill="#F0E8D2" font-size="15">sky diffuse DHI</text>
          <line x1="140" y1="210" x2="250" y2="182" stroke="#E0B33A" stroke-width="1.8" stroke-dasharray="3 4"/>
          <text x="40" y="238" fill="#E0B33A" font-size="15">ground reflected ρ·GHI (ρ ≈ 0.2)</text>
        </svg>
      </div>
    </div></div></details>

  <details id="a3"><summary>A3 · Temperature and power: heat, wiring and the inverter</summary><div class="in">
    <p class="muted">Once we know the light on the panel, four steps give the AC energy. Heat varies most between sites: a panel in Sonora runs hotter than one in Veracruz and loses more power.</p>
    <div class="split">
      <div class="grid g2" style="margin-top:0">
        ${EQ('(4) Cell temperature · Faiman', 'T_c=T_a+\\frac{G_{\\mathrm{POA}}}{U_0+U_1\\,v}', '<b>In words:</b> the panel heats above the air in proportion to the sunlight; wind cools it. At 800 W/m², 32 °C air and 2 m/s wind: \\(T_c\\approx52\\ ^{\\circ}\\mathrm{C}\\).')}
        ${EQ('(5) DC power · PVWatts', 'P_{\\mathrm{dc}}=P_{\\mathrm{STC}}\\,\\frac{G_{\\mathrm{eff}}}{G_{\\mathrm{STC}}}\\bigl[1+\\gamma\\,(T_c-T_{\\mathrm{STC}})\\bigr]', '<b>In words:</b> power grows with light and falls with heat. With \\(\\gamma=-0.35\\ \\%/^{\\circ}\\mathrm{C}\\) and \\(T_c=55\\ ^{\\circ}\\mathrm{C}\\): \\(1+\\gamma\\cdot 30=0.895\\), a 10.5 % loss.')}
        ${EQ('(6) AC power · losses and inverter', 'P_{\\mathrm{ac}}=\\min\\!\\Bigl(\\eta_{\\mathrm{inv}}\\,(1-L_{\\mathrm{sys}})\\,P_{\\mathrm{dc}},\\ \\tfrac{P_{\\mathrm{STC}}}{r}\\Bigr)', '<b>In words:</b> wiring, mismatch and soiling remove \\(L_{\\mathrm{sys}}\\) (PVWatts default 14 %); the inverter converts to AC and cannot exceed its rating, so midday peaks above it are clipped.')}
        ${EQ('(7) Energy per kWp in hour h', 'y_h=\\frac{1}{P_{\\mathrm{STC}}}\\int_h^{h+1}P_{\\mathrm{ac}}\\,dt\\approx\\frac{P_{\\mathrm{ac},h}\\cdot 1\\ \\mathrm{h}}{P_{\\mathrm{STC}}}', '<b>In words:</b> one hour of AC power per installed kWp. Summed over a year it gives \\(Y_f\\); weighted against prices it gives \\(P_{\\mathrm{cap}}\\).')}
      </div>
      <div class="stack">
        <div class="legend"><span><i style="background:var(--orange)"></i>Heat factor \\(1+\\gamma\\,(T_c-25)\\) with \\(\\gamma=-0.35\\) %/°C, no unit</span></div>
        <div class="chart" style="height:210px"><canvas id="cA3a" role="img" aria-label="DC power factor as a function of cell temperature"></canvas></div>
        <div class="legend"><span><i style="background:var(--ink-3)"></i>DC power, \\(r=1.3\\)</span><span><i class="sq" style="background:var(--orange)"></i>AC delivered</span><span><i class="dsh" style="border-color:var(--ink)"></i>Inverter limit \\(1/r\\)</span></div>
        <div class="chart" style="height:210px"><canvas id="cA3b" role="img" aria-label="Clear-day DC power and AC power with clipping at the inverter limit"></canvas></div>
        <p class="fine">Clipping chart: illustrative clear day, \\(G_{\\mathrm{POA}}\\) peak 1,050 W/m², \\(\\eta_{\\mathrm{inv}}(1-L_{\\mathrm{sys}})\\) = 0.97 × 0.90.</p>
      </div>
    </div>
    <div class="panel"><span class="lbl accent">What this project's pipeline applies</span>
      <p>Tracker: single axis N–S, ±60°, backtracking, ground coverage ratio 0.35; fixed: south-facing at 0.76·|lat| + 3.1°. Transposition: Perez (1990) with albedo 0.20 and an ASHRAE incidence-angle loss. Cell temperature: SAPM open-rack glass-glass; power coefficient −0.35 %/°C above 25 °C; system derate 0.904. NASA POWER 2015–2025, shaped as a typical month × hour year on the CDMX clock. ${ext('https://pvlib-python.readthedocs.io', 'pvlib documentation')}.</p></div>
    <p class="fine">Constants \\(U_0=25\\) W/(m²K), \\(U_1=6.84\\) W·s/(m³K): Faiman (2008) [5]. PVWatts: Dobos (2014) [6]. \\(\\gamma\\) −0.30 to −0.40 %/°C for silicon; \\(\\eta_{\\mathrm{inv}}\\) 96–98 %; \\(r\\) 1.2–1.3.</p>
  </div></details>

  <details id="a4"><summary>A4 · One hour, step by step (interactive)</summary><div class="in">
    <p class="muted">Set the conditions of one hour and follow the power of 1 kWp through equations (4) to (6). The top bar is what an irradiance-only calculation assumes; the bottom bar is what the meter sees.</p>
    <div class="split">
      <div class="stack"><div class="ctrls">
        <div class="ctrl"><label for="g9">Sunlight on panel \\(G_{\\mathrm{POA}}\\), W/m²</label><output id="g9o"></output><input type="range" id="g9" min="0" max="1200" step="10" value="800"></div>
        <div class="ctrl"><label for="t9">Air temperature \\(T_a\\), °C</label><output id="t9o"></output><input type="range" id="t9" min="0" max="45" step="1" value="32"></div>
        <div class="ctrl"><label for="v9">Wind speed \\(v\\), m/s</label><output id="v9o"></output><input type="range" id="v9" min="0" max="10" step="0.5" value="2"></div>
        <div class="ctrl"><label for="y9">Temperature coefficient \\(\\gamma\\), %/°C</label><output id="y9o"></output><input type="range" id="y9" min="-0.50" max="-0.25" step="0.01" value="-0.35"></div>
        <div class="ctrl"><label for="l9">System losses \\(L_{\\mathrm{sys}}\\), %</label><output id="l9o"></output><input type="range" id="l9" min="0" max="20" step="0.5" value="10"></div>
        <div class="ctrl"><label for="e9">Inverter efficiency \\(\\eta_{\\mathrm{inv}}\\), %</label><output id="e9o"></output><input type="range" id="e9" min="94" max="99" step="0.5" value="97"></div>
        <div class="ctrl"><label for="r9">DC/AC ratio \\(r\\)</label><output id="r9o"></output><input type="range" id="r9" min="1" max="1.5" step="0.05" value="1.25"></div></div>
        <ul class="dash"><li><span><b>Why it matters.</b> An irradiance-only calculation treats every kWh/m² of sunlight as output. This hour shows 20–30 % of it never reaches the meter, and the share is larger on hot sites.</span></li>
        <li><span><b>Try it.</b> Raise \\(T_a\\) to 42 °C and drop wind to 0: that is a Sonora afternoon. Raise \\(G_{\\mathrm{POA}}\\) above 1,000 with \\(r=1.3\\): clipping appears.</span></li></ul></div>
      <div class="stack"><div class="stats"><div class="stat"><span>Cell temp. · °C</span><strong id="k9t"></strong></div><div class="stat"><span>Heat factor</span><strong id="k9f"></strong></div>
        <div class="stat"><span>AC power · kW/kWp</span><strong id="k9a"></strong></div><div class="stat"><span>Kept vs sunlight</span><strong id="k9p"></strong></div></div>
        <div class="chart" style="height:340px"><canvas id="c9" role="img" aria-label="Power per kWp after each loss step"></canvas></div>
        <p class="fine">“Kept vs sunlight” is the hourly performance ratio \\(P_{\\mathrm{ac}}G_{\\mathrm{STC}}/(P_{\\mathrm{STC}}G_{\\mathrm{POA}})\\). Reflection and soiling of eq. (3) are folded into \\(L_{\\mathrm{sys}}\\) here.</p></div>
    </div>
    <details><summary>Worked example from this pipeline (node 01AAN-85, 21 Mar 2024, 12:00–13:00 CDMX)</summary><div class="in">
      <ol class="notes"><li>NASA: GHI 1,006.9 W/m², DNI 950.5, DHI 116.3, T2M 31.45 °C, WS2M 2.46 m/s (wind at 10 m: 3.10 m/s).</li>
      <li>Sun at 12:30: zenith 19.87°, azimuth 170.6°.</li><li>Fixed (18.5°, south): POA 1,077.5 W/m², cell temperature 62.6 °C.</li>
      <li>Power = 10⁶ × (POA/1000) × [1 − 0.0035·(62.6 − 25)] × 0.9038 = <b>845.7 kW/MWp</b>.</li><li>Tracker (3.4°): POA 1,012.9 W/m², <b>0.7989 MWh/MWp</b>.</li>
      <li>PML of that hour: 1,085.44 MXN/MWh; it contributes y·PML = 0.7371 × 1,085.44 = 800.1 MXN/MWp to the fixed-tilt March 12:00 sum.</li></ol></div></details>
  </div></details>

  <details id="a5"><summary>A5 · The shortcut is the hourly model with four factors set to 1</summary><div class="in">
    <p class="muted">“Total Generation” multiplies annual horizontal sunshine by a 2022 average price. Writing the real revenue in the same units shows which four effects it ignores and in which direction each pushes.</p>
    <div class="split">
      <div class="stack">
        ${EQ('Total Generation (REPSA office-prospection method)', '\\mathrm{TG}=\\frac{H_{\\mathrm{GHI}}\\cdot\\overline{\\mathrm{PML}}_{2022}}{1000}\\qquad\\text{e.g. } \\frac{2{,}220\\times40.73}{1000}=90\\ \\tfrac{\\mathrm{USD}}{\\mathrm{kWp\\cdot yr}}')}
        ${EQ('Real revenue per kWp, same units', '\\frac{R}{P_{\\mathrm{STC}}}=\\mathrm{TG}\\times\\underbrace{\\mathrm{PR}}_{\\text{losses}}\\times\\underbrace{\\frac{H_{\\mathrm{POA}}}{H_{\\mathrm{GHI}}}}_{\\text{panel plane}}\\times\\underbrace{\\mathrm{VF}}_{\\text{timing}}\\times\\underbrace{\\frac{\\overline{\\mathrm{PML}}_{\\text{now}}}{\\overline{\\mathrm{PML}}_{2022}}}_{\\text{price level}}')}
        <div class="scroll-x"><table><thead><tr><th>Factor</th><th>What the shortcut assumes</th><th>Reality</th><th>Effect on TG</th></tr></thead><tbody>
          <tr><td>\\(\\mathrm{PR}\\)</td><td>Every kWh/m² becomes a kWh (PR = 1)</td><td>0.75–0.85; lower on hot sites</td><td class="neg">Overstates 15–25 %</td></tr>
          <tr><td>\\(H_{\\mathrm{POA}}/H_{\\mathrm{GHI}}\\)</td><td>Panel lies flat</td><td>≈ 1.10 fixed tilt, ≈ 1.25 tracker</td><td>Understates</td></tr>
          <tr><td>VF</td><td>Every MWh sells at the average price</td><td id="a5-vfrange">by region</td><td class="neg" id="a5-over">Overstates</td></tr>
          <tr><td>Price level</td><td>2022 forecast, in USD</td><td>Hourly CENACE PML, last 12 months</td><td>Either way</td></tr></tbody></table></div>
        ${VARS([['\\mathrm{TG}', 'Total Generation, USD per kWp per year (ranking index)'], ['H_{\\mathrm{GHI}},\\ H_{\\mathrm{POA}}', 'annual irradiation, flat and on the panel, kWh/m²'], ['\\overline{\\mathrm{PML}}_{2022}', 'average node price from the 2022 file, USD/MWh'], ['\\mathrm{PR}', 'performance ratio, \\(Y_f\\,G_{\\mathrm{STC}}/H_{\\mathrm{POA}}\\)']])}
      </div>
      <div class="stack">
        <div class="ctrls">
          <div class="ctrl"><label for="a11">PR</label><output id="a11o"></output><input type="range" id="a11" min="0.70" max="0.90" step="0.01" value="0.80"></div>
          <div class="ctrl"><label for="b11">\\(H_{\\mathrm{POA}}/H_{\\mathrm{GHI}}\\)</label><output id="b11o"></output><input type="range" id="b11" min="1.00" max="1.35" step="0.01" value="1.25"></div>
          <div class="ctrl"><label for="c11">VF</label><output id="c11o"></output><input type="range" id="c11" min="0.40" max="1.10" step="0.01" value="0.80"></div>
          <div class="ctrl"><label for="d11">Price level now / 2022</label><output id="d11o"></output><input type="range" id="d11" min="0.30" max="2.00" step="0.05" value="1.00"></div>
        </div>
        <div class="stats"><div class="stat"><span>Real ÷ shortcut</span><strong id="k11r"></strong></div><div class="stat"><span>Shortcut error</span><strong id="k11e"></strong></div></div>
        <div class="chart" style="height:300px"><canvas id="ch11" role="img" aria-label="Shortcut index of 100 multiplied step by step by each factor"></canvas></div>
        <p class="fine" id="a5-note"></p>
      </div>
    </div></div></details>

  <details id="formulas"><summary>Formulas this page computes in your browser</summary><div class="in">
    <p class="muted">All per MWp, in the active price basis. Unit-tested against the deck-scenario figures in <code>analysis.json</code>.</p>
    ${EQ('Annual energy and operating cost', 'E_t=Y_f\\,(1-d)^{t-1},\\qquad \\mathrm{OM}_t=\\mathrm{OM}_1\\,(1+\\pi)^{t-1}\\ \\text{(nominal basis; }\\pi=0\\text{ in real basis)}')}
    ${EQ('Net present value and IRR', '\\mathrm{NPV}=-\\mathrm{CAPEX}+\\sum_{t=1}^{T}\\frac{P\\,E_t-\\mathrm{OM}_t}{(1+i)^{t}},\\qquad \\mathrm{NPV}(\\mathrm{IRR})=0')}
    ${EQ('Levelized cost and break-evens', '\\mathrm{LCOE}=\\frac{\\mathrm{CAPEX}+\\sum_{t}\\mathrm{OM}_t(1+i)^{-t}}{\\sum_{t}E_t(1+i)^{-t}},\\quad \\mathrm{PPA}_{\\mathrm{BE}}=\\mathrm{LCOE},\\quad \\overline{\\mathrm{PML}}_{\\mathrm{BE}}=\\frac{\\mathrm{LCOE}}{\\mathrm{VF}}')}
    ${EQ('Margin, required VF and coverage', '\\text{margin}=P_{\\mathrm{cap}}-\\mathrm{LCOE},\\qquad \\mathrm{VF}_{\\mathrm{req}}=\\frac{\\mathrm{LCOE}}{\\overline{\\mathrm{PML}}},\\qquad \\text{share covering}=\\frac{\\#\\{i:\\ P_{\\mathrm{cap},i}\\ge \\mathrm{LCOE}_i\\}}{N}')}
    ${EQ('Deck-scenario P&L per MWp (printed LCOE)', '\\Pi_i=Y_{f,i}\\,\\bigl(P_{\\mathrm{cap},i}-\\mathrm{LCOE}\\bigr),\\qquad \\mathrm{LCOE}=40\\ \\mathrm{USD/MWh}\\times17.84=714\\ \\mathrm{MXN/MWh}')}
    <p class="fine">Traffic light: green when \\(P_{\\mathrm{cap}}\\ge\\mathrm{LCOE}\\), yellow when within the band you set below it, red otherwise. It appears only for a complete assumption set.</p>
  </div></details>`;
  renderMath(root);
  // A1 grid map
  const geo = await loadGeo();
  if (geo) {
    const gm = new GeoMap($('#a1-map'), geo, { interactive: false, labels: false });
    const ex = [['04RGU-115', 'Hermosillo'], ['08NCM-115', 'Mérida']].map(([id, t]) => { const n = D.byId.get(id); return n && n.lat != null ? { id, t, lon: n.lon, lat: n.lat } : null; }).filter(Boolean);
    gm.setFill({ level: 'region', color: () => '#3A4C3D', label: () => '' });
    gm.setExtra((ctx2) => {
      ctx2.strokeStyle = 'rgba(240,232,210,.28)'; ctx2.lineWidth = 1; ctx2.beginPath();
      for (let lon = -118; lon <= -86; lon++) { const [x] = ll2xy(lon + 0.5, 0); ctx2.moveTo(x, 0); ctx2.lineTo(x, geo.vb[1]); }
      for (let lat = 15; lat <= 32; lat++) { const [, y] = ll2xy(0, lat + 0.5); ctx2.moveTo(0, y); ctx2.lineTo(geo.vb[0], y); }
      ctx2.stroke();
      ex.forEach((e) => {
        const cx = Math.round(e.lon), cy = Math.round(e.lat), [x0, y0] = ll2xy(cx - 0.5, cy + 0.5), [x1, y1] = ll2xy(cx + 0.5, cy - 0.5);
        ctx2.fillStyle = 'rgba(192,112,48,.38)'; ctx2.strokeStyle = '#C07030'; ctx2.lineWidth = 2; ctx2.fillRect(x0, y0, x1 - x0, y1 - y0); ctx2.strokeRect(x0, y0, x1 - x0, y1 - y0);
        const [x, y] = ll2xy(e.lon, e.lat);
        ctx2.beginPath(); ctx2.arc(x, y, 7, 0, 6.3); ctx2.fillStyle = '#C07030'; ctx2.fill(); ctx2.lineWidth = 2.5; ctx2.strokeStyle = '#232E26'; ctx2.stroke();
        ctx2.font = '500 24px "DM Mono", monospace'; ctx2.textAlign = x > 600 ? 'left' : 'right'; ctx2.lineWidth = 4; ctx2.strokeStyle = '#384A3B'; ctx2.fillStyle = '#F0E8D2';
        const tx = x > 600 ? x + 20 : x - 20; ctx2.strokeText(e.t, tx, y - 20); ctx2.fillText(e.t, tx, y - 20);
      });
    });
  }
  // A2 sketch
  const svg = $('#a2-svg');
  function sketch() {
    const b = +$('#a2-b').value, z = +$('#a2-z').value, br = (b * Math.PI) / 180, zr = (z * Math.PI) / 180;
    $('#a2-bo').textContent = `${b}°`; $('#a2-zo').textContent = `${z}°`;
    const P = [350, 235], L = 100, n = [Math.sin(br), -Math.cos(br)];
    const ax = [Math.cos(br), Math.sin(br)];
    const p1 = [P[0] - ax[0] * L, P[1] - ax[1] * L], p2 = [P[0] + ax[0] * L, P[1] + ax[1] * L];
    const sun = [P[0] + 250 * Math.sin(zr), P[1] - 250 * Math.cos(zr)];
    const nt = [P[0] + n[0] * 150, P[1] + n[1] * 150];
    const ti = Math.abs(z - b);
    const arc = (r, a0, a1) => { const x0 = P[0] + r * Math.sin(a0), y0 = P[1] - r * Math.cos(a0), x1 = P[0] + r * Math.sin(a1), y1 = P[1] - r * Math.cos(a1); return `M ${x0} ${y0} A ${r} ${r} 0 0 ${a1 > a0 ? 1 : 0} ${x1} ${y1}`; };
    svg.innerHTML = `<line x1="20" y1="280" x2="560" y2="280" stroke="#9C9985" stroke-width="2"/>
      <line x1="${P[0]}" y1="${P[1]}" x2="${P[0]}" y2="40" stroke="#9C9985" stroke-dasharray="5 6"/><text x="${P[0] + 8}" y="52" fill="#C3BEA9" font-size="15">vertical (zenith)</text>
      <line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="#F0E8D2" stroke-width="7" stroke-linecap="round"/>
      <line x1="${P[0]}" y1="${P[1]}" x2="${nt[0]}" y2="${nt[1]}" stroke="#F0E8D2" stroke-width="1.6" stroke-dasharray="4 5"/><text x="${nt[0] + 6}" y="${nt[1] - 4}" fill="#F0E8D2" font-size="15">panel normal</text>
      <circle cx="${sun[0]}" cy="${sun[1]}" r="22" fill="#C07030"/><line x1="${sun[0]}" y1="${sun[1]}" x2="${P[0]}" y2="${P[1]}" stroke="#E8A266" stroke-width="2.6"/>
      <path d="${arc(110, 0, zr)}" fill="none" stroke="#F0E8D2" stroke-width="1.6"/><text x="${P[0] + 110 * Math.sin(zr / 2) + 6}" y="${P[1] - 110 * Math.cos(zr / 2) - 4}" fill="#F0E8D2" font-size="20" font-style="italic">θz</text>
      <path d="${arc(70, br, zr)}" fill="none" stroke="#E8A266" stroke-width="2.4"/><text x="${P[0] + 90 * Math.sin((br + zr) / 2) + 4}" y="${P[1] - 90 * Math.cos((br + zr) / 2)}" fill="#E8A266" font-size="20" font-style="italic">θi</text>
      <text x="${P[0] - 36}" y="268" fill="#F0E8D2" font-size="20" font-style="italic">β = ${b}°</text>
      <text x="30" y="312" fill="#C3BEA9" font-size="14">flat ground: GHI is measured here · panel tilted by β</text>`;
    const cos = Math.cos((ti * Math.PI) / 180);
    $('#a2-read').innerHTML = `Sun in the plane facing the panel (\\(\\varphi_s=\\varphi_p\\)): \\(\\theta_i=${ti}^\\circ\\), \\(\\cos\\theta_i=${f2(cos)}\\). The panel catches ${f0(cos * 100)} % of the direct beam per unit area${ti >= 90 ? '; the sun is behind the panel' : ''}.`;
    renderMath($('#a2-read'));
  }
  ['a2-b', 'a2-z'].forEach((i) => $('#' + i).addEventListener('input', sketch)); sketch();
  // A3 charts
  const c = col();
  const T = Array.from({ length: 17 }, (_, i) => i * 5);
  const a = await make($('#cA3a'), { type: 'line', data: { labels: T, datasets: [{ data: T.map((t) => 1 - 0.0035 * (t - 25)), borderColor: c.orange, borderWidth: 2.5, pointRadius: T.map((t) => (t === 45 || t === 65 ? 6 : 0)), pointBackgroundColor: c.ink }] }, options: baseOptions() });
  axisTitle(a, 'Cell temperature Tc, °C', 'Heat factor'); a.options.scales.y.min = 0.8; a.options.scales.y.max = 1.1; a.options.scales.x.ticks.callback = (v, i) => (T[i] % 10 === 0 ? T[i] : '');
  a.options.plugins.tooltip.callbacks = { title: (it) => `T_c = ${T[it[0].dataIndex]} °C`, label: (it) => `factor ${f3(it.raw)} (${signed((it.raw - 1) * 100, 1)} %)` };
  const hrs = Array.from({ length: 15 }, (_, i) => i + 5), G = hrs.map((h) => (h <= 6 || h >= 18 ? 0 : (1050 * Math.sin((Math.PI * (h - 6)) / 12) ** 1.2) / 1000));
  const dc = G.map((g) => g * 0.95), lim = 1 / 1.3, ac = dc.map((x) => Math.min(x * 0.97 * 0.9, lim));
  const b = await make($('#cA3b'), { data: { labels: hrs, datasets: [
    { type: 'line', label: 'DC power', data: dc, borderColor: c.ink3, borderWidth: 2, pointRadius: 0, tension: 0.3 },
    { type: 'bar', label: 'AC delivered', data: ac, backgroundColor: c.orange, barPercentage: 0.85 },
    { type: 'line', label: 'Inverter limit', data: hrs.map(() => lim), borderColor: c.ink, borderDash: [6, 4], borderWidth: 2, pointRadius: 0 }] }, options: baseOptions() });
  axisTitle(b, 'Hour of day', 'kW per kWp'); b.options.scales.y.min = 0; b.options.scales.y.max = 1.1; b.options.scales.x.ticks.callback = (v, i) => (hrs[i] % 3 === 0 ? pad(hrs[i]) : '');
  b.options.plugins.tooltip.callbacks = { title: (it) => `${pad(hrs[it[0].dataIndex])}:00 h`, label: (it) => `${it.dataset.label}: ${f2(it.raw)} kW/kWp` };
  a.update(); b.update();
  // A4
  const labels = ['Sunlight only (irradiance)', 'After heat, eq. (4)–(5)', 'After system losses', 'After inverter', 'After clipping = AC'];
  const ch = await make($('#c9'), { type: 'bar', data: { labels, datasets: [{ data: [], backgroundColor: [c.ink3, c.orange, c.orange, c.orange, c.cream], barPercentage: 0.72 }] }, options: baseOptions({ indexAxis: 'y' }) });
  ch.options.scales.x.grid = { display: true, color: c.line }; ch.options.scales.y.grid = { display: false }; ch.options.scales.x.min = 0; ch.options.scales.x.max = 1.25;
  axisTitle(ch, 'Power, kW per kWp installed', null); ch.options.scales.y.ticks.font = { family: 'DM Sans', size: 14 }; ch.options.scales.y.ticks.color = c.ink;
  ch.options.plugins.tooltip.callbacks = { label: (it) => `${f3(it.raw)} kW per kWp` };
  const upd9 = () => {
    const g = +$('#g9').value, ta = +$('#t9').value, v = +$('#v9').value, gam = +$('#y9').value / 100, L = +$('#l9').value / 100, eta = +$('#e9').value / 100, r = +$('#r9').value;
    $('#g9o').textContent = f0(g); $('#t9o').textContent = f0(ta); $('#v9o').textContent = f1(v); $('#y9o').textContent = f2(gam * 100); $('#l9o').textContent = f1(L * 100); $('#e9o').textContent = f1(eta * 100); $('#r9o').textContent = f2(r);
    const tc = ta + g / (25 + 6.84 * v), tf = 1 + gam * (tc - 25), p0 = g / 1000, p1 = p0 * tf, p2 = p1 * (1 - L), p3 = p2 * eta, p4 = Math.min(p3, 1 / r);
    $('#k9t').textContent = f1(tc); $('#k9f').textContent = f3(tf); $('#k9a').textContent = f3(p4); $('#k9p').textContent = g > 0 ? `${f0((p4 / p0) * 100)} %` : '–';
    ch.data.datasets[0].data = [p0, p1, p2, p3, p4].map((x) => +x.toFixed(3)); ch.update();
  };
  ['g9', 't9', 'v9', 'y9', 'l9', 'e9', 'r9'].forEach((i) => $('#' + i).addEventListener('input', upd9)); upd9();
  // A5
  const n2 = areaStat(WIN.Y2.key, 'national');
  const vf0 = n2 ? n2.vf : 0.8;
  $('#c11').value = vf0.toFixed(2);
  const reg = REGIONS.map((r) => areaStat(WIN.Y2.key, 'region', r)).filter(Boolean).map((s) => s.vf);
  if (reg.length) { $('#a5-vfrange').textContent = `${f2(Math.min(...reg))}–${f2(Math.max(...reg))} by region (${WIN.Y2.short})`; $('#a5-over').textContent = `Overstates ${f0((1 / Math.max(...reg) - 1) * 100)}–${f0((1 / Math.min(...reg) - 1) * 100)} %`; }
  $('#a5-note').textContent = `Read the bars left to right: start at the shortcut (100) and apply one correction at a time. Defaults: national VF ${f2(vf0)} (${WIN.Y2.short}, this project's data), tracker plane gain 1.25, PR 0.80.`;
  const ch11 = await make($('#ch11'), { type: 'bar', data: { labels: ['Shortcut', '× PR', '× panel plane', '× VF', '× price level'], datasets: [{ data: [], backgroundColor: [c.ink3, c.orange, c.orange, c.orange, c.cream], barPercentage: 0.6 }] }, options: baseOptions() });
  ch11.options.scales.y.min = 0; ch11.options.scales.x.ticks.color = c.ink; ch11.options.scales.x.ticks.font = { family: 'DM Sans', size: 13 };
  axisTitle(ch11, 'Correction applied, left to right', 'Revenue index, shortcut = 100'); ch11.options.plugins.tooltip.callbacks = { label: (it) => `index ${f1(it.raw)}` };
  const upd11 = () => {
    const [aa, bb, cc, dd] = ['a11', 'b11', 'c11', 'd11'].map((i) => +$('#' + i).value);
    ['a11', 'b11', 'c11', 'd11'].forEach((i, k) => { $(`#${i}o`).textContent = f2([aa, bb, cc, dd][k]); });
    const s = [100, 100 * aa, 100 * aa * bb, 100 * aa * bb * cc, 100 * aa * bb * cc * dd], ratio = s[4] / 100, err = 1 / ratio - 1;
    $('#k11r').textContent = f2(ratio); const e = $('#k11e'); e.textContent = `${signed(err * 100, 0)} %`; e.classList.toggle('neg', err > 0);
    ch11.data.datasets[0].data = s.map((x) => +x.toFixed(1)); ch11.options.scales.y.max = Math.max(120, Math.ceil(Math.max(...s) / 20) * 20); ch11.update();
  };
  ['a11', 'b11', 'c11', 'd11'].forEach((i) => $('#' + i).addEventListener('input', upd11)); upd11();
  root.insertAdjacentHTML('beforeend', `<style>.chain{list-style:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.chain li{border:1px solid var(--line);background:rgba(250,246,235,.05);padding:10px 12px;font-size:15px;line-height:1.4;border-radius:5px}.chain li b{display:block;font:500 12px var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--orange-text);margin-bottom:4px}.chain li.hl{border-color:var(--orange)}.vars p{font-size:14.5px;color:var(--ink-2);margin:0}.vars b{color:var(--ink)}</style>`);
}

/* ---------- Sources ---------- */
export function initSources(ctx) {
  const idx = D.index, pd = idx.periodo_datos, a = D.analysis;
  $('#sources-root').innerHTML = `
    <div class="grid g2">
      <div class="panel"><span class="lbl accent">Data and conventions</span><ul class="dash">
        <li><span>Prices: CENACE MDA PML, ${esc(pd.desde)} to ${esc(pd.hasta)}, ${f0(idx.conteo.nodos)} nodes in the index; SIN analysis universe needs ≥ 300 days of prices in the window and a solar baseline; Cozumel excluded.</span></li>
        <li><span>Hours: CENACE hour-ending 1–24 shifted to hour-beginning 0–23 and put on the fixed CDMX clock (UTC−6); BCA and BCS are shifted +2 h and +1 h from their local time.</span></li>
        <li><span>Production \\(y_h\\): pvlib single-axis tracker (±60°, backtracking, GCR 0.35) or fixed tilt, NASA POWER 2015–2025 typical year by month and hour, applied to each real hour of price.</span></li>
        <li><span>Areas: node averages per state or control region; VF = ratio of averages. Complete years and months need every hour; edge months never count and nothing is annualised.</span></li>
        <li><span>Pesos: today's pesos use INPC (Banxico SP1) with base month ${esc(idx.pesos_reales.base_mes)}; nominal is each month's own pesos.</span></li>
        <li><span>Locations: municipal centroids from the CENACE node catalogue and INEGI; 6 retired codes inherit the location of the node that replaced them.</span></li>
        <li><span>Generated ${esc((idx.generated_at || '').slice(0, 10))}; contract ${esc(idx.schema_version)}; analysis ${a ? esc(a.schema_version) : '—'}.</span></li></ul></div>
      <div class="panel"><span class="lbl accent">References</span><ol class="notes refs">
        <li>Holmgren, Hansen, Mikofski (2018), pvlib python, <i>JOSS</i> 3(29), 884; Anderson et al. (2023), <i>JOSS</i> 8(92), 5994. ${ext('https://pvlib-python.readthedocs.io', 'pvlib-python.readthedocs.io')}</li>
        <li>Ineichen, Perez (2002), Linke turbidity formulation, <i>Solar Energy</i> 73(3), 151–157.</li>
        <li>NASA Langley Research Center POWER Project. ${ext('https://power.larc.nasa.gov', 'power.larc.nasa.gov')} · ${ext('https://power.larc.nasa.gov/docs/services/', 'services')}</li>
        <li>Hirth (2013), The market value of variable renewables, <i>Energy Economics</i> 38, 218–236.</li>
        <li>Faiman (2008), <i>Progress in Photovoltaics</i> 16(4), 307–315.</li>
        <li>Dobos (2014), PVWatts Version 5 Manual, NREL/TP-6A20-62641.</li>
        <li>CENACE, Mercado de Día en Adelanto, precios marginales locales. ${ext('https://www.cenace.gob.mx', 'cenace.gob.mx')}</li>
        <li>NSRDB (NREL): ${ext('https://nsrdb.nlr.gov/data-sets/us-data', 'nsrdb.nlr.gov')}. LCOE ranges: ${ext('https://www.iea.org/reports/cost-of-capital-observatory/tools-and-analysis', 'IEA')}, ${ext('https://www.surgepv.com/blog/solar-lcoe-by-country', 'SurgePV')}.</li>
        <li>REPSA, “6. Origination – Office prospection calculations” (Total Generation formula).</li></ol></div>
    </div>
    <div class="panel"><span class="lbl accent">Credits and licences</span>
      <p class="fine" style="margin-top:0">Type: Bricolage Grotesque, DM Sans and DM Mono (SIL OFL 1.1, bundled). Math: KaTeX (MIT). Charts: Chart.js 4.4.1 (MIT). State outlines: the generalised geometry of the REPSA deck, pre-projected (equirectangular, 24°N); see <code>web/docs/boundaries.md</code>. The NASA POWER entry is a data credit, not an endorsement. All libraries are bundled; the page makes no third-party requests.</p></div>
    <div id="src-quality"></div>`;
  renderMath($('#sources-root'));
}
