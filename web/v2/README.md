# PowerAtlasMx by REPSA Group, web v2 (`web/v2`)

A second, separate web app. v1 (`web/index.html`) is frozen at tag `v1-deck-page` and keeps working at `http://localhost:8080/#pnl`.
No framework, no CDN, no build step: plain ES modules, plain CSS, vendored fonts and deck.gl.

## Run
```
cd web && python3 -m http.server 8080
open http://localhost:8080/v2/
```
The app is a static site; any static server that serves `web/` works (the app reads `../data/...` and `../assets/...` relative to `/v2/`).

## Daily series (M11)
Explorer and Revenue draw 7-day moving averages at daily resolution from `web/data/solar_v2/daily/` (gitignored, 2 471 files,
about 194 MB gzipped / 486 MB raw; one 80-100 KB gzipped file per node plus 38 area files; layout in docs/TECNICO.md section 13).
Build: `python3 web/tools/build_daily_web.py` (copies the validated `data/solar_v2/daily/`). Files are fetched only when the
daily card scrolls into view (`daily-load.js`), kept in memory at most 8 at a time, and in the service worker cache at most 12
(`DATA_DAILY`, evictable, never precached). Moving averages are computed in the browser (`daily-math.js`).

## Data dependencies
v2 reads files that are **not in git**: `web/data/index.json`, `web/data/analysis/{analysis,analysis_nodos}.json`,
`web/data/derived/{node_profiles,series_nodes,series_areas,geography}.json`. The `.gitignore` entry `data/` also ignores `web/data/`,
so a fresh clone has no data. Regenerate with `web/tools/build_derived.py` and copy `data/analysis/*.json` into `web/data/analysis/`
(see `web/README.md`). Never commit data files. Tests that need the data skip themselves when `web/data` is absent.

## Routes
`#/` landing, `#/map`, `#/choose`, `#/explorer`, `#/revenue`. Selection lives in the query: `?sel=01AAN-85,state:JALISCO,national`
(1 to 3 slots, ids validated against the atlas, unknown ids dropped, URL normalised). Price basis: `&real=1` = today's pesos (nominal is the default and is omitted).
Back/Forward restore each entry exactly. Explorer and Revenue overlay up to 3 slots and end with a comparison table.

## Architecture (one concern per file, each under 300 lines)
| file | concern |
|---|---|
| `index.html`, `main.js` | shell, hash router, transitions (View Transitions API with fade fallback), service worker registration |
| `config.js` | `CONTACT_EMAIL` and product strings |
| `assets/js/route-logic.js`, `store.js`, `nav.js`, `live.js` | pure routing/selection/announcement logic (unit tested) |
| `assets/js/shell.js` | the ONE persistent deck.gl map host (hidden / full / mini), shared state |
| `assets/js/map-view.js`, `metrics.js`, `geo.js`, `atlas.js` | deck.gl layers, colour scales, geometry conversion, node join |
| `assets/js/map-page.js`, `choose.js`, `analysis.js`, `landing.js`, `selector.js`, `chips.js` | views and controls |
| `assets/js/explorer*.js`, `revenue*.js`, `compare-*.js`, `explorer-data.js`, `controls.js` | data layer (slot based) and Explorer / Revenue / compare views |
| `assets/js/svg-charts.js`, `series-style.js` | small SVG charts, series colour + line style + marker |
| `sw.js`, `sw-strategy.js`, `offline.html` | service worker (scope `/v2/`) |
| `assets/css/*.css` | `tokens.css` is the single token source read by the contrast test |

v1 pure modules are reused by import (`format.js`, `names.js`, `geomap.js`, `contrast.js`); nothing is recomputed differently from v1.

## Analysis pages (Explorer, Revenue)
Left column (sticky; stacked above the plots at 390): selected slots with name, id, state and region, "+ Add", the analysis level (Node | State | Region | National,
applied to the first slot; going up and back remembers the node), window, price basis, mounting (single-axis tracker; Fixed tilt is shown disabled) and the key indicators per slot.
Centre: the PML decomposition by hour of the typical day (system energy, losses, congestion, price line, solar hours shaded, solar output on the right axis, average and captured
price lines, 24-value table), Revenue's production x price chart, the value factor by month or by year (years also carry average and captured price), the comparison table for
several slots and, at the National level, sortable tables of all states and all regions (published area fields; a row click sets the slot).
Intro texts and labels live in `assets/js/copy.js` and are a **draft** pending Nico's approval.
Chart widths follow the container so tick labels stay readable on phones; every chart has x tick labels and an x axis title (tested).

