# Solar Plant Score: spatial siting workflow (v2, revisit draft)

Goal: per PML node, a land-availability screen and a 0-100 "Solar Plant Score", shown in a separate
"Solar Plant Score" window (map + score) inside PowerAtlasMx v2.
Tags: [verificado] checked in this repo, [estimado] assumption, [pendiente] needs a decision or data.

---

## 0. Viability check against current data

| Need | Status | Detail |
|---|---|---|
| Node IDs + lat/lon | [verificado] partial | `web/data/index.json` → `nodos[]`: 2,659 nodes, 2,623 `valido`, 54 without coords. |
| Coordinate precision | [verificado] **proxy** | 2,599 are INEGI **municipality centroids** (`coord_fuente=municipio_catalogo`), 6 inherited from renamed nodes. Only ~815 unique points for 2,623 nodes. Not substation locations. |
| DuckDB + spatial ext | [verificado] | `.venv` has duckdb 1.5.6; `INSTALL spatial` works. DB at `data/db/pml.duckdb`. |
| Table `pml_nodes` | [verificado] missing | The original script assumed it. It must be created from `index.json`. |
| DEM (slope) | [verificado] received | `data/ref/geo/dem/conjunto_de_datos/modelo_relieve_mexico_2025.tif` (INEGI, 3.1 GB, ~81 m pixel, LCC, values -9650..5592 m so it includes bathymetry; treat sea as nodata). Coarse for slope: use as a screen, not a site survey. |
| Land cover | [verificado] received | `landcover/serie7_cdv/cdv_usuev250sVII_cnal.shp` (INEGI USV Serie VII 1:250k, 179,099 polygons, fields `CLAVE`/`DESCRIPCIO`, Albers equal-area). **Primary.** `serie7_cw/` is a near-duplicate (2023, LCC, no CLAVE); kept as cross-check only. |
| Protected areas (ANP) | [verificado] received | `protected/shp_anp_20260924/` (CONANP, 2026-09-24, 232 polygons incl. marine, ITRF2008). **Primary.** `protected/anpmx_old/` is an older copy, cross-check only. Federal ANP only: state/municipal reserves, RAMSAR and Indigenous lands are not covered. |
| Grid lines / substations | [verificado] received (OSM-derived) | `grid/atlas-sen/` (github.com/batuenergy/atlas-sen, shallow clone, code not executed). `data/derived/osm_lines.json`: 8,715 lines, 69-400 kV (115 kV 5,190; 230 kV 1,888; 400 kV 798), ~26.8k vertices, `[kV, [[lat,lng],...]]`. `osm_substations.json`: 2,037 substations <=161 kV with lat/lng, 637 named. **Gap:** 230/400 kV substations have no open coordinates (Google-geocoded, not shipped); use line endpoints. Completeness of OSM lines is [estimado], not audited. |
| Node-ID bridge | [verificado] | `rgd_substations.json` (1,659 CFE substations, no coords) shares the 3-letter+kV code with PML IDs (1,480 matching keys), so it adds division, zone, MVA and bank count per node, not location. |
| Name match to OSM subs | [estimado] unreliable | 530 exact-name matches against 2,623 nodes, but spot checks are wrong (e.g. "Nacozari" listed in Mexicali municipality). Only usable with a municipality/distance sanity check; do not replace centroids with it yet. |
| Other useful files | [verificado] | `osm_plants.json` (plant coords), `transmission.json` (planned lines), `projects.json`, `private_generation.json` (pipeline), `region_polys.json` (CENACE regions). |
| Batu open CSVs (6) | [verificado] reviewed 2026-10-14, stored in `data/ref/batu_open/` | `subestaciones.csv`: 471 substations 230/400 kV with MVA, connected MW, saturation, no coordinates; name match to PML 230/400 nodes 132 of 313 (42 %, unverified by location), saturation > 0 only for 50 substations. `centrales.csv`: 537 plants with permits, no coords (our `CentralesElectricas.csv` is richer). `precios-mda.csv`: one single day (2026-06-24), 108 load zones: no use. `cfe-usuarios/consumo.csv`: by tariff division x year 2016/2019-2026. `gd-por-estado.csv`: DG MW by state, half-years to 2025-H2. |
| Licence | [verificado] | OSM-derived data is ODbL: attribute "© OpenStreetMap contributors"; do not republish raw geometry in the web app, only derived scores/distances. Others CC-BY 4.0 (attribute CENACE/CFE/CNE). |
| Power plants (new) | [verificado] received | `grid/centrales/CentralesElectricas.csv` (named .xls, really CSV, latin-1): 1,736 plants, 528 PV (112 operating, 28 under construction). X/Y in Web Mercator (EPSG:3857), 1 row without coords. Not a grid layer, but operating plants imply interconnection exists nearby: use as a **proxy** for grid proximity and as a saturation/competition signal. |
| Roads (bonus) | [verificado] received | `roads/conjunto_de_datos/rnc2025.gpkg` (INEGI RNC 2025, 2.4 GB). Not in the plan; usable as an access-distance term later. |
| Raster tooling | [pendiente] | `.venv` has no rasterio/GDAL; `pip install rasterio` needed for slope. DuckDB reads the shapefiles and gpkg directly. |
| Solar resource (GHI/yield) | [verificado] | Already produced by `pipeline/solar*.py` per node; reuse, do not recompute. |
| Price KPIs (captured price, % PML <= 0) | [verificado] | Already in per-node JSON via `pipeline/kpis.py`; reuse. |

