"""National Solar Plant Score (workflow.solar.md, G3-G4): land screen per unique node point + score.

Run: .venv/bin/python pipeline/geo_score.py
Out: data/analysis/solar_score.json  (full, gitignored)
Weights/scales live in config/solar_score.json. Status: PROVISIONAL (no green/red verdict).
"""
import json
import math
import sys
import time

import duckdb
import numpy as np
import rasterio

from geo_pilot import DEM, ROOT, analyse, duck, load_grid

CFG = json.loads((ROOT / "config/solar_score.json").read_text())
LAND_KEYS = ("total_ha", "valid_ha", "steep_pct", "flat3_pct", "landcover_excl_pct", "anp_excl_pct",
             "net_viable_ha", "max_patch_ha", "median_slope_pct", "dist_hv_line_km", "dist_substation_km")


def unit(x, lo, hi):
    return float(min(1.0, max(0.0, (x - lo) / (hi - lo))))


def land_screen(nodes, buf):
    """One analysis per unique (lat, lon); returns {(lat, lon): metrics}. Reuses the last run if present."""
    prev = ROOT / "data/analysis/solar_score.json"
    if prev.exists() and "--rerun" not in sys.argv:
        old = json.loads(prev.read_text())["nodes"]
        have = {(r["lat"], r["lon"]): {k: r[k] for k in LAND_KEYS} for r in old}
        if all((n["lat"], n["lon"]) in have for n in nodes):
            return have
    pts = {}
    for n in nodes:
        pts.setdefault((n["lat"], n["lon"]), n)
    con, (hv, subs) = duck(), load_grid()
    out, t0 = {}, time.time()
    with rasterio.open(DEM) as dem:
        for i, (k, n) in enumerate(pts.items(), 1):
            r = analyse(n, con, dem, buf, hv, subs)
            out[k] = {m: r[m] for m in LAND_KEYS}
            if i % 100 == 0:
                print(f"{i}/{len(pts)} {time.time() - t0:.0f}s", flush=True)
    return out


def score(comp, w, mode):
    """Strict = weighted geometric mean (a weak component drags the score); linear = weighted average."""
    tw = sum(w.values())
    if mode == "linear":
        return round(100 * sum(w[c] * v for c, v in comp.items()) / tw, 1)
    return round(100 * math.exp(sum(w[c] * math.log(max(v, 0.02)) for c, v in comp.items()) / tw), 1)


def resource_table():
    c = duckdb.connect()
    q = (f"select nodo, yf_annual_equiv yf from '{ROOT}/data/solar_v2/scalars.parquet' "
         "where config='fixed' and variant='mean' and \"window\"='Y1'")
    return {r[0]: r[1] for r in c.execute(q).fetchall()}


def congestion_table(y0, y1):
    """Solar-weighted congestion component (MXN/MWh), fixed config, full years y0..y1. Negative = costly."""
    c = duckdb.connect()
    q = (f"select nodo, sum(sum_y_congestion) / nullif(sum(sum_y), 0) cong, "
         f"sum(sum_y_congestion) / nullif(sum(sum_y_pml), 0) cshare "
         f"from '{ROOT}/data/aggregates/agregados_config.parquet' "
         f"where config='fixed' and anio between {y0} and {y1} group by nodo")
    return {r[0]: (r[1], r[2]) for r in c.execute(q).fetchall()}


def main():
    idx = json.loads((ROOT / "web/data/index.json").read_text())["nodos"]
    nodes = [x for x in idx if x.get("valido") and x.get("lat") is not None]
    land = land_screen(nodes, CFG["buffer_km"])
    yf = resource_table()
    cg = congestion_table(*CFG["congestion_years"])

    rows = []
    for n in nodes:
        k = n.get("kpis") or {}
        fx = k.get("fixed") or {}
        row = {"id": n["id"], "nombre": n["nombre"], "region": n.get("region"), "entidad": n.get("entidad"),
               "municipio": n.get("municipio"), "lat": n["lat"], "lon": n["lon"],
               "confianza": n.get("confianza"), "meses": n.get("meses_de_datos"),
               "coord": n.get("coord_precision"), **land[(n["lat"], n["lon"])],
               "yf_kwh_kwp": yf.get(n["id"]),
               "price_mxn_mwh": fx.get("precio_capturado_real_mxn_mwh"),
               "vf": fx.get("vf_real"), "pct_le0": fx.get("pct_energia_pml_le0"),
               "cong_mxn_mwh": (cg.get(n["id"]) or (None, None))[0], "cong_share": (cg.get(n["id"]) or (None, None))[1]}
        rows.append(row)

    def pr(key, p):
        v = [r[key] for r in rows if r[key] is not None]
        return float(np.percentile(v, p))

    s = CFG["scales"]
    mk_lo, mk_hi = pr("price_mxn_mwh", s["market_pctl"][0]), pr("price_mxn_mwh", s["market_pctl"][1])
    cg_lo, cg_hi = pr("cong_mxn_mwh", s["congestion_pctl"][0]), pr("cong_mxn_mwh", s["congestion_pctl"][1])
    for r in rows:
        reasons = []
        if r["max_patch_ha"] < CFG["min_patch_ha"]:
            reasons.append("no 100 ha patch")
        if r["yf_kwh_kwp"] is None:
            reasons.append("no solar yield")
        if r["price_mxn_mwh"] is None:
            reasons.append("no price data")
        if r["cong_mxn_mwh"] is None:
            reasons.append("no congestion data")
        r["flags"] = reasons
        r["components"], r["score"] = None, None
        if reasons:
            continue
        ha_lo, ha_hi = s["land_ha"]
        r["components"] = {k: round(v, 3) for k, v in {
            "land": unit(math.log10(max(r["max_patch_ha"], 1)), math.log10(ha_lo), math.log10(ha_hi)),
            "resource": unit(r["yf_kwh_kwp"], *s["resource_kwh_kwp"]),
            "market": unit(r["price_mxn_mwh"], mk_lo, mk_hi),
            "congestion": unit(r["cong_mxn_mwh"], cg_lo, cg_hi),
            "terrain": unit(r["flat3_pct"], *s["flat_pct"]),
            "grid": 1 - unit(min(r["dist_hv_line_km"], r["dist_substation_km"]), *s["grid_km"]),
        }.items()}
        r["score"] = score(r["components"], CFG["weights"], CFG["mode_default"])
    ranked = sorted((r["score"] for r in rows if r["score"] is not None), reverse=True)
    meta = {"generated": time.strftime("%Y-%m-%d"), "config": CFG, "n_nodes": len(rows),
            "n_scored": len(ranked), "price_scale": [round(mk_lo), round(mk_hi)],
            "cong_scale": [round(cg_lo, 1), round(cg_hi, 1)]}
    dest = ROOT / "data/analysis/solar_score.json"
    dest.write_text(json.dumps({"meta": meta, "nodes": rows}, ensure_ascii=False))
    print(meta)
    if ranked:
        print("score pctl 10/50/90:", [round(float(np.percentile(ranked, p)), 1) for p in (10, 50, 90)])


if __name__ == "__main__":
    main()
