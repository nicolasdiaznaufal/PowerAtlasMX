"""Grid strength per catalog node from the CENACE short-circuit levels (RNT 2028).
Join: catalog clave[2:] == acronym-kV of the document; repeated acronyms are resolved by regional management, then by normalised name.
Ssc_min = sqrt(3) * kV * Icc3F_min (MVA); SCR_ref = Ssc_min / P_ref; max_mw_scr3 = Ssc_min / 3. Prioritisation filter, not an interconnection study.
Run: .venv/bin/python pipeline/strength.py  -> data/analysis/strength.json"""
import csv
import difflib
import json
import math
from collections import defaultdict
from pathlib import Path

from norm_name import norm_name

ROOT = Path(__file__).resolve().parents[1]
CC = ROOT / "data/ref/cenace/cortocircuito_2028.csv"
REG = {"OCCIDENTAL": "Occidental", "ORIENTAL": "Oriental", "NORESTE": "Noreste", "NORTE": "Norte", "CENTRAL": "Central",
       "NOROESTE": "Noroeste", "BAJA CALIFORNIA": "Baja California", "BAJA CALIFORNIA SUR": "Baja California", "PENINSULAR": "Peninsular"}


def build(p_ref=100.0, icc_max_flag=40.0):
    rows = list(csv.DictReader(open(CC, encoding="utf-8")))
    by = defaultdict(list)
    for r in rows:
        by[r["acr_kv"]].append(r)
    cat = json.loads((ROOT / "data/analysis/catalog_nodes.json").read_text())["nodes"]
    out, how = {}, {"direct": 0, "region": 0, "name": 0, "none": 0}
    for k, c in cat.items():
        cand = by.get(k[2:], [])
        if not cand:
            how["none"] += 1
            continue
        mode = "direct"
        if len(cand) > 1:
            reg = [r for r in cand if r["region"] == REG.get(c["crc"])]
            if len(reg) == 1:
                cand, mode = reg, "region"
            else:
                pool = reg or cand
                nm = norm_name(c["nombre"], True)
                best = max(pool, key=lambda r: difflib.SequenceMatcher(None, nm, norm_name(r["name"], True)).ratio())
                cand, mode = [best], "name"
        r = cand[0]
        ssc = math.sqrt(3) * float(r["kv"]) * float(r["icc3f_min"])
        out[k] = {"ssc_min_mva": round(ssc, 1), "scr_ref": round(ssc / p_ref, 2), "max_mw_scr3": round(ssc / 3, 0),
                  "icc3f_min_ka": float(r["icc3f_min"]), "icc3f_max_ka": float(r["icc3f_max"]), "match": mode,
                  "icc_flag": float(r["icc3f_max"]) > icc_max_flag}
        how[mode] += 1
    return {"meta": {"source": "Niveles de cortocircuito RNT 2028 (CENACE, nov 2025)", "p_ref_mw": p_ref, "n_catalog": len(cat),
                     "n_matched": len(out), "match": how, "rows_in_document": len(rows)}, "nodes": out}


if __name__ == "__main__":
    d = build()
    (ROOT / "data/analysis/strength.json").write_text(json.dumps(d))
    print(d["meta"])
