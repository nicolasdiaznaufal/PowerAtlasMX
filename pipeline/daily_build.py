"""
daily_build.py - Construye la serie DIARIA (docs/TECNICO.md §13) para los 2 431 nodos de analysis_nodos.json.

  NODAL_DATA_ROOT=/ruta/al/checkout .venv/bin/python pipeline/daily_build.py [--limit N] [--workers 8] [--replace]

Entradas (solo lectura): data/db/pml.duckdb (PML horario), data/index.json (lat/lon), data/analysis/analysis_nodos.json
(universo, region, entidad, publicado), data/aggregates/agregados_comunes.parquet, data/solar_v2/tables_month_hour.parquet
(`win`), data/solar_v2/web/variant_scalars_{tracker,fijo}.json, clima horario NASA POWER de solar_full.load_cell,
data/ref/inpc_mensual.csv. Salida: data/solar_v2/daily/ (nodes/{id}.json, areas/..., deflator_mensual.json,
manifest.json). Se escribe en un directorio temporal y solo se mueve a daily/ si TODAS las puertas pasan
(daily_gates.py); daily/ existente no se toca salvo --replace (y solo si lo escribio este modulo)."""
from __future__ import annotations

import argparse
import gzip
import json
import os
import shutil
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aggregates as A  # noqa: E402
import clock  # noqa: E402
import daily_gates as G  # noqa: E402
import daily_series as S  # noqa: E402
import kpis as K  # noqa: E402
import solar  # noqa: E402
import solar_full as SF  # noqa: E402
import solar_variants as SV  # noqa: E402

DATA_ROOT = Path(os.environ.get("NODAL_DATA_ROOT", K.ROOT))
PRODUCER = "pipeline/daily_build.py"


def sql_hourly(where: str) -> str:
    ts = clock.sql_ts_cdmx("sistema", "fecha", "hora")
    cents = ", ".join(f"CAST(round(100*{c}) AS BIGINT) AS c_{c}" for c in S.COMP)
    return (f"SELECT nodo, datediff('hour', TIMESTAMP '{S.D0}', {ts}) AS h, pml, {cents} "
            f"FROM db.pml_hourly WHERE {where}")


def day_range(con) -> tuple:
    q = (f"WITH x AS ({sql_hourly('TRUE')}) SELECT d, max(c) AS m FROM "
         "(SELECT nodo, h // 24 AS d, count(*) AS c FROM x GROUP BY ALL) GROUP BY d ORDER BY d")
    t = con.execute(q).df()
    days = S.D0 + pd.to_timedelta(t["d"].to_numpy(), unit="D")
    return S.full_day_range(days, t["m"].to_numpy())


def process(job) -> dict:
    """Un nodo: lado PML, clima real -> y horario por config, campos diarios, archivo y estadisticas de puertas."""
    nodo, lat, lon, h, pml, cents, wtab, nd, root, tmp = job
    pm = S.pml_daily(h, cents, pml, nd)
    df = SF.load_cell(Path(root), *solar.cell_of(lat, lon))
    if df is None:
        return {"nodo": nodo, "error": "sin_celda"}
    geom = solar.site_geometry(df.index, lat, lon)
    ym_day = S.month_of_days(nd)
    cfgs, gst = {}, {"pml": G.window_pml(pm, ym_day)}
    for k, pk in S.CONFIGS.items():
        loc = solar.to_cdmx(solar.hourly_pv_power(df, lat, lon, pk, solar.DEFAULT, geom=geom, dni_dhi_source="nasa"))
        grid = S.y_grid(loc.index, loc["energy_mwh_per_mwp"].to_numpy(), solar.valid_day_mask(loc).to_numpy(), nd)
        cfgs[k] = S.solar_daily(h, pml, grid, pm["pml_avg"])
        gst[k] = G.window_cfg(cfgs[k], pm, ym_day, h, pml, grid, wtab.get(pk))
    doc = S.node_doc(nodo, nd, pm, cfgs)
    raw = json.dumps(doc, separators=(",", ":")).encode()
    (Path(tmp) / "nodes" / f"{nodo}.json").write_bytes(raw)
    keep = {f: pm[f] for f in S.PML_FIELDS}
    return {"nodo": nodo, "pml": keep, "cfg": cfgs, "gates": gst, "bytes": len(raw),
            "gz": len(gzip.compress(raw, 9))}


