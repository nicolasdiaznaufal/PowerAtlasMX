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

## Numbers
All figures are published fields (`analysis_nodos.json`, `analysis.json`, `series_*.json`). Explorer, Revenue and compare read the same record
(`explorer-data.js`), so a number cannot differ between views. Revenue bars follow the typical day and are scaled to the published yearly `ingreso`;
the page states the gap. Prices are the MDA reference price (CENACE): no capacity, CEL or contracts. Nodes with fewer than 8,760 priced hours in a window show a
"Partial year" note; nothing is annualised.

## Service worker
`/v2/sw.js`, scope `/v2/`, registered after load. App shell, fonts and hero: stale-while-revalidate. Data JSON: network first, the cached copy is used only offline.
Navigations: network first (with navigation preload), cached shell or `offline.html` offline. Bump `VERSION` in `sw.js` on every shell release; old caches are deleted on activate.
v1's `web/sw.js` ignores `/v2/` URLs. During development, unregister via DevTools > Application > Service Workers, or bump the version.

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
- Not measured on real GPUs or touch devices; frame times in the notes below are from software GL.
- Baja California systems have no analysis data in the current window (dim "no data" dots).

## Placeholders pending Nico
- `CONTACT_EMAIL` in `config.js` (set to nicolas.diaz.naufal@gmail.com).
- Client logos: `assets/img/clients/manifest.json` is empty; the strip shows REPSA, NASA POWER and pvlib as text.
- Landing copy is a draft apart from the approved headline.
