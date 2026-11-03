# PowerAtlasMx / Nodal Solar Value: project context for Claude Projects

Single-file briefing of everything built so far. Upload this file as Project knowledge. It is kept in sync with the repo (see section 12). Repo: https://github.com/nicolasdiaznaufal/PowerAtlasMX (branch `v2/poweratlas`). Owner: Nico, REPSA Group. Internal tool, possible future sale.

## 0. How to use this file (instructions to the receiving Claude)

1. Treat sections 1 to 9 as ground truth about methods and results. If a user asks for a number not here, say it must be read from the repo files in section 11; never invent one.
2. Always state the caveats in section 8 when quoting a result (MDA reference price only, modelled not metered production, node averages, provisional business inputs).
3. Never present a green/red viability verdict: business inputs (discount rate, capex, opex, FX, thresholds) are `PENDIENTE`. Say "under your assumptions" when the user supplies them.
4. Clock: all hours are Mexico City standard time, fixed UTC-6, hour-beginning. Never use `(fecha, hora-1)` as the standard hour.
5. Typical applications: explain a node's value factor; compare places; screen sites for solar or battery; draft methodology text; design new KPIs or API consumers; review a number for consistency with the pipeline.
6. UI/copy language is English. Older internal docs are in Spanish.

## 1. What the project answers

How much is a solar plant's electricity worth at a given place in Mexico, and why does it differ from the average price? Solar produces at midday, when prices tend to be low, so the **captured price** is below the all-hours average. **Value factor (VF) = captured price / average price.** VF 0.80 means a 20% discount against flat output. Extensions: battery arbitrage screening and a national site score for solar and for batteries.

## 2. Data

| Item | Detail |
|---|---|
| Prices | CENACE day-ahead (MDA) hourly PML and components (system energy, losses, congestion), 2020-01-01 to 2026-09-30, no missing days. 151,050,393 node-hours. Systems SIN, BCA, BCS. |
| Nodes | 2,431 nodes in the KPI universe (SIN). BCA and BCS are converted to the common clock but outside the KPI universe. Valid node = at least 12 months of data. |
| Solar resource | NASA POWER hourly (MERRA-2 / CERES SYN1deg), 170 grid cells, 2015 to 2026-07-30. Model estimates, not station data. |
| Plant model | pvlib-python: single-axis tracker or fixed tilt (0.76 x abs(lat) + 3.1 deg), DC/AC 1.0, derate 0.904 (estimate). Weather fixed to 2015-2025 mean; also real-year and clear-sky variants. |
| Inflation | INPC (Banxico), base 2026-09. "Today's pesos" view; nominal MXN is the default. |
| Windows | Last 12 months (Aug 2025 to Jul 2026), previous 12 months (Aug 2024 to Jul 2025), full history. Nodes with under a year in a window are flagged, never annualised. |
| Not included | Capacity, clean-energy certificates (CEL), contracts, MTR market. |

Raw data traps: CSV headers lie about the month (use the `Fecha` column); 23/25-hour days are legitimate (7,946 rows with `hora = 25`); six node codes were retired and renamed (e.g. 03DEA-230 to 03DEC-230); one node (SIN 03EGM-230) has a 177-day gap in 2023.

## 3. Clock decision (blocking convention)

Common clock = CDMX standard UTC-6, fixed all year, hour-beginning. In SIN it coincides with the SIN standard hour. SIN/BCS 2020-2022 and BCA 2020-2026 use civil daylight-saving time in `hora`, so `hora` runs 1 h ahead of standard in summer periods. `pipeline/clock.py` (`ts_local_estandar`) is the only allowed conversion; tests are per date.

## 4. Pipeline (all in `pipeline/`, tests in `tests/`)

CSV portal to Parquet/DuckDB (`ingest_portal.py`, `build_duckdb.py`) then `clock.py` then `quality.py` (flags only, nothing dropped) then `solar.py` family (`solar_full.py`, `solar_variants.py`, `solar_scenarios.py`, `nasa_fetch.py`, `solar_qa.py`) then `aggregates.py` (additive monthly sums) then `kpis.py` / `kpis_variants.py` then daily series (`daily_series.py`, `daily_build.py`, `daily_gates.py`) then scores (`geo_score.py`, `grid_saturation.py`, `battery_metrics.py`, `battery_score.py`, `export_scores.py`).