def load_inputs(root: Path, limit: int | None):
    an = json.loads((root / "data/analysis/analysis_nodos.json").read_text())
    ids = an["ids"][:limit] if limit else an["ids"]
    idx = {n["id"]: n for n in json.loads((root / "data/index.json").read_text())["nodos"]}
    tab = pd.read_parquet(root / "data/solar_v2/tables_month_hour.parquet", filters=[("variant", "==", "win")])
    tab = tab[tab["nodo"].isin(set(ids))]
    wt = {}
    for (n, c), g in tab.groupby(["nodo", "config"]):
        g = g.sort_values("key")
        wt.setdefault(n, {})[c] = (g["key"].to_numpy(int), np.vstack(g["y"].to_numpy()), g["nd"].to_numpy(float))
    return an, ids, idx, wt


def run(root: Path, limit: int | None, workers: int, batch: int = 120) -> tuple[Path, dict]:
    t0 = time.time()
    an, ids, idx, wt = load_inputs(root, limit)
    con = A.conectar(root / "data/db/pml.duckdb")
    first, last = day_range(con)
    if pd.Timestamp(first) != S.D0:
        raise SystemExit(f"primer dia completo {first} != D0 {S.D0.date()}")
    nd = S.n_days(last)
    tmp = root / "data/solar_v2" / f".daily.tmp-{os.getpid()}"
    (tmp / "nodes").mkdir(parents=True)
    reg, ent = dict(zip(an["ids"], an["region"])), dict(zip(an["ids"], an["entidad"]))
    acc = {"ALL": S.AreaAcc(nd)}
    res, errors = [], []

    def jobs(lote):
        t = con.execute(sql_hourly(A._in_list(lote))).df().sort_values(["nodo", "h"])
        out = []
        for n, g in t.groupby("nodo", sort=False):
            c = {k: g["c_" + k].to_numpy(np.int64) for k in S.COMP}
            out.append((n, float(idx[n]["lat"]), float(idx[n]["lon"]), g["h"].to_numpy(np.int64),
                        g["pml"].to_numpy(float), c, wt.get(n, {}), nd, str(root), str(tmp)))
        return out

    lotes = [ids[i:i + batch] for i in range(0, len(ids), batch)]
    with ProcessPoolExecutor(workers) as ex:
        pend = [ex.submit(process, j) for j in jobs(lotes[0])]
        for i in range(len(lotes)):
            nxt = jobs(lotes[i + 1]) if i + 1 < len(lotes) else []
            for f in pend:
                r = f.result()
                if "error" in r:
                    errors.append(r)
                    continue
                n = r["nodo"]
                for key in ("ALL", f"region:{reg[n]}", f"state:{ent[n]}"):
                    acc.setdefault(key, S.AreaAcc(nd)).add(r["pml"], r["cfg"])
                res.append({k: r[k] for k in ("nodo", "gates", "bytes", "gz")})
            pend = [ex.submit(process, j) for j in nxt]
            print(f"lote {i + 1}/{len(lotes)} {time.time() - t0:.0f}s", flush=True)
    missing = sorted(set(ids) - {r["nodo"] for r in res})
    rep = G.check_all(root, res, ids, missing, errors)
    areas = write_areas(tmp, acc, nd)
    defl = write_deflator(root, tmp, nd)
    rep["e_areas"] = G.check_areas(root, tmp, areas, an, ids, full=limit is None)
    G.fail_if(rep)
    gz = np.array([r["gz"] for r in res])
    man = {"schema_version": "daily-manifest/1", "producer": PRODUCER, "generated_at": pd.Timestamp.utcnow().isoformat(),
           "start": str(S.D0.date()), "last_day": str(last), "n": nd, "clock": "CDMX standard, UTC-6 fixed (clock.ts_cdmx)",
           "ids": [r["nodo"] for r in sorted(res, key=lambda r: ids.index(r["nodo"]))], "missing": missing,
           "fields": {"pml": list(S.PML_FIELDS), "config": list(S.CFG_FIELDS), "configs": list(S.CONFIGS),
                      "area_pml": list(S.AREA_PML_FIELDS), "area_config": list(S.AREA_CFG_FIELDS)},
           "scale": S.SCALE, "null": "JSON null = no value that day (no PML hours, no valid weather, y_day=0 or pml_avg<=0 for vf)",
           "areas": areas, "deflator": defl,
           "sizes": {"node_gz_median": int(np.median(gz)), "node_gz_max": int(gz.max()),
                     "node_gz_total": int(gz.sum()), "node_raw_total": int(sum(r["bytes"] for r in res))},
           "weather": "NASA POWER hourly (solar_full.load_cell); valid day = 24 GHI hours (solar.valid_day_mask)",
           "reconciliation": rep, "seconds": round(time.time() - t0)}
    (tmp / "manifest.json").write_text(json.dumps(man, separators=(",", ":"), default=float))
    return tmp, man


