"""Before/after ranking report for a new score component set (instructivo section 8).
  .venv/bin/python pipeline/rank_report.py solar OLD.json     (OLD = previous solar_score.json copy)
  .venv/bin/python pipeline/rank_report.py battery OLD_scores.json  (OLD = previous web/data/derived/scores.json)
Prints: Spearman, top 20 risers and fallers with the component that moved most, critical archaeology flags, neutral coverage.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[1]


def load(kind, old_path):
    if kind == "solar":
        old = {r["id"]: r for r in json.loads(Path(old_path).read_text())["nodes"] if r.get("score") is not None}
        new = {r["id"]: r for r in json.loads((ROOT / "data/analysis/solar_score.json").read_text())["nodes"] if r.get("score") is not None}
        return old, new, lambda r: r["components"], lambda r: r["flags"]
    old = {n["id"]: n["bat"] for n in json.loads(Path(old_path).read_text())["nodes"] if n.get("bat")}
    new = json.loads((ROOT / "data/analysis/battery_score.json").read_text())["nodes"]
    return old, new, lambda r: r["components"], lambda r: r["flags"]


def main(kind, old_path):
    old, new, comp, flags = load(kind, old_path)
    ids = [i for i in new if i in old]
    ro = {i: k for k, i in enumerate(sorted(ids, key=lambda i: -old[i]["score"]))}
    rn = {i: k for k, i in enumerate(sorted(ids, key=lambda i: -new[i]["score"]))}
    rho = spearmanr([ro[i] for i in ids], [rn[i] for i in ids])[0]
    print(f"{kind}: {len(ids)} nodes, Spearman old/new = {rho:.3f}" + ("  (< 0.9: explain)" if rho < 0.9 else ""))
    mv = sorted(ids, key=lambda i: ro[i] - rn[i])    # negative = fell
    def cause(i):
        a, b = comp(old[i]), comp(new[i])
        d = {k: b[k] - a.get(k, b[k]) for k in b if k in ("arch", "indig", "access", "strength")}
        return max(d, key=lambda k: abs(d[k])) + f" {b[max(d, key=lambda k: abs(d[k]))]:.2f}" if d else "-"
    for name, sel in (("rise", mv[::-1][:20]), ("fall", mv[:20])):
        print(f"top 20 {name}:")
        for i in sel:
            print(f"  {i:12s} rank {ro[i]+1:5d} -> {rn[i]+1:5d}  score {old[i]['score']:5.1f} -> {new[i]['score']:5.1f}  driver {cause(i)}")
    crit = sum(1 for i in new if any("INAH critical" in f for f in flags(new[i])))
    print("nodes with critical archaeology flag:", crit)
    for k in ("arch", "indig", "access", "strength"):
        have = [i for i in new if k in comp(new[i])]
        print(f"component {k}: present for {len(have)} of {len(new)} nodes" if have else f"component {k}: not in score (layer without data)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
