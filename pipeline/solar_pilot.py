"""
solar_pilot.py - Piloto Fase 0 (5-10 nodos): reproduce el seguidor publicado y agrega fijo / despejado /
irradiancia. Solo lectura sobre data/ del checkout principal (--data-root); cache nueva (BCS/BCA) en
--extra-cache (data/solar_cache/climatologia, git-ignored).

Uso:  .venv/bin/python pipeline/solar_pilot.py --data-root <repo con data/> --out data/solar_cache/pilot
Salida: pilot_summary.csv, pilot_arrays.json (todo bajo data/, no se versiona).
"""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import pandas as pd

try:
    import solar
    import solar_scenarios as sc
except ImportError:
    from pipeline import solar, solar_scenarios as sc

PILOT = ["01AAN-85", "03MMN-230", "08NCM-115", "05ITC-115", "04AAM-115", "06BRL-115", "02MCN-115",
         "08AKD-115", "07BLE-115", "07CHQ-230"]
WINDOWS = {"Y1": ("2024-08", "2025-07"), "Y2": ("2025-08", "2026-07")}


def find_cell(data_root: Path, extra: Path | None, lat: float, lon: float) -> Path:
    la0, lo0 = solar.cell_of(lat, lon)
    for base in ([extra] if extra else []) + [data_root / "data" / "cache" / "nasa" / "climatologia"]:
        p = Path(base) / "celdas" / f"celda_{la0:+03d}_{lo0:+04d}.parquet"
        if p.exists():
            return p
    raise FileNotFoundError(f"celda {la0},{lo0} no esta en la cache")


def published_yf(data_root: Path, nodo: str, mh_tracker: pd.DataFrame) -> dict:
    """y_f publicado (analysis_nodos, ventana deck_2024_25) y su reconstruccion = sum(n_horas x y(mes,hora)) con
    las horas con PML del nodo (agregados_comunes). n_horas<8760 => y_f NO es anual (no se anualiza)."""
    a = json.loads((data_root / "data/analysis/analysis_nodos.json").read_text())
    if nodo not in a["ids"]:
        return {}
    i = a["ids"].index(nodo)
    v = a["ventanas"]["deck_2024_25"]
    c = pd.read_parquet(data_root / "data/aggregates/agregados_comunes.parquet", filters=[("nodo", "==", nodo)])
    ym = c["anio"] * 100 + c["mes"]
    c = c[(ym >= 202408) & (ym <= 202507)]
    y = mh_tracker.set_index(["month", "hour"])["y"]
    rec = float(sum(r.n_horas * y.get((r.mes, r.hora), np.nan) for r in c.itertuples()))
    return {"yf_published": v["y_f"][i], "n_horas_published": v["n_horas"][i], "yf_rebuilt": rec}


