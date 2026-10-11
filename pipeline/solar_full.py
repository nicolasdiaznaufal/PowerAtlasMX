"""
solar_full.py - Corrida completa de solar v2: todos los nodos x config (tracker, fixed) x variantes de clima.

Entradas (solo lectura): data/index.json (lat/lon/sistema/region), data/cache/nasa/climatologia/celdas (161
celdas, 2015-2026-06), data/solar_cache/refresh2026 (2026 hasta 2026-07-31, archivos nuevos) y
data/solar_cache/climatologia (9 celdas BCA/BCS completas), data/aggregates/agregados_comunes.parquet (n_horas).
Salidas (data/solar_v2/, git-ignored, archivos nuevos):
    tables_month_hour.parquet  nodo, config(tracker|fixed), variant, key(mes 1..12 | anio-mes), nd, y[24] float64
    scalars.parquet            nodo, config, variant, window, n_horas, y_f, yf_annual_equiv
    variants/{variant}.json    perfil y 24 h por ventana (n_horas-ponderado, como node_profiles) + irradiancia
    scalars.json               y_f / yf_annual_equiv por nodo x config x variante x ventana (web, lazy)
    qa.json, manifest.json
Uso: .venv/bin/python pipeline/solar_full.py --root <repo con data/> [--limit N] [--workers 8]
"""
from __future__ import annotations

import argparse
import json
import math
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

try:
    import solar
    import solar_scenarios as sc
    import solar_variants as sv
except ImportError:
    from pipeline import solar, solar_scenarios as sc, solar_variants as sv

CFGS = ("tracker", "fixed")
WEB = {"tracker": "tracker", "fixed": "fijo"}


def load_cell(root: Path, la0: int, lo0: int) -> pd.DataFrame | None:
    """Serie horaria de la celda: completa nueva (BCA/BCS) o la cache vieja con 2026 reemplazado por el refresh."""
    name = f"celda_{la0:+03d}_{lo0:+04d}.parquet"
    full = root / "data/solar_cache/climatologia/celdas" / name
    if full.exists():
        return solar.load_climate_cell(full)
    old = root / "data/cache/nasa/climatologia/celdas" / name
    if not old.exists():
        return None
    df = solar.load_climate_cell(old)
    new = root / "data/solar_cache/refresh2026/celdas" / name
    if new.exists():
        n = solar.load_climate_cell(new)
        df = pd.concat([df[df.index < n.index.min()], n]).sort_index()
        df = df[~df.index.duplicated(keep="last")]
    return df


def _r(a, nd):
    return [None if not np.isfinite(x) else round(float(x), nd) for x in np.asarray(a, float)]


