"""Parse CENACE "Catálogo de NodosP" (xlsx) into a compact per-node JSON used by battery scoring and Network Atlas.

Fields kept per node (clave -> record): kv (voltage), load/gen modelling type, transmission and distribution
zones, state and municipality. Modelling types: "D" directly modelled, "I" indirectly modelled, "" not applicable.
Run: .venv/bin/python pipeline/catalog_nodes.py [xlsx]   ->  data/analysis/catalog_nodes.json
"""
import glob
import json
import sys
import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
COLS = ["sis", "crc", "zc", "clave", "nombre", "kv", "carga_dir", "carga_ind", "gen_dir", "gen_ind",
        "zot", "grt", "zd", "gdd", "cve_ent", "ent", "cve_mun", "mun", "reg_trans"]


def latest_catalog() -> Path:
    files = sorted(glob.glob(str(ROOT / "data/ref/catalog_nodosp/Cat*NodosP*.xlsx")))
    if not files:
        raise FileNotFoundError("no catalog xlsx in data/ref/catalog_nodosp")
    return Path(files[-1])   # names end with (vYYYY-MM-DD): lexical order = chronological


def _flag(v, direct, indirect) -> str:
    s = str(v)
    return "D" if s == direct else ("I" if s == indirect else "")


def parse(path: Path) -> dict:
    d = pd.read_excel(path, sheet_name=0, header=1)
    if len(d.columns) != len(COLS):
        raise ValueError(f"unexpected catalog layout: {len(d.columns)} columns")
    d.columns = COLS
    nodes = {}
    for r in d.itertuples(index=False):
        carga = _flag(r.carga_dir, "Directamente Modelada", "") or _flag(r.carga_ind, "", "Indirectamente Modelada")
        gen = _flag(r.gen_dir, "Directamente Modelada", "") or _flag(r.gen_ind, "", "Indirectamente Modelada")
        nodes[str(r.clave).strip()] = {
            "nombre": str(r.nombre).strip(), "sis": r.sis, "crc": r.crc, "zc": r.zc, "kv": float(r.kv),
            "carga": carga, "gen": gen, "zot": r.zot, "grt": r.grt, "zd": r.zd, "gdd": r.gdd,
            "ent": r.ent, "mun": r.mun, "reg": r.reg_trans}
    return nodes


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else latest_catalog()
    nodes = parse(src)
    meta = {"source": src.name, "n": len(nodes), "generated": time.strftime("%Y-%m-%d"),
            "kv_levels": sorted({v["kv"] for v in nodes.values()}),
            "n_gen": sum(1 for v in nodes.values() if v["gen"]), "n_carga": sum(1 for v in nodes.values() if v["carga"])}
    dest = ROOT / "data/analysis/catalog_nodes.json"
    dest.write_text(json.dumps({"meta": meta, "nodes": nodes}, ensure_ascii=False))
    print(meta)


if __name__ == "__main__":
    main()
