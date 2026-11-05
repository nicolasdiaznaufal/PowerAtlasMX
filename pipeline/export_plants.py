"""Export web/data/derived/plants.json: power plants with coordinates and permit status for Network Atlas (not in git).

Sources: data/ref/geo/grid/centrales/CentralesElectricas.csv (plant list, Web Mercator X/Y, CRE permit number and phase) and
data/ref/osm/permisos_cne_atlas_sen.json (CNE permit modality, grant and expiry dates, holder; from atlas-sen, CC-BY 4.0).
Permit status is read from the phase text; grant/expiry dates exist only for plants matched by permit number.
Run:  .venv/bin/python pipeline/export_plants.py
"""
import json
import math
import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
R = 6378137.0
STATUS = [("retirada", "retired"), ("cancel", "cancelled"), ("suspend", "cancelled"), ("revoc", "revoked"), ("reovoc", "revoked"),
          ("terminado", "ended"), ("caduc", "ended"), ("negado", "denied"), ("sin permiso", "none"), ("solicitado", "requested")]


def lonlat(x, y):
    return math.degrees(x / R), math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)


def status_of(fase: str, has_num: bool) -> str:
    f = str(fase).lower()
    for key, st in STATUS:
        if key in f:
            return st
    if "operaci" in f:
        return "operating"
    if "construcci" in f:
        return "building"
    return "permit" if "con permiso" in f else ("permit" if has_num else "none")


def build():
    d = pd.read_csv(ROOT / "data/ref/geo/grid/centrales/CentralesElectricas.csv").dropna(subset=["X", "Y"])
    perm = json.loads((ROOT / "data/ref/osm/permisos_cne_atlas_sen.json").read_text())
    by_num = {v["num"]: v for v in perm["byPlant"].values() if v.get("num")}
    rows = []
    for r in d.itertuples(index=False):
        lo, la = lonlat(r.X, r.Y)
        if not (-120 < lo < -85 and 14 < la < 33.5):
            continue
        num = r[13] if isinstance(r[13], str) else None
        pm = by_num.get(num, {})
        yr = pd.to_numeric(r[7], errors="coerce")
        rows.append({"n": r.Nombre, "co": r.Empresa if isinstance(r.Empresa, str) else "", "t": r[2], "fase": str(r.Fase).strip(),
                     "st": status_of(r.Fase, bool(num)), "mw": None if pd.isna(r[8]) else round(float(r[8]), 1),
                     "yr": None if pd.isna(yr) else int(yr), "ent": r.Entidad, "mod": r.Modalidad, "num": num,
                     "grant": pm.get("otorgamiento"), "exp": pm.get("vencimiento"), "mlab": pm.get("modLabel"),
                     "holder": pm.get("titular"), "lo": round(lo, 4), "la": round(la, 4)})
    meta = {"generated": time.strftime("%Y-%m-%d"), "n": len(rows), "with_dates": sum(1 for x in rows if x["grant"]),
            "permits_source": perm["source"]["label"], "note": perm["notaVigencia"]}
    return {"meta": meta, "plants": rows}


if __name__ == "__main__":
    out = ROOT / "web/data/derived/plants.json"
    out.write_text(json.dumps(build(), ensure_ascii=False, separators=(",", ":")))
    print(out, out.stat().st_size // 1024, "KB")
