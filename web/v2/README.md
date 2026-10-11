# PowerAtlasMx by REPSA Group, web v2 (`web/v2`)

A second, separate web app. v1 (`web/index.html`) is frozen at tag `v1-deck-page` and keeps working at `http://localhost:8080/#pnl`.
No framework, no CDN, no build step: plain ES modules, plain CSS, vendored fonts and deck.gl.

## Run
```
cd web && python3 -m http.server 8080
open http://localhost:8080/v2/
```
The app is a static site; any static server that serves `web/` works (the app reads `../data/...` and `../assets/...` relative to `/v2/`).

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

## Roadmap (not built)
Tracker vs fixed tilt, irradiance, typical year and clear sky are held for a later solar brief: no UI beyond the disabled "Fixed tilt" option.

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
- Mounting configuration: the analysis files cover the single-axis tracker only; it is shown as a label, not a switch.
- "Solar output at price <= 0" is energy based (`pct_e0`); an hours-based share is not published in the analysis files.
- Area records publish no hour count, so the partial-year note applies to nodes only.
- Not measured on real GPUs or touch devices; the frame-time and paint numbers under "Performance notes" are from software GL and are lower bounds.
- Baja California systems have no analysis data in the current window (dim "no data" dots).

## Placeholders pending Nico
- `CONTACT_EMAIL` in `config.js` (set to nicolas.diaz.naufal@gmail.com).
- Client logos: `assets/img/clients/manifest.json` is empty; the strip shows REPSA, NASA POWER and pvlib as text.
- Landing copy is a draft apart from the approved headline.
