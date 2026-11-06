"""Indigenous-locality layer from the INEGI Censo 2020 ITER (iter_00_cpv2020). Place the unzipped CSV in
data/ref/geo/indigena/iter_00_cpv2020/ (the INEGI download page cannot be fetched automatically).

Per locality: indigenous share = indigenous population / POBTOT; "indigenous" if share >= cfg share_min.
Population column: first of cfg pop_column_preference present (P3YM_HLI = speakers of an indigenous language aged 3+, the standard INEGI
proxy; PHOG_IND = population in households with an indigenous head or spouse). Suppressed values ('*', 'N/D') are missing, never zero.
"""
import re
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from roads_layer import km_xy

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "data/ref/geo/indigena/iter_00_cpv2020"
DMS = re.compile(r"^\s*(-?)(\d+(?:\.\d+)?)\s*[°º\s]\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:\"|″|'')\s*)?([NSEWO]?)\s*$", re.I)


def dms_to_deg(txt):
    """'099°07'59.00"W' -> -99.1330556; plain decimals pass; None if unreadable. W/O and S are negative."""
    if txt is None:
        return None
    s = str(txt).strip()
    try:
        return float(s)
    except ValueError:
        pass
    m = DMS.match(s)
    if not m:
        return None
    neg, d, mi, se, hemi = m.groups()
    v = float(d) + float(mi or 0) / 60 + float(se or 0) / 3600
    return -v if (neg or hemi.upper() in ("S", "W", "O")) else v


def to_num(series):
    return pd.to_numeric(series.astype(str).str.strip().replace({"*": None, "N/D": None, "": None}), errors="coerce")


def load_iter(cfg, path=None):
    """-> DataFrame(lat, lon, pob, ind, share, is_ind) plus info dict, or (None, info) when the file is not there."""
    base = Path(path) if path else DIR
    files = sorted(base.rglob("conjunto_de_datos*.csv")) if base.exists() else []   # the INEGI zip nests it two folders deep
    if not files:
        return None, {"available": False}
    d = pd.read_csv(files[0], dtype=str, encoding="utf-8-sig", low_memory=False)
    d.columns = [c.strip().upper() for c in d.columns]
    if "LOC" in d.columns:   # LOC 0000 = entity/municipality totals, 9998/9999 = scattered localities without coordinates
        d = d[~d["LOC"].str.strip().isin(["0", "00", "000", "0000", "9998", "9999"])]
    pop_col = next((c for c in cfg["pop_column_preference"] if c in d.columns), None)
    if pop_col is None or cfg["tot_column"] not in d.columns or "LONGITUD" not in d.columns:
        raise ValueError(f"ITER columns not as expected: {list(d.columns)[:20]}")
    out = pd.DataFrame({"lat": d["LATITUD"].map(dms_to_deg), "lon": d["LONGITUD"].map(dms_to_deg), "pob": to_num(d[cfg["tot_column"]]), "ind": to_num(d[pop_col])})
    n_all = len(out)
    out = out.dropna(subset=["lat", "lon"])
    valid = out["pob"].gt(0) & out["ind"].notna()
    info = {"available": True, "pop_column": pop_col, "localities": n_all, "with_coord": len(out), "pct_without_data": round(100 * (1 - valid.sum() / max(n_all, 1)), 1)}
    out = out[valid].copy()
    out["share"] = out["ind"] / out["pob"]
    out["is_ind"] = out["share"] >= cfg["share_min"]
    return out, info


class IndigIndex:
    def __init__(self, df, cfg):
        self.cfg, self.df = cfg, df[df["is_ind"]].reset_index(drop=True)
        self.xy = km_xy(self.df["lat"], self.df["lon"])
        self.tree = cKDTree(self.xy)

    def metrics(self, lat, lon):
        c, p = self.cfg, km_xy([lat], [lon])[0]
        if not len(self.df):
            return {"dist_indig_km": None, "indig_pop_5km": 0, "indig_n_5km": 0}
        d = float(self.tree.query(p)[0])
        idx = self.tree.query_ball_point(p, c["radius_km"])
        return {"dist_indig_km": round(d, 2), "indig_pop_5km": int(self.df["ind"].iloc[idx].sum()) if idx else 0, "indig_n_5km": len(idx)}

    def risk(self, m):
        """risk = max(0, 1 - dist/radius) * min(1, base + pop/pop_full); component = 1 - risk."""
        c = self.cfg
        if m["dist_indig_km"] is None:
            return 0.0
        near = max(0.0, 1 - m["dist_indig_km"] / c["radius_km"])
        return near * min(1.0, c["base_intensity"] + m["indig_pop_5km"] / c["pop_per_full_weight"])
