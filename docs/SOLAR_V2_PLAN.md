# Solar plan for PowerAtlasMx v2: fixed tilt, irradiance, typical year, clear sky

Phase 0 (scope + 10-node pilot), solar agent, branch `solar/fixed-irradiance-plan`. Code: `pipeline/solar_scenarios.py`,
`pipeline/solar_pilot.py`, `tests/test_solar_scenarios.py`. Tags: [verified] / [estimated] (no project source) / [pending].

## 0. Key findings (read first)

1. **Fixed tilt already exists in the pipeline.** `pipeline/solar.py` computes `fixed` and `tracker`;
   `data/aggregates/agregados_config.parquet` holds both configs for all nodes with a baseline (9.3 M rows), and
   every node ficha has `clima.fixed`, `clima.tracker` and `agregados.perfil_y`. Only the *publication* of `fixed`
   is missing (analysis_nodos.json and node_profiles.json are tracker-only by a `config == 'tracker'` filter in
   `kpis.analisis` and `web/tools/build_derived.py`). [verified]
2. **The published `y` is already a typical year.** `y(month, hour)` = mean day of each calendar month over the
   11 full years 2015-2025 (NASA POWER hourly), applied to every real PML hour (`aggregates.py`, "perfil de ano
   tipico"). Y1/Y2 use real PML with typical weather, NOT the weather of that window. `y_f` = sum of `y` over the
   hours that have PML in the window. [verified]
3. **Reproduction is exact.** My run of the same code path gives published tracker AND fixed annual yields with
   0.000 % error on 8 SIN nodes, and rebuilds the published `y_f` (analysis_nodos `deck_2024_25`) to 1e-6. [verified]
4. **`y_f` is not annualised for nodes with gaps.** 03MMN-230 has 7,200 PML hours: published `y_f` = 1,967
   MWh/MWp vs its annual typical yield 2,367 (-17 %); `ingreso` has the same bias (4 nodes have n_horas < 8760).
   kpis/Nico decide whether to annualise or flag. [verified]
5. **BCA/BCS have no solar baseline**: 149 nodes (118 BCA, 31 BCS) lack a NASA cell; 9 cells to fetch
   (23,-110) (24,-111) (25,-112) (26,-112) (31,-117) (32,-118) (32,-117) (32,-116) (32,-115). The pilot
   fetched 2 of them (24 requests, 26 s, no errors) into the worktree's ignored `data/solar_cache/`. [verified]

## 1. How the tracker `y` was built (reused unchanged)

Path: NASA POWER hourly cache -> `solar.load_climate_cell` -> `solar.hourly_pv_power` -> `solar.to_cdmx` ->
`baseline_month_hour` -> `aggregates.py` (join by `clock.ts_cdmx`) -> `kpis._metricas_nodo`.

| Assumption | Value | Status / source |
|---|---|---|
| Climate | NASA POWER hourly API v2, community RE, GHI/DNI/DHI/CLRSKY/T2M/WS2M, UTC, 2015-2026; -999 -> NaN | [verified] `pipeline/nasa_fetch.py`, COVERAGE.json (161 cells) |
| Spatial unit | 1-degree cell, queried at cell centre (floor lat, floor lon); node -> cell | [estimated] legacy check: GHI identical inside cell; NASA native grid is 0.5 x 0.625 deg |
| Baseline years | 2015-2025 (11 full years; 2026 partial excluded) | [verified] solar.BASELINE_YEARS |
| Valid days | only days with 24 valid GHI hours; month needs >= 5 valid days | [verified] |
| Time stamp | start-of-hour UTC; geometry at hour midpoint (+30 min) | [verified] legacy fit vs clear sky |
| Clock | common CDMX standard time UTC-6 fixed, `clock.utc_a_cdmx`; PML join `clock.ts_cdmx(system, fecha, hora)` | [verified] clock-qa |
| DNI/DHI | NASA direct if valid (DHI <= 1.05 GHI + 5), else Erbs | [estimated] |
| Transposition | Perez allsitescomposite1990, albedo 0.20 | [estimated] |
| Tracker | 1-axis horizontal N-S (azimuth 180), backtracking, GCR 0.35, max angle 60 | [estimated] |
| Fixed | azimuth 180, tilt = 0.76*abs(lat) + 3.1 | [estimated], rule has no cited source |
| IAM | ASHRAE b = 0.05 on beam | [estimated] |
| Cell temperature | SAPM open_rack_glass_glass, wind = WS2M x (10/2)^(1/7) | [estimated] |
| Temperature coeff. | -0.35 %/C on Pdc | [estimated] |
| Losses | soiling 2 %, mismatch+wiring 3 %, availability 1 %, inverter 2.5 %, AC/transformer 1.5 % => derate 0.904 | [estimated] |
| DC/AC | 1.0 (no clipping) | [pending] |
| Degradation | 0.5 %/yr, NOT applied to year 1 | [estimated] |
| Elevation | 0 m (substation height unknown) | [estimated] |
| NSRDB; capex/opex/rate | not used; capex/opex/rate live in `config/supuestos.yaml` PENDIENTE | [pending] |

Units: W/m2 (hour mean), kWh/m2, MWh/MWp (= kWh/kWp). CF = MWh/MWp / 8760 (AC per DC MWp).
## 2. Deliverables by feature
### (a) Fixed tilt
Definition: azimuth 180, tilt = 0.76*|lat| + 3.1 (18-28 deg across Mexico), same losses, IAM, temperature model and
DC/AC as the tracker (fair comparison). GCR is n/a (no row-to-row shading modelled for fixed; declared). Checked the
rule against a tilt sweep (0-35 deg) on 4 nodes: the best fixed tilt beats the rule by <= 0.4 % (05ITC-115: rule
2,019 vs 2,025 at 30 deg; 07CHQ-230: 2,008 vs 2,014) so per-node optimisation is not worth its complexity.
**Recommendation: keep the rule, label it "tilt ~ latitude, south-facing", show the tilt value per node.**

### (b) Irradiance outputs (kWh/m2, same typical-year basis as `y`)
- Monthly climatology (12 values): GHI, POA tracker, POA fixed, plus clear-sky GHI/POA = sum_hour(mean W/m2)/1000 x
  days in month.
- Typical day per window (24 values, CDMX hours, day-weighted over the window's months, same weighting as
  `node_profiles.json`): `ghi`, `poa` per config, plus `*_clear`.
- Label "modelled from NASA POWER (MERRA-2, 1 deg cell), not measured"; show POA of the selected config.

### (c) Typical year
Already shipped as `y` (see 0.2). Definition to state in the UI: "mean day of each calendar month, 2015-2025,
by hour" (energy-unbiased, equals the long-term mean). I do NOT recommend a TMY (ISO 15927-4/Sandia typical-month
selection): it needs per-node monthly ranking, produces a different artificial year per node, and our monthly
additive aggregates need the mean day, not a single sampled year. Spread is given by `annual_year_{min,p10,median,max}`
(existing). New optional layer, **"actual weather of the window"**: pilot annual yield with Y1/Y2 weather
(`solar_window_yields.parquet`, exists) vs typical: 01AAN-85 tracker Y1 1,893 vs 1,923 (-1.6 %). Y2 has valid GHI only
to 2026-06-30 in the old cache (333 days); the 2 new cells run to 2026-07-31, so the old cells need a 2026 refresh.

