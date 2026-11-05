"""Export web/data/derived/network.json for the Network Atlas window (not in git, like scores.json).

Per node: catalog (voltage, load/generation type, transmission/distribution zones), coordinates, battery score, day-ahead vs
real-time (MTR) gap, congestion. Lines: OpenStreetMap power lines (c) OpenStreetMap contributors, ODbL 1.0, via the atlas-sen
extract in data/ref/osm. Run after battery_score.py:  .venv/bin/python pipeline/export_network.py
"""
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
R = lambda x, d=0: None if x is None else round(x, d)


def build():
    idx = {x["id"]: x for x in json.loads((ROOT / "web/data/index.json").read_text())["nodos"] if x.get("valido")}
    cat = json.loads((ROOT / "data/analysis/catalog_nodes.json").read_text())
    bs = json.loads((ROOT / "data/analysis/battery_score.json").read_text())["nodes"]
    nodes = []
    for i, x in idx.items():
        c, b = cat["nodes"].get(i), bs.get(i)
        if not c or x.get("lat") is None:
            continue
        rt = (b or {}).get("rt") or {}
        nodes.append({
            "id": i, "n": c["nombre"], "la": R(x["lat"], 4), "lo": R(x["lon"], 4), "kv": c["kv"], "sis": c["sis"],
            "crc": c["crc"], "zc": c["zc"], "carga": c["carga"], "gen": c["gen"], "zot": c["zot"], "grt": c["grt"],
            "zd": c["zd"], "gdd": c["gdd"], "ent": c["ent"], "mun": c["mun"],
            "score": b and b["score"], "mda4": b and b["rule_4h"], "mtr4": rt.get("mtr_kw_yr_4h"),
            "gap": rt.get("dev_mean"), "gapsd": rt.get("dev_p95_abs"), "mtrsp": rt.get("mtr_spread_med"),
            "spread": b and b["spread_med"], "cong": b and b["cong_mean"], "sat": b and b["sat"] and b["sat"]["sat"],
            "pay": b and b["econ_4h"]["payback_yr"]})
    raw = json.loads((ROOT / "data/ref/osm/osm_lines_odbl.json").read_text())
    lines = [[int(kv), [[round(a, 3), round(o, 3)] for a, o in pts]] for kv, pts in raw if len(pts) > 1]
    meta = {"generated": time.strftime("%Y-%m-%d"), "catalog": cat["meta"]["source"], "n_nodes": len(nodes),
            "n_lines": len(lines), "lines_credit": "© OpenStreetMap contributors (ODbL 1.0)"}
    return {"meta": meta, "nodes": nodes, "lines": lines}


if __name__ == "__main__":
    out = ROOT / "web/data/derived/network.json"
    out.write_text(json.dumps(build(), ensure_ascii=False, separators=(",", ":")))
    print(out, out.stat().st_size // 1024, "KB")
