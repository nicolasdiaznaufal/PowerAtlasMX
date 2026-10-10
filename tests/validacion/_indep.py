"""Utilidades del validador, escritas SIN reutilizar pipeline/ (camino independiente).

- mapa_reloj(): (sistema, fecha, hora publicada) -> ts = inicio de hora en hora local ESTANDAR,
  derivado con zoneinfo (medianoche civil de la zona IANA + (hora-1) h reales, + offset estándar).
- kpis_desde_sumas(): fórmulas de KPIs escritas aquí a partir de la definición publicada
  (docs/TECNICO.md §4), no del código del autor.
"""
from __future__ import annotations

import datetime as dt
from datetime import timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

import pandas as pd

IANA = {"SIN": "America/Mexico_City", "BCS": "America/Mazatlan", "BCA": "America/Tijuana"}
STD = {"SIN": -6, "BCS": -7, "BCA": -8}
DATOS_INI, DATOS_FIN = dt.date(2020, 1, 1), dt.date(2026, 9, 30)


def _largo(z: ZoneInfo, d: dt.date) -> int:
    a = dt.datetime(d.year, d.month, d.day, tzinfo=z).astimezone(timezone.utc)
    n = d + timedelta(days=1)
    b = dt.datetime(n.year, n.month, n.day, tzinfo=z).astimezone(timezone.utc)
    return int((b - a) / timedelta(hours=1))


@lru_cache(maxsize=None)
def mapa_cdmx(ini: dt.date = DATOS_INI, fin: dt.date = DATOS_FIN) -> pd.DataFrame:
    """(sistema, fecha, hora) -> ts en reloj CDMX = instante UTC - 6 h (UTC-6 fijo, nunca DST)."""
    m = mapa_reloj(ini, fin).copy()
    m["ts"] = m["ts"] - pd.to_timedelta(m["sistema"].map(STD), unit="h") - pd.Timedelta(hours=6)
    return m


@lru_cache(maxsize=None)
def mapa_reloj(ini: dt.date = DATOS_INI, fin: dt.date = DATOS_FIN) -> pd.DataFrame:
    rows = []
    for s, zn in IANA.items():
        z = ZoneInfo(zn)
        d = ini
        while d <= fin:
            m = dt.datetime(d.year, d.month, d.day, tzinfo=z).astimezone(timezone.utc).replace(tzinfo=None)
            for h in range(1, _largo(z, d) + 1):
                rows.append((s, d, h, m + timedelta(hours=h - 1 + STD[s])))
            d += timedelta(days=1)
    df = pd.DataFrame(rows, columns=["sistema", "fecha", "hora", "ts"])
    df["fecha"] = pd.to_datetime(df["fecha"]).dt.date
    return df


def horas_anio(y: int) -> int:
    return (366 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 365) * 24


def kpis_desde_sumas(n: int, sum_pml: float, P: float, I: float, E0: float, n_le0: int) -> dict:
    B = sum_pml / n if n else None
    C = I / P if P else None
    return {"n_horas": n, "precio_base_mxn_mwh": B, "precio_capturado_mxn_mwh": C,
            "vf": (C / B) if (B and B > 0 and C is not None) else None,
            "produccion_mwh_por_mwp": P, "ingreso_mxn_por_mwp": I, "mwh_por_mwp_en_riesgo": E0,
            "pct_energia_pml_le0": 100.0 * E0 / P if P else None,
            "pct_horas_pml_le0": 100.0 * n_le0 / n if n else None}