def run_node(data_root: Path, extra: Path | None, nodo: str, lat: float, lon: float, system: str) -> tuple[dict, dict]:
    t0 = time.time()
    df = solar.load_climate_cell(find_cell(data_root, extra, lat, lon))
    r = sc.run_scenarios(df, lat, lon)
    mh = {k: sc.month_hour_table(v) for k, v in r.items()}
    ann = {k: solar.annual_from_month_hour(m.rename(columns={"y": "mwh_per_mwp_mean_day"}))["annual_mwh_per_mwp"]
           for k, m in mh.items()}
    row = {"nodo": nodo, "system": system, "lat": lat, "lon": lon, "tilt_fixed_deg": round(solar.fixed_tilt_deg(lat), 1),
           "y_tracker": ann[("real", "tracker")], "y_fixed": ann[("real", "fixed")],
           "y_tracker_clear": ann[("clear", "tracker")], "y_fixed_clear": ann[("clear", "fixed")]}
    row["cf_tracker"] = row["y_tracker"] / 8760.0
    row["cf_fixed"] = row["y_fixed"] / 8760.0
    row["fixed_over_tracker"] = row["y_fixed"] / row["y_tracker"]
    row["real_over_clear_tracker"] = row["y_tracker"] / row["y_tracker_clear"]
    row["real_over_clear_fixed"] = row["y_fixed"] / row["y_fixed_clear"]
    row["ghi_kwh_m2_year"] = float(sc.monthly_kwh_m2(mh[("real", "tracker")], "ghi_wm2").sum())
    row["ghi_clear_kwh_m2_year"] = float(sc.monthly_kwh_m2(mh[("clear", "tracker")], "ghi_wm2").sum())
    row["poa_tracker_kwh_m2_year"] = float(sc.monthly_kwh_m2(mh[("real", "tracker")], "poa_wm2").sum())
    row["poa_fixed_kwh_m2_year"] = float(sc.monthly_kwh_m2(mh[("real", "fixed")], "poa_wm2").sum())
    if "clrsky_ghi_wm2" in df:   # GHI despejada NASA vs la usada (sanidad del reescalado)
        loc = solar.to_cdmx(df)
        v = solar.restrict_years(loc, solar.BASELINE_YEARS)
        v = v[solar.valid_day_mask(v)]
        g = v.groupby(["month", "hour"])["clrsky_ghi_wm2"].mean().reset_index()
        row["clrsky_nasa_kwh_m2_year"] = float(sc.monthly_kwh_m2(g.rename(columns={"clrsky_ghi_wm2": "g"}), "g").sum())
    # Ineichen puro vs NASA clrsky (informativo)
    geom = solar.site_geometry(df.index, lat, lon)
    pure = sc.clear_sky_frame(df, lat, lon, geom, "ineichen")
    p = solar.to_cdmx(pure)
    p = p[solar.valid_day_mask(p)]
    p = p[p["year"].isin(solar.BASELINE_YEARS)]
    g = p.groupby(["month", "hour"])["ghi_wm2"].mean().reset_index()
    row["ghi_ineichen_kwh_m2_year"] = float(sc.monthly_kwh_m2(g, "ghi_wm2").sum())
    row["min_valid_days_month_hour"] = int(mh[("real", "tracker")]["n_days"].min())   # dias validos por (mes, hora), 11 anos
    row["nasa_pct_missing_ghi"] = float(100 * df["ghi_wm2"].isna().mean())
    row["last_valid_ghi"] = str(df.index[df["ghi_wm2"].notna()].max())
    # reproduccion del publicado (solo nodos con baseline)
    mh_t = mh[("real", "tracker")]
    try:
        b = pd.read_parquet(data_root / "data/baselines/solar_baselines.parquet",
                            filters=[("loc_id", "==", nodo)]).set_index("config")["annual_mwh_per_mwp"]
        row["pub_tracker"], row["pub_fixed"] = float(b.get("tracker", np.nan)), float(b.get("fixed", np.nan))
        row["repro_err_tracker_pct"] = 100 * (row["y_tracker"] / row["pub_tracker"] - 1) if len(b) else np.nan
        row["repro_err_fixed_pct"] = 100 * (row["y_fixed"] / row["pub_fixed"] - 1) if len(b) else np.nan
        row.update(published_yf(data_root, nodo, mh_t))
    except Exception as e:   # sin baseline (BCS/BCA)
        row["pub_note"] = f"sin baseline publicado ({type(e).__name__})"
    row["seconds"] = round(time.time() - t0, 1)
    arr = {"months_kwh_m2": {"ghi": sc.monthly_kwh_m2(mh[("real", "tracker")], "ghi_wm2").round(1).tolist(),
                             "ghi_clear": sc.monthly_kwh_m2(mh[("clear", "tracker")], "ghi_wm2").round(1).tolist(),
                             "poa_tracker": sc.monthly_kwh_m2(mh[("real", "tracker")], "poa_wm2").round(1).tolist(),
                             "poa_fixed": sc.monthly_kwh_m2(mh[("real", "fixed")], "poa_wm2").round(1).tolist()},
           "months_y": {f"{s}_{c}": sc.monthly_y(mh[(s, c)]).round(1).tolist() for s, c in mh},
           "day_Y1": {f"{s}_{c}": sc.typical_day_window(mh[(s, c)], "y", *WINDOWS["Y1"]).round(4).tolist() for s, c in mh}}
    return row, arr


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--extra-cache", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--nodes", nargs="*", default=PILOT)
    a = ap.parse_args(argv)
    root, out = Path(a.data_root), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    idx = pd.DataFrame(json.loads((root / "data/index.json").read_text())["nodos"]).set_index("id")
    rows, arrs = [], {}
    for n in a.nodes:
        r, ar = run_node(root, Path(a.extra_cache) if a.extra_cache else None, n, float(idx.loc[n, "lat"]),
                         float(idx.loc[n, "lon"]), idx.loc[n, "sistema"])
        rows.append(r)
        arrs[n] = ar
        print(n, {k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items() if k.startswith(("y_", "repro", "fixed_over", "real_over"))},
              flush=True)
    pd.DataFrame(rows).to_csv(out / "pilot_summary.csv", index=False)
    (out / "pilot_arrays.json").write_text(json.dumps(arrs, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