def write_areas(tmp: Path, acc: dict, nd: int) -> list:
    (tmp / "areas").mkdir()
    out = []
    for key in sorted(acc, key=lambda k: (k != "ALL", k)):
        kind, name = ("all", "ALL") if key == "ALL" else key.split(":", 1)
        rel = f"areas/{'ALL' if kind == 'all' else kind + '-' + S.slug(name)}.json"
        raw = json.dumps(S.area_doc(key, kind, name, acc[key].result(), nd), separators=(",", ":")).encode()
        (tmp / rel).write_bytes(raw)
        out.append({"key": key, "kind": kind, "name": name, "file": rel, "bytes": len(raw), "gz": len(gzip.compress(raw, 9))})
    return out


def write_deflator(root: Path, tmp: Path, nd: int) -> dict:
    inpc = K.cargar_inpc(root / "data/ref/inpc_mensual.csv")
    base = json.loads((root / "data/index.json").read_text())["pesos_reales"]["base_mes"]
    if inpc is None or inpc["base"] != base:
        raise SystemExit(f"INPC base {inpc and inpc['base']} != publicado {base}")
    meses = sorted({f"{m // 100}-{m % 100:02d}" for m in S.month_of_days(nd)})
    f = {m: K.deflactor(inpc, m) for m in meses}
    doc = {"schema_version": "daily-deflator/1", "base": base, "months": meses, "factor": [f[m] for m in meses],
           "use": "real MXN = nominal MXN x factor of the value's CDMX month (INPC(base)/INPC(month)); vf and MWh unchanged",
           "source": inpc["fuente"]}
    (tmp / "deflator_mensual.json").write_text(json.dumps(doc, separators=(",", ":")))
    return {"file": "deflator_mensual.json", "base": base, "missing": [m for m in meses if f[m] is None]}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--replace", action="store_true", help="reemplaza daily/ si lo escribio este modulo")
    ap.add_argument("--out", type=Path, default=None, help="destino (por defecto data/solar_v2/daily)")
    a = ap.parse_args(argv)
    final = a.out or DATA_ROOT / "data/solar_v2/daily"
    if final.exists():
        prev = json.loads((final / "manifest.json").read_text()).get("producer") if (final / "manifest.json").exists() else None
        if not (a.replace and prev == PRODUCER):
            raise SystemExit(f"{final} existe; usa --replace (solo si lo escribio {PRODUCER})")
    tmp = None
    try:
        tmp, man = run(DATA_ROOT, a.limit, a.workers)
    except BaseException:
        for p in (DATA_ROOT / "data/solar_v2").glob(f".daily.tmp-{os.getpid()}"):
            shutil.rmtree(p)
        raise
    if final.exists():
        shutil.rmtree(final)
    shutil.move(str(tmp), str(final))
    print(json.dumps({k: man[k] for k in ("n", "last_day", "sizes", "seconds")}))
    print(json.dumps(man["reconciliation"]["summary"], indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