def process_node(job) -> dict:
    nodo, system, lat, lon, root, rows = job
    t0 = time.time()
    df = load_cell(Path(root), *solar.cell_of(lat, lon))
    if df is None:
        return {"nodo": nodo, "error": "sin_celda"}
    r = sc.run_scenarios(df, lat, lon)
    tabs = {k: sv.build_tables(v) for k, v in r.items()}
    out = {"nodo": nodo, "system": system, "lat": lat, "lon": lon, "ytab": {}, "scal": [], "prof": {}, "irr": {}, "qa": {}}
    qa = out["qa"]
    for cfg in CFGS:
        real, clear = tabs[("real", cfg)], tabs[("clear", cfg)]["mean"]
        ann = {"real": sv.annual_equiv(real["mean"]), "clear": sv.annual_equiv(clear)}
        qa[f"annual_{cfg}"], qa[f"annual_clear_{cfg}"] = ann["real"], ann["clear"]
        poa_a = float(np.sum(sv.monthly_kwh_m2(real["mean"], "poa")))
        qa[f"poa_{cfg}"] = poa_a
        qa[f"pr_{cfg}"] = ann["real"] / poa_a if poa_a else float("nan")
        loc = r[("real", cfg)]
        qa[f"night_violations_{cfg}"] = int((loc.loc[loc["ghi_wm2"] == 0, "energy_mwh_per_mwp"] > 1e-12).sum())
        yt = {"clear": clear}
        for v in sv.WEATHER_VARIANTS:
            yt[v] = real[v]
        out["ytab"][cfg] = {
            "mean": real["mean"]["y"], "nd_mean": real["mean"]["nd"], "win": real["win"]["y"], "nd_win": real["win"]["nd"],
            "clear": clear["y"], "nd_clear": clear["nd"],
            **{v: (real[v]["y"] if real[v] is not None else None) for v in sv.YEAR_VARIANTS}}
        for v in sv.ALL_VARIANTS:
            tab = yt[v]
            win = v == "win"
            for w in sv.WINDOWS:
                n, yf, prof = sv.yf_and_profile(tab, rows, w, win)
                eq = float("nan")
                if w in ("Y1", "Y2"):
                    eq = sv.annual_equiv(tab, "y", w) if win else sv.annual_equiv(tab, "y")
                out["scal"].append((cfg, v, w, n, yf, eq))
                if w in ("Y1", "Y2"):
                    out["prof"].setdefault(v, {}).setdefault(cfg, {})[w] = prof if np.all(np.isfinite(prof)) else None
                    for q, key in (("ghi", "ghi"), ("poa", f"poa_{cfg}")):
                        if q == "ghi" and cfg != "tracker":
                            continue
                        d = out["irr"].setdefault(v, {}).setdefault(key, {})
                        d[w] = sv.typical_day(tab, q, w, win)
                        d["m" + w if win else "m"] = sv.monthly_kwh_m2(tab, q, w if win else None)
    out["qa"]["seconds"] = round(time.time() - t0, 2)
    out["qa"]["ghi_year_kwh_m2"] = float(np.sum(sv.monthly_kwh_m2(tabs[("real", "tracker")]["mean"], "ghi")))
    out["qa"]["ghi_clear_kwh_m2"] = float(np.sum(sv.monthly_kwh_m2(tabs[("clear", "tracker")]["mean"], "ghi")))
    out["qa"]["variants_missing"] = [v for v in sv.WEATHER_VARIANTS if tabs[("real", "tracker")][v] is None]
    out["qa"]["win_months_missing"] = int((tabs[("real", "tracker")]["win"]["nd"] == 0).sum())
    out["qa"]["ghi_pct_missing"] = float(100 * df["ghi_wm2"].isna().mean())
    out["qa"]["last_valid_ghi"] = str(df.index[df["ghi_wm2"].notna()].max())
    return out


def comunes_rows(root: Path, nodos) -> dict:
    c = pd.read_parquet(root / "data/aggregates/agregados_comunes.parquet",
                        columns=["nodo", "anio", "mes", "hora", "n_horas"], filters=[("anio", ">=", 2024)])
    c = c[c["nodo"].isin(set(nodos))]
    c["ym"] = c["anio"] * 100 + c["mes"]
    c = c[(c["ym"] >= 202408) & (c["ym"] <= 202607)]
    return {k: g[["ym", "hora", "n_horas"]].to_numpy(float) for k, g in c.groupby("nodo")}


