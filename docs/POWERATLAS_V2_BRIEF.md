# PowerAtlasMx by REPSA Group: v2 web build brief

Owner agent: `frontend`. Goal: a second, separate web version. v1 stays untouched and keeps working at `http://localhost:8080/#pnl`.
Everything below was decided by Nico; items marked **[assumed]** are my reading, change them if wrong.

## 0. Scope and layout
- New app in `web/v2/`, served by the same server (`python3 -m http.server 8080` from `web/`) at `http://localhost:8080/v2/`. v1 at `/` is not edited. **[assumed]** "keep #pnl" = v1 stays reachable, v2 does not rebuild P&L.
- v2 reads the existing data at `../data/...` (no copies). Do not generate new data unless a missing field forces it.
- Reuse v1 pure modules by `import '../assets/js/<file>'` after checking each has no DOM/KaTeX dependency: `data-pure.js`, `format.js`, `fmt.js`, `names.js`, `mapmetric.js`, `sec-map-pure.js`, `engine.js`, `calc.js`, `contract.js`, `worker.js`. Port only chart/DOM code.
- One v1 file may change: `web/sw.js`: add `if (url.pathname.startsWith('/v2/')) return;` at the top of the fetch handler and bump `VERSION`. Do not register a service worker in v2 until the last milestone.
- Out of scope now: equations/KaTeX, IRR/NPV/LCOE/verdict, P&L, assumptions panel, PDF export, PWA install, 3D, any new analysis.

## 1. Step 0: git (before any code)
Repo has **zero commits and no remote**. Do this first, in order:
1. `git status --short`; confirm `data/`, `.venv/`, `*.duckdb` are ignored (note: `.gitignore` entry `data/` also ignores `web/data/`; leave it, so v1/v2 need `web/tools/build_derived.py` + copying `data/analysis/*.json` to regenerate. Document this in `web/v2/README.md`).
2. Set `user.name`/`user.email` only if empty (ask Nico). Create branch `v2/poweratlas` after the baseline.
3. Baseline commit of everything tracked-able: `v1 baseline (deck page, pipeline, agents)`. Tag `v1-deck-page`.
4. GitHub remote: needs Nico's decision on repo name and visibility (recommend private). If `gh` is authenticated, `gh repo create <name> --private --source . --push`; otherwise stop and tell Nico the exact command. Push after every commit, and push tags at each milestone.

## 2. Product, tone, copy
- Name: **PowerAtlasMx** · "by REPSA Group". Tone: business, direct, fluid. No academic phrasing, no notation, short labels, plain-word units ("MXN/MWh", "hours at or below zero").
- Landing copy is a draft for Nico to approve: headline "Solar value, node by node." Right-side stamps (mono, uppercase): `2,431 NODES` · `HOUR-BY-HOUR PRODUCTION × PRICE` · `LAST 12 MONTHS, EVERY REGION`.
- Buttons: **Deploy Analysis** (primary), **Talk to Sales** (ghost). Talk to Sales opens a small modal that composes a `mailto:` to `CONTACT_EMAIL` in `web/v2/config.js`; empty value = button disabled with tooltip. Needs Nico's address.
- Logo strip under the hero: REPSA clients + NASA POWER + pvlib. `assets/img/pvlib-logo.png` and `repsa-logo.png` exist in v1; client logos are an input from Nico: render whatever is listed in `web/v2/assets/img/clients/manifest.json`; until supplied, show REPSA, NASA POWER, pvlib only. Never invent or scrape client logos. Logos grayscale at ~60% opacity, full on hover.

