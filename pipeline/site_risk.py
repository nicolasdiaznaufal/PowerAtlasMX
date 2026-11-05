"""Site risk for BESS / solar scoring: archaeology (heaviest), indigenous localities, road access, for ANY point.

  risk_for_points(points) -> {key: {metrics, components, flags, coord}}      points: [{key, lat, lon, coord?}]
  python pipeline/site_risk.py --nodes                    all valid nodes of the index -> data/analysis/site_risk.json
  python pipeline/site_risk.py --point 19.6925,-98.8438   one point (prints JSON)
  python pipeline/site_risk.py --csv plants.csv           columns nombre,lat,lon[,nodo]; without nodo it proposes generation nodes nearby
Node coordinates are municipal centroids (field coord_precision), so distances of a few km are approximate.
Archaeology: points only. A site not mapped nearby does NOT mean no heritage (many sites are unregistered; INAH requires the procedure anyway),
hence nearness is combined with regional density. Missing layer or point -> neutral value + flag, never a silent 1.0.
Components are 0..1, higher = safer. Parameters: config/site_risk.json (all [estimated]).
"""
import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from arch_layer import D as ARCH_DIR
from indig_layer import IndigIndex, load_iter
from roads_layer import CACHE as ROADS_CACHE, RoadIndex, km_xy

ROOT = Path(__file__).resolve().parents[1]
CFG = json.loads((ROOT / "config/site_risk.json").read_text())
unit = lambda x, lo, hi: float(min(1.0, max(0.0, (x - lo) / (hi - lo))))


class Layers:
    """lazy loaders: a missing layer yields None so the caller can return a neutral value with a flag."""
    def __init__(self, cfg=CFG):
        self.cfg = cfg
        sites = ARCH_DIR / "sitios.csv"
        self.arch = None
        if sites.exists():
            rows = list(csv.DictReader(open(sites, encoding="utf-8")))
            if rows:
                self.arch = cKDTree(km_xy([float(r["lat"]) for r in rows], [float(r["lon"]) for r in rows]))
        self.roads = RoadIndex() if ROADS_CACHE.exists() else None
        df, self.indig_info = load_iter(cfg["indig"])
        self.indig = IndigIndex(df, cfg["indig"]) if df is not None else None


def arch_part(L, lat, lon):
    c = L.cfg["arch"]
    if L.arch is None:
        return None
    p = km_xy([lat], [lon])[0]
    d = float(L.arch.query(p)[0])
    n = len(L.arch.query_ball_point(p, c["density_radius_km"]))
    near = 1 - unit(d, c["near_full_km"], c["near_zero_km"])
    risk = min(1.0, near + min(1.0, n / c["density_n_full"]) * c["density_weight"])
    comp = c["critical_component"] if d < c["critical_km"] else 1 - risk
    flags = []
    if d < c["flag_critical_km"]:
        flags.append("archaeological site < 2 km: INAH critical path")
    elif d < c["flag_minor_km"]:
        flags.append("archaeological site 2-5 km: INAH check advised")
    return {"dist_arch_km": round(d, 2), "arch_n_15km": n}, round(comp, 3), flags


def indig_part(L, lat, lon):
    if L.indig is None:
        return None
    m = L.indig.metrics(lat, lon)
    r = L.indig.risk(m)
    flags = ["indigenous locality within 5 km: consulta/EIS probable"] if r > L.cfg["indig"]["flag_risk"] else []
    return m, round(1 - r, 3), flags


def access_part(L, lat, lon):
    if L.roads is None:
        return None
    c = L.cfg["access"]
    d, dh = (float(x[0]) for x in L.roads.dist_km([lat], [lon]))
    return {"dist_road_km": round(d, 2), "dist_highway_km": round(dh, 2)}, round(1 - unit(d, *c["dist_km_scale"]), 3), []


PARTS = {"arch": (arch_part, "no archaeological layer"), "indig": (indig_part, "no indigenous-locality data (ITER not loaded): neutral"),
         "access": (access_part, "no road cache: neutral")}


def risk_for_points(points, L=None):
    L, out = L or Layers(), {}
    for pt in points:
        r = {"coord": pt.get("coord"), "metrics": {}, "components": {}, "flags": []}
        if pt.get("lat") is None or pt.get("lon") is None:
            r["components"] = {k: CFG["neutral_missing"] for k in PARTS}
            r["flags"].append("no coordinate: neutral site-risk components")
        else:
            for k, (fn, miss) in PARTS.items():
                res = fn(L, pt["lat"], pt["lon"])
                if res is None:
                    r["components"][k] = CFG["neutral_missing"]
                    r["flags"].append(miss)
                else:
                    r["metrics"].update(res[0]); r["components"][k] = res[1]; r["flags"].extend(res[2])
        out[pt["key"]] = r
    return out


def nodes_points():
    idx = json.loads((ROOT / "web/data/index.json").read_text())["nodos"]
    return [{"key": x["id"], "lat": x.get("lat"), "lon": x.get("lon"), "coord": x.get("coord_precision")} for x in idx if x.get("valido")]


def propose_nodes(lat, lon, k=3):
    """generation-modelled nodes nearest to a plant (same municipality shares the centroid): candidates for the interconnection node."""
    cat = json.loads((ROOT / "data/analysis/catalog_nodes.json").read_text())["nodes"]
    pts = [p for p in nodes_points() if cat.get(p["key"], {}).get("gen") and p["lat"] is not None]
    d = km_xy([p["lat"] for p in pts], [p["lon"] for p in pts]) - km_xy([lat], [lon])[0]
    order = np.argsort(np.hypot(d[:, 0], d[:, 1]))[:k]
    return [{"nodo": pts[i]["key"], "dist_km": round(float(np.hypot(*d[i])), 1), "gen": cat[pts[i]["key"]]["gen"], "kv": cat[pts[i]["key"]]["kv"]} for i in order]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--nodes", action="store_true"); g.add_argument("--point"); g.add_argument("--csv")
    a = ap.parse_args(argv)
    if a.nodes:
        res = risk_for_points(nodes_points())
        miss = {k: sum(1 for r in res.values() if r["components"][k] == CFG["neutral_missing"]) for k in PARTS}
        layers = {k: miss[k] < len(res) for k in PARTS}   # a layer with no data for any node is left out of the scores, not set to a flat 0.5
        (ROOT / "data/analysis/site_risk.json").write_text(json.dumps({"config": CFG, "layers": layers, "neutral": miss, "nodes": res}))
        print(len(res), "nodes; neutral (no data) per component:", miss)
    elif a.point:
        lat, lon = (float(x) for x in a.point.split(","))
        print(json.dumps(risk_for_points([{"key": "point", "lat": lat, "lon": lon, "coord": "exact"}])["point"], indent=1, ensure_ascii=False))
    else:
        rows, pts = list(csv.DictReader(open(a.csv, encoding="utf-8-sig"))), []
        for r in rows:
            pts.append({"key": r["nombre"], "lat": float(r["lat"]), "lon": float(r["lon"]), "coord": "exact"})
        res = risk_for_points(pts)
        for r, p in zip(rows, pts):
            res[p["key"]]["nodo"] = r.get("nodo") or None
            if not r.get("nodo"):
                res[p["key"]]["nodo_candidates"] = propose_nodes(p["lat"], p["lon"])
        print(json.dumps(res, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
