"""Real-time (MTR, ex-post) metrics per node, next to day-ahead (MDA), for battery scoring.

Same split as battery_metrics.py: charge/discharge hours are chosen per month from TRAIN-year MDA profiles, then
settled in the TEST year at (a) MDA prices and (b) MTR prices. (b) is what a day-ahead schedule earns if energy is
settled at real-time prices; MTR - MDA also shows imbalance exposure. Not a revenue forecast.
Units: MXN per kW-year for a k-hour battery (RTE from battery_metrics), MXN/MWh for prices.
Run: .venv/bin/python pipeline/mtr_metrics.py  ->  data/analysis/mtr_metrics.json
"""
import json
import time
from pathlib import Path

import duckdb
import numpy as np

from battery_metrics import KS, RTE, TEST, TRAIN

ROOT = Path(__file__).resolve().parents[1]


def load_days(chunk=40, train=TRAIN, test=TEST):
    """Yield (node, dates, MDA[n,24], MTR[n,24]) for days with 24 h in both markets (SIN only: MTR exists there)."""
    con = duckdb.connect()
    con.execute("PRAGMA threads=2; PRAGMA memory_limit='4GB'; SET preserve_insertion_order=false")
    a = f"read_parquet('{ROOT}/data/parquet/pml_mda/sistema=SIN/**/*.parquet', hive_partitioning=true)"
    b = f"read_parquet('{ROOT}/data/parquet/pml_mtr/sistema=SIN/**/*.parquet', hive_partitioning=true)"
    nodes = [r[0] for r in con.execute(f"select distinct nodo from {b} where anio={test} order by 1").fetchall()]
    for i in range(0, len(nodes), chunk):
        ids = ",".join("'" + n + "'" for n in nodes[i:i + chunk])
        q = (f"select a.nodo, a.fecha, list(a.pml order by a.hora) pa, list(b.pml order by a.hora) pb "
             f"from (select nodo, fecha, hora, pml from {a} where nodo in ({ids}) and anio between {min(train)} and {test}) a "
             f"join (select nodo, fecha, hora, pml from {b} where nodo in ({ids}) and anio between {min(train)} and {test}) b "
             f"on a.nodo=b.nodo and a.fecha=b.fecha and a.hora=b.hora "
             f"group by a.nodo, a.fecha having count(*) = 24 order by a.nodo, a.fecha")
        cache = {}
        for n, d, pa, pb in con.execute(q).fetchall():
            e = cache.setdefault(n, ([], [], []))
            e[0].append(d), e[1].append(pa), e[2].append(pb)
        for n, (dates, A, B) in cache.items():
            yield n, dates, np.array(A, dtype=np.float32), np.array(B, dtype=np.float32)


def node_metrics(dates, A, B, train=TRAIN, test=TEST, months=None):
    yr = np.array([d.year for d in dates])
    mo = np.array([d.month for d in dates])
    tr, te = np.isin(yr, train), yr == test
    if months:   # compare the same months across tests (no seasonal mixing)
        tr, te = tr & np.isin(mo, months), te & np.isin(mo, months)
    if tr.sum() < 90 * len(set(train)) * (len(months) / 12 if months else 1) or te.sum() < (25 * len(months) if months else 250):
        return None
    dev = B[te] - A[te]
    sp_a, sp_b = A[te].max(1) - A[te].min(1), B[te].max(1) - B[te].min(1)
    out = {"days_test": int(te.sum()), "mda_mean": float(A[te].mean()), "mtr_mean": float(B[te].mean()),
           "dev_mean": float(dev.mean()), "dev_std": float(dev.std()),
           "dev_p95_abs": float(np.percentile(np.abs(dev), 95)),
           "mtr_spread_med": float(np.median(sp_b)), "mtr_spread_p90": float(np.percentile(sp_b, 90)),
           "mda_spread_med": float(np.median(sp_a)),
           "mtr_neg_share_pct": float(100 * (B[te] <= 0).mean()),
           "mtr_p99": float(np.percentile(B[te], 99)), "mtr_p01": float(np.percentile(B[te], 1)),
           "mtr_nonpos_share_pct": float(100 * (B[te] <= 0).mean()),
           "rt_wider_share": float((sp_b > sp_a).mean())}   # share of days the real-time spread beats day-ahead
    scale, te_idx = 365.0 / te.sum(), np.where(te)[0]   # per-year equivalent
    for k in KS:
        dis_a, ch_a, dis_b, ch_b = (np.zeros(te.sum()) for _ in range(4))
        for m in range(1, 13):
            sel = mo[te_idx] == m
            if not sel.any():
                continue
            prof = A[tr & (mo == m)].mean(0) if (tr & (mo == m)).any() else A[tr].mean(0)
            order = np.argsort(prof)
            ch, dis = order[:k], order[-k:]
            ia = te_idx[sel]
            dis_a[sel], ch_a[sel] = k * A[ia][:, dis].mean(1), k * A[ia][:, ch].mean(1)
            dis_b[sel], ch_b[sel] = k * B[ia][:, dis].mean(1), k * B[ia][:, ch].mean(1)
        out[f"mda_kw_yr_{k}h"] = float((dis_a - ch_a / RTE).sum() * scale / 1000)
        out[f"mtr_kw_yr_{k}h"] = float((dis_b - ch_b / RTE).sum() * scale / 1000)
        # perfect-foresight on MTR: upper bound, context only
        s = np.sort(B[te], axis=1)
        out[f"mtr_pf_kw_yr_{k}h"] = float((k * s[:, -k:].mean(1) - k * s[:, :k].mean(1) / RTE).sum() * scale / 1000)
    return out


def main(train=TRAIN, test=TEST, months=None, out_name="mtr_metrics.json"):
    t0, res = time.time(), {}
    for i, (node, dates, A, B) in enumerate(load_days(train=train, test=test), 1):
        m = node_metrics(dates, A, B, train, test, months)
        if m:
            res[node] = m
        if i % 200 == 0:
            print(i, f"{time.time() - t0:.0f}s", flush=True)
    meta = {"train": list(train), "test": test, "months": months, "rte": RTE, "n": len(res), "generated": time.strftime("%Y-%m-%d")}
    (ROOT / "data/analysis" / out_name).write_text(json.dumps({"meta": meta, "nodes": res}))
    print(meta)


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["forward"]:   # train 2024-25, test Jan-Sep 2026; the 2025 test is recomputed on the same months for comparison
        main(train=(2024, 2025), test=2026, months=list(range(1, 10)), out_name="mtr_metrics_fwd2026.json")
        main(train=TRAIN, test=TEST, months=list(range(1, 10)), out_name="mtr_metrics_2025_jan_sep.json")
    else:
        main()