## 3. Visual system: Vercel, dark
Reference: `docs/referencia/vercel-hero-ref.png` (layout and feel), `docs/referencia/Vercel_Design.md` (rules; read only "Components" and "Do's and Don'ts"; its theme is light, so invert it). Keep what is stable from the Vercel rules, translated to dark:
- Surfaces by tonal step, not shadow: canvas `#0B100D` (darker than v1 `--stage`), surface `#111813`, raised `#18211B`. Hairline rings: `box-shadow: 0 0 0 1px rgba(240,232,210,.10)`; stronger `.18`. No drop-shadows on UI.
- Ink: reuse v1 `--ink #F0E8D2`, `--ink-2 #C3BEA9`, `--ink-3 #9C9985`. Single accent = the eclipse sand/amber (reuse v1 `--orange-text #E8A266`; logo uses the same hue). No other chroma except the three series colours below and map ramp.
- Type: **Geist Sans** (400/450/500) and **Geist Mono** (11-12px, uppercase, 0.071em tracking, for every label, unit, eyebrow, stamp). Hero 56-64px, weight 450, tracking -0.06em, line-height 1.0. Body 14-16px. Vendor Geist as local woff2 (OFL, npm `geist` package) in `web/v2/assets/fonts/`; no CDN. v2 does not load v1 fonts.
- Radius 6px (cards, inputs); hero CTAs and nav actions are pills (9999px) as in the reference. 4px spacing grid, content max-width 1280px.
- Series colours for compare (always also distinguishable by line style/marker): 1 sand `#E8A266`, 2 cream `#EDE6D0`, 3 sage `#8DA892` (v1 `--c-losses`).
- Tokens in `web/v2/assets/css/tokens.css`; add `web/tests/contrast-v2.test.mjs` (copy the v1 test, point at v2 tokens). Text >= 4.5:1, UI marks >= 3:1.
- Motion: durations 350-600ms, `cubic-bezier(.2,.8,.2,1)`; animate only `transform`/`opacity`; stagger children 40ms; `prefers-reduced-motion` = instant swaps.

## 4. Eclipse logo
Inline SVG, no raster. Match `docs/referencia/eclipse-logo-ref.png`: sand disc offset left over a darker, slightly larger crescent ring, with two rings of tapered rays (long/short alternating) radiating around it.
- Nav version: flat mark, 24-28px, wordmark "PowerAtlasMx" Geist 500 14px beside it.
- Hero version (like the Vercel triangle): large mark floating on the canvas with a soft radial glow behind the lit edge, a faint contact shadow under it, fine film grain on the glow (SVG `feTurbulence` or a small tiling PNG at 4-6% opacity). Idle motion: glow breathes (8s), rays drift (<= 1 deg/s). The mark scales up and dissolves during the Deploy Analysis transition.
- Also export `assets/icons/eclipse.svg` (flat) for later favicon/PWA use.

## 5. Flow and routes (hash routes, back button works)
`#/` landing → `#/map` → `#/choose` → `#/explorer` or `#/revenue`. Selection lives in the query: `#/explorer?sel=01AAN-85,state:JALISCO,national`.
1. **Landing**: hero as in the reference. Deploy Analysis → transition.
2. **Map** (full-page, behind everything): see §6. Header keeps a small nav; a floating left panel (Vercel card) has the selector and metric switch.
3. **Choose**: after a selection is confirmed ("Continue" or double click), the map eases to centre the selection and two large cards appear: **Explorer** and **Revenue**, one-line descriptions, keys 1/2.
4. **Analysis**: the SAME map element (never remounted) animates to a card in the top-right (~340x240, FLIP via transform, resize deck at the end), the chosen view fills the page. Clicking the mini-map returns to `#/map` with the reverse animation.
5. Use `document.startViewTransition` for page-level swaps with a plain opacity/transform fallback. Landing→Map: crossfade with the hero mark scaling up as a portal. Map→Choose: map fly-to (`transitionDuration` 700ms).

