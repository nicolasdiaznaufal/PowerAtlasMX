"""
daily_series.py - Serie DIARIA por nodo (PML + produccion FV con clima real del dia) y promedios de area.

Funciones puras (numpy), sin E/S; la orquestacion y las puertas estan en daily_build.py. Formulas y unidades en
docs/TECNICO.md §13.

Eje: hora CDMX estandar (UTC-6 fijo, clock.ts_cdmx). h = horas desde D0 00:00 CDMX; dia = h // 24; hora = h % 24.

Lado PML (independiente de config), por dia d, sobre las horas con PML del dia (n_horas_d):
    pml_avg = sum(round(100*pml))/100/n      (centavos como aggregates.py: misma suma que pml_medio publicado)
    energia_avg, perdidas_avg, congestion_avg: igual con cada componente   [MXN/MWh]
    spread  = max(pml) - min(pml) del dia                                   [MXN/MWh]
    n_horas = horas con PML (0 -> todo el dia nulo)
Lado solar por config, y_h = produccion de la hora con el clima REAL de ese dia [MWh/MWp]; solo dias de clima
valido (24 h de GHI, solar.valid_day_mask); las sumas recorren las MISMAS horas con PML (como y_f publicado):
    y_day = sum(y_h)            [MWh/MWp]        horas_solares = #(y_h > 0)
    ingreso_dia = sum(y_h*pml)  [MXN/MWp]        p_cap_dia = ingreso_dia / y_day [MXN/MWh] (nulo si y_day == 0)
    vf_dia = p_cap_dia / pml_avg (nulo si pml_avg <= 0, como kpis._metricas_nodo)
Identidades: ingreso_dia = y_day * p_cap_dia ; vf_dia = p_cap_dia / pml_avg.
"""
from __future__ import annotations

import datetime as dt
import re

import numpy as np
import pandas as pd

D0 = pd.Timestamp("2020-01-01")                    # primer dia (CDMX) de la cobertura PML
COMP = ("pml", "energia", "perdidas", "congestion")
PML_FIELDS = ("n_horas", "pml_avg", "energia_avg", "perdidas_avg", "congestion_avg", "spread")
CFG_FIELDS = ("y_day", "horas_solares", "p_cap_dia", "vf_dia", "ingreso_dia")
CONFIGS = {"tracker": "tracker", "fijo": "fixed"}  # clave web -> clave parquet/solar
# escala de cada campo: valor = entero * escala (error de redondeo <= escala/2)
SCALE = {"n_horas": 1, "pml_avg": 0.1, "energia_avg": 0.1, "perdidas_avg": 0.01, "congestion_avg": 0.01,
         "spread": 0.1, "y_day": 1e-4, "horas_solares": 1, "p_cap_dia": 0.1, "vf_dia": 1e-4, "ingreso_dia": 0.1,
         "n_nodos": 1}
AREA_CFG_FIELDS = ("n_nodos", "y_day", "horas_solares", "p_cap_dia", "pml_avg", "vf_dia", "ingreso_dia")
AREA_PML_FIELDS = ("n_nodos",) + PML_FIELDS[1:]


def n_days(last_day) -> int:
    return int((pd.Timestamp(last_day) - D0).days) + 1


