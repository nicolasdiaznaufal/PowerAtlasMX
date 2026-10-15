"""
solar_variants.py - Variantes de clima ("weather variants") sobre la serie horaria CDMX de solar.py.

Variantes (todas con la MISMA planta, perdidas y reloj que el seguidor publicado):
    mean    "Yearly mean": dia promedio por (mes calendario, hora) sobre dias validos 2015-2025 (lo publicado).
    y2015.. dia promedio por (mes, hora) del clima REAL de ese ano (solo si los 12 meses tienen >= 15 dias
    y2025   validos; si no, la variante es NaN para ese nodo). 2026 NO es seleccionable como ano (incompleto).
    win     clima real de cada mes de las ventanas: tabla por (anio-mes, hora) para ago-2024..jul-2026.
    clear   cielo despejado (NASA-CLRSKY escalado), dia promedio por (mes, hora) sobre los mismos dias validos.

Representacion exacta y compacta para kpis: tabla (mes, hora) de 12x24 por variante de ano/mean (288 valores),
y 24x24 (anio-mes x hora) para `win`. Cada hora real con PML toma el valor y[variante](mes, hora) -> y_f = suma
n_horas x y (misma regla que aggregates.py). Unidades: y en MWh/MWp por hora (= kWh/kWp); ghi y poa en W/m2
(media horaria; kWh/m2 por hora al dividir entre 1000).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

try:
    import solar
except ImportError:
    from pipeline import solar

YEARS = tuple(range(2015, 2026))
YEAR_VARIANTS = tuple(f"y{y}" for y in YEARS)
WEATHER_VARIANTS = ("mean",) + YEAR_VARIANTS + ("win",)
ALL_VARIANTS = WEATHER_VARIANTS + ("clear",)
WINDOWS = {"Y1": (202408, 202507), "Y2": (202508, 202607), "Y1aj": (202408, 202506), "Y2aj": (202508, 202606)}
WIN_YM = tuple(int(p.year * 100 + p.month) for p in pd.period_range("2024-08", "2026-07", freq="M"))
MIN_DAYS_YEAR_MONTH = 15   # [estimado] dias validos minimos por mes para una variante de ano
MIN_DAYS_MEAN_MONTH = 5    # igual que solar.annual_from_month_hour
QTY = ("y", "ghi", "poa")
_RENAME = {"energy_mwh_per_mwp": "y", "ghi_wm2": "ghi", "poa_wm2": "poa"}
DAYS = np.array([solar.DAYS_IN_MONTH[m] for m in range(1, 13)], dtype=float)


def ym_days(ym: int) -> int:
    return pd.Period(f"{ym // 100}-{ym % 100:02d}").days_in_month


def ym_pos(ym):
    """Posicion 0..23 de un anio-mes dentro de WIN_YM (2024-08 = 0). Vectorizado."""
    ym = np.asarray(ym)
    return (ym // 100 - 2024) * 12 + (ym % 100 - 8)


def window_ym(window: str) -> list[int]:
    a, b = WINDOWS[window]
    return [ym for ym in WIN_YM if a <= ym <= b]


def _arr(df: pd.DataFrame) -> dict:
    return {c: df[c].unstack("hour").reindex(index=range(1, 13), columns=range(24)).to_numpy(float).copy() for c in QTY}


def build_tables(local: pd.DataFrame) -> dict:
    """local: salida de solar.to_cdmx(hourly_pv_power). Devuelve
    {'mean': {y,ghi,poa: (12,24), nd: (12,)}, 'y2015'..: igual o None, 'win': {y,ghi,poa: (24,24), nd: (24,)}}."""
    v = local[solar.valid_day_mask(local)].rename(columns=_RENAME)[["year", "month", "hour", "date", *QTY]]
    out = {}
    vm = v[v["year"].isin(YEARS)]
    t = _arr(vm.groupby(["month", "hour"])[list(QTY)].mean())
    nd = vm.groupby("month")["date"].nunique().reindex(range(1, 13)).fillna(0).to_numpy(float)
    bad = nd < MIN_DAYS_MEAN_MONTH
    for c in QTY:
        t[c][bad, :] = np.nan
    out["mean"] = {**t, "nd": nd}
    g = v.groupby(["year", "month", "hour"])[list(QTY)].mean()
    ndy = v.groupby(["year", "month"])["date"].nunique()
    for y in YEARS:
        if y not in g.index.get_level_values(0):
            out[f"y{y}"] = None
            continue
        t = _arr(g.loc[y])
        nd = ndy.loc[y].reindex(range(1, 13)).fillna(0).to_numpy(float)
        if (nd < MIN_DAYS_YEAR_MONTH).any():
            out[f"y{y}"] = None
            continue
        out[f"y{y}"] = {**t, "nd": nd}
    w = {c: np.full((len(WIN_YM), 24), np.nan) for c in QTY}
    wnd = np.zeros(len(WIN_YM))
    for i, ym in enumerate(WIN_YM):
        key = (ym // 100, ym % 100)
        if key in ndy.index and ndy.loc[key] >= MIN_DAYS_YEAR_MONTH:
            sub = g.loc[key].reindex(range(24))
            for c in QTY:
                w[c][i] = sub[c].to_numpy(float)
            wnd[i] = ndy.loc[key]
    out["win"] = {**w, "nd": wnd}
    return out


def annual_equiv(tab: dict | None, col: str = "y", window: str | None = None) -> float:
    """MWh/MWp-ano (o kWh/m2-ano) de la variante sin huecos de PML: sum_mes dias x sum_hora(valor).
    Para `win` con `window`: suma de sus 12 anio-mes (dias reales de cada mes)."""
    if tab is None:
        return float("nan")
    if window is None:
        return float(np.sum(DAYS * np.sum(tab[col], axis=1)))
    pos = ym_pos(window_ym(window))
    d = np.array([ym_days(ym) for ym in window_ym(window)], float)
    return float(np.sum(d * np.sum(tab[col][pos], axis=1)))


def _lookup(tab: dict, col: str, ym: np.ndarray, hour: np.ndarray, win: bool) -> np.ndarray:
    if win:
        return tab[col][ym_pos(ym), hour]
    return tab[col][(ym % 100) - 1, hour]


def yf_and_profile(tab: dict | None, rows: np.ndarray, window: str, win: bool = False):
    """rows: (k,3) = [anio-mes, hora CDMX, n_horas] del nodo (agregados_comunes). Devuelve
    (n_horas, y_f MWh/MWp, perfil 24h ponderado por n_horas) de la ventana. y_f = suma n x y; NaN si falta
    algun valor requerido (no se rellena). Perfil: sum(n y)/sum(n) por hora, igual que node_profiles.json."""
    a, b = WINDOWS[window]
    r = rows[(rows[:, 0] >= a) & (rows[:, 0] <= b)]
    n = float(r[:, 2].sum()) if len(r) else 0.0
    if tab is None or len(r) == 0:
        return n, float("nan"), np.full(24, np.nan)
    ym, hr, nh = r[:, 0].astype(int), r[:, 1].astype(int), r[:, 2]
    val = _lookup(tab, "y", ym, hr, win)
    prof = np.full(24, np.nan)
    num = np.bincount(hr, weights=nh * val, minlength=24)
    den = np.bincount(hr, weights=nh, minlength=24)
    ok = den > 0
    prof[ok] = num[ok] / den[ok]
    yf = float(np.sum(nh * val)) if np.isfinite(val).all() else float("nan")
    return n, yf, prof


def monthly_kwh_m2(tab: dict | None, col: str, window: str | None = None) -> np.ndarray:
    """12 valores kWh/m2-mes: calendario Ene-Dic (mean/anos) o los 12 meses de la ventana (win)."""
    if tab is None:
        return np.full(12, np.nan)
    if window is None:
        return np.sum(tab[col], axis=1) / 1000.0 * DAYS
    pos = ym_pos(window_ym(window))
    d = np.array([ym_days(ym) for ym in window_ym(window)], float)
    return np.sum(tab[col][pos], axis=1) / 1000.0 * d


def typical_day(tab: dict | None, col: str, window: str, win: bool = False) -> np.ndarray:
    """Dia tipico de 24 h de la ventana (media ponderada por dias del mes), en unidades de `col`/1000 para
    ghi/poa (kWh/m2 por hora) o tal cual para y."""
    if tab is None:
        return np.full(24, np.nan)
    yms = window_ym(window)
    d = np.array([ym_days(ym) for ym in yms], float)
    rows = tab[col][ym_pos(yms)] if win else tab[col][[(ym % 100) - 1 for ym in yms]]
    out = (rows * d[:, None]).sum(axis=0) / d.sum()
    return out if col == "y" else out / 1000.0