**Additive aggregates** are the key design: per node, month and hour-of-day, store sums not means (sum of y*PML, sum y, sum PML, n, sum of y where PML <= 0, component sums). Any month range is then combined exactly in the browser. Validated against full hourly data on 10 nodes (relative error <= 1e-12) and 3 hand-computed synthetic nodes.

## 5. Metric definitions

- **Average price**: mean PML, all hours of the window. **Captured price**: PML weighted by solar output (MWh-weighted). **VF**: captured / average.
- **Area values** (state, region, nation): mean over member nodes; area VF = ratio of means, not mean of ratios. Not generation-weighted.
- **% solar output at PML <= 0**: share of solar energy produced in zero/negative-price hours.
- **Evening peak minus solar hours**: mean price of the highest evening hours minus mean in solar hours.
- **Revenue per MWp** = yield (MWh/MWp) x captured price.
- **Daily series**: 7-day trailing ratio (revenue over energy); days under 12 valid hours are dropped; very low-price weeks are hidden from the VF display.
- **LCOE and margin**: computed in the browser only after the user enters a full set of inputs (size, capex, O&M, discount rate, inflation, life, degradation, FX). Compared in today's pesos (INPC) for the main test; nominal fields are kept for deck comparison.
- **What-if sliders**: price shift, midday dip, solar yield change; result = published value x (scenario typical day / baseline typical day). Neutral sliders reproduce the published figure exactly.
- Window rule: complete year/month needs 100% of hours; edge months are never complete; trends need at least 3 years; "median" means the lower median.

## 6. Key results (SIN valid nodes, full period 2020-01 to 2026-09)

| | Fixed tilt | Tracker |
|---|---|---|
| Base price, median (p5 to p95) | 827 (517 to 1,087) MXN/MWh | same |
| Captured price, median | 732 (380 to 929) | 740 (399 to 935) |
| VF, median | 0.885 (0.718 to 0.920) | 0.896 (0.763 to 0.927) |
| % energy at PML <= 0, median (p95) | 0.41% (3.4%) | 0.37% (2.9%) |
| Revenue per MWp-year, worst / median / best year | 1.06 / 1.23 / 2.02 M MXN | 1.26 / 1.48 / 2.45 M MXN |

Best year is almost always 2022 (high prices); worst is 2020 or 2025. Deck LCOE reference: 40 USD at 17.84 MXN/USD, about 714 MXN/MWh. Share of nodes whose captured price covers that LCOE, in today's pesos: 80.6% full period, 34.5% Aug 2024 to Jul 2025, 5.2% Aug 2025 to Jul 2026 (nominal: 62.2%, 31.6%, 4.9%). Inflation matters most in 2020-2023. The 2015 weather year is about 6% below the 2015-2025 mean. Extra figures live in `docs/TECNICO.md` sections 7, 11 to 13.

## 7. Scores and battery (PROVISIONAL, no verdict colour)

- **Solar score** (`config/solar_score.json`): weights land 0.20, resource 0.20, market 0.20, congestion 0.15, terrain 0.15, grid 0.10. Land screen: 15 km buffer, slope max 7%, min patch 100 ha. Scales: land 200 to 5,000 ha, resource 1,600 to 2,000 kWh/kWp, grid 0.5 to 10 km, congestion years 2023 to 2025.
- **Battery** (`pipeline/battery_metrics.py`, `battery_score.py`, `config/battery_score.json`): standalone MDA arbitrage screening. Rule-based and out of sample (charge/discharge hours chosen per month on train years 2023 to 2024, applied to test year 2025, no look-ahead). Perfect-foresight spread shown only as an upper bound. RTE 0.85 (re-priceable, charge/discharge totals are kept), illustrative costs 4,500 MXN/kW power, 3,800 MXN/kWh energy, O&M 1.5%, life 15 y, rate 10%. Weights: value 0.30, spread 0.15, predictability 0.15, negative 0.15, congestion volatility 0.10, grid 0.15. Substation saturation is verified only when name, kV and CFE zone all match.
- Weights and economics are editable in the UI; the UI shows a no-data card for nodes below the 12-month rule.

## 8. Caveats to quote

MDA reference price only (no contracts, capacity, CEL). Production is a modelled ideal plant; plant parameters are estimates. Node location = municipality centroid. Typical day, revenue and economics exist per 12-month window; other spans use the window containing the span end and say so. NASA data end 2026-07-30 while prices run to 2026-09-30. Production profile is a climatological month x hour profile applied to real prices, which ignores same-year weather/price correlation. Storage regulation (30%/3h rule) is scenario-only until official text is verified.

