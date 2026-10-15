// Appendix A1-A4 (text and figures of v1 "Methods and appendix"). A5 is intentionally not ported. Equations are rendered with the
// vendored KaTeX (loaded on this page only); every equation is followed by its plain-language reading, as in v1.
const ext = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
const EQ = (lbl, tex, note = '') => `<div class="eq-card"><span class="lbl">${lbl}</span>\\[ ${tex} \\]${note ? `<p class="note">${note}</p>` : ''}</div>`;
const VARS = (items) => `<div class="grid g3 vars">${items.map(([s, t]) => `<p><b>\\(${s}\\)</b> ${t}</p>`).join('')}</div>`;

export const appendixHTML = () => `
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
        <div class="map-wrap"><div id="a1-map" role="img" aria-label="Mexico with the NASA POWER one-degree solar grid and two example nodes"></div></div>
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
        <div class="chart" id="cA3a" role="img" aria-label="DC power factor as a function of cell temperature"></div>
        <div class="legend"><span><i style="background:var(--ink-3)"></i>DC power, \\(r=1.3\\)</span><span><i class="sq" style="background:var(--orange)"></i>AC delivered</span><span><i class="dsh" style="border-color:var(--ink)"></i>Inverter limit \\(1/r\\)</span></div>
        <div class="chart" id="cA3b" role="img" aria-label="Clear-day DC power and AC power with clipping at the inverter limit"></div>
        <p class="fine">Clipping chart: illustrative clear day, \\(G_{\\mathrm{POA}}\\) peak 1,050 W/m², \\(\\eta_{\\mathrm{inv}}(1-L_{\\mathrm{sys}})\\) = 0.97 × 0.90.</p>
      </div>
    </div>
    <div class="apx-panel"><span class="lbl accent">What this project's pipeline applies</span>
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
        <div class="chart" id="c9" role="img" aria-label="Power per kWp after each loss step"></div>
        <p class="fine">“Kept vs sunlight” is the hourly performance ratio \\(P_{\\mathrm{ac}}G_{\\mathrm{STC}}/(P_{\\mathrm{STC}}G_{\\mathrm{POA}})\\). Reflection and soiling of eq. (3) are folded into \\(L_{\\mathrm{sys}}\\) here.</p></div>
    </div>
    <details><summary>Worked example from this pipeline (node 01AAN-85, 21 Mar 2024, 12:00–13:00 CDMX)</summary><div class="in">
      <ol class="notes"><li>NASA: GHI 1,006.9 W/m², DNI 950.5, DHI 116.3, T2M 31.45 °C, WS2M 2.46 m/s (wind at 10 m: 3.10 m/s).</li>
      <li>Sun at 12:30: zenith 19.87°, azimuth 170.6°.</li><li>Fixed (18.5°, south): POA 1,077.5 W/m², cell temperature 62.6 °C.</li>
      <li>Power = 10⁶ × (POA/1000) × [1 − 0.0035·(62.6 − 25)] × 0.9038 = <b>845.7 kW/MWp</b>.</li><li>Tracker (3.4°): POA 1,012.9 W/m², <b>0.7989 MWh/MWp</b>.</li>
      <li>PML of that hour: 1,085.44 MXN/MWh; it contributes y·PML = 0.7371 × 1,085.44 = 800.1 MXN/MWp to the fixed-tilt March 12:00 sum.</li></ol></div></details>
  </div></details>`;