**Verdict: viable as a municipality-level screen.** Not viable as a site-level (substation-exact) screen
until real substation coordinates are added. The UI must say "land near municipality centroid", never "site".

Decisions taken (Nico): municipality-level screen; layers = slope (DEM), land cover, protected areas,
grid proximity; output = separate "Solar Plant Score" window with map and score in v2.

---

## 1. Required inputs (to acquire, stored in `data/ref/geo/`, never in git)

| Layer | Suggested source | Use | Hard rule |
|---|---|---|---|
| DEM → slope | INEGI CEM 15 m or Copernicus GLO-30 | slope raster | exclude > 7 % [estimado] |
| Land cover | INEGI Uso de Suelo y Vegetación Serie VII, or ESA WorldCover 10 m | classes | exclude forest, wetland, water, urban, irrigated agri [estimado] |
| Protected areas | CONANP ANP (federal + state) | polygons | exclude all |
| Grid | OSM `power=line/substation` or CENACE/CFE if obtainable | lines/points | score only, not exclusion |

[pendiente] confirm licences and the exact class list with Nico before coding the rules.

---

## 2. Pipeline design

Keep one concern per file, each under 300 lines (repo rule). Proposed:

1. `pipeline/geo_prepare.py`: nodes → `node_points` (unique points), layers → DuckDB tables in the metric CRS.
2. `pipeline/geo_suitability.py`: buffers, exclusion, net area, largest patch.
3. `pipeline/geo_score.py`: combine with solar + price KPIs → score; writes `web/v2` JSON.
4. `tests/test_geo_*.py`: synthetic polygons with known areas.

### Fixes to the original script

1. **Source table**: build `pml_nodes` from `index.json` (id, nombre, lat, lon), filter `valido` and non-null coords.
2. **Axis order**: with `ST_Transform(geom, 'EPSG:4326', 'EPSG:6372')` DuckDB expects lat/lon order for 4326. Build points as
   `ST_Point(lon, lat)` and pass `always_xy := true`, otherwise points land in the wrong place. Add a test with one known node.
3. **Dedupe first**: compute on the ~815 unique coordinates and join back to the node IDs (about 3x less work).
4. **No `ST_Difference(buffer, ST_Union_Agg(...))` per node**: slow and memory heavy. Instead dissolve all exclusion layers once into
   `exclusion_union`, then `ST_Intersection(buffer, exclusion_union)` per point, or rasterize to 100 m cells and count cells.
   [estimado] raster/cell counting is the more robust option for national layers.
5. **"Contiguous" was not computed**: the original `net_viable_ha` is total non-excluded area, not contiguous flat land.
   Take `ST_Dump` of the viable geometry and keep the **largest patch** (`max_patch_ha`); apply the 100 ha test to that.
6. **Area accuracy**: EPSG:6372 (LCC) is conformal, not equal-area. Fine for 15 km buffers; for reported hectares use
   an equal-area CRS (e.g. ESRI:102008 Albers) or accept ~<1 % error [estimado].
7. **RTREE indexes**: recent DuckDB spatial uses a spatial-join operator for `ST_Intersects` joins automatically;
   benchmark before keeping `CREATE INDEX ... RTREE` [pendiente].
8. **Buffer radius**: 15 km is a configuration value in `config/supuestos.yaml`, plus a 5 km variant, because the anchor is a
   municipality centroid. Report `max_patch_ha` and `distance_to_patch_km`, not just totals.
9. **Memory**: `threads=4`, `memory_limit='8GB'` are fine; set `temp_directory` to `$CLAUDE_JOB_DIR/tmp` or `data/cache`.

### Core query (after dedupe and dissolve)