def hour_index(ts) -> np.ndarray:
    """Horas enteras desde D0 (ts tz-naive CDMX, inicio de hora)."""
    return ((pd.DatetimeIndex(ts) - D0) // pd.Timedelta(hours=1)).to_numpy(np.int64)


def _bc(day, w, nd):
    return np.bincount(day, weights=w, minlength=nd)[:nd]


def pml_daily(h: np.ndarray, cents: dict, pml: np.ndarray, nd: int) -> dict:
    """h: horas desde D0 (unicas); cents[c] = round(100*c) entero por hora (c en COMP); pml crudo [MXN/MWh]."""
    keep = (h >= 0) & (h < nd * 24)
    h, pml = h[keep], np.asarray(pml, float)[keep]
    day = h // 24
    if len(np.unique(h)) != len(h):
        raise ValueError("hora duplicada en la serie del nodo")
    n = np.bincount(day, minlength=nd)[:nd].astype(float)
    ok = n > 0
    out = {"n_horas": np.where(ok, n, np.nan)}
    for c, f in zip(COMP, PML_FIELDS[1:5]):
        s = _bc(day, np.asarray(cents[c], np.int64)[keep].astype(float), nd)
        out[f] = np.where(ok, s / 100.0 / np.where(ok, n, 1), np.nan)
        out["_cent_" + c] = s                        # sumas exactas (centavos) para las puertas
    mx = np.full(nd, -np.inf)
    mn = np.full(nd, np.inf)
    np.maximum.at(mx, day, pml)
    np.minimum.at(mn, day, pml)
    out["spread"] = np.where(ok, mx - mn, np.nan)
    return out


def y_grid(local_idx, energy: np.ndarray, valid: np.ndarray, nd: int) -> np.ndarray:
    """Rejilla horaria (nd*24) de y [MWh/MWp] desde la salida de solar.to_cdmx; NaN en horas de dias no validos
    o fuera del cache de clima."""
    g = np.full(nd * 24, np.nan)
    h = hour_index(local_idx)
    e = np.where(np.asarray(valid, bool), np.asarray(energy, float), np.nan)
    k = (h >= 0) & (h < nd * 24)
    g[h[k]] = e[k]
    return g


def solar_daily(h: np.ndarray, pml: np.ndarray, grid: np.ndarray, pml_avg: np.ndarray) -> dict:
    """Campos diarios de una config. Dia nulo si no tiene PML o si alguna de sus horas con PML no tiene clima."""
    nd = len(pml_avg)
    keep = (h >= 0) & (h < nd * 24)
    h, pml = h[keep], np.asarray(pml, float)[keep]
    day = h // 24
    y = grid[h]
    fin = np.isfinite(y)
    n = np.bincount(day, minlength=nd)[:nd]
    nfin = np.bincount(day, weights=fin, minlength=nd)[:nd]
    ok = (n > 0) & (nfin == n)
    y0 = np.where(fin, y, 0.0)
    yd = _bc(day, y0, nd)
    ing = _bc(day, y0 * pml, nd)
    hs = _bc(day, (y0 > 0).astype(float), nd)
    pos = ok & (yd > 0)
    pcap = np.where(pos, ing / np.where(pos, yd, 1), np.nan)
    pa = np.asarray(pml_avg, float)
    vf = np.where(pos & (pa > 0), pcap / np.where(pa > 0, pa, 1), np.nan)
    return {"y_day": np.where(ok, yd, np.nan), "horas_solares": np.where(ok, hs, np.nan), "p_cap_dia": pcap,
            "vf_dia": vf, "ingreso_dia": np.where(ok, ing, np.nan)}


def y24_day(grid: np.ndarray) -> np.ndarray:
    """Produccion del dia completo (24 h, solo clima) [MWh/MWp]; NaN si el dia no es valido. Para la puerta (c)."""
    return grid.reshape(-1, 24).sum(axis=1)


def month_of_days(nd: int) -> np.ndarray:
    """anio*100+mes (CDMX) de cada dia."""
    d = D0 + pd.to_timedelta(np.arange(nd), unit="D")
    return (d.year * 100 + d.month).to_numpy(np.int64)


# ------------------------------------------------------------------ codificacion
def encode(a: np.ndarray, scale: float) -> list:
    """Enteros (valor/escala redondeado) con None en NaN."""
    a = np.asarray(a, float)
    q = np.rint(a / scale)
    return [None if not np.isfinite(v) else int(v) for v in q]


def decode(lst: list, scale: float) -> np.ndarray:
    return np.array([np.nan if v is None else v * scale for v in lst], float)


def node_doc(nodo: str, nd: int, pmls: dict, cfgs: dict) -> dict:
    return {"schema_version": "daily/1", "id": nodo, "start": D0.strftime("%Y-%m-%d"), "n": nd,
            "scale": {f: SCALE[f] for f in PML_FIELDS + CFG_FIELDS},
            "pml": {f: encode(pmls[f], SCALE[f]) for f in PML_FIELDS},
            **{k: {f: encode(cfgs[k][f], SCALE[f]) for f in CFG_FIELDS} for k in CONFIGS}}


# ------------------------------------------------------------------ areas
class AreaAcc:
    """Promedio diario entre nodos miembros CON dato ese dia.
    Lado PML: miembros = nodos con n_horas > 0; media simple de pml_avg, componentes y spread.
    Lado config: miembros = nodos con p_cap_dia no nulo; media de y_day, horas_solares, p_cap_dia, pml_avg,
    ingreso_dia sobre ESE conjunto y vf_dia = media(p_cap_dia) / media(pml_avg) (cociente de promedios)."""

    def __init__(self, nd: int):
        self.nd = nd
        self.s: dict = {}

    def _add(self, key, f, v, m):
        s = self.s.setdefault(key, {}).setdefault(f, np.zeros(self.nd))
        s += np.where(m, v, 0.0)

    def add(self, pmls: dict, cfgs: dict) -> None:
        mp = np.isfinite(pmls["pml_avg"])
        self._add("pml", "n_nodos", mp.astype(float), mp)
        for f in PML_FIELDS[1:]:
            self._add("pml", f, pmls[f], mp)
        for k in CONFIGS:
            m = mp & np.isfinite(cfgs[k]["p_cap_dia"])
            self._add(k, "n_nodos", m.astype(float), m)
            for f in ("y_day", "horas_solares", "p_cap_dia", "ingreso_dia"):
                self._add(k, f, cfgs[k][f], m)
            self._add(k, "pml_avg", pmls["pml_avg"], m)

    def result(self) -> dict:
        out = {}
        for key, d in self.s.items():
            n = d["n_nodos"]
            ok = n > 0
            r = {"n_nodos": n.copy()}
            for f, v in d.items():
                if f != "n_nodos":
                    r[f] = np.where(ok, v / np.where(ok, n, 1), np.nan)
            if key != "pml":
                pa = r["pml_avg"]
                r["vf_dia"] = np.where(ok & (pa > 0), r["p_cap_dia"] / np.where(pa > 0, pa, 1), np.nan)
            out[key] = r
        return out


def area_doc(key: str, kind: str, name: str, res: dict, nd: int) -> dict:
    return {"schema_version": "daily-area/1", "key": key, "kind": kind, "name": name,
            "start": D0.strftime("%Y-%m-%d"), "n": nd, "scale": {f: SCALE[f] for f in SCALE},
            "pml": {f: encode(res["pml"][f], SCALE[f]) for f in AREA_PML_FIELDS},
            **{k: {f: encode(res[k][f], SCALE[f]) for f in AREA_CFG_FIELDS} for k in CONFIGS}}


def slug(name: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", str(name).upper()).strip("_")


def full_day_range(days, max_hours) -> tuple[dt.date, dt.date]:
    """Primer y ultimo dia CDMX con 24 horas en algun nodo (max_hours: max entre nodos de horas con PML)."""
    d = pd.DatetimeIndex(days)[np.asarray(max_hours) >= 24]
    return d.min().date(), d.max().date()


# ------------------------------------------------------------------ medias moviles (referencia para la web)
def ma7(x, n_horas, min_days: int = 4, w: int = 7) -> np.ndarray:
    """Media movil (ventana que TERMINA en el dia i) ponderada por n_horas, saltando dias nulos; NaN con < min_days."""
    x, n = np.asarray(x, float), np.asarray(n_horas, float)
    ok = np.isfinite(x) & np.isfinite(n) & (n > 0)
    out = np.full(len(x), np.nan)
    for i in range(len(x)):
        k = ok[max(0, i - w + 1):i + 1]
        if k.sum() >= min_days:
            xs, ns = x[max(0, i - w + 1):i + 1][k], n[max(0, i - w + 1):i + 1][k]
            out[i] = (xs * ns).sum() / ns.sum()
    return out


def ma7_ratio(ingreso, y_day, pml_avg, n_horas, min_days: int = 4, w: int = 7) -> tuple[np.ndarray, np.ndarray]:
    """(p_cap_7d, vf_7d) por cociente de SUMAS sobre los dias validos (ingreso, y, pml y n_horas no nulos) de la
    ventana: p_cap = sum(ingreso)/sum(y); vf = p_cap / (sum(n*pml)/sum(n)). Nunca la media de vf_dia.
    NaN con < min_days validos, sum(y) <= 0 o pml ponderado <= 0."""
    a = [np.asarray(v, float) for v in (ingreso, y_day, pml_avg, n_horas)]
    ok = np.logical_and.reduce([np.isfinite(v) for v in a]) & (a[3] > 0)
    pc, vf = np.full(len(a[0]), np.nan), np.full(len(a[0]), np.nan)
    for i in range(len(ok)):
        s = slice(max(0, i - w + 1), i + 1)
        k = ok[s]
        if k.sum() < min_days:
            continue
        ing, y, p, n = (v[s][k] for v in a)
        if y.sum() <= 0:
            continue
        pc[i] = ing.sum() / y.sum()
        pm = (n * p).sum() / n.sum()
        vf[i] = pc[i] / pm if pm > 0 else np.nan
    return pc, vf