## 9. Business state (internal)

All of these are `PENDIENTE` in `config/supuestos.yaml` and block any verdict: discount rate (real), plant life, capex, opex, degradation (reference 0.005), FX, traffic-light metric and thresholds, scenario multipliers (base, conservative, crisis). Open M18 decisions: data licensing for redistributing derived CENACE aggregates, raw hourly exposure (default no), API key issuance and rate limits, public vs password-gated `/llms.txt`.

## 10. Product and architecture

- **Web v2** (`web/v2/`, dark Vercel look, English): landing, deck.gl 2D map, place selector, Explorer, Revenue, Compare up to 3, Score full-bleed map with click/clear/compare of 2 places, battery economics editor, no-data card, scenarios, daily profiles, PWA/service worker. v1 (`web/` outside `web/v2/`) is frozen at tag `v1-deck-page`.
- **Hosting**: Cloudflare Pages (`wrangler.toml`, project `poweratlasmx`) with a shared-password Pages Function (`functions/_middleware.js`) that protects HTML and data JSON. Secrets never go in git.
- **Data contract**: `index.json` and `nodes/{id}.json`, schema 1.2.0 (`docs/TECNICO.md` section 6). Data folders (`data/`, `web/data/`) are git-ignored.
- **M18 (planned, `v2-m18-agent-api`)**: read-only JSON API under `functions/api/v1/`, OpenAPI 3.1 and `/llms.txt`, per-user bearer keys in KV, coverage test (every UI metric has an endpoint field), parity test, independent recomputation by `validador`, agent eval of 30+ questions with pass rate >= 95%, correction loop through `docs/CORRECCIONES.md` and `corrections_version` in `/meta`. Spec: `docs/M18_AGENT_API.md`. We host data, never an LLM.
- **Agents** (`.claude/agents/*.md`): orquestador, ingest, clock-qa, calidad, solar, kpis, validador, frontend, devops. Each owns its folders.

## 11. Where to find things (read excerpts only)

| Need | File |
|---|---|
| Plain-language method for readers | `docs/POWERATLAS_V2_REPORT.md` |
| Formulas, schema, validation, deck analysis | `docs/TECNICO.md` (about 67 KB, grep headings) |
| Master workflow and decisions | `workflow-app-nodal-solar.md`, `workflow.solar.md` |
| Web build brief and milestones | `docs/POWERATLAS_V2_BRIEF.md` |
| Solar variants plan | `docs/SOLAR_V2_PLAN.md` |
| Data corrections log | `docs/CORRECCIONES.md` |
| Credits | `docs/CREDITS.md` (NASA POWER, pvlib-python) |
| Business inputs | `config/supuestos.yaml` |

## 12. Sync protocol (keep this file current)

- Update this file in the same commit as any significant change: new milestone tag, new or changed KPI/formula, new data window, new source, changed assumption, scoring weight or config change, deployment or API change, new correction in `CORRECCIONES.md`.
- Edit the affected narrative section by hand, then run `python3 tools/sync_context.py` (rewrites the AUTO block). `python3 tools/sync_context.py --check` exits 1 when the source docs/configs changed since the last sync.
- Rule is recorded in `CLAUDE.md`. Re-upload the file to the Claude Project after each milestone.
- Never put passwords, API keys, tokens or raw data in this file.

## 13. Sync status (auto)

<!-- AUTO:BEGIN -->
- Last sync: 2026-11-03 at commit `a292f51` (branch `v2/poweratlas`)
- Latest milestone tag: `v2-m17-score-2` (27 v2 tags)
- Source fingerprint: `97e671b63db9`
- Milestone tags (oldest first): v2-m1-landing, v2-m2-map, v2-m3-flow, v2-m3-flow-r2, v2-m4-explorer, v2-m5-revenue, v2-m6-compare, v2-m7-polish, v2-m7-polish-r2, v2-m7-polish-r3, v2-m8-ui, v2-m9-scenarios, v2-m9-scenarios-r2, v2-m10-solar, v2-m10-solar-r2, v2-m10-solar-r3, v2-m10-solar-r4, v2-m11-daily, v2-m11-daily-r2, v2-m12-v1-parity, v2-m13-corrections, v2-m14-timetoggle, v2-m14-leftcolumn, v2-m15-fixes, v2-m16-tweaks, v2-m17-score, v2-m17-score-2
<!-- AUTO:END -->
