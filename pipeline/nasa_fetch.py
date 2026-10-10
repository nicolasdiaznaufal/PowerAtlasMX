"""Descarga de climatologia larga NASA POWER (horaria, UTC) para las celdas de 1 grado de la cache.

Uso:
    .venv/bin/python pipeline/nasa_fetch.py [--start-year 2015] [--end-date YYYY-MM-DD]
                                            [--workers 4] [--cells-from data/cache/nasa/celdas]
                                            [--out data/cache/nasa/climatologia] [--merge-only]

Salida (bajo data/, git-ignored; no toca data/cache/nasa/celdas):
    <out>/partes/celda_+LL_-LLL/AAAA.parquet   unidad de reanudacion: una celda x un anio
    <out>/celdas/celda_+LL_-LLL.parquet        serie completa de la celda (mezcla de las partes)
    <out>/COVERAGE.json                        resumen de cobertura

Convencion igual que la cache: celda = (floor(lat), floor(lon)), punto de consulta = centro (la0+.5, lo0+.5),
indice = INICIO de hora en UTC (tz-aware). -999 (NASA no publica) -> NaN; nunca se guarda como valor.
Columnas: ghi_wm2 (ALLSKY_SFC_SW_DWN), clrsky_ghi_wm2 (CLRSKY_SFC_SW_DWN), dni_wm2 (ALLSKY_SFC_SW_DNI),
          dhi_wm2 (ALLSKY_SFC_SW_DIFF), t2m_c (T2M), ws2m_ms (WS2M).
ghi_wm2/t2m_c tienen los mismos nombres que pipeline.solar.load_nasa_cell, asi que el resultado es intercambiable.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

API = "https://power.larc.nasa.gov/api/temporal/hourly/point"
PARAMS = {
    "ALLSKY_SFC_SW_DWN": "ghi_wm2",
    "CLRSKY_SFC_SW_DWN": "clrsky_ghi_wm2",
    "ALLSKY_SFC_SW_DNI": "dni_wm2",
    "ALLSKY_SFC_SW_DIFF": "dhi_wm2",
    "T2M": "t2m_c",
    "WS2M": "ws2m_ms",
}
MISSING = -999.0
REFRESH_DAYS = 3          # un anio incompleto (en curso o con -999 recientes) se vuelve a pedir tras 3 dias
_CELL_RE = re.compile(r"celda_([+-]\d+)_([+-]\d+)\.json$")


class RateLimited(Exception):
    pass


def cell_name(la0: int, lo0: int) -> str:
    return f"celda_{la0:+03d}_{lo0:+04d}"


def list_cells(cells_dir: Path) -> list[tuple[int, int]]:
    out = []
    for f in sorted(Path(cells_dir).glob("celda_*.json")):
        m = _CELL_RE.search(f.name)
        if m:
            out.append((int(m.group(1)), int(m.group(2))))
    return out


def parse_response(payload: dict) -> pd.DataFrame:
    """JSON de POWER -> DataFrame horario UTC con NaN en faltantes."""
    p = payload["properties"]["parameter"]
    cols = {}
    for api_name, col in PARAMS.items():
        if api_name not in p:
            continue
        s = pd.Series(p[api_name], dtype="float64")
        s[s == MISSING] = np.nan
        s.index = pd.to_datetime(s.index, format="%Y%m%d%H")
        cols[col] = s
    df = pd.DataFrame(cols).sort_index()
    df.index = df.index.tz_localize("UTC")
    df.index.name = "ts_utc_hour_start"
    return df


def fetch_year(session, la: float, lo: float, start: date, end: date, retries: int = 5,
               sleep=time.sleep) -> pd.DataFrame:
    url = (f"{API}?parameters={','.join(PARAMS)}&community=RE&latitude={la}&longitude={lo}"
           f"&start={start:%Y%m%d}&end={end:%Y%m%d}&format=JSON&time-standard=UTC")
    last = None
    for i in range(retries):
        try:
            r = session.get(url, timeout=180)
            if r.status_code in (429, 503, 502, 504, 500):
                last = f"HTTP {r.status_code}"
                sleep(min(120, 5 * 2 ** i))
                continue
            r.raise_for_status()
            return parse_response(r.json())
        except Exception as e:  # red / JSON truncado
            last = f"{type(e).__name__}: {e}"
            sleep(min(120, 5 * 2 ** i))
    raise RateLimited(f"{last} tras {retries} intentos: {url}")


def part_path(out: Path, la0: int, lo0: int, year: int) -> Path:
    return out / "partes" / cell_name(la0, lo0) / f"{year}.parquet"


def part_complete(path: Path, year: int, end: date, now: datetime | None = None) -> bool:
    """Parte completa: existe y (anio cerrado sin faltantes de GHI, o refrescada hace < REFRESH_DAYS)."""
    if not path.exists():
        return False
    now = now or datetime.now()
    fresh = now - datetime.fromtimestamp(path.stat().st_mtime) < timedelta(days=REFRESH_DAYS)
    if fresh:
        return True
    df = pd.read_parquet(path, columns=["ghi_wm2"])
    y_end = min(end, date(year, 12, 31))
    expected = (y_end - date(year, 1, 1)).days * 24 + 24
    return len(df) >= expected and df["ghi_wm2"].notna().all()


def merge_cell(out: Path, la0: int, lo0: int) -> Path | None:
    parts = sorted((out / "partes" / cell_name(la0, lo0)).glob("*.parquet"))
    if not parts:
        return None
    df = pd.concat([pd.read_parquet(p) for p in parts]).sort_index()
    df = df[~df.index.duplicated(keep="last")]
    dest = out / "celdas" / f"{cell_name(la0, lo0)}.parquet"
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")
    df.to_parquet(tmp, compression="zstd")
    tmp.replace(dest)
    return dest


def load_climatologia_cell(path: str | Path) -> pd.DataFrame:
    """Lee celdas/celda_*.parquet (indice UTC inicio de hora, NaN = faltante)."""
    return pd.read_parquet(path)


def run(root: Path, start_year: int, end: date, workers: int, cells_dir: Path, out: Path,
        session_factory=None, sleep=time.sleep, pause: float = 0.5) -> dict:
    import requests
    session_factory = session_factory or requests.Session
    cells = list_cells(cells_dir)
    jobs = [(la0, lo0, y) for (la0, lo0) in cells for y in range(start_year, end.year + 1)]
    todo = [j for j in jobs if not part_complete(part_path(out, *j), j[2], end)]
    print(f"{len(cells)} celdas, {len(jobs)} partes, {len(todo)} por descargar", flush=True)
    stop = threading.Event()
    errors: list[str] = []
    local = threading.local()
    done = [0]

    def work(job):
        if stop.is_set():
            return
        la0, lo0, y = job
        if not hasattr(local, "s"):
            local.s = session_factory()
        a, b = date(y, 1, 1), min(date(y, 12, 31), end)
        try:
            df = fetch_year(local.s, la0 + 0.5, lo0 + 0.5, a, b, sleep=sleep)
        except RateLimited as e:
            errors.append(str(e))
            stop.set()      # bloqueo persistente: no seguir golpeando
            return
        p = part_path(out, la0, lo0, y)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        df.to_parquet(tmp, compression="zstd")
        tmp.replace(p)
        done[0] += 1
        if done[0] % 50 == 0:
            print(f"  {done[0]}/{len(todo)}", flush=True)
        sleep(pause)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(as_completed([ex.submit(work, j) for j in todo]))
    for la0, lo0 in cells:
        merge_cell(out, la0, lo0)
    return {"downloaded": done[0], "pending": len(todo) - done[0], "errors": errors}


def coverage(out: Path, cells: list[tuple[int, int]], end: date) -> dict:
    res = {"generated": datetime.now().isoformat(timespec="seconds"), "source": "NASA POWER hourly API v2 (community RE, UTC)",
           "variables": PARAMS, "n_cells": len(cells), "cells": {}}
    miss_tot = {c: [0, 0] for c in PARAMS.values()}
    for la0, lo0 in cells:
        f = out / "celdas" / f"{cell_name(la0, lo0)}.parquet"
        if not f.exists():
            res["cells"][cell_name(la0, lo0)] = {"status": "missing"}
            continue
        df = pd.read_parquet(f)
        frac = {c: round(float(df[c].isna().mean()), 5) for c in df.columns}
        for c in df.columns:
            miss_tot[c][0] += int(df[c].isna().sum())
            miss_tot[c][1] += len(df)
        valid = df["ghi_wm2"].dropna()
        full_years = sorted(int(y) for y, g in df.groupby(df.index.year)
                            if g["ghi_wm2"].notna().mean() > 0.99 and len(g) >= 8760)
        res["cells"][cell_name(la0, lo0)] = {
            "first_hour": str(df.index.min()), "last_hour": str(df.index.max()),
            "first_valid_ghi": str(valid.index.min()) if len(valid) else None,
            "last_valid_ghi": str(valid.index.max()) if len(valid) else None,
            "n_hours": len(df), "years_full_ghi": full_years, "frac_missing": frac,
            "ghi_hours_missing_before_last_valid": int(df.loc[:valid.index.max(), "ghi_wm2"].isna().sum()) if len(valid) else None,
        }
    c = res["cells"]
    ok = {k: v for k, v in c.items() if "n_hours" in v}
    res["summary"] = {
        "cells_ok": len(ok), "cells_missing": len(c) - len(ok),
        "frac_missing_overall": {k: round(a / b, 5) if b else None for k, (a, b) in miss_tot.items()},
        "cells_with_interior_ghi_gaps": sorted(k for k, v in ok.items() if v["ghi_hours_missing_before_last_valid"]),
        "min_full_years": min((len(v["years_full_ghi"]) for v in ok.values()), default=0),
        "last_valid_ghi_range": [min((v["last_valid_ghi"] for v in ok.values() if v["last_valid_ghi"]), default=None),
                                 max((v["last_valid_ghi"] for v in ok.values() if v["last_valid_ghi"]), default=None)],
    }
    (out / "COVERAGE.json").write_text(json.dumps(res, indent=1))
    return res


def main(argv=None):
    root = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--start-year", type=int, default=2015)
    ap.add_argument("--end-date", default=date.today().isoformat())
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--cells-from", default=str(root / "data/cache/nasa/celdas"))
    ap.add_argument("--out", default=str(root / "data/cache/nasa/climatologia"))
    ap.add_argument("--pause", type=float, default=0.5, help="segundos entre peticiones por hilo")
    ap.add_argument("--merge-only", action="store_true")
    a = ap.parse_args(argv)
    out, end = Path(a.out), date.fromisoformat(a.end_date)
    cells = list_cells(Path(a.cells_from))
    t0 = time.time()
    if a.merge_only:
        for c in cells:
            merge_cell(out, *c)
        r = {}
    else:
        r = run(root, a.start_year, end, min(a.workers, 4), Path(a.cells_from), out, pause=a.pause)
    cov = coverage(out, cells, end)
    print(json.dumps({**r, "summary": cov["summary"], "seconds": round(time.time() - t0)}, indent=1))
    return 1 if r.get("errors") else 0


if __name__ == "__main__":
    sys.exit(main())
