"""Battery Score (draft) per node: relative ranking of MDA arbitrage potential + illustrative MXN economics.

Inputs: data/analysis/battery_metrics.json, solar_score.json (grid distances, node info), subs_verified.csv.
Out: data/analysis/battery_score.json. Weights/costs: config/battery_score.json. No verdict colour.
"""
import csv
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CFG = json.loads((ROOT / "config/battery_score.json").read_text())


def unit(x, lo, hi):
    return float(min(1.0, max(0.0, (x - lo) / (hi - lo))))


def strict(comp, w):
    tw = sum(w.values())
    return 100 * math.exp(sum(w[c] * math.log(max(v, .02)) for c, v in comp.items()) / tw)


def economics(value_kw_yr, hours):
    c = CFG["cost"]
    capex = c["power_mxn_per_kw"] + c["energy_mxn_per_kwh"] * hours            # MXN/kW
    r, n = c["discount_rate"], c["life_years"]
    crf = r / (1 - (1 + r) ** -n)
    om = capex * c["om_pct_capex_yr"] / 100
    net = value_kw_yr - om
    return {"capex_mxn_kw": round(capex), "annual_cost_mxn_kw": round(capex * crf + om),
            "coverage": round(value_kw_yr / (capex * crf + om), 2),
            "payback_yr": round(capex / net, 1) if net > 0 else None}


def main():
    bm = json.loads((ROOT / "data/analysis/battery_metrics.json").read_text())["nodes"]
    sol = {r["id"]: r for r in json.loads((ROOT / "data/analysis/solar_score.json").read_text())["nodes"]}
    sat = {r["clave"]: r for r in csv.DictReader(open(ROOT / "data/analysis/subs_verified.csv"))}
    ids = [i for i in bm if i in sol]

    def col(k):
        return np.array([bm[i][k] for i in ids if bm[i].get(k) is not None], dtype=float)
    S = CFG["scales"]
    pc = lambda k, key: (float(np.percentile(col(k), S[key][0])), float(np.percentile(col(k), S[key][1])))
    sc = {"value": pc("rule_kw_yr_4h", "value_pctl"), "spread": pc("spread_med", "spread_pctl"),
          "negative": pc("neg_share_pct", "negative_pctl"), "congvol": pc("cong_std", "congvol_pctl")}
    out, p0, p1 = {}, *CFG["saturation_penalty_pts"]
    for i in ids:
        m, s = bm[i], sol[i]
        comp = {
            "value": unit(m["rule_kw_yr_4h"], *sc["value"]),
            "spread": unit(m["spread_med"], *sc["spread"]),
            "predictability": unit(m["capture_4h"] or 0, *S["capture"]),
            "negative": unit(m["neg_share_pct"], *sc["negative"]),
            "congvol": unit(m["cong_std"], *sc["congvol"]),
            "grid": 1 - unit(min(s["dist_hv_line_km"], s["dist_substation_km"]), *S["grid_km"]),
        }
        flags = []
        if m["cong_mean"] > CFG["structural_congestion_mxn_mwh"]:
            flags.append("structural congestion (mean congestion above %d MXN/MWh)" % CFG["structural_congestion_mxn_mwh"])
        sv, pen = sat.get(i), 0.0
        sat_info = None
        if sv:
            f = lambda k: float(sv[k]) if sv[k] not in ("", None) else None
            x = f("saturacion")
            sat_info = {"mva": f("capacidad_mva"), "gen_mw": f("generacion_conectada_mw"), "sat": x}
            x = x or 0.0
            if x > 0:
                pen = p0 + (p1 - p0) * min(1.0, x / 5.0)
        out[i] = {"components": {k: round(v, 3) for k, v in comp.items()}, "pen": round(pen, 1), "sat": sat_info,
                  "flags": flags, "spread_med": round(m["spread_med"]), "spread_p90": round(m["spread_p90"]),
                  "rule_2h": round(m["rule_kw_yr_2h"]), "rule_4h": round(m["rule_kw_yr_4h"]),
                  "pf_4h": round(m["pf_kw_yr_4h"]), "capture_4h": round(m["capture_4h"] or 0, 2),
                  "neg_pct": round(m["neg_share_pct"], 2), "cong_std": round(m["cong_std"]),
                  "cong_mean": round(m["cong_mean"]), "econ_2h": economics(m["rule_kw_yr_2h"], 2),
                  "econ_4h": economics(m["rule_kw_yr_4h"], 4)}
        out[i]["score"] = round(max(0.0, strict(comp, CFG["weights"]) - pen), 1)
    sc_v = [v["score"] for v in out.values()]
    meta = {"config": CFG, "n": len(out), "scales": {k: [round(a, 2) for a in v] for k, v in sc.items()},
            "verified_subs": len(sat), "saturated": sum(1 for v in out.values() if v["pen"] > 0)}
    (ROOT / "data/analysis/battery_score.json").write_text(json.dumps({"meta": meta, "nodes": out}))
    print(meta["n"], "nodes; score pctl 10/50/90:", [round(float(np.percentile(sc_v, p)), 1) for p in (10, 50, 90)],
          "| saturated:", meta["saturated"])
    cov = np.array([v["econ_4h"]["coverage"] for v in out.values()])
    print("4h coverage ratio pctl 50/90/max:", [round(float(np.percentile(cov, p)), 2) for p in (50, 90)], round(cov.max(), 2),
          "| nodes with payback:", sum(1 for v in out.values() if v["econ_4h"]["payback_yr"]))


if __name__ == "__main__":
    main()
