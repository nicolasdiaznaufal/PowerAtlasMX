# web/ — Nodal Solar Value (Phase 4, round 4: the page)

Static, no build, no CDN, English UI. Serve with `python3 -m http.server 8080` from `web/` and open http://localhost:8080
(service worker only on localhost/https; bump `VERSION` in `sw.js` whenever any file changes; current `nsv-v4-deckpalette-2`).
Tests (node >= 20): `node --test web/tests/*.test.mjs`.

## Structure (and why)
One scrolling page with a sticky header, a sticky side rail (wide) or chip bar (narrow), and a persistent **Assumptions** drawer reachable from the header, the rail and every profitability block.
1. **Summary**: logo, the question, five headline numbers, "what to read first". A reader gets the answer in 20 seconds.
2. **The project**: description, tools and data (CENACE PML, NASA POWER, pvlib), the six pipeline steps, questions answered, scope limits. Sets expectations before any chart.
3. **Story in deck order**: Notation, Prices, Explorer, Revenue, Value factor, Map (+ Geography), Profitability, Node P&L, Conclusions. Cream paper cards carry equations and headline blocks; dark panels carry charts, as in the deck.
4. **Node sheet** and **Compare**: the working tools once the story is understood.
5. **Assumptions**: what is pending, what the deck prints, how the sets work.
6. **Methods and appendix** A1-A5 (progressive disclosure, one `<details>` each), the browser formulas, **Sources**.
Print stylesheet switches to a light page and hides controls. Contrast is tested on the real tokens.

## Deck slide -> section
| Deck slide | Section | Data |
|---|---|---|
| 1 Title | `#summary` (+ REPSA logo extracted from the deck) | `analysis.json` windows |
| 2 Notation | `#notation` | KaTeX |
| 3 Prices | `#prices` (deck formula, same controls) | synthetic |
| 4 Explorer | `#explorer`: same controls, charts and tiles; **plus** VF last 12 months and calendar years 2020-2025 | `derived/node_profiles`, `series_*`, `analysis.json explorador` |
| 5 Revenue | `#revenue` | same |
| 6 Value factor | `#vf` (+ mini map) | `analysis.json` |
| 7 Map | `#map` canvas map, regions/states, node dots, hover/click, `#geography` | `analysis_nodos`, `geography.json` |
| 8 Profitability | `#profit` (live from the Assumptions panel) | `analysis_nodos` in a Web Worker |
| 9 Node P&L | `#pnl` | node/area inputs + panel |
| 10 Conclusions | `#conclusions` (five findings computed from the data) | `analysis.json` |
| 11 Assumptions and sources | `#assumptions`, `#sources` | `escenario_deck` quotes |
| 12-16 A1-A5 | `#methods`: chain flow, NASA 1 degree grid map, tilt sketch (interactive), three-source sketch, heat/clipping charts, one-hour chart, shortcut factors | deck equations, project data for A5 defaults |

The "Deck versus this project" section and every deck-vs-ours table/badge are gone. The deck scenario (LCOE 40 USD = 714 MXN/MWh, FX 17.84) is always labelled "Deck scenario".

## Assumption sets (`params.js`, `finmodel.js`, `finworker.js`)
* **Deck scenario**: printed values only; coverage of 714 MXN/MWh, no IRR/NPV (capex, O&M, rate, life not printed), no verdict.
* **My assumptions**: blank until typed, saved in `localStorage` (try/catch). Complete = plant size, capex, O&M, rate, life, degradation, FX (+ inflation on the nominal basis). Only a complete set shows IRR, NPV, own LCOE, break-even PPA (= LCOE), break-even base PML (= LCOE/VF) and the traffic light, always "under your assumptions". `config/supuestos.yaml` stays PENDIENTE and the panel says so.
* Real basis: real rate, prices and costs in constant pesos. Nominal basis: nominal rate, O&M escalates with inflation, price held flat. Formulas in LaTeX under "Formulas this page computes"; unit tests reproduce the deck-scenario coverage counts, regional margins, VF_req and P&L of `analysis.json` exactly.

## Data
`data/index.json`, 20 sheets in `data/nodes/`, `data/analysis/analysis*.json` (copied from `data/analysis`, schema 1.1.0). `data/derived/` is **frontend-built** by `tools/build_derived.py` from `data/aggregates` (same definitions as the analysis; checked against `explorador` and node KPIs in `derived.test.mjs`): hourly profiles of 2,431 nodes for both deck windows, monthly VF (81 months) per node/state/region/national, calendar-year series. `tools/boundaries.py` writes `assets/geo/mx.json` and `derived/geography.json` (see `docs/boundaries.md`).
Vendor: KaTeX 0.16.11, Chart.js 4.4.1, Bricolage Grotesque / DM Sans / DM Mono (OFL). MapLibre was removed: the canvas map needs no tiles.

## Map performance (headless Chrome, 1440 px, 2,605 nodes with coordinates)
| | Old (MapLibre GL, GeoJSON circle layer) | Deck-style SVG (32 paths + 2,605 circles) | New canvas |
|---|---|---|---|
| Build + first paint | map ready 750-1,800 ms after page load (library + style + tiles-free source) | 16 ms | 14 ms |
| Hit test per pointer move | 0.08-0.12 ms (`queryRenderedFeatures`) | 0.17 ms (`elementFromPoint`) | **0.006 ms** (grid index) |
| Full redraw, CPU time | repaint 16.6 ms (vsync-bound) | 16.7 ms incl. forced layout | **0.7 ms** |
| Hover/selection change | 16.6 ms | 16.7 ms (re-set 32 fills) | overlay canvas only (rAF-bound) |
Page-level: lazy init when the section nears the viewport; map section ready in ~12 ms after geometry decode, 5.7 ms to decode and build 32 `Path2D`.
