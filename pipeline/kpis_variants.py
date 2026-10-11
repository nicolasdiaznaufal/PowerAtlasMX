"""KPIs por nodo x configuracion (tracker / fijo) x variante de clima (solar v2), con las MISMAS rutas de calculo
que el analisis publicado (kpis._metricas_nodo, kpis.a_reales, kpis.nodos_json). No hay formulas nuevas.

Base: data/solar_v2/tables_month_hour.parquet trae y(clave, hora) [MWh/MWp por hora] por nodo, config y variante;
clave = mes 1..12 (mean, yYYYY, clear) o anio*100+mes (win). Como y es constante dentro de cada celda
(nodo, anio, mes, hora) de los agregados comunes, las sumas ponderadas son exactas:
    sum_y     = y * n_horas            [MWh/MWp]
    sum_y_pml = y * sum_pml_cent / 100 [MXN/MWp]   (identico al Sum(y*pml) horario: error medido 4e-13 relativo)
    sum_y_le0 = y * n_pml_le0          [MWh/MWp]
y con eso kpis._metricas_nodo da p_cap, vf, pct_e0, y_f, ingreso, ingreso_atajo, vf_dia_promedio, etc.
Reales: kpis.a_reales (deflactor INPC del mes CDMX, base = ultimo mes de la tabla), igual que el publicado.
Universo por ventana: ids de analysis_nodos.json y n_horas >= 300 dias (igual que el publicado). y_f e ingreso
NO se anualizan; yf_annual_equiv (de solar_v2/scalars.parquet) es solo informativo.
Raiz de datos: $NODAL_DATA_ROOT (por defecto, la raiz del repo)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aggregates as AG  # noqa: E402
import kpis as K  # noqa: E402

DATA_ROOT = Path(os.environ.get("NODAL_DATA_ROOT", K.ROOT))
VARIANTES = ["mean"] + [f"y{a}" for a in range(2015, 2026)] + ["win"]     # clear: solo referencia de irradiancia
ETIQUETAS = {"mean": "Yearly mean 2015-2025", "win": "Window weather (actual months of each window)",
             **{f"y{a}": f"{a} weather" for a in range(2015, 2026)}}
NOTA_2015 = ("2015 weather: median across the 2,431 KPI nodes (tracker, 12-month yield) is -6.1 % vs the 2015-2025 "
             "Yearly mean (which includes 2015) and -6.7 % vs the mean of the other ten years (2016-2025); over all "
             "2,605 solar nodes it is -5.9 % vs the Yearly mean. Likely a MERRA-2/CERES input change [unverified]; "
             "2015 stays inside the Yearly mean.")
VENT_WEB = {"Y1": "deck_2024_25", "Y2": "deck_2025_26"}
CFG_WEB = {"tracker": "tracker", "fixed": "fijo"}
CAMPOS9 = ["p_cap", "vf", "pct_e0", "y_f", "ingreso", "ingreso_atajo", "vf_dia_promedio", "p_cap_real", "ingreso_real"]
CORE = ["p_cap", "vf", "y_f", "ingreso", "yf_annual_equiv"]
COMPARTIDOS = ["n_horas", "pml_medio", "pml_medio_real", "congestion_media", "spread_punta_solar"]
TOL_REL = 1e-6


def rutas(root: Path = DATA_ROOT) -> dict:
    return {"comunes": root / "data/aggregates/agregados_comunes.parquet",
            "config": root / "data/aggregates/agregados_config.parquet",
            "tablas": root / "data/solar_v2/tables_month_hour.parquet",
            "scalars": root / "data/solar_v2/scalars.parquet",
            "publicado": root / "data/analysis/analysis_nodos.json",
            "inpc": root / "data/ref/inpc_mensual.csv",
            "out": root / "data/solar_v2/web"}


def cargar_comunes(path: Path, ids, desde: str | None = None) -> pd.DataFrame:
    filtros = [("anio", ">=", int(desde[:4]))] if desde else None
    c = pd.read_parquet(path, filters=filtros)
    c = c[c["nodo"].isin(set(ids))]
    if desde:
        c = c[c["anio"] * 100 + c["mes"] >= int(desde.replace("-", ""))]
    return c.reset_index(drop=True)


def tabla_larga(tablas: pd.DataFrame, config: str, variante: str) -> pd.DataFrame:
    """nodo, clave, hora, y (una fila por hora) para una config y variante."""
    t = tablas[(tablas["config"] == config) & (tablas["variant"] == variante)]
    if t.empty:
        raise ValueError(f"sin tabla para {config}/{variante}")
    y = np.stack(t["y"].to_numpy()).astype(float)
    if y.shape[1] != 24:
        raise ValueError("cada fila de tables_month_hour debe traer 24 horas")
    return pd.DataFrame({"nodo": np.repeat(t["nodo"].to_numpy(), 24), "clave": np.repeat(t["key"].to_numpy(), 24),
                         "hora": np.tile(np.arange(24), len(t)), "y": y.ravel()})


def combinar_variante(com: pd.DataFrame, larga: pd.DataFrame, variante: str) -> pd.DataFrame:
    """Celdas comunes + sumas ponderadas con el y de la variante (misma forma que aggregates.combinar)."""
    d = com.copy()
    d["clave"] = d["anio"] * 100 + d["mes"] if variante == "win" else d["mes"]
    d = d.merge(larga, on=["nodo", "clave", "hora"], how="left", validate="many_to_one")
    if d["y"].isna().any():
        faltan = d.loc[d["y"].isna(), ["nodo", "anio", "mes"]].drop_duplicates().head(5).to_dict("records")
        raise ValueError(f"celdas sin y para la variante {variante}: {faltan}")
    d["y_mwh_por_mwp"] = d["y"]
    d["sum_y"] = d["y"] * d["n_horas"]
    d["sum_y_pml"] = d["y"] * d["sum_pml_cent"] / 100.0
    d["sum_y_le0"] = d["y"] * d["n_pml_le0"]
    return d.drop(columns=["clave", "y"])


def metricas(ag: pd.DataFrame, inpc: dict | None, ventana: str, ids) -> pd.DataFrame:
    """Tabla por nodo de una ventana, exactamente como kpis.analisis (universo y campos *_real)."""
    de, ha = K.VENTANAS_ANALISIS[ventana]
    t = K._metricas_nodo(ag, de, ha)
    t = t[t.index.isin(set(ids)) & (t["n_horas"] >= K.MIN_DIAS_DECK * 24)]
    if inpc is not None:
        tr = K._metricas_nodo(K.a_reales(ag, inpc)[0], de, ha)
        t["p_cap_real"] = tr["p_cap"].reindex(t.index)
        t["pml_medio_real"] = tr["pml_medio"].reindex(t.index)
        t["ingreso_real"] = tr["ingreso"].reindex(t.index)
    return t


def kpis_mean(com_full: pd.DataFrame, tablas: pd.DataFrame, inpc, ids, config: str) -> dict:
    """Todas las ventanas del analisis publicado para la variante mean (completo incluido)."""
    ag = combinar_variante(com_full, tabla_larga(tablas, config, "mean"), "mean")
    return {v: metricas(ag, inpc, v, ids) for v in K.VENTANAS_ANALISIS}


def kpis_publicado(com_full: pd.DataFrame, cfg_path: Path, inpc, ids, config: str) -> dict:
    """Misma tabla por la ruta publicada (agregados_config del pipeline): referencia exacta de la puerta."""
    c = pd.read_parquet(cfg_path, filters=[("config", "==", config)])
    c = c[c["nodo"].isin(set(ids))]
    ag = AG.combinar(com_full, c, config)
    return {v: metricas(ag, inpc, v, ids) for v in K.VENTANAS_ANALISIS}


def kpis_variantes(com_y: pd.DataFrame, tablas: pd.DataFrame, inpc, ids, config: str) -> dict:
    """{variante: {Y1|Y2: DataFrame por nodo}} para las 13 variantes seleccionables."""
    out = {}
    for v in VARIANTES:
        ag = combinar_variante(com_y, tabla_larga(tablas, config, v), v)
        out[v] = {w: metricas(ag, inpc, vent, ids) for w, vent in VENT_WEB.items()}
    return out


# ---------------------------------------------------------------- puertas de conciliacion (fallan el build)
def _err_rel(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.abs(a - b) / np.maximum(np.abs(b), 1e-12)


def comparar(mio: pd.DataFrame, ref: pd.DataFrame, campos, tol: float = TOL_REL, atol: float = 1e-9) -> dict:
    """Max error relativo por campo; misma membresia de nodos. Lanza AssertionError si se excede."""
    if set(mio.index) != set(ref.index):
        raise AssertionError(f"universos distintos: {len(set(mio.index) ^ set(ref.index))} nodos")
    r = ref.reindex(mio.index)
    res = {}
    for c in campos:
        a, b = mio[c].to_numpy(float), r[c].to_numpy(float)
        if not np.array_equal(np.isnan(a), np.isnan(b)):
            raise AssertionError(f"{c}: NaN en lugares distintos")
        ok = ~np.isnan(a)
        bad = np.abs(a[ok] - b[ok]) > tol * np.abs(b[ok]) + atol
        if bad.any():
            raise AssertionError(f"{c}: {int(bad.sum())} nodos fuera de {tol} relativo")
        res[c] = float(_err_rel(a[ok], b[ok]).max()) if ok.any() else 0.0
    return res


def comparar_json(nod: dict, pub: dict) -> dict:
    """analysis_nodos (4 decimales) contra el publicado: |a-b| <= 5e-5 (redondeo) + 1e-6*|b|.
    Devuelve {ventana.campo: (max error absoluto, max error relativo)}."""
    if nod["ids"] != pub["ids"]:
        raise AssertionError("ids distintos al publicado")
    res = {}
    for v, cols in pub["ventanas"].items():
        if set(cols) != set(nod["ventanas"][v]):
            raise AssertionError(f"{v}: campos distintos al publicado")
        for c, b in cols.items():
            a = nod["ventanas"][v][c]
            if [x is None for x in a] != [x is None for x in b]:
                raise AssertionError(f"{v}.{c}: None en lugares distintos")
            aa = np.array([x for x in a if x is not None], float)
            bb = np.array([x for x in b if x is not None], float)
            d = np.abs(aa - bb)
            if (d > 5e-5 * (1 + 1e-9) + TOL_REL * np.abs(bb)).any():
                raise AssertionError(f"{v}.{c}: {int((d > 5e-5 + TOL_REL * np.abs(bb)).sum())} valores fuera")
            res[f"{v}.{c}"] = ((float(d.max()), float(_err_rel(aa, bb).max())) if len(d) else (0.0, 0.0))
    return res


def comparar_scalars(var: dict, sc: pd.DataFrame, config: str) -> dict:
    """y_f y n_horas por variante y ventana Y1/Y2 contra solar_v2/scalars.parquet."""
    s = sc[sc["config"] == config].set_index(["variant", "window", "nodo"]).sort_index()
    peor = 0.0
    for v, wins in var.items():
        for w, t in wins.items():
            ref = s.loc[(v, w)].reindex(t.index)
            if ref["y_f"].isna().any():
                raise AssertionError(f"{config}/{v}/{w}: nodos sin escalar de solar")
            if not np.array_equal(ref["n_horas"].to_numpy(float), t["n_horas"].to_numpy(float)):
                raise AssertionError(f"{config}/{v}/{w}: n_horas distinto a solar_v2")
            e = _err_rel(t["y_f"].to_numpy(float), ref["y_f"].to_numpy(float))
            if (e > TOL_REL).any():
                raise AssertionError(f"{config}/{v}/{w}: y_f fuera de {TOL_REL} vs solar_v2 ({e.max():.2e})")
            peor = max(peor, float(e.max()))
            t["yf_annual_equiv"] = ref["yf_annual_equiv"].to_numpy(float)
    return {"y_f_max_err_rel": peor}


def n_horas_identico(todas: dict) -> None:
    """n_horas igual entre configs y variantes (por ventana)."""
    for w in VENT_WEB:
        series = [var[v][w]["n_horas"] for var in todas.values() for v in var]
        for s in series[1:]:
            if not s.equals(series[0]):
                raise AssertionError(f"{w}: n_horas difiere entre configs/variantes")