## 6. Map (deck.gl, 2D only)
- Vendor the official `deck.gl` 9.x UMD bundle in `web/v2/assets/vendor/deckgl/` with LICENSE and a README noting the exact version. No CDN. If the bundle is too heavy, build a custom `@deck.gl/core + layers` bundle once with esbuild, commit the output, document the command.
- `MapView`, no basemap tiles, canvas background = canvas colour. Controller on: wheel/pinch zoom, drag pan, double-click zoom; also on-screen `+`, `−`, reset buttons. Clamp zoom to Mexico bounds. Camera animates with `transitionDuration`.
- Geometry: `web/assets/geo/mx.json` is pre-projected (ints = px×10, plate carrée). Convert to lon/lat once at load (inverse of the projection in `data/derived/geography.json` → `projection`: `lon = lon0 + x/px_per_deg_lon`, `lat = lat0 − y/px_per_deg_lat`, using the file's own scale for the ×10) and cache as GeoJSON in memory. Verify with 5 known nodes. Keep states (hairline) and regions (stronger outline) as `GeoJsonLayer`.
- Nodes: `ScatterplotLayer`, lon/lat from `data/index.json` → `nodos[].lat/lon` (2,659 nodes; plot those in the 2,431-node analysis universe, others as dim grey "no data" dots). Radius in pixels scaling with zoom; colour by metric through the v1 ramp logic in `mapmetric.js`, re-tuned for the darker canvas (ramp: `#1E2B23` low to `#EDE6D0` high).
- Metrics (last 12 months = `analysis_nodos.json → ventanas.deck_2025_26`, Aug 2025 to Jul 2026, same as `windows.Y2`), arrays indexed by `ids[]`: **Average price** = `pml_medio`, **Captured price** = `p_cap`, **VF** = `vf`, **VF rank in region** = rank of `vf` among nodes with the same `region[]` (1 = best), computed at load. Label the window on screen. Default metric: VF.
- Mounting config: default is `index.json → config_defecto` (`tracker`). Check which configs `analysis_nodos.json` covers before building a Tracker/Fixed switch; if map metrics exist for one config only, show it as a static label.
- Hover tooltip (Geist Mono labels): node name, id, state, region, the four metrics. Click selects (max 3, see §8). Selected nodes get a sand ring.
- If WebGL is unavailable: show a short message and keep the selector working.

## 7. Selector
Searchable combobox, keyboard-operable, ARIA-labelled, in the left panel and reused in the analysis header. Levels: **National**, **Region**, **State**, **Node** (type to search id/name/municipality). Reuse v1 `common.js` `Picker` logic if it is DOM-light, otherwise port. Choosing a region/state flies the camera to its bounds and highlights its nodes; clicking a region/state polygon on the map does the same. Clicking a node adds it.

## 8. Compare (up to 3, both views)
Slots hold any mix of node / state / region / national. Chips with series colour + remove; "+ Add" opens the selector. Averages come from `data/derived/series_areas.json` (`areas.ALL`, `areas.region`, `areas.state`; same definition as v1: ratio of node averages over complete months). Nodes come from `node_profiles.json` + `series_nodes.json`. Both views overlay the series and end with a compact comparison table (one row per slot).

## 9. Views (same data as v1, restyled, no equations)
Before coding each view, open the v1 section and copy its behaviour: `grep -n "initExplorer\|initRevenue" web/assets/js/*.js`, read only those functions.
- **Explorer**: what v1 `#explorer` and `#vf` show: typical-day price profile (energy / losses / congestion), headline tiles (average price, captured price, VF, % hours at or below zero, solar-vs-peak spread), monthly VF series (81 months) and calendar years. Default window: last 12 months.
- **Revenue**: what v1 `#revenue` shows: hour-by-hour production × price for the typical day, the revenue it adds up to per MWp per year (`ingreso`; real-pesos toggle uses `ingreso_real`), with the same units v1 prints. Same data, different lens: Revenue must never show a number that disagrees with Explorer for the same node and window.
- Data loading: load `index.json` and `analysis_nodos.json` at the map; lazy-load `node_profiles.json` (2.9 MB) and `series_*.json` on first analysis visit, prefetch on idle after the landing. Heavy math in a worker (reuse v1 `worker.js`).

## 10. Milestones (each = commit(s) + tag + push + screenshot check)
Verify visually at 1440×900 and 390×844 before each commit (headless Chrome/Playwright or Claude in Chrome), screenshots to `docs/shots/v2/` (gitignored is fine).
- **M0** git baseline, tag `v1-deck-page`, remote (§1).
- **M1** `v2-m1-landing`: tokens, fonts, logo, nav, hero, logo strip, contrast test.
- **M2** `v2-m2-map`: deck.gl map, zoom, hover, metric switch, selector, selection (1-3).
- **M3** `v2-m3-flow`: routes + all transitions (landing→map→choose→analysis, mini-map FLIP, back). Ask `validador` to review motion/regressions here.
- **M4** `v2-m4-explorer`, **M5** `v2-m5-revenue`, **M6** `v2-m6-compare`.
- **M7** `v2-m7-polish`: performance (map at 60 fps, first paint of landing < 1 s locally), a11y pass, reduced motion, README, full test suite green.

- **M18** `v2-m18-agent-api` (goal, not started): read-only agent API + OpenAPI + per-user keys, with parity/eval correctness report and correction loop. Spec: `docs/M18_AGENT_API.md`.

## 11. Inputs needed from Nico (do not block on them)
`CONTACT_EMAIL` · REPSA client names/logos · GitHub repo name/visibility · approval of landing copy · confirm the §0 reading of "keep #pnl".
