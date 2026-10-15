"""Pilot of the Solar Plant Score land screen (workflow.solar.md, milestone G2).

For N pilot nodes (one per region) compute, inside a BUFFER_KM circle around the node's
municipality centroid: slope, land-cover and ANP exclusion, net viable ha, largest contiguous
patch, and distance to the nearest 115-400 kV line / <=161 kV substation (OSM via atlas-sen).

Run: .venv/bin/python pipeline/geo_pilot.py [n_nodes] [buffer_km]
Output: data/analysis/geo_pilot.json (gitignored) + stdout table.
"""
import json
import math
import sys
import time
from pathlib import Path

import duckdb
import numpy as np
import rasterio
from rasterio import features
from rasterio.crs import CRS
from rasterio.warp import transform as warp_xy, transform_geom
from rasterio.windows import from_bounds
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
GEO = ROOT / "data/ref/geo"
DEM = GEO / "dem/conjunto_de_datos/modelo_relieve_mexico_2025.tif"
LC = GEO / "landcover/serie7_cdv/cdv_usuev250sVII_cnal.shp"
ANP = GEO / "protected/shp_anp_20260924/shp_anp_20260924.shp"
ATLAS = GEO / "grid/atlas-sen/data/derived"

SLOPE_MAX_PCT = 7.0      # [estimado] exclude steeper than this
MIN_PATCH_HA = 100.0
# land cover excluded when DESCRIPCIO contains any of these (forest, jungle, water, urban, irrigated, wetland)
LC_EXCLUDE = ("BOSQUE", "SELVA", "ASENTAMIENTOS", "CUERPO DE AGUA", "ACUÍCOLA", "MANGLAR", "TULAR",
              "POPAL", "HIDRÓFILA", "GALERÍA", "RIEGO", "HUMEDAD", "PALMAR", "PETÉN", "PRADERA")


