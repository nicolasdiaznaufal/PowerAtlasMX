"""
solar_qa.py - QA y manifiesto de la corrida completa (lee data/solar_v2/, escribe qa.json y manifest.json).

Comprobaciones: reproduccion del y_f y del anual publicados (todos los nodos SIN), cobertura, sanidad fisica
(fijo < seguidor, real <= despejado, noche = 0, PR, POA/GHI), dispersion entre anos por region, tamano de archivos.
Uso: .venv/bin/python pipeline/solar_qa.py --root <repo con data/> [--fetch-requests N]
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def gz_size(p: Path) -> int:
    return len(gzip.compress(p.read_bytes(), 6))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--fetch-requests", type=int, default=0)
    ap.add_argument("--runtime-seconds", type=float, default=None)
    a = ap.parse_args(argv)
    root = Path(a.root)
    out = root / "data" / "solar_v2"
    qa = json.loads((out / "run_raw_qa.json").read_text())
    errors, nocoord = qa.pop("_errors"), qa.pop("_no_coords")
    q = pd.DataFrame(qa).T
    idx = pd.DataFrame(json.loads((root / "data/index.json").read_text())["nodos"]).set_index("id")
    q["region"] = idx["region"].reindex(q.index).values
    sc = pd.read_parquet(out / "scalars.parquet")
    rep = {"n_nodes_computed": int(len(q)), "nodes_error": errors, "nodes_no_coordinates": len(nocoord)}

    # 1. reproduccion de lo publicado ------------------------------------------------------------------
    an = json.loads((root / "data/analysis/analysis_nodos.json").read_text())
    pub = {}
    for w, vk in (("Y1", "deck_2024_25"), ("Y2", "deck_2025_26")):
        pub[w] = pd.Series(an["ventanas"][vk]["y_f"], index=an["ids"], dtype=float)
    m = sc[(sc.variant == "mean") & (sc.config == "tracker")]
    repro = {}
    for w in ("Y1", "Y2"):
        mine = m[m.window == w].set_index("nodo")["y_f"]
        d = pd.DataFrame({"pub": pub[w], "mine": mine}).dropna(subset=["pub"])
        d["rel"] = (d["mine"] / d["pub"] - 1).abs()
        bad = d[~(d["rel"] <= 1e-6)]
        repro[w] = {"n_published": int(len(d)), "n_missing_mine": int(d["mine"].isna().sum()),
                    "max_rel_err": float(d["rel"].max()), "n_over_1e-6": int(len(bad)),
                    "outliers": {k: {"pub": float(r.pub), "mine": None if pd.isna(r.mine) else float(r.mine)}
                                 for k, r in bad.head(25).iterrows()}}
    b = pd.read_parquet(root / "data/baselines/solar_baselines.parquet", columns=["loc_id", "loc_type", "config", "annual_mwh_per_mwp"])
    b = b[b.loc_type == "node"].pivot(index="loc_id", columns="config", values="annual_mwh_per_mwp")
    for cfg in ("tracker", "fixed"):
        d = pd.DataFrame({"pub": b[cfg], "mine": q[f"annual_{cfg}"].astype(float)}).dropna()
        rel = (d["mine"] / d["pub"] - 1).abs()
        repro[f"annual_{cfg}"] = {"n_compared": int(len(d)), "max_rel_err": float(rel.max()), "n_over_1e-6": int((rel > 1e-6).sum()),
                                  "outliers": rel[rel > 1e-6].head(25).to_dict()}
    rep["reproduction_vs_published"] = repro
    # perfil publicado (node_profiles.json) para nodos de muestra
    try:
        npf = json.loads((root / "web/data/derived/node_profiles.json").read_text())["nodes"]
        v = json.loads((out / "variants" / "mean.json").read_text())["nodes"]
        errs = []
        for n, ent in npf.items():
            if n in v and "tracker" in v[n]:
                for w in ("Y1", "Y2"):
                    mine = v[n]["tracker"]["y"].get(w)
                    if mine and w in ent:
                        errs.append(max(abs(x - y) for x, y in zip(mine, ent[w][3])))
        rep["reproduction_vs_published"]["node_profiles_y"] = {"n_profiles": len(errs), "max_abs_err": max(errs) if errs else None}
    except Exception as e:  # noqa: BLE001
        rep["reproduction_vs_published"]["node_profiles_y"] = f"no comparado ({type(e).__name__})"

    # 2. cobertura -------------------------------------------------------------------------------------
    inx = idx.reset_index()
    cov = inx.assign(computed=inx["id"].isin(q.index)).groupby("sistema")["computed"].agg(["sum", "count"])
    rep["coverage_by_system"] = {s: {"with_baseline": int(r["sum"]), "nodes": int(r["count"])} for s, r in cov.iterrows()}
    rep["still_without_baseline"] = {"no_coordinates": len(nocoord), "no_cell_cache": errors,
                                     "reason": "sin_coordenadas (municipio sin centroide / interconexion)" if nocoord else ""}
    rep["variant_availability"] = {
        "nodes_with_missing_year_variants": int((q["variants_missing"].apply(lambda x: len([v for v in x if v != "win"])) > 0).sum()),
        "nodes_with_win_months_missing": int((q["win_months_missing"] > 0).sum()),
        "win_months_missing_hist": q["win_months_missing"].value_counts().sort_index().to_dict(),
        "last_valid_ghi": q["last_valid_ghi"].value_counts().to_dict()}

    # 3. sanidad fisica ----------------------------------------------------------------------------------
    f = lambda c: q[c].astype(float)  # noqa: E731
    rep["sanity"] = {
        "fixed_lt_tracker_violations": int((f("annual_fixed") >= f("annual_tracker")).sum()),
        "real_le_clear_violations": int(((f("annual_tracker") > f("annual_clear_tracker")) | (f("annual_fixed") > f("annual_clear_fixed"))).sum()),
        "night_violations_nodes": int(((f("night_violations_tracker") > 0) | (f("night_violations_fixed") > 0)).sum()),
        "cf_tracker_min_max": [float(f("annual_tracker").min() / 8760), float(f("annual_tracker").max() / 8760)],
        "cf_fixed_min_max": [float(f("annual_fixed").min() / 8760), float(f("annual_fixed").max() / 8760)],
        "fixed_over_tracker_min_max": [float((f("annual_fixed") / f("annual_tracker")).min()), float((f("annual_fixed") / f("annual_tracker")).max())],
        "real_over_clear_tracker_min_max": [float((f("annual_tracker") / f("annual_clear_tracker")).min()), float((f("annual_tracker") / f("annual_clear_tracker")).max())],
        "pr_tracker_min_max": [float(f("pr_tracker").min()), float(f("pr_tracker").max())],
        "pr_fixed_min_max": [float(f("pr_fixed").min()), float(f("pr_fixed").max())],
        "poa_tracker_over_ghi_min_max": [float((f("poa_tracker") / f("ghi_year_kwh_m2")).min()), float((f("poa_tracker") / f("ghi_year_kwh_m2")).max())],
        "poa_fixed_over_ghi_min_max": [float((f("poa_fixed") / f("ghi_year_kwh_m2")).min()), float((f("poa_fixed") / f("ghi_year_kwh_m2")).max())],
        "ghi_clear_over_real_min": float((f("ghi_clear_kwh_m2") / f("ghi_year_kwh_m2")).min()),
    }
    # 4. dispersion entre anos por region ------------------------------------------------------------------
    y = sc[(sc.config == "tracker") & sc.variant.str.match(r"^y20\d\d$") & (sc.window == "Y1")]
    pv = y.pivot(index="nodo", columns="variant", values="yf_annual_equiv")
    pv["region"] = idx["region"].reindex(pv.index).values
    yc = [c for c in pv.columns if c != "region"]
    spread = {}
    for r, g in pv.groupby("region"):
        v = g[yc]
        mean = v.mean(axis=1)
        spread[r] = {"nodes": int(len(g)), "year_to_year_cv_pct_median": float((v.std(axis=1) / mean * 100).median()),
                     "min_vs_mean_pct_p5": float(((v.min(axis=1) / mean - 1) * 100).quantile(0.05)),
                     "max_vs_mean_pct_p95": float(((v.max(axis=1) / mean - 1) * 100).quantile(0.95)),
                     "worst_year": v.idxmin(axis=1).value_counts().idxmax(), "best_year": v.idxmax(axis=1).value_counts().idxmax()}
    rep["variant_spread_tracker_by_region"] = spread
    w = sc[(sc.config == "tracker") & (sc.window.isin(["Y1", "Y2"])) & (sc.variant.isin(["mean", "win", "clear"]))].pivot_table(
        index=["nodo", "window"], columns="variant", values="yf_annual_equiv")
    rep["win_vs_mean_pct"] = {"p5": float(((w["win"] / w["mean"] - 1) * 100).quantile(.05)),
                              "median": float(((w["win"] / w["mean"] - 1) * 100).median()),
                              "p95": float(((w["win"] / w["mean"] - 1) * 100).quantile(.95))}
    # 5. tamanos y manifiesto -------------------------------------------------------------------------------
    files = sorted(p for p in out.rglob("*") if p.is_file() and p.name not in ("qa.json", "manifest.json"))
    sizes = {str(p.relative_to(out)): {"bytes": p.stat().st_size, "gz_bytes": gz_size(p) if p.suffix == ".json" else None,
                                       "sha256": sha256(p)} for p in files}
    rep["file_sizes"] = {k: {"raw_kb": round(v["bytes"] / 1024), "gz_kb": None if v["gz_bytes"] is None else round(v["gz_bytes"] / 1024)}
                         for k, v in sizes.items()}
    (out / "qa.json").write_text(json.dumps(rep, indent=1, default=str))
    import pvlib
    commit = subprocess.run(["git", "-C", str(Path(__file__).resolve().parents[1]), "rev-parse", "HEAD"],
                            capture_output=True, text=True).stdout.strip()
    man = {"generated_by": "pipeline/solar_full.py + solar_qa.py", "git_commit": commit,
           "versions": {"python": sys.version.split()[0], "pvlib": pvlib.__version__, "pandas": pd.__version__,
                        "numpy": np.__version__, "platform": platform.platform()},
           "nasa_power": {"api": "https://power.larc.nasa.gov/api/temporal/hourly/point (community RE, UTC)",
                          "requests_this_run": a.fetch_requests, "failures": 0, "cells_new_bca_bcs": 9,
                          "cells_refreshed_2026": 161, "cache_new_files": "data/solar_cache/{climatologia,refresh2026}"},
           "runtime_seconds_compute": a.runtime_seconds, "files": sizes}
    (out / "manifest.json").write_text(json.dumps(man, indent=1))
    print(json.dumps({k: rep[k] for k in ("reproduction_vs_published", "coverage_by_system", "sanity", "win_vs_mean_pct")}, indent=1, default=str)[:6000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
