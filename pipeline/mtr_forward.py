"""Forward validation of the real-time (MTR) value: train 2023-24 / test Jan-Sep 2025 vs train 2024-25 / test Jan-Sep 2026 (same months).
Reports rank correlation and marks nodes whose rank moves by more than UNSTABLE_PCT of the node count as unstable.
Run after: mtr_metrics.py forward -> data/analysis/mtr_forward.json"""
import json
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[1]
UNSTABLE_PCT = 20   # [estimated]
KEY = "mtr_kw_yr_4h"


def main():
    a = json.loads((ROOT / "data/analysis/mtr_metrics_2025_jan_sep.json").read_text())["nodes"]
    b = json.loads((ROOT / "data/analysis/mtr_metrics_fwd2026.json").read_text())["nodes"]
    ids = sorted(set(a) & set(b))
    x, y = np.array([a[i][KEY] for i in ids]), np.array([b[i][KEY] for i in ids])
    ra, rb = x.argsort().argsort() / len(ids), y.argsort().argsort() / len(ids)
    shift = np.abs(ra - rb) * 100
    out = {"n": len(ids), "spearman": round(float(spearmanr(x, y)[0]), 3), "median_value_2025": float(np.median(x)), "median_value_2026": float(np.median(y)),
           "unstable_pct_threshold": UNSTABLE_PCT, "n_unstable": int((shift > UNSTABLE_PCT).sum()),
           "nodes": {i: {"v2025": round(float(p), 1), "v2026": round(float(q), 1), "rank_shift_pct": round(float(s), 1), "unstable": bool(s > UNSTABLE_PCT)}
                     for i, p, q, s in zip(ids, x, y, shift)}}
    (ROOT / "data/analysis/mtr_forward.json").write_text(json.dumps(out))
    print({k: v for k, v in out.items() if k != "nodes"})


if __name__ == "__main__":
    main()