def pick_nodes(n):
    idx = json.loads((ROOT / "web/data/index.json").read_text())["nodos"]
    ok = [x for x in idx if x.get("valido") and x.get("lat") is not None and x["id"].endswith(("-115", "-230"))]
    by_region = {}
    for x in ok:
        by_region.setdefault(x.get("region"), []).append(x)
    regions = sorted(by_region, key=lambda r: -len(by_region[r]))[:n]
    return [sorted(by_region[r], key=lambda x: x["id"])[len(by_region[r]) // 2] for r in regions]


def duck():
    """Cached copy of the vector layers with bbox columns (ST_Read has no spatial filter here)."""
    cache = ROOT / "data/cache/geo_layers.duckdb"
    cache.parent.mkdir(parents=True, exist_ok=True)
    c = duckdb.connect(str(cache))
    c.execute("INSTALL spatial; LOAD spatial;")
    have = {r[0] for r in c.execute("select table_name from information_schema.tables").fetchall()}
    for name, shp in (("lc", LC), ("anp", ANP)):
        if name not in have:
            t = time.time()
            c.execute(f"create table {name} as select {'DESCRIPCIO' if name == 'lc' else 'NOMBRE'} desc_, geom, ST_XMin(geom) x0, ST_YMin(geom) y0, "
                      f"ST_XMax(geom) x1, ST_YMax(geom) y1 from st_read('{shp}')")
            print(f"cached {name} in {time.time() - t:.0f}s", flush=True)
    return c


def vector_mask(con, shp, where, box_xy, src_crs, dst_crs, shape, transform):
    """Rasterize polygons of `shp` intersecting box (in src crs) onto the DEM window grid."""
    x0, y0, x1, y1 = box_xy
    tbl = "lc" if shp == LC else "anp"
    q = (f"select ST_AsGeoJSON(geom) g from {tbl} where x1 >= {x0} and x0 <= {x1} and y1 >= {y0} and y0 <= {y1}"
         f"{where}")
    geoms = [transform_geom(src_crs, dst_crs, json.loads(r[0])) for r in con.execute(q).fetchall()]
    if not geoms:
        return np.zeros(shape, bool)
    return features.rasterize(((g, 1) for g in geoms), out_shape=shape, transform=transform,
                              fill=0, dtype="uint8").astype(bool)


def seg_dist_m(lat, lon, segs):
    """Min distance (m) from point to line segments given as array [[lat1,lon1,lat2,lon2],...]."""
    k = 111320.0
    cl = math.cos(math.radians(lat))
    ax, ay = (segs[:, 1] - lon) * k * cl, (segs[:, 0] - lat) * k
    bx, by = (segs[:, 3] - lon) * k * cl, (segs[:, 2] - lat) * k
    dx, dy = bx - ax, by - ay
    t = np.clip(-(ax * dx + ay * dy) / np.maximum(dx * dx + dy * dy, 1e-9), 0, 1)
    return float(np.min(np.hypot(ax + t * dx, ay + t * dy)))


def load_grid():
    lines = json.loads((ATLAS / "osm_lines.json").read_text())
    segs = {}
    for kv, pts in lines:
        a = np.array(pts)
        if len(a) > 1:
            segs.setdefault("hv" if kv >= 115 else "sub", []).append(np.hstack([a[:-1], a[1:]]))
    hv = np.vstack(segs["hv"])
    subs = json.loads((ATLAS / "osm_substations.json").read_text())["subs"]
    return hv, np.array([[s[0], s[1]] for s in subs])


def point_dist_m(lat, lon, pts):
    k = 111320.0
    return float(np.min(np.hypot((pts[:, 1] - lon) * k * math.cos(math.radians(lat)), (pts[:, 0] - lat) * k)))


def analyse(node, con, dem, buf_km, hv, subs):
    lat, lon = node["lat"], node["lon"]
    mx, my = warp_xy("EPSG:4326", dem.crs, [lon], [lat])
    mx, my = mx[0], my[0]
    scale = math.cos(math.radians(lat))               # Mercator pixel -> ground metres
    half = buf_km * 1000 / scale + 2 * dem.res[0]
    win = from_bounds(mx - half, my - half, mx + half, my + half, dem.transform)
    z = dem.read(1, window=win, boundless=True, fill_value=np.nan).astype("float32")
    z[(z <= 0) | (z < -1e30)] = np.nan                  # sea / bathymetry / nodata
    tf = dem.window_transform(win)
    px = dem.res[0] * scale                             # ground metres per pixel
    gy, gx = np.gradient(z, px)
    slope = np.hypot(gx, gy) * 100.0
    rows, cols = np.indices(z.shape)
    cx = (mx - tf.c) / tf.a
    cy = (my - tf.f) / tf.e
    inside = np.hypot(cols + .5 - cx, rows + .5 - cy) * px <= buf_km * 1000
    minx, maxy = tf.c, tf.f
    maxx, miny = tf.c + tf.a * z.shape[1], tf.f + tf.e * z.shape[0]
    corners = [(minx, miny), (maxx, maxy)]
    lc_crs = CRS.from_wkt(LC.with_suffix(".prj").read_text())
    anp_crs = CRS.from_wkt(ANP.with_suffix(".prj").read_text())
    box = lambda crs: [v for xy in zip(*warp_xy(dem.crs, crs, [c[0] for c in corners], [c[1] for c in corners]))
                       for v in xy]
    bx = box(lc_crs)
    lc_box = (min(bx[0], bx[2]), min(bx[1], bx[3]), max(bx[0], bx[2]), max(bx[1], bx[3]))
    ba = box(anp_crs)
    anp_box = (min(ba[0], ba[2]), min(ba[1], ba[3]), max(ba[0], ba[2]), max(ba[1], ba[3]))
    cond = " or ".join(f"desc_ ilike '%{w}%'" for w in LC_EXCLUDE)
    lc_ex = vector_mask(con, LC, f" and ({cond})", lc_box, lc_crs, dem.crs, z.shape, tf)
    anp_ex = vector_mask(con, ANP, "", anp_box, anp_crs, dem.crs, z.shape, tf)

    valid = inside & ~np.isnan(z)
    steep = valid & (slope > SLOPE_MAX_PCT)
    viable = valid & ~steep & ~lc_ex & ~anp_ex
    lab, n = ndimage.label(viable, structure=np.ones((3, 3)))
    patch = float(np.bincount(lab[lab > 0]).max()) if n else 0.0
    ha = px * px / 1e4
    tot = float(inside.sum())
    return {
        "id": node["id"], "nombre": node["nombre"], "region": node.get("region"), "lat": lat, "lon": lon,
        "total_ha": round(tot * ha), "valid_ha": round(float(valid.sum()) * ha),
        "steep_pct": round(100 * float(steep.sum()) / max(valid.sum(), 1), 1),
        "landcover_excl_pct": round(100 * float((valid & lc_ex).sum()) / max(valid.sum(), 1), 1),
        "anp_excl_pct": round(100 * float((valid & anp_ex).sum()) / max(valid.sum(), 1), 1),
        "net_viable_ha": round(float(viable.sum()) * ha),
        "max_patch_ha": round(patch * ha), "passes_100ha": patch * ha >= MIN_PATCH_HA,
        "flat3_pct": round(100 * float((valid & (slope <= 3.0)).sum()) / max(valid.sum(), 1), 1),
        "median_slope_pct": round(float(np.nanmedian(slope[valid])), 1) if valid.any() else None,
        "dist_hv_line_km": round(seg_dist_m(lat, lon, hv) / 1000, 1),
        "dist_substation_km": round(point_dist_m(lat, lon, subs) / 1000, 1),
    }


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    buf = float(sys.argv[2]) if len(sys.argv) > 2 else 15.0
    con, hv, subs = duck(), *load_grid()
    out = []
    with rasterio.open(DEM) as dem:
        for node in pick_nodes(n):
            t = time.time()
            r = analyse(node, con, dem, buf, hv, subs)
            r["seconds"] = round(time.time() - t, 1)
            out.append(r)
            print(json.dumps(r, ensure_ascii=False), flush=True)
    dest = ROOT / "data/analysis/geo_pilot.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"buffer_km": buf, "slope_max_pct": SLOPE_MAX_PCT, "nodes": out},
                               ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
