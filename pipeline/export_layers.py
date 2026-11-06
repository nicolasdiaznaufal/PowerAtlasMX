"""Export web/data/derived/layers.json: the reference map layers shown in Network Atlas (not in git).
substations (OSM <=161 kV, ODbL), international ties (OSM, ODbL; atlas-sen), archaeology points (OSM + INAH list), indigenous localities
(INEGI ITER 2020, share >= cfg threshold), major roads (INEGI RNC 2025, federal/state, binned to ~5 km cells).
Run: .venv/bin/python pipeline/export_layers.py"""
import csv
import json
import time
from pathlib import Path

import numpy as np

import indig_layer

ROOT = Path(__file__).resolve().parents[1]
AS = ROOT / "data/ref/geo/grid/atlas-sen"


def build():
    cfg = json.loads((ROOT / "config/site_risk.json").read_text())["indig"]
    subs = json.loads((AS / "data/derived/osm_substations.json").read_text())["subs"]
    ties = json.loads((AS / "public/data/international_ties.json").read_text())
    arch = [[round(float(r["lat"]), 4), round(float(r["lon"]), 4), r["name"], int(r["inah"] or 0)]
            for r in csv.DictReader(open(ROOT / "data/ref/geo/arqueologia/sitios.csv", encoding="utf-8"))]
    df, info = indig_layer.load_iter(cfg)
    ind = df[df["is_ind"]]
    indig = [[round(float(a), 3), round(float(b), 3), int(p)] for a, b, p in zip(ind["lat"], ind["lon"], ind["ind"])]
    z = np.load(ROOT / "data/cache/roads_pts.npz", allow_pickle=True)
    hw = z["hw"]
    cells = np.unique(np.round(np.column_stack([z["lat"][hw], z["lon"][hw]]) * 20).astype(int), axis=0) / 20   # 0.05 deg ~ 5 km
    roads = [[round(float(a), 2), round(float(b), 2)] for a, b in cells]
    return {"meta": {"generated": time.strftime("%Y-%m-%d"), "indig_info": {k: (float(v) if hasattr(v, "item") else v) for k, v in info.items()},
                     "credit": "Substations, lines and ties: © OpenStreetMap contributors (ODbL). Archaeology: OSM + INAH open-zones list. Indigenous: INEGI Censo 2020 ITER. Roads: INEGI RNC 2025."},
            "subs": [[s[0], s[1], s[2], s[3], s[5]] for s in subs] if isinstance(subs[0], list) else
                    [[s["lat"], s["lng"], s["band"], s["name"], s.get("voltage")] for s in subs],
            "ties": ties, "arch": arch, "indig": indig, "roads": roads}


if __name__ == "__main__":
    d = build()
    out = ROOT / "web/data/derived/layers.json"
    out.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
    print(out.stat().st_size // 1024, "KB;", {k: len(v) for k, v in d.items() if isinstance(v, list)})
