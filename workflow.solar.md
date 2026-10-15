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
| Exclusion masks (slope, land cover, protected areas) | [pendiente] none | No DEM, land-cover or ANP layer in `data/`. Must be downloaded. |
| Grid lines / substations | [pendiente] none | No line geometry. Needed for the proximity term. |
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
   - grid 10 %: distance to nearest line/substation
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
