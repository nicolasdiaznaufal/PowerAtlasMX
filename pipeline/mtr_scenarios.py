"""MTR scenarios, annual distribution and tail risk per node (SIN only; BCA/BCS have no MTR and stay neutral).
For each test year Y (2021-2026) the schedule is learned ONLY on years before Y (no look-ahead), per calendar month, 4 h battery, RTE from battery_metrics:
  floor    schedule learned on MDA, settled at MTR   (day-ahead planner paid real-time)
  realistic schedule learned on MTR, settled at MTR   (operator that reads real-time prices)
  ceiling  perfect foresight on MTR                   (upper bound, context only)
information value = ceiling - floor. 2021 contains the February 2021 event (stress, not a typical year); 2026 is Jan-Sep annualised.
Tail: share of the spread that comes from the top 1% of days, p99 / non-positive share of MTR, MTR congestion mean and share of months with
structural congestion (monthly mean above CONG_STRUCT MXN/MWh). Few years and market changes: not a robust statistical distribution.
Run: .venv/bin/python pipeline/mtr_scenarios.py -> data/analysis/mtr_scenarios.json"""
import json
import time
from pathlib import Path

import duckdb
import numpy as np

from battery_metrics import RTE

ROOT = Path(__file__).resolve().parents[1]
K, YEARS, CONG_STRUCT = 4, range(2021, 2027), 20.0   # CONG_STRUCT [estimated]


def load_all(chunk=8):
    con = duckdb.connect()
    con.execute("PRAGMA threads=2; PRAGMA memory_limit='6GB'; SET preserve_insertion_order=false")
    a = f"read_parquet('{ROOT}/data/parquet/pml_mda/sistema=SIN/**/*.parquet', hive_partitioning=true)"
    b = f"read_parquet('{ROOT}/data/parquet/pml_mtr/sistema=SIN/**/*.parquet', hive_partitioning=true)"
    nodes = [r[0] for r in con.execute(f"select distinct nodo from {b} where anio=2025 order by 1").fetchall()]
    for i in range(0, len(nodes), chunk):
        ids = ",".join("'" + n + "'" for n in nodes[i:i + chunk])
        q = (f"select a.nodo, a.fecha, list(a.pml order by a.hora), list(b.pml order by a.hora), list(b.congestion order by a.hora) "
             f"from (select nodo, fecha, hora, pml from {a} where nodo in ({ids})) a "
             f"join (select nodo, fecha, hora, pml, congestion from {b} where nodo in ({ids})) b on a.nodo=b.nodo and a.fecha=b.fecha and a.hora=b.hora "
             f"group by a.nodo, a.fecha having count(*)=24 order by a.nodo, a.fecha")
        cache = {}
        for n, d, pa, pb, pc in con.execute(q).fetchall():
            e = cache.setdefault(n, ([], [], [], []))
            e[0].append(d); e[1].append(pa); e[2].append(pb); e[3].append(pc)
        for n, e in cache.items():
            yield n, e[0], *(np.array(x, dtype=np.float32) for x in e[1:])


def schedule(prof_by_month, k):
    return {m: (np.argsort(p)[:k], np.argsort(p)[-k:]) for m, p in prof_by_month.items()}


def year_values(yr, mo, A, B, Y):
    tr, te = yr < Y, yr == Y
    if tr.sum() < 180 or te.sum() < 120:
        return None
    scale, idx = 365.0 / te.sum(), np.where(te)[0]
    res = {}
    for name, src in (("floor", A), ("real", B)):
        prof = {m: src[tr & (mo == m)].mean(0) for m in range(1, 13) if (tr & (mo == m)).any()}
        sch = schedule(prof, K)
        tot = 0.0
        for m, (ch, dis) in sch.items():
            sel = idx[mo[idx] == m]
            if len(sel):
                tot += (K * B[sel][:, dis].mean(1) - K * B[sel][:, ch].mean(1) / RTE).sum()
        res[name] = float(tot * scale / 1000)   # MXN per kW-year
    s = np.sort(B[te], axis=1)
    res["ceil"] = float((K * s[:, -K:].mean(1) - K * s[:, :K].mean(1) / RTE).sum() * scale / 1000)
    return res


def node_out(dates, A, B, C):
    yr, mo = np.array([d.year for d in dates]), np.array([d.month for d in dates])
    ann = {str(Y): v for Y in YEARS if (v := year_values(yr, mo, A, B, Y))}
    if not ann:
        return None
    real = {y: v["real"] for y, v in ann.items()}
    typical = [v for y, v in real.items() if y not in ("2021",)]   # Feb 2021 event excluded from the typical-year summary
    last = yr >= 2023
    sp = (B[last].max(1) - B[last].min(1)); top = np.sort(sp)[::-1][:max(1, int(0.01 * len(sp)))]
    mm = [C[last][(mo[last] == m) & (yr[last] == y)].mean() for y in set(yr[last]) for m in range(1, 13) if ((mo[last] == m) & (yr[last] == y)).any()]
    return {"annual": {y: {k: round(x) for k, x in v.items()} for y, v in ann.items()},
            "floor_med": round(float(np.median([v["floor"] for y, v in ann.items() if y != "2021"]))),
            "real_med": round(float(np.median(typical))), "ceil_med": round(float(np.median([v["ceil"] for y, v in ann.items() if y != "2021"]))),
            "real_min": round(min(typical)), "real_stress": round(min(real.values())), "stress_year": min(real, key=real.get),
            "info_value": round(float(np.median([v["ceil"] - v["floor"] for y, v in ann.items() if y != "2021"]))),
            "top1pct_days_share": round(float(top.sum() / sp.sum()), 3), "mtr_p99": round(float(np.percentile(B[last], 99)), 1),
            "mtr_nonpos_pct": round(float(100 * (B[last] <= 0).mean()), 2), "cong_mtr_mean": round(float(C[last].mean()), 1),
            "cong_struct_share": round(float(np.mean(np.array(mm) > CONG_STRUCT)), 2)}


def main():
    t0, res = time.time(), {}
    for i, (n, d, A, B, C) in enumerate(load_all(), 1):
        o = node_out(d, A, B, C)
        if o:
            res[n] = o
        if i % 400 == 0:
            print(i, f"{time.time() - t0:.0f}s", flush=True)
    meta = {"k_hours": K, "years": [min(YEARS), max(YEARS)], "rte": RTE, "n": len(res), "cong_struct_mxn_mwh": CONG_STRUCT, "generated": time.strftime("%Y-%m-%d"),
            "caveats": "few years, regulation and market changes; 2021 includes the February 2021 event; 2026 is Jan-Sep annualised"}
    (ROOT / "data/analysis/mtr_scenarios.json").write_text(json.dumps({"meta": meta, "nodes": res}))
    print(meta)


if __name__ == "__main__":
    main()
