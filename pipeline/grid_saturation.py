"""Verified substation saturation for 230/400 kV PML nodes (Batu open CSV x CENACE catalog).

Verification = normalised name + kV + CFE distribution zone all match (no coordinates exist in the Batu file).
Out: data/analysis/subs_verified.csv (clave, nombre, tension_kv, capacidad_mva, generacion_conectada_mw, saturacion).
"""
import re
import unicodedata
from pathlib import Path

import openpyxl
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CAT = ROOT / "data/ref/Catálogo NodosP Sistema Eléctrico Nacional (v2026-07-16).xlsx"
COLS = ['sistema', 'cc', 'zona_carga', 'clave', 'nombre', 'kv', 'cd', 'ci', 'gd', 'gi', 'zot', 'grt', 'zona_dist',
        'gdd', 'cve_ent', 'entidad', 'cve_mun', 'municipio', 'region_tx']


def nm(s):
    s = unicodedata.normalize("NFKD", str(s or "").upper()).encode("ascii", "ignore").decode()
    s = re.sub(r"\b(POTENCIA|SUBESTACION|S\.?E\.?|DE|LA|EL|LOS|LAS|DEL)\b", "", s)
    return re.sub(r"[^A-Z0-9]", "", s)


def main():
    ws = openpyxl.load_workbook(CAT, data_only=True, read_only=True).worksheets[0]
    cat = pd.DataFrame([r[:19] for r in ws.iter_rows(min_row=3, values_only=True)], columns=COLS).dropna(subset=["clave"])
    cat = cat[cat.kv.astype(float) >= 230].assign(nn=lambda d: d.nombre.map(nm), zz=lambda d: d.zona_dist.map(nm))
    s = pd.read_csv(ROOT / "data/ref/batu_open/subestaciones.csv")
    s = s.assign(nn=s.nombre.map(nm), zz=s.zona_cfe.map(nm))
    m = s.merge(cat[["clave", "nn", "zz", "kv"]], on="nn", suffixes=("", "_c"))
    ok = m[(m.zz == m.zz_c) & (m.tension_kv.astype(float) == m.kv.astype(float))].drop_duplicates("clave")
    cols = ["clave", "nombre", "tension_kv", "capacidad_mva", "generacion_conectada_mw", "saturacion"]
    out = ROOT / "data/analysis/subs_verified.csv"
    ok[cols].to_csv(out, index=False)
    print(len(ok), "verified nodes;", int((ok.saturacion > 0).sum()), "saturated ->", out)


if __name__ == "__main__":
    main()
