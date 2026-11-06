"""Node lifecycle from the catalog's "Control de Cambios" sheet: first/last date each NodoP key appears in a change description.
Verbs: Alta/Nuevo -> added; Baja/Elimin/Cancel -> removed; other mentions (rename, reclassification) are recorded as 'changed'.
Run: .venv/bin/python pipeline/node_lifecycle.py -> data/analysis/node_lifecycle.json"""
import glob
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
KEY = re.compile(r"\b\d\d[A-Z0-9]{3}-\d+\b")
ADD = re.compile(r"\b(alta|nuev[oa]s?|incorpor)", re.I)
DEL = re.compile(r"\b(baja|elimin|cancel|desincorpor)", re.I)


def build():
    f = sorted(glob.glob(str(ROOT / "data/ref/catalog_nodosp/Cat*NodosP*.xlsx")))[-1]
    d = pd.read_excel(f, sheet_name="Control de Cambios", header=None).iloc[:, :3]
    d.columns = ["n", "desc", "date"]
    d["date"] = pd.to_datetime(d["date"], errors="coerce")
    d = d.dropna(subset=["date"])
    cat = json.loads((ROOT / "data/analysis/catalog_nodes.json").read_text())["nodes"]
    life = {}
    for r in d.sort_values("date").itertuples():
        desc = str(r.desc)
        for k in set(KEY.findall(desc)):
            e = life.setdefault(k, {"added": None, "removed": None, "changed": []})
            day = r.date.strftime("%Y-%m-%d")
            # look at the sentence fragment that holds the key to decide the verb
            frag = next((p for p in re.split(r"[.;]", desc) if k in p), desc)
            if DEL.search(frag):
                e["removed"] = day
            elif ADD.search(frag):
                e["added"] = e["added"] or day
            else:
                e["changed"].append(day)
    for k, e in life.items():
        e["in_catalog"] = k in cat
    return {"meta": {"changes": len(d), "last_change": d["date"].max().strftime("%Y-%m-%d"), "keys": len(life),
                     "added": sum(1 for e in life.values() if e["added"]), "removed": sum(1 for e in life.values() if e["removed"])},
            "nodes": life}


if __name__ == "__main__":
    out = build()
    (ROOT / "data/analysis/node_lifecycle.json").write_text(json.dumps(out))
    print(out["meta"])