### (d) Clear sky
pvlib Ineichen-Perez with pvlib's monthly Linke-turbidity climatology, elevation 0, then scaled hour by hour to
NASA `CLRSKY_SFC_SW_DWN` (default `nasa_scaled`). Why: pure Ineichen at 0 m is -11 % vs NASA at 05ITC-115 (inland,
high) and +2.5 % at 01AAN-85 (annual GHI clear, kWh/m2: 2,203 vs 2,476 and 2,459 vs 2,399); NASA clear-sky comes from the
same product as the all-sky GHI, so real/clear is internally consistent (cloud loss). Ineichen provides only the
DNI/DHI split. Same plant model and the actual T2M/wind (clear days are slightly hotter, production slightly
overstated, [estimated]). Meaning: an upper bound "every day clear", not a forecast. UI: show cloud loss = 1 - real/clear.

### (e) Output schema (aligned with web/v2)
New lazy files, one per config, same layout as `node_profiles.json` (`windows`, `rows`, `nodes{id:{Y1,Y2}}`):
- `derived/node_profiles_fijo.json`: rows `pml, perdidas, congestion, y` as today but with fixed `y` (pml/perdidas/
  congestion are config-independent: reuse, or ship only `y`).
- `derived/irradiance_tracker.json`, `irradiance_fijo.json`: per node `{Y1:{y_clear[24], poa[24], poa_clear[24]},
  Y2:{...}, m:{poa[12], poa_clear[12], y[12], y_clear[12]}, tilt, y_clear_f, y_f_typ}`; `irradiance_common.json`:
  per node `{Y1:{ghi[24], ghi_clear[24]}, Y2:..., m:{ghi[12], ghi_clear[12]}, ghi_year, source, period, cell}`.