## Time span and what-if scenarios (M9)
- **Time span** (`&from=YYYY-MM&to=YYYY-MM`, default = the 12-month window): a dual-handle slider with presets (last 12 months, all, each calendar year) drives the monthly
  value-factor series and its summary. Exact period prices exist only where the node's monthly sums are published (the 20 node sheets): there the summary uses v1's own
  `compute()` (`calc.js`), so numbers equal v1 "One node in detail, for any period" and, for the 12-month window, the published window figures (tested). Every other slot
  only has the monthly value factor, so its summary is the simple mean and range of the monthly values (labelled as such, not the period's value factor).
  Typical day and revenue always use the 12-month windows. Months without complete data are gaps, not zeros.
- **Scenarios** (`&sc=p:50,m:100,y:0`; the default load is always real values): three levers on the typical-day hourly profile, applied as midday dip, then price shift, then yield.
  Every simulated figure is `published value x (scenario typical-day result / baseline typical-day result)`, so neutral sliders reproduce the published numbers exactly.
  Simulated: average price, captured price, value factor (and VF of the average day), revenue per MWp. Not simulated (shown unchanged and marked):
  share of output at price <= 0, evening-peak minus solar spread, and the monthly/yearly series. A visible "Simulated" badge, deltas vs real and ghost lines of the published profile accompany every simulated view; "Reset to real values" restores everything.
  The price shift moves the typical-day average by exactly the shift; the displayed (published-scaled) average moves by the shift times (published average / typical-day average), within about 2%.

## Mounting and weather (M10)
- **Routes:** `&cfg=fijo` (fixed tilt; default single-axis tracker, omitted) and `&wx=mean|y2015..y2025|win` (default yearly mean 2015-2025, omitted) join `?sel`, `&real`, `&from/&to`, `&sc`.
  An explicit entry without them means tracker / yearly mean; a bare hash inherits. Back and Forward restore each entry.
- **Fixed tilt** is tilted towards the south by 0.76 x |latitude| + 3.1 degrees (shown in words on the page) with the same losses as the tracker. **Weather year**: the
  typical day of each month is built from that year's NASA POWER weather (or from the real months of the window, `win`) and applied to the real prices.
  2015 carries the data note (`note_2015`: about -6% vs the mean, likely an input change in MERRA-2/CERES; it stays inside the published yearly mean).
- **Data** (`web/data/solar_v2/`, git-ignored; build with `web/tools/build_solar_web.py`, documented in `docs/TECNICO.md` section 12 and `docs/SOLAR_V2_PLAN.md`):
  `variant_scalars_{tracker,fijo}.json` (5 exact fields per variant and window), `variant_extra/{cfg}/{variant}.json` (the other 5 exact fields), `variants/{v}.json`
  (typical-day production and irradiance per node), `variants/clear.json` (clear-sky reference). Loaded lazily: nothing from `solar_v2` is requested on the default tracker + yearly-mean Explorer or Revenue until the irradiance card scrolls into view
  (Explorer, nodes) or fixed tilt / another weather is selected (verified in a browser; the pure gate `shouldLoadIrradiance` is tested). Tracker + yearly mean uses the published files exactly as before.
- **Areas** (state, region, national) under another configuration or weather are derived in the browser as the mean over member nodes with data (the published
  definition, labelled "derived" on the page; the all-states and all-regions tables are derived the same way under fixed tilt or another weather); they match `analysis.json` to rounding (the node files carry 4 decimals; tested). Node figures are the file values, never approximated.
- **Irradiance** (Explorer, nodes only): global horizontal and plane of array (per mounting), monthly and typical day, kWh/m2; "Show clear-sky reference" overlays the
  clear-sky irradiance and production and shows the cloud loss (1 - real / clear). Clear sky is a reference, not a scenario: no KPIs exist for it.
- **Partial-year nodes** keep the published, un-annualised numbers; the variant's 12-month yield is shown "for information" beside the partial-year note.
- **Monthly value-factor series and the span slider** stay on the single-axis tracker with yearly-mean weather (the published monthly series); the page says so.
- **Service worker:** the data files are network first; the core JSON (about 21 MB raw) is pinned and at most 5 per-variant files (`variants/*`, `variant_extra/*`, about 25 MB worst case) are kept, oldest evicted first; only code and CSS are precached.
- **Credits:** Solar resource: NASA POWER (MERRA-2 / CERES SYN1deg); PV model: pvlib-python (footer of Explorer and Revenue, `docs/CREDITS.md`).

## Roadmap (not built)
Nothing pending from the solar brief; NSRDB contrast and a daily NASA refresh are held (see docs/SOLAR_V2_PLAN.md section 7).

## Numbers
All figures are published fields (`analysis_nodos.json`, `analysis.json`, `series_*.json`). Explorer, Revenue and compare read the same record
(`explorer-data.js`), so a number cannot differ between views. Revenue bars follow the typical day and are scaled to the published yearly `ingreso`;
the page states the gap. Prices are the MDA reference price (CENACE): no capacity, CEL or contracts. Nodes with fewer than 8,760 priced hours in a window show a
"Partial year" note; nothing is annualised.

## Service worker
`/v2/sw.js`, scope `/v2/`, registered after load.
- One release = one cache `v2-shell-<VERSION>`. `install` precaches the whole shell (all-or-nothing; the list `precache.js` is generated from the real import graph by
  `node web/v2/tools/precache-manifest.mjs --write`, and a test fails when it is stale). Files are served cache-first inside the release, so module versions never mix.
- A new release waits and is applied on the next fresh page load (the page asks it to skip waiting, then reloads once). After any shell change run `node web/v2/tools/precache-manifest.mjs --write`: it regenerates `precache.js` and puts the content hash into `VERSION` (a test fails when they disagree). Bump the release part of `VERSION` (`v2-m7-N`) when you want a new release number.
- Data JSON (`/data/...`): network first; the cached copy is only an offline fallback (cache `v2-data`).
- Navigations: the cached shell of the release; if it is missing the worker goes to the network and re-fills it; offline with nothing cached it answers with an inline "You are offline" page (never undefined).
- v1's `web/sw.js` deletes every cache that does not start with its own `VERSION`, including v2's. v1 is frozen, so v2 copes: the shell is re-filled on the next online v2 visit.
- Development: unregister via DevTools > Application > Service Workers, or bump `VERSION`.

## Performance notes (headless Chrome, software GL: lower bounds)
- Map during pan and zoom: median frame 16.7 ms (60 fps cadence), p95 83 ms, max 383 ms over 373 frames (SwiftShader).
- Landing: DOMContentLoaded 20 to 300 ms; first contentful paint 60 to 900 ms across runs, about 1.2 s for the very first page load of a fresh browser (browser start-up, not app work).
  WebGL probing, the JSON data and deck.gl start only after first contentful paint (or when Deploy Analysis is hovered, focused or touched).
- Not measured on a real GPU or on touch devices.

## Vendored assets
- deck.gl 9.4.0 UMD, `assets/vendor/deckgl/` (MIT, README with the reproduce command; about 2 MB, loaded lazily after first paint). A custom esbuild core+layers bundle
  was evaluated as optional: it does not affect first paint because the file is loaded after it; build it only if the 2 MB matters on slow networks.
- Geist Sans and Geist Mono variable fonts (OFL), `assets/fonts/` with the licence.

## Tests
```
node --test web/tests/*.test.mjs      # includes contrast-v2, v2-route, v2-compare, v2-explorer, v2-revenue, v2-sw, v2-geo, v2-atlas
.venv/bin/pytest -q                   # pipeline tests (unchanged by v2)
```

## Credits
Hero image: NASA/SDO, AIA 171, 2017-08-21 19:41:46 UT (partial solar eclipse; NASA imagery, public domain). Source at `docs/referencia/sun_full.jpeg`;
`assets/img/hero-sun-{1000,2000}.webp` are composed from it (caption cropped, black lifted to the page black `#0A0A0A`). The credit is in this README and an HTML comment on the landing only.

## Known limitations
- "Solar output at price <= 0" is energy based (`pct_e0`); an hours-based share is not published in the analysis files.
- Area records publish no hour count, so the partial-year note applies to nodes only.
- Not measured on real GPUs or touch devices; the frame-time and paint numbers under "Performance notes" are from software GL and are lower bounds.
- Baja California systems have no analysis data in the current window (dim "no data" dots).

## Placeholders pending Nico
- `CONTACT_EMAIL` in `config.js` (set to nicolas.diaz.naufal@gmail.com).
- Client logos: `assets/img/clients/manifest.json` is empty; the strip shows REPSA, NASA POWER and pvlib as text.
- Landing copy is a draft apart from the approved headline.
