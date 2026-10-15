"""Build docs/mockups/solar_score.html (self-contained) from data/analysis/solar_score.json."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEEP = ("id", "nombre", "region", "entidad", "municipio", "lat", "lon", "meses", "max_patch_ha", "net_viable_ha",
        "steep_pct", "flat3_pct", "landcover_excl_pct", "anp_excl_pct", "dist_hv_line_km", "dist_substation_km",
        "yf_kwh_kwp", "price_mxn_mwh", "components", "flags")
d = json.loads((ROOT / "data/analysis/solar_score.json").read_text())
d["nodes"] = [{k: n[k] for k in KEEP} for n in d["nodes"]]
tpl = (ROOT / "docs/mockups/solar_score.tpl.html").read_text()
out = ROOT / "docs/mockups/solar_score.html"
out.write_text(tpl.replace("__DATA__", json.dumps(d, ensure_ascii=False, separators=(",", ":"))))
print(out, out.stat().st_size // 1024, "KB")