- Precision y 4 dp, kWh/m2 1 dp. Estimated size: ~1.6 KB/node/config + ~0.6 KB common; x 2,431 nodes =
  ~3.9 MB raw, **~1.5 MB gz per config, ~0.6 MB gz common** (< 3 MB target; measured 1.36 KB/node on the pilot arrays).
- Metadata block (shown in UI quality panel): source "NASA POWER hourly v2 (MERRA-2)", period 2015-01..2025-12, cell,
  elevation assumption, tilt rule, clock, `clear_mode`, assumption statuses.
- `analysis_nodos_fijo.json` (same columnar schema, `config: "fijo"`), config-dependent fields only: `p_cap`, `vf`,
  `pct_e0`, `y_f`, `ingreso`, `ingreso_atajo`, `vf_dia_promedio`, `p_cap_real`, `ingreso_real` (+ `ingreso_*` only in
  12-month windows, as today). Config-independent, reuse: `n_horas`, `pml_medio`, `pml_medio_real`,
  `congestion_media`, `spread_punta_solar`. Recompute with `kpis._metricas_nodo` over `ag["fixed"]` (no new solar
  compute; aggregates exist). Optional clear-sky economics (`p_cap_clear`, VF clear) needs new `y_clear` month-hour
  aggregates (24 x 12 per node x config).
- `validador` should test: fixed <= tracker annual yield per node; CF tracker in 15-35 %, fixed/tracker in 0.75-0.92;
  clear >= real daily; sum of 12 monthly = annual; Y1/Y2 typical-day sum x 365 ~ window annual; `p_cap` re-derived from
  `node_profiles_fijo` rows (sum y*pml / sum y) equals `analysis_nodos_fijo` within rounding; -999 never present;
  night hours = 0; VF fijo vs tracker differ by < 0.15 (sanity); kpis config switch does not change pml/n_horas.

### (f) Compute cost for 2,431 nodes
- NASA API: nothing new for SIN (161 cells cached, 837 MB; built with ~1,930 year-requests). Missing: 9 BCA/BCS
  cells x 12 yearly requests = 108 requests (~2 min at 2 threads, 1 s pause; 2 cells took 26 s). Refresh of 2026 for
  161 cells = 161 requests (~5 min). Documented API, 429 -> exponential backoff (`nasa_fetch.fetch_year`,
  <= 4 threads), resumable by cell-year parts under `data/cache/nasa/climatologia/partes`.
- CPU: ~1.0 s per node (4 PV runs + clear sky); 10 pilot nodes 11.6 s total => ~45 min single core, ~8-10 min on 6
  workers. Output + arrays < 20 MB under `data/`. Total wall-clock: **< 30 min** including fetch.
- Effort: ~1 day: batch driver + JSON writers (files < 300 lines), kpis `fijo` table, validador tests.

### (g) Risks and open questions for Nico
1. Fixed tilt rule OK (latitude-based, <= 0.4 % from optimum) or another layout (25 deg, bifacial, DC/AC 1.3)?
   DC/AC=1.0 and losses are [estimated]; they change absolute y, not the ratio.