def write_outputs(res: list[dict], out: Path, idx: pd.DataFrame) -> dict:
    (out / "variants").mkdir(parents=True, exist_ok=True)
    trows, srows, scal_json = [], [], {}
    for r in res:
        n = r["nodo"]
        for cfg, y in r["ytab"].items():
            for v in ("mean", *sv.YEAR_VARIANTS, "clear"):
                a = y[v]
                if a is None:
                    continue
                nd = y["nd_mean"] if v == "mean" else (y["nd_clear"] if v == "clear" else None)
                for m in range(12):
                    trows.append((n, cfg, v, m + 1, float(nd[m]) if nd is not None else float("nan"), a[m].tolist()))
            for i, ym in enumerate(sv.WIN_YM):
                trows.append((n, cfg, "win", ym, float(y["nd_win"][i]), y["win"][i].tolist()))
        for cfg, v, w, nh, yf, eq in r["scal"]:
            srows.append((n, cfg, v, w, nh, yf, eq))
            d = scal_json.setdefault(n, {}).setdefault(WEB[cfg], {}).setdefault(v, {"yf": {}, "eq": {}})
            d["yf"][w] = None if not np.isfinite(yf) else round(yf, 3)
            if w in ("Y1", "Y2"):
                d["eq"][w] = None if not np.isfinite(eq) else round(eq, 3)
        scal_json[n]["n"] = {w: int(next(s[3] for s in r["scal"] if s[2] == w)) for w in sv.WINDOWS}
    pd.DataFrame(trows, columns=["nodo", "config", "variant", "key", "nd", "y"]).to_parquet(
        out / "tables_month_hour.parquet", compression="zstd", index=False)
    pd.DataFrame(srows, columns=["nodo", "config", "variant", "window", "n_horas", "y_f", "yf_annual_equiv"]).to_parquet(
        out / "scalars.parquet", compression="zstd", index=False)
    (out / "scalars.json").write_text(json.dumps(
        {"schema": "solar_v2/1", "units": {"yf": "MWh/MWp over the window's PML hours (not annualised)",
                                           "eq": "MWh/MWp-year of the variant (information only)", "n": "PML hours in window"},
         "variants": list(sv.ALL_VARIANTS), "windows": {k: list(v) for k, v in sv.WINDOWS.items()},
         "nodes": scal_json}, separators=(",", ":")))
    for v in sv.ALL_VARIANTS:
        nodes = {}
        for r in res:
            p = r["prof"].get(v)
            if not p:
                continue
            ent = {WEB[c]: {"y": {w: (None if a is None else _r(a, 4)) for w, a in d.items()}} for c, d in p.items()}
            ent["irr"] = {k: {kk: _r(a, 4 if len(a) == 24 else 1) for kk, a in d.items()} for k, d in r["irr"][v].items()}
            nodes[r["nodo"]] = ent
        doc = {"schema": "solar_v2/1", "variant": v,
               "units": {"y": "MWh/MWp per hour (= kWh/kWp), n_horas-weighted mean over the window, CDMX hours 0..23",
                         "irr.*.Y1/Y2": "kWh/m2 per hour, day-weighted typical day of the window",
                         "irr.*.m": "kWh/m2 per month, Jan..Dec (mean, yYYYY, clear); win: mY1/mY2 = Aug..Jul"},
               "nodes": nodes}
        (out / "variants" / f"{v}.json").write_text(json.dumps(doc, separators=(",", ":")))
    return {"tables_rows": len(trows), "scalar_rows": len(srows)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args(argv)
    root = Path(a.root)
    out = Path(a.out) if a.out else root / "data" / "solar_v2"
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    idx = pd.DataFrame(json.loads((root / "data/index.json").read_text())["nodos"])
    skipped = idx[idx["lat"].isna()]
    idx = idx.dropna(subset=["lat"]).reset_index(drop=True)
    if a.limit:
        idx = idx.iloc[:a.limit]
    rows = comunes_rows(root, idx["id"])
    jobs = [(r.id, r.sistema, float(r.lat), float(r.lon), str(root), rows.get(r.id, np.zeros((0, 3)))) for r in idx.itertuples()]
    with ProcessPoolExecutor(a.workers) as ex:
        res = list(ex.map(process_node, jobs, chunksize=8))
    bad = [r for r in res if "error" in r]
    good = [r for r in res if "error" not in r]
    info = write_outputs(good, out, idx)
    (out / "run_raw_qa.json").write_text(json.dumps(
        {r["nodo"]: {**r["qa"], "system": r["system"]} for r in good} | {"_errors": {r["nodo"]: r["error"] for r in bad},
                                                                         "_no_coords": skipped["id"].tolist()},
        separators=(",", ":"), default=float))
    print(json.dumps({"nodes_ok": len(good), "nodes_error": len(bad), "no_coords": len(skipped), **info,
                      "seconds": round(time.time() - t0)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
