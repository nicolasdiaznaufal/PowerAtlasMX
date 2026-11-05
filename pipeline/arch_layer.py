"""Archaeological sites layer for site risk: OSM points (historic=archaeological_site) + INAH open zones geocoded by name.

No public INAH polygons exist. Points are a lower bound: a site missing here does NOT mean no heritage nearby (many sites are
unregistered and INAH demands the procedure anyway), so site_risk also uses regional density.
Inputs  data/ref/geo/arqueologia/{osm_arqueologicos.json, INAH_zonas_arqueologicas.csv, pendientes_geocodificar.csv (optional, filled by hand)}
Outputs data/ref/geo/arqueologia/sitios.csv (name,lat,lon,estado,fuente,inah) and pendientes_geocodificar.csv
Run: .venv/bin/python pipeline/arch_layer.py
"""
import csv
import json
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from norm_name import norm_name

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "data/ref/geo/arqueologia"
DEDUP_M = 300.0
STATE_FIX = {"mexico": "estado de mexico", "distrito federal": "ciudad de mexico", "coahuila": "coahuila de zaragoza",
             "michoacan": "michoacan de ocampo", "veracruz": "veracruz de ignacio de la llave"}


def state_key(s):
    k = norm_name(s)
    return STATE_FIX.get(k, k)


def muni_index():
    rows = list(csv.DictReader(open(ROOT / "data/ref/municipios_centroides.csv", encoding="utf-8")))
    xy = np.array([[float(r["LAT_DEC"]), float(r["LON_DEC"])] for r in rows])
    return cKDTree(xy), [state_key(r["NOM_ENT"]) for r in rows]


def name_score(a, b):
    na, nb = norm_name(a, True), norm_name(b, True)
    if not na or not nb:
        return 0.0
    ta, tb = set(na.split()), set(nb.split())
    contain = 0.9 if (ta <= tb or tb <= ta) and min(len(ta), len(tb)) >= 1 and max(len(na), len(nb)) > 0 else 0
    return max(SequenceMatcher(None, na, nb).ratio(), contain)


def load_osm():
    pts = []
    for e in json.loads((D / "osm_arqueologicos.json").read_text())["elements"]:
        la, lo = (e["lat"], e["lon"]) if "lat" in e else (e.get("center", {}).get("lat"), e.get("center", {}).get("lon"))
        if la is None:
            continue
        t = e.get("tags", {})
        pts.append({"name": t.get("name:es") or t.get("name") or "", "lat": la, "lon": lo, "fuente": "osm"})
    return pts


def dedup(pts):
    """drop points closer than DEDUP_M to an earlier one (named points are kept first)."""
    pts = sorted(pts, key=lambda p: (p["name"] == "", p["fuente"] != "osm"))
    kx = np.array([[p["lat"] * 111320.0, p["lon"] * 111320.0 * np.cos(np.radians(p["lat"]))] for p in pts])
    tree, drop = cKDTree(kx), set()
    for i in range(len(pts)):
        if i in drop:
            continue
        drop.update(j for j in tree.query_ball_point(kx[i], DEDUP_M) if j > i)
    return [p for i, p in enumerate(pts) if i not in drop]


def build():
    tree, states = muni_index()
    osm = load_osm()
    for p in osm:
        p["estado"] = states[int(tree.query([p["lat"], p["lon"]])[1])]
        p["inah"] = 0
    inah = list(csv.DictReader(open(D / "INAH_zonas_arqueologicas.csv", encoding="utf-8-sig")))
    manual = {}
    if (D / "pendientes_geocodificar.csv").exists():
        for r in csv.DictReader(open(D / "pendientes_geocodificar.csv", encoding="utf-8")):
            if r.get("lat") and r.get("lon"):
                manual[r["consecutivo"]] = (float(r["lat"]), float(r["lon"]))
    pending, matched = [], 0
    for r in inah:
        st = state_key(r["estado"])
        best = max(((name_score(r["nombre"], p["name"]), p) for p in osm if p["estado"] == st and p["name"]), key=lambda x: x[0], default=(0, None))
        if best[0] >= 0.85:
            best[1]["inah"] = 1
            matched += 1
        elif r["consecutivo"] in manual:
            osm.append({"name": r["nombre"], "lat": manual[r["consecutivo"]][0], "lon": manual[r["consecutivo"]][1], "fuente": "inah-manual", "estado": st, "inah": 1})
            matched += 1
        else:
            pending.append({"consecutivo": r["consecutivo"], "estado": r["estado"], "nombre": r["nombre"], "lat": "", "lon": ""})
    sites = dedup(osm)
    with open(D / "sitios.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["name", "lat", "lon", "estado", "fuente", "inah"])
        w.writeheader()
        w.writerows({k: p[k] for k in w.fieldnames} for p in sites)
    with open(D / "pendientes_geocodificar.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["consecutivo", "estado", "nombre", "lat", "lon"])
        w.writeheader()
        w.writerows(pending)
    by_state = {}
    for p in sites:
        by_state[p["estado"]] = by_state.get(p["estado"], 0) + 1
    return {"sites": len(sites), "osm_raw": len(load_osm()), "inah_zones": len(inah), "inah_located": matched, "inah_pending": len(pending),
            "top_states": sorted(by_state.items(), key=lambda x: -x[1])[:8]}


if __name__ == "__main__":
    print(build())
