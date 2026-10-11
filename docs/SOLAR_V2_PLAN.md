# Solar plan for PowerAtlasMx v2: fixed tilt, irradiance, yearly mean, weather variants, clear sky

Status: solar stage DONE for all 2,605 nodes with coordinates (stage 1 of solar -> kpis -> validador). Owner: solar agent.
Code: `pipeline/solar_variants.py` (variants), `solar_full.py` (batch), `solar_qa.py` (QA/manifest),
`solar_scenarios.py` (clear sky, POA), `solar_pilot.py` (Phase 0). Tests: `tests/test_solar_{variants,scenarios}.py`.
Tags: [verified] / [estimated] (typical value, no project source) / [pending].

## 0. Key facts
1. `fixed` was already computed (aggregates hold both configs); only its publication was missing. [verified]
2. Published `y` = **Yearly mean**: mean day of each calendar month x hour over 2015-2025, applied to every real PML
   hour. Y1/Y2 = real PML with yearly-mean weather. `y_f` = sum of `y` over the window's PML hours. [verified]
3. Gap nodes (n_horas < 8760) are NOT annualised (Nico's decision): `y_f`/`ingreso` stay as published; new fields
   `n_horas` and `yf_annual_equiv` (variant's 12-month yield, information only) travel beside them.
4. Credits (UI + docs/CREDITS.md): "Solar resource: NASA POWER (MERRA-2 / CERES SYN1deg), long-term climatology;
   PV model: pvlib-python." NSRDB contrast skipped by decision (no GHI bias estimate: [pending]).

## 1. Assumptions (all reused from `solar.PlantAssumptions`, none new for fixed)
| Assumption | Value | Status |
|---|---|---|
| Climate | NASA POWER hourly v2 community RE, GHI/DNI/DHI/CLRSKY/T2M/WS2M, UTC; -999 -> NaN | [verified] |
| Spatial unit | 1-degree cell queried at centre; node = municipal centroid (not substation) | [estimated] |
| Years | mean: 2015-2025 pooled valid days (day valid = 24 GHI hours); 2026 only through `win` | [verified] |
| Clock | CDMX standard UTC-6 fixed (`clock.py`); geometry at hour midpoint (+30 min) | [verified] |
| DNI/DHI, transposition | NASA direct else Erbs; Perez allsites; albedo 0.20 | [estimated] |
| Tracker | 1-axis N-S, backtracking, GCR 0.35, max 60 deg | [estimated] |
| Fixed | azimuth 180, tilt = 0.76*abs(lat)+3.1 (accepted by Nico); within 0.4 % of per-node optimum (sweep, 4 nodes) | [estimated] |
| IAM / temperature | ASHRAE b=0.05; SAPM open_rack_glass_glass, wind 2 m -> 10 m (1/7); gamma -0.35 %/C | [estimated] |
| Losses | soiling 2, mismatch 3, availability 1, inverter 2.5, AC 1.5 % (derate 0.904), same for both configs | [estimated] |
| DC/AC, degradation, elevation | 1.0 (accepted); 0.5 %/yr not applied; 0 m | [estimated] |
| Variant thresholds | single year needs >= 15 valid days in each of 12 months; `mean` >= 5 per month | [estimated] |
| Capex/opex/rate | `config/supuestos.yaml` PENDIENTE (not solar's) | [pending] |
Units: W/m2 (hour mean), kWh/m2, MWh/MWp (= kWh/kWp). CF = MWh/MWp / 8760.

## 2. Weather variants (selector in UI)
| id | Meaning | Table |
|---|---|---|
| `mean` (default) | "Yearly mean": 2015-2025 mean day per month x hour (= published) | 12x24 |
| `y2015`..`y2025` | same construction using only that calendar year's actual weather | 12x24 |
| `win` | weather of each actual month of the windows (Aug 2024..Jul 2026), mean day of that month | 24x24 (year-month x hour) |
| `clear` | clear sky (extra sky option, not a weather year) | 12x24 |
Partial 2026 (Jan..Jul valid, NASA lag): NOT a selectable year (needs 12 months); it only enters `win`
(Y2 = Aug 2025..Jul 2026; Jul 2026 is complete in the refreshed cache). A year-variant with any month < 15 valid days
is NaN for that node (0 nodes affected). Y1/Y2 under `yYYYY` = "that year's weather applied to the window's months and
real PML". Hour values inside a month are the month's mean day (additive aggregate machinery unchanged).

## 3. Clear sky and irradiance
Clear sky: pvlib Ineichen-Perez + Linke monthly, elevation 0, scaled hour by hour to NASA CLRSKY (pure Ineichen is
-11..+2.5 % vs NASA at the pilot nodes), real plant model, real T2M/wind (production slightly overstated) [estimated].
Irradiance (kWh/m2): GHI, POA tracker, POA fixed, each also clear; monthly climatology (12) and typical day per window
(24, day-weighted). `win`: monthly Aug..Jul per window (`mY1`, `mY2`).

## 4. Outputs (main checkout `data/solar_v2/`, git-ignored, new files only) and measured sizes
| File | Content | Size (raw / gz) |
|---|---|---|
| `tables_month_hour.parquet` | nodo, config (tracker/fixed), variant, key (month 1..12 or yyyymm), nd, y[24] float64: **exact** compact basis for kpis; 937,800 rows | 64 MB |
| `scalars.parquet` | nodo, config, variant, window (Y1,Y2,Y1aj,Y2aj), n_horas, y_f, yf_annual_equiv; 291,760 rows | 1 MB |
| `scalars.json` | web lazy: per node {n:{window}, tracker/fijo:{variant:{yf:{4 windows}, eq:{Y1,Y2}}}} | 8.1 MB / 1.08 MB |
| `variants/{variant}.json` x 14 | per node: y 24-h profile Y1/Y2 for tracker+fijo (n_horas-weighted, same as node_profiles `y`) + irradiance (ghi, poa_tracker, poa_fixed: m, Y1, Y2) | 4.4-5.1 MB / 0.44-0.77 MB each (win 0.77, clear 0.48) |
| `qa.json`, `manifest.json`, `run_raw_qa.json` | QA, checksums, versions, cells, requests | small |
Web budget: first load `scalars.json` (1.1 MB gz) + the selected variant (~0.45 MB gz); the other variants load lazily.
Config key in web JSON is `fijo`; parquet uses `fixed` (kpis convention).

## 5. Hand-off to `kpis` (stage 2)
Replace the baseline `y(mes,hora)` by the variant table in the aggregates join: key (month, hour) for `mean`, `yYYYY`,
`clear`; key (year-month, hour) for `win`. Per node x config x variant recompute (sums exact in the browser as today):
`p_cap = sum(y*pml)/sum(y)`, `vf = p_cap/pml_medio`, `pct_e0`, `y_f = sum(y)`, `ingreso = sum(y*pml)`, `ingreso_atajo =
y_f*pml_medio`, `vf_dia_promedio`, `p_cap_real`, `ingreso_real`. Config/variant-independent (reuse): `n_horas`, `pml_medio`,
`pml_medio_real`, `congestion_media`, `spread_punta_solar`. `y_f` must equal `scalars.parquet` for Y1/Y2 (reconciliation).
The `completo` window must be rebuilt from `tables_month_hour` (not in scalars). Do not annualise `y_f`.

Size-bounded web layout proposal (28 full `analysis_nodos` files are too many):
1. `analysis_nodos_{tracker,fijo}.json` for `mean` only (today's schema, all windows).
2. `variant_scalars_{config}.json`: columnar, per variant x window Y1/Y2 only: `p_cap, vf, y_f, ingreso, yf_annual_equiv`
   (14 variants x 2 windows x 5 fields x 2,431 ~ 4 MB raw / ~1.3 MB gz per config, lazy per config).
3. Profiles + irradiance: `variants/{variant}.json` above, loaded on selection.
4. Fields beyond the 5 (pct_e0, vf_dia_promedio, *_real) only for the selected variant, computed from (3) and
   `node_profiles` (day-average approximation, label it) or from a lazily built per-variant file.

`validador` should test: (a) `mean`/tracker `y_f` Y1/Y2 equals published within 1e-6 for every node, and kpis output for
`mean` equals today's analysis_nodos for both configs' shared fields; (b) fixed < tracker and real <= clear per node and
variant; (c) every `yYYYY` annual_equiv within +-15 % of `mean`; (d) `y_f(variant)` = sum n_horas x table (recompute 50
random nodes from `tables_month_hour.parquet`); (e) profile `y` x 8760-weighted equals `yf` for no-gap nodes; (f) night
hours 0 and no NaN/-999 in JSON; (g) `n_horas` identical across configs/variants; (h) `p_cap`, `vf` bounds and
`vf_fijo` vs `vf_tracker` within 0.15; (i) gap nodes keep `y_f` unannualised and `yf_annual_equiv` > `y_f`.

## 6. QA results (`data/solar_v2/qa.json`)
- Reproduction vs published: tracker `y_f` Y1 (2,412 nodes) and Y2 (2,424): max relative error 3e-8, 0 outliers; annual
  tracker and fixed vs `solar_baselines.parquet` (2,456 nodes): 2e-9; `node_profiles.json` y rows (4,850): max abs error 0.0.
- Coverage: 2,605 nodes computed (SIN 2,455, BCA 119, BCS 31); 0 errors; 54 nodes without baseline = no coordinates
  (municipality without centroid / foreign interconnection). BCA/BCS now covered (149 nodes). All 2,605 have all 11 year
  variants and all 24 `win` months.
- Sanity (all nodes): fixed < tracker 0 violations; real <= clear 0; night energy 0; CF tracker 18.4-28.1 %, fixed
  15.4-23.3 %; fixed/tracker 0.816-0.900; real/clear 0.63-0.93; PR 0.80-0.85; POA/GHI tracker 1.13-1.39, fixed 0.96-1.17.
- Year spread (tracker annual, median node): 2015 -5.9 % vs mean, 2016 -1.5, 2017 +2.1, 2018 -1.5, 2019 +2.1, 2020 +2.0,
  2021 +0.8, 2022 +1.6, 2023 +1.8, 2024 -0.2, 2025 -0.7. Year-to-year CV (median node) 1.5 % (BCA) to 3.3 % (Central);
  p5 worst year -5 to -10 % by region. `win` vs `mean`: median -0.9 %, p5 -4.0 %, p95 +3.8 %.
- Run: 269 NASA POWER requests (9 BCA/BCS cells x 12 years + 161 x 2026 refresh), 0 failures, ~3 min; compute 516 s
  on 9 workers (2,605 nodes, 4 PV runs each). Pilot (Phase 0) numbers unchanged.

## 7. Risks and open questions for Nico
1. 2015 is -5.9 % below the 2016-2025 level at the median node; may be a MERRA-2/CERES input change rather than
   weather. [unverified] Keep 2015 in `mean` (published) or exclude it? Needs an NSRDB/ground check.
2. Each node uses the municipal centroid and a 1-degree cell: spatial error is the dominant uncertainty.
3. `win` and `yYYYY` apply a month's mean day (not the real hourly weather) to real PML hours, so day-to-day
   PML/weather co-movement is not captured (same limitation as the published `mean`).
4. Y2 `win` uses Aug 2025..Jul 2026 weather with PML through Sep 2026; Y2aj windows exclude Jul.
5. Tracker/fixed numbers rest on [estimated] derate/DC-AC; they scale absolute y, not ratios.
6. NASA data after 2026-07-31 is not yet published; a daily refresh needs the cache `refresh2026` re-run.
