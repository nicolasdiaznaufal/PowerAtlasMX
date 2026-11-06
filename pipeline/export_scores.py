"""Export the compact per-node score file for the web app: web/data/derived/scores.json (not in git).

Merges data/analysis/solar_score.json + battery_score.json; adds the state key used by web/assets/geo/mx.json.
Run after geo_score.py and battery_score.py:  .venv/bin/python pipeline/export_scores.py
"""
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEEP = ("id", "nombre", "region", "entidad", "municipio", "lat", "lon", "meses", "max_patch_ha", "steep_pct",
        "flat3_pct", "landcover_excl_pct", "anp_excl_pct", "dist_hv_line_km", "dist_substation_km", "yf_kwh_kwp",
        "price_mxn_mwh", "cong_mxn_mwh", "components", "flags", "state", "bat", "site", "stab")


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", unicodedata.normalize("NFKD", (s or "").upper()).encode("ascii", "ignore").decode())


def build():
    geo = json.loads((ROOT / "web/assets/geo/mx.json").read_text())
    keys = {norm(s["k"]): s["k"] for s in geo["states"]}
    d = json.loads((ROOT / "data/analysis/solar_score.json").read_text())
    bs = json.loads((ROOT / "data/analysis/battery_score.json").read_text())
    for n in d["nodes"]:
        n["state"] = keys.get(norm(n.get("entidad")))
        n["bat"] = bs["nodes"].get(n["id"])
    d["nodes"] = [{k: n.get(k) for k in KEEP} for n in d["nodes"]]
    st = ROOT / "data/analysis/ranking_stability.json"
    if st.exists():   # share of weight-perturbed replicas in which the node stays in the top 50 (pipeline/ranking_stability.py)
        rs = json.loads(st.read_text())
        for n in d["nodes"]:
            n["stab"] = {k: rs[k]["nodes"][n["id"]]["top_share"] for k in ("solar", "battery") if n["id"] in rs[k]["nodes"]} or None
        d["stability_meta"] = {**rs["meta"], "robust_battery": rs["battery"]["n_robust"], "robust_solar": rs["solar"]["n_robust"]}
    d["bat_meta"] = {**bs["meta"], "generated": d["meta"]["generated"]}
    return d


if __name__ == "__main__":
    out = ROOT / "web/data/derived/scores.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(build(), ensure_ascii=False, separators=(",", ":")))
    print(out, out.stat().st_size // 1024, "KB")