2. Fixed/tracker ratio 0.82-0.86 (tracker +17-21 %): check against a vendor or NSRDB reference.
3. Typical year = existing 11-year mean day. Confirm that "typical year" does not mean a TMY, or that
   "weather of window" (Y1/Y2 actual) should be an extra toggle.
4. Annualise `y_f`/`ingreso` for nodes with gaps (4 nodes) or flag them? (kpis decision.)
5. NSRDB: Mexico coverage is partial (NSRDB Americas/PSM v3 covers most of Mexico but needs an API key and
   attribution) and has not been used; a 3-5 node contrast (GHI bias) would settle the NASA bias [pending].
6. Licensing/attribution text (to put in the UI): NASA POWER data is public; cite "NASA POWER (MERRA-2/CERES),
   https://power.larc.nasa.gov" and pvlib (BSD-3, Holmgren et al. 2018). Exact required wording [pending, legal].
7. Node coordinates are municipal centroids, not substations (dominant spatial error at 1-degree cells).
8. Clear sky uses elevation 0; adding node elevation (INEGI DEM) would reduce the need for NASA scaling.

## 3. Pilot (10 nodes, `data/solar_cache/pilot/`, not versioned)

| Node | Region | Tracker MWh/MWp | CF | Fixed | Fixed/Trk | Real/Clear (trk) | GHI kWh/m2 | POA trk | POA fix |
|---|---|---|---|---|---|---|---|---|---|
| 01AAN-85 | Central | 1,923 | 22.0 % | 1,647 | 0.857 | 0.718 | 1,870 | 2,275 | 1,954 |
| 03MMN-230 | Occidental (7,200 h) | 2,367 | 27.0 % | 1,966 | 0.831 | 0.826 | 2,182 | 2,819 | 2,349 |
| 08NCM-115 | Peninsular | 1,991 | 22.7 % | 1,666 | 0.837 | 0.797 | 1,964 | 2,472 | 2,072 |
| 05ITC-115 | Norte | 2,402 | 27.4 % | 2,019 | 0.840 | 0.867 | 2,157 | 2,895 | 2,439 |
| 04AAM-115 | Noroeste | 2,344 | 26.8 % | 1,953 | 0.833 | 0.882 | 2,156 | 2,907 | 2,430 |
| 06BRL-115 | Noreste (8,520 h) | 2,186 | 25.0 % | 1,830 | 0.837 | 0.810 | 2,000 | 2,618 | 2,200 |
| 02MCN-115 | Oriental | 1,998 | 22.8 % | 1,679 | 0.840 | 0.737 | 2,030 | 2,383 | 2,008 |
| 08AKD-115 | Peninsular coast | 2,012 | 23.0 % | 1,664 | 0.827 | 0.798 | 1,943 | 2,476 | 2,050 |
| 07BLE-115 | BCS (new cell) | 2,257 | 25.8 % | 1,858 | 0.823 | 0.884 | 2,123 | 2,766 | 2,282 |
| 07CHQ-230 | BCA (new cell) | 2,401 | 27.4 % | 2,011 | 0.838 | 0.928 | 2,166 | 2,968 | 2,491 |

Tracker (and fixed) reproduction error vs published `solar_baselines.parquet`: 0.0000 % on 8 of 8 SIN nodes; `y_f`
rebuilt from `agregados_comunes` hours equals published `y_f` (incl. 03MMN-230, 06BRL-115). Runtime:
~1 s/node. Tests: 13 in `tests/test_solar_scenarios.py` (tracker >= fixed, clear >= real per day, night = 0, CF, seasonal
shape, clock shift with longitude, NaN not zero, window weighting, units); with `test_solar.py` all pass.
All tracker CF in the 22-30 % Mexican band, fixed 19-23 %.
Next (after 2.g): fetch 9 cells + 2026 refresh, batch driver, JSON writers, kpis `fijo`, validador, TECNICO A1-A5.
