"""Battery (standalone arbitrage) screening metrics per node from hourly PML MDA.

Not a revenue forecast. Two views, kept apart on purpose (project rule: no perfect-foresight base case):
  * rule-based, out of sample: hours-of-day to charge / discharge are chosen per month from TRAIN years,
    then applied to the TEST year's real prices (no look-ahead).
  * perfect-foresight spread (max-min of the day, and top-k minus bottom-k): upper bound, context only.
Units: MXN per kW-year for a k-hour battery, round-trip efficiency RTE (config).
Run: .venv/bin/python pipeline/battery_metrics.py  ->  data/analysis/battery_metrics.json
"""
import json
import time
from pathlib import Path

import duckdb
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
TRAIN, TEST = (2023, 2024), 2025
RTE = 0.85            # [estimado] AC-AC round trip
KS = (2, 4)


def load_days(chunk=120):
    """Yield (node, [dates], array[n_days, 24]) for full 24 h days; queries in node chunks to bound memory."""
    con = duckdb.connect()
    con.execute("PRAGMA threads=4; PRAGMA memory_limit='6GB'; SET preserve_insertion_order=false")
    src = f"read_parquet('{ROOT}/data/parquet/pml_mda/**/*.parquet', hive_partitioning=true)"
    idx = json.loads((ROOT / "web/data/index.json").read_text())["nodos"]
    nodes = sorted({x["id"] for x in idx if x.get("valido")})
    for i in range(0, len(nodes), chunk):
        ids = ",".join("'" + n + "'" for n in nodes[i:i + chunk])
        q = (f"select nodo, fecha, list(pml order by hora) p, list(congestion order by hora) c "
             f"from {src} where nodo in ({ids}) and anio between {TRAIN[0]} and {TEST} "
             f"group by nodo, fecha having count(*) = 24 order by nodo, fecha")
        cur, cache = con.execute(q).fetchall(), {}
        for n, d, p, c in cur:
            e = cache.setdefault(n, ([], [], []))
            e[0].append(d)
            e[1].append(p)
            e[2].append(c)
        for n, (dates, P, Cg) in cache.items():
            yield n, dates, np.array(P, dtype=np.float32), np.array(Cg, dtype=np.float32)


def node_metrics(dates, P, Cg):
    yr = np.array([d.year for d in dates])
    mo = np.array([d.month for d in dates])
    tr, te = np.isin(yr, TRAIN), yr == TEST
    if tr.sum() < 180 or te.sum() < 250:
        return None
    out = {"days_train": int(tr.sum()), "days_test": int(te.sum())}
    sp = P.max(1) - P.min(1)
    out["spread_med"] = float(np.median(sp))
    out["spread_p90"] = float(np.percentile(sp, 90))
    out["neg_share_pct"] = float(100 * (P <= 0).mean())
    out["cong_std"] = float(Cg.std())
    out["cong_mean"] = float(Cg.mean())
    scale = 365.0 / te.sum()
    for k in KS:
        srt = np.sort(P[te], axis=1)
        pf_dis, pf_ch = k * srt[:, -k:].mean(1), k * srt[:, :k].mean(1)     # MXN/MW-day, hindsight
        pf = pf_dis - pf_ch / RTE
        rule_dis, rule_ch = np.zeros(te.sum()), np.zeros(te.sum())
        te_idx = np.where(te)[0]
        for m in range(1, 13):
            prof = P[tr & (mo == m)].mean(0) if (tr & (mo == m)).any() else P[tr].mean(0)
            order = np.argsort(prof)
            ch, dis = order[:k], order[-k:]
            sel = mo[te_idx] == m
            if sel.any():
                pp = P[te_idx[sel]]
                rule_dis[sel], rule_ch[sel] = k * pp[:, dis].mean(1), k * pp[:, ch].mean(1)
        rule = rule_dis - rule_ch / RTE
        # revenue and charging cost kept apart so the web app can re-price with another RTE:
        # value(RTE) = dis - ch / RTE   [MXN per kW-year]
        out[f"dis_kw_yr_{k}h"] = float(rule_dis.sum() * scale / 1000.0)
        out[f"ch_kw_yr_{k}h"] = float(rule_ch.sum() * scale / 1000.0)
        out[f"pfdis_kw_yr_{k}h"] = float(pf_dis.sum() * scale / 1000.0)
        out[f"pfch_kw_yr_{k}h"] = float(pf_ch.sum() * scale / 1000.0)
        out[f"rule_kw_yr_{k}h"] = float(rule.sum() * scale / 1000.0)
        out[f"pf_kw_yr_{k}h"] = float(pf.sum() * scale / 1000.0)
        out[f"capture_{k}h"] = float(rule.sum() / pf.sum()) if pf.sum() > 0 else None
    return out


def main():
    t0, res = time.time(), {}
    for i, (node, dates, P, Cg) in enumerate(load_days(), 1):
        m = node_metrics(dates, P, Cg)
        if m:
            res[node] = m
        if i % 200 == 0:
            print(i, f"{time.time() - t0:.0f}s", flush=True)
    meta = {"train": TRAIN, "test": TEST, "rte": RTE, "n": len(res), "generated": time.strftime("%Y-%m-%d")}
    dest = ROOT / "data/analysis/battery_metrics.json"
    dest.write_text(json.dumps({"meta": meta, "nodes": res}))
    print(meta)


if __name__ == "__main__":
    main()
