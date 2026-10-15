"""Build docs/mockups/solar_score.html (self-contained, no map tiles) from solar_score.json + battery_score.json."""
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
M = ROOT / "docs/mockups"
KEEP = ("id", "nombre", "region", "entidad", "municipio", "lat", "lon", "meses", "max_patch_ha", "steep_pct",
        "flat3_pct", "landcover_excl_pct", "anp_excl_pct", "dist_hv_line_km", "dist_substation_km", "yf_kwh_kwp",
        "price_mxn_mwh", "cong_mxn_mwh", "components", "flags", "state", "bat")


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", unicodedata.normalize("NFKD", (s or "").upper()).encode("ascii", "ignore").decode())


geo = json.loads((ROOT / "web/assets/geo/mx.json").read_text())
by_name = {norm(s["n"]): s["k"] for s in geo["states"]}
by_name.update({norm(s["k"]): s["k"] for s in geo["states"]})
keys = {s["k"] for s in geo["states"]}
d = json.loads((ROOT / "data/analysis/solar_score.json").read_text())
miss = set()
for n in d["nodes"]:
    k = by_name.get(norm(n.get("entidad")))
    n["state"] = k if k in keys else None
    if n["state"] is None:
        miss.add(n.get("entidad"))
bs = json.loads((ROOT / "data/analysis/battery_score.json").read_text())
for n in d["nodes"]:
    n["bat"] = bs["nodes"].get(n["id"])
d["bat_meta"] = {**bs["meta"], "generated": d["meta"]["generated"]}
d["nodes"] = [{k: n.get(k) for k in KEEP} for n in d["nodes"]]
html = (M / "solar_score.tpl.html").read_text()
for tag, val in (("/*CSS*/", (M / "solar_score.css").read_text()), ("/*JS*/", (M / "solar_score.js").read_text()),
                 ("/*DATA*/", json.dumps(d, ensure_ascii=False, separators=(",", ":"))),
                 ("/*GEO*/", json.dumps({k: geo[k] for k in ("proj", "scale", "states", "regions")}, separators=(",", ":")))):
    html = html.replace(tag, val)
(M / "solar_score.html").write_text(html)
print("built", (M / "solar_score.html").stat().st_size // 1024, "KB; states unmatched:", sorted(map(str, miss)))
