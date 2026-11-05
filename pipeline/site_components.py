"""Attach the site-risk components (arch, indig, access) to a score. Reads data/analysis/site_risk.json (pipeline/site_risk.py --nodes).

A layer with no data for any node is left out of the score (listed in `missing_layers`); a node without a coordinate gets the neutral
value and a flag (decided inside site_risk). Never a silent 1.0.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SR_PATH = ROOT / "data/analysis/site_risk.json"
KEYS = ("arch", "indig", "access")


def load():
    if not SR_PATH.exists():
        return {"layers": {}, "nodes": {}}
    return json.loads(SR_PATH.read_text())


def for_node(sr, key):
    """-> (components {k: v} for available layers, flags, metrics) ; ({}, [], {}) when the node or the file is missing."""
    r = sr["nodes"].get(key)
    if not r:
        return {}, [], {}
    comp = {k: r["components"][k] for k in KEYS if sr["layers"].get(k)}
    flags = [f for f in r["flags"] if not f.startswith("no ") or "coordinate" in f]   # layer-wide gaps are reported once in meta
    return comp, flags, r["metrics"]


def effective_weights(w, comps):
    """weights of the components present, normalised (reported with the score)."""
    ks = [k for k in comps if k in w]
    t = sum(w[k] for k in ks)
    return {k: round(w[k] / t, 3) for k in ks} if t else {}