```sql
CREATE OR REPLACE TABLE viable AS
SELECT p.pt_id,
       ST_Difference(p.buf, COALESCE(e.geom, ST_GeomFromText('POLYGON EMPTY'))) AS geom
FROM point_buffers p
LEFT JOIN exclusion_union e ON ST_Intersects(p.buf, e.geom);

SELECT pt_id,
       ST_Area(buf) / 1e4  AS total_ha,
       ST_Area(geom) / 1e4 AS net_viable_ha
FROM viable;
-- max_patch_ha: unnest(ST_Dump(geom)) per pt_id, then max(ST_Area(part)) / 1e4
```

(Pseudo-SQL; exact `ST_Dump` unnesting syntax to be tested in step 2.)

---

## 3. Solar Plant Score (0-100)

1. **Gate**: `max_patch_ha >= 100` (config). Fails → score null, flagged "no commercial-scale land".
2. **Components** (normalised 0-1, weights in `config/supuestos.yaml` marked `PENDIENTE`):
   - land 25 %: `max_patch_ha` (log-scaled, capped)
   - terrain 15 %: share of buffer with slope < 3 %
   - resource 25 %: yearly yield from `pipeline/solar*.py`
   - market 25 %: captured price / % PML <= 0 from `kpis.py`
   - grid 10 %: distance to nearest 115-400 kV line or <=161 kV substation (OSM via atlas-sen); voltage-weighted [estimado]
   Starting weights (Nico: changeable later); keep them in `config/supuestos.yaml`.
3. **No verdict colour** while weights are `PENDIENTE` (same rule as the revenue view): show "provisional".
4. **Confidence**: lower for centroid-based nodes and for nodes with < 12 months of data (existing `confianza`).

---

## 4. Web integration (frontend, `web/v2/` only)

- Data: one compact `web/v2/data/solar_score.json` (id, score, components, max_patch_ha, coord_precision). Under ~300 KB; no geometries.
- Window: separate "Solar Plant Score" page/panel, deck.gl map coloured by score, node click → component bars.
- Always show the label "municipality centroid, not substation" next to the map.
- v1 (`web/` outside `web/v2/`) stays frozen.

---

## 5. Milestones

| # | Deliverable | Gate |
|---|---|---|
| G1 | Layers downloaded, CRS verified, node points table | known-node coordinate test passes |
| G2 | Suitability for 5 pilot nodes (one per region) | areas match QGIS check within 2 % |
| G3 | National run + runtime/memory report | < 30 min on 8 GB |
| G4 | Score + config weights + tests | validador review |
| G5 | v2 Solar Plant Score window | screenshot + integrity tests |

## 6. Open questions

- Class list for land cover and slope threshold: confirm with Nico.
- Substation coordinates: is there any source you can obtain? Would remove the centroid caveat.
- Are the weights set by the team, or should they be derived (e.g. regression against captured price)?
- Is irrigated/rainfed agriculture allowed (lease) or excluded?

---

## 7. Add-on: grid saturation (verified) and Battery Score (draft, 2026-10-15)

### 7.1 Substation saturation (Batu `subestaciones.csv`)
- Verification by catalog, not coordinates: normalised name + kV + CFE distribution zone against the CENACE catalog
  (`zona_distribucion`). Result: **71 PML 230/400 kV nodes verified** (of 313; ~3 % of all nodes); only **13 saturated**.
- Coverage is far below 50 %, so it cannot be a score component. Rule: **neutral by default; penalty-only modifier
  on verified saturated nodes (-5 to -15 pts, scaled by saturation)**; verified headroom = no bonus (absence of data
  must never be rewarded). Show a "grid data: verified / not available" badge.

### 7.2 Battery screening (`pipeline/battery_metrics.py`, 2,551 nodes)
- Rule-based, out of sample: charge/discharge hours chosen per month from 2023-24, applied to 2025 real prices,
  RTE 85 % [estimado]. Perfect-foresight spread (max-min and top-k minus bottom-k) is shown only as an upper bound
  (project rule: no perfect-foresight base case).
- Measured (MDA only): median 4 h rule-based value **~585 MXN/kW-yr** (p5 424, p95 1,501); median daily spread
  ~800 MXN/MWh; capture of the perfect-foresight bound ~0.7; negative-price share ~0.2 %.
- Reading: on MDA arbitrage alone this is thin against any realistic 4 h capex [estimado, capex PENDIENTE]. Outliers
  (34.5 kV Peninsular nodes with congestion mean > 3,000 MXN/MWh) need an audit before being trusted.
- Proposed components (weights, strict mode): value 30, daily spread 15, predictability (capture ratio) 15,
  negative-price share 15, congestion volatility 10, grid 15; saturation modifier as 7.1. No verdict colour.
