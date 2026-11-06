"""Ranking stability against the weights (all assumptions): Dirichlet perturbation around the config weights (alpha [estimated]),
strict score (weighted geometric mean, floor 0.02) per replica, share of replicas in which each node is in the top K.
Robust = top-K in >80% of replicas. Run: .venv/bin/python pipeline/ranking_stability.py -> data/analysis/ranking_stability.json"""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
REPS, ALPHA, TOPK, SEED = 500, 100.0, 50, 7


def run(nodes, w):
    ids = [i for i, n in nodes.items() if n.get("components") and n.get("score") is not None]
    keys = [k for k in w if all(k in nodes[i]["components"] for i in ids[:50])]
    X = np.log(np.maximum(np.array([[nodes[i]["components"].get(k, 0.5) for k in keys] for i in ids]), 0.02))
    pen = np.array([nodes[i].get("pen", 0) or 0 for i in ids])
    w0 = np.array([w[k] for k in keys]); w0 = w0 / w0.sum()
    rng = np.random.default_rng(SEED)
    W = rng.dirichlet(ALPHA * w0, REPS)
    S = 100 * np.exp(X @ W.T) - pen[:, None]
    top = (np.argsort(-S, axis=0)[:TOPK] )
    freq = np.zeros(len(ids))
    for r in range(REPS):
        freq[top[:, r]] += 1
    freq /= REPS
    base = 100 * np.exp(X @ w0) - pen
    rank0 = np.argsort(np.argsort(-base)) + 1
    return {"keys": keys, "nodes": {i: {"top_share": round(float(f), 3), "rank_base": int(r)} for i, f, r in zip(ids, freq, rank0)},
            "robust": [i for i, f in zip(ids, freq) if f > 0.8], "n_robust": int((freq > 0.8).sum()),
            "fragile_in_base_top": [i for i, f, r in zip(ids, freq, rank0) if r <= TOPK and f < 0.5]}


def main():
    out = {"meta": {"reps": REPS, "alpha": ALPHA, "topk": TOPK, "note": "alpha [estimated]; weights are assumptions, PROVISIONAL"}}
    for name, f in (("battery", "battery_score.json"), ("solar", "solar_score.json")):
        d = json.loads((ROOT / "data/analysis" / f).read_text())
        nodes = d["nodes"] if isinstance(d["nodes"], dict) else {n["id"]: (n.get("bat") or n) for n in d["nodes"]}
        out[name] = run(nodes, d["meta"]["config"]["weights"] if "config" in d["meta"] else d["config"]["weights"])
        print(name, "nodes", len(out[name]["nodes"]), "robust", out[name]["n_robust"], "fragile top-K", len(out[name]["fragile_in_base_top"]))
    (ROOT / "data/analysis/ranking_stability.json").write_text(json.dumps(out))


if __name__ == "__main__":
    main()
