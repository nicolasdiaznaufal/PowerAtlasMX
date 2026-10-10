"""Convencion de reloj de los PML del MDA (CENACE) para SIN, BCA y BCS, 2020-2026.

Dueno: agent clock-qa. Evidencia completa en docs/TECNICO.md, seccion "Reloj".

Lo que publica CENACE
---------------------
`hora` = hora que TERMINA, numerada 1..n de forma consecutiva desde la medianoche CIVIL de `fecha`,
en la hora civil (oficial) de cada sistema. Con horario de verano el dia de cambio tiene
n = 23 (primavera) o n = 25 (otono); fuera de esos dias n = 24.

Convencion por sistema y periodo
--------------------------------
| sistema | hora estandar          | horario de verano (DST) en el dato publicado                     |
|---------|------------------------|-------------------------------------------------------------------|
| SIN     | UTC-6 (Centro)         | regla mexicana hasta 2022-10-30 (1er dom abr -> ult dom oct);     |
|         |                        | desde 2022-10-30 02:00 reloj fijo UTC-6 (Ley 2022) [verificado]   |
| BCS     | UTC-7 (Pacifico MX)    | igual que SIN: regla mexicana hasta 2022-10-30, luego fijo UTC-7  |
| BCA     | UTC-8 (Pacifico/PST)   | regla de EE.UU. en TODO 2020-2026 (2o dom mar -> 1er dom nov);    |
|         |                        | la Ley 2022 la mantiene en la franja fronteriza [verificado]      |

- Fechas de cambio y conteo de horas: [verificado] en los 151 M de filas (todas las nodo-dia de esos
  dias tienen 23/25 horas contiguas 1..n; ningun otro dia difiere de 24).
- Sentido del desfase en verano (las etiquetas se corren +1 h en verano): [verificado] con prueba de
  desfase del perfil 14 dias antes/despues de cada cambio, contra placebos 2023-2026 sin cambio.
- Desfase estandar UTC-7 (BCS) y UTC-8 (BCA): [estimado] (zona legal del estado + pico vespertino
  ~0.8 h y ~1.7 h antes que el SIN en invierno, coherente con el ocaso local; no hay prueba directa).
- Orden intra-dia en los dias 23/25 (horas consecutivas, sin hueco ni hora 25 "anexada" al final):
  [estimado]; los datos no distinguen ambas hipotesis (ver TECNICO.md). Afecta 2 h por cambio.

Salida principal
----------------
`ts_local_estandar(sistema, fecha, hora)` -> timestamp tz-naive del INICIO de la hora en hora local
ESTANDAR del sistema (sin saltos de verano): continuo, unico y de 24 h por dia estandar.
`ts_utc(...)` = ts_local_estandar - offset estandar (tz-naive en UTC).
`ts_cdmx(...)` = reloj COMUN para los tres sistemas: hora estandar de CDMX, UTC-6 fijo, nunca DST
(= ts_utc - 6 h = ts_local_estandar + {SIN 0, BCS +1, BCA +2} h). SQL: `sql_ts_cdmx()`;
UTC -> CDMX: `utc_a_cdmx()`. Dia, mes y hora del dia del reloj comun se toman de ts_cdmx.
"""
from __future__ import annotations

import datetime as dt
from typing import Iterable

import numpy as np
import pandas as pd

SISTEMAS = ("SIN", "BCA", "BCS")

# Offset de la hora estandar respecto a UTC (horas). Todos [estimado]: zona legal del estado; el dato
# solo prueba la regla de verano. BCA/BCS apoyados por el pico vespertino (ver docstring).
STD_UTC_OFFSET_HOURS: dict[str, int] = {"SIN": -6, "BCS": -7, "BCA": -8}

CONFIANZA = {
    "SIN": "[verificado] DST mexicano 2020-2022 y fijo desde 2022-10-30; offset UTC-6 [estimado]",
    "BCS": "[verificado] DST mexicano 2020-2022 y fijo desde 2022-10-30; offset UTC-7 [estimado]",
    "BCA": "[verificado] DST de EE.UU. 2020-2026; offset UTC-8 [estimado]",
    "intra_dia_23_25": "[estimado] horas consecutivas desde la medianoche civil",
}

# Ultimo ano con horario de verano en SIN/BCS (Ley de los Husos Horarios, DOF 28-oct-2022).
_MX_ULTIMO_ANO_DST = 2022


def _nth_sunday(year: int, month: int, n: int) -> dt.date:
    d = dt.date(year, month, 1)
    d += dt.timedelta(days=(6 - d.weekday()) % 7)
    return d + dt.timedelta(weeks=n - 1)


def _last_sunday(year: int, month: int) -> dt.date:
    d = dt.date(year + (month == 12), month % 12 + 1, 1) - dt.timedelta(days=1)
    return d - dt.timedelta(days=(d.weekday() - 6) % 7)


def cambios_horario(sistema: str, year: int) -> tuple[dt.date, dt.date] | None:
    """(dia de primavera [23 h], dia de otono [25 h]) del sistema en `year`, o None si no hay DST."""
    if sistema not in SISTEMAS:
        raise ValueError(f"sistema desconocido: {sistema}")
    if sistema == "BCA":  # regla EE.UU. (Energy Policy Act 2005), seguida por la franja fronteriza
        return _nth_sunday(year, 3, 2), _nth_sunday(year, 11, 1)
    if year > _MX_ULTIMO_ANO_DST:
        return None
    return _nth_sunday(year, 4, 1), _last_sunday(year, 10)  # regla mexicana 2002-2022


def horas_en_dia(sistema: str, fecha: dt.date) -> int:
    """Numero de horas publicadas que se esperan para (sistema, fecha): 23, 24 o 25."""
    c = cambios_horario(sistema, fecha.year)
    if c is None:
        return 24
    return 23 if fecha == c[0] else 25 if fecha == c[1] else 24


def medianoche_en_verano(sistema: str, fecha: dt.date) -> bool:
    """True si las 00:00 civiles de `fecha` caen en horario de verano.

    El cambio es a las 02:00 civiles: la medianoche del dia de primavera aun es estandar y la del
    dia de otono aun es de verano. Por eso: primavera < fecha <= otono."""
    c = cambios_horario(sistema, fecha.year)
    return c is not None and c[0] < fecha <= c[1]


def _as_dates(fecha) -> pd.Series:
    return pd.to_datetime(pd.Series(fecha)).dt.normalize()


def _dst_midnight_vec(sistema: str, fechas: pd.Series) -> np.ndarray:
    years = fechas.dt.year.to_numpy()
    out = np.zeros(len(fechas), dtype=bool)
    for y in np.unique(years):
        c = cambios_horario(sistema, int(y))
        if c is None:
            continue
        m = years == y
        f = fechas[m]
        out[m] = ((f > pd.Timestamp(c[0])) & (f <= pd.Timestamp(c[1]))).to_numpy()
    return out


def ts_local_estandar(sistema: str, fecha, hora) -> pd.Series | pd.Timestamp:
    """INICIO de la hora publicada (fecha, hora 1..25) en hora local ESTANDAR del sistema, tz-naive.

    ts = fecha 00:00 + (hora - 1) h - (1 h si la medianoche civil de `fecha` esta en verano).
    Acepta escalares o vectores (Series/arrays). Valida 1 <= hora <= horas_en_dia."""
    scalar = np.isscalar(hora) and not isinstance(fecha, (pd.Series, np.ndarray, list, pd.Index))
    if sistema not in SISTEMAS:
        raise ValueError(f"sistema desconocido: {sistema}")
    f = _as_dates([fecha] if scalar else fecha).reset_index(drop=True)
    h = pd.Series([hora] if scalar else hora).reset_index(drop=True).astype("int64")
    if len(f) != len(h):
        raise ValueError("fecha y hora con distinta longitud")
    years = f.dt.year.to_numpy()
    nmax = np.full(len(f), 24)
    for y in np.unique(years):
        c = cambios_horario(sistema, int(y))
        if c is None:
            continue
        m = years == y
        nmax[m & (f == pd.Timestamp(c[0])).to_numpy()] = 23
        nmax[m & (f == pd.Timestamp(c[1])).to_numpy()] = 25
    bad = (h.to_numpy() < 1) | (h.to_numpy() > nmax)
    if bad.any():
        i = int(np.argmax(bad))
        raise ValueError(f"{sistema} {f[i].date()} hora={h[i]} fuera de 1..{nmax[i]}")
    dst = _dst_midnight_vec(sistema, f)
    ts = f + pd.to_timedelta(h - 1 - dst.astype("int64"), unit="h")
    return ts.iloc[0] if scalar else ts


def ts_utc(sistema: str, fecha, hora):
    """INICIO de la hora publicada en UTC (tz-naive)."""
    off = pd.Timedelta(hours=STD_UTC_OFFSET_HOURS[sistema])
    return ts_local_estandar(sistema, fecha, hora) - off


def utc_a_local_estandar(sistema: str, ts_utc_idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """UTC (tz-aware o naive=UTC) -> hora local estandar del sistema, tz-naive. Para solar.py."""
    idx = pd.DatetimeIndex(ts_utc_idx)
    if idx.tz is not None:
        idx = idx.tz_convert("UTC").tz_localize(None)
    return idx + pd.Timedelta(hours=STD_UTC_OFFSET_HOURS[sistema])


def fechas_cambio(sistemas: Iterable[str] = SISTEMAS, anios: Iterable[int] = range(2020, 2027)):
    """Lista [(sistema, fecha, horas)] de todos los dias de cambio (23/25 h)."""
    out = []
    for s in sistemas:
        for y in anios:
            c = cambios_horario(s, y)
            if c:
                out += [(s, c[0], 23), (s, c[1], 25)]
    return out


def sql_ts_local_estandar(sistema_col: str = "sistema", fecha_col: str = "fecha", hora_col: str = "hora") -> str:
    """Expresion DuckDB equivalente a ts_local_estandar (para agregar sin cargar en memoria).

    Las reglas se calculan en SQL a partir del ano de `fecha` (sin lista de anos), asi que no hay
    limite de cobertura: BCA = regla EE.UU. (2o dom mar -> 1er dom nov) cualquier ano;
    SIN/BCS = regla mexicana (1er dom abr -> ult dom oct) solo hasta 2022. No valida el rango de
    `hora` (eso lo hace ts_local_estandar en Python)."""
    f = f"CAST({fecha_col} AS DATE)"
    y = f"year({f})"

    def first_sunday(month: int) -> str:  # isodow: lunes=1 .. domingo=7
        d = f"make_date({y}, {month}, 1)"
        return f"({d} + CAST((7 - isodow({d})) % 7 AS INTEGER))"

    oct31 = f"make_date({y}, 10, 31)"
    last_sun_oct = f"({oct31} - CAST(isodow({oct31}) % 7 AS INTEGER))"
    us = f"({f} > {first_sunday(3)} + 7 AND {f} <= {first_sunday(11)})"
    mx = f"({y} <= {_MX_ULTIMO_ANO_DST} AND {f} > {first_sunday(4)} AND {f} <= {last_sun_oct})"
    dst = (f"CASE WHEN {sistema_col} = 'BCA' THEN {us} "
           f"WHEN {sistema_col} IN ('SIN', 'BCS') THEN {mx} ELSE NULL END")
    return (f"(CAST({f} AS TIMESTAMP) + to_hours(CAST({hora_col} AS BIGINT) - 1 "
            f"- CASE WHEN {dst} THEN 1 ELSE 0 END))")


# --------------------------------------------------------------------------------------------
# Reloj comun de referencia: hora estandar de CDMX = UTC-6 fijo, SIN horario de verano nunca.
# Sirve para poner los tres sistemas en un solo eje (hora del dia, dia y mes en hora CDMX).
# SIN: identico a ts_local_estandar. BCS: +1 h. BCA: +2 h (respecto a su hora local estandar).
# --------------------------------------------------------------------------------------------
CDMX_UTC_OFFSET_HOURS: int = -6


def desfase_a_cdmx_horas(sistema: str) -> int:
    """Horas que se suman a la hora local estandar del sistema para llevarla a CDMX estandar."""
    if sistema not in SISTEMAS:
        raise ValueError(f"sistema desconocido: {sistema}")
    return CDMX_UTC_OFFSET_HOURS - STD_UTC_OFFSET_HOURS[sistema]


def ts_cdmx(sistema: str, fecha, hora):
    """INICIO de la hora publicada (fecha, hora 1..25) en hora estandar de CDMX (UTC-6 fijo), tz-naive.

    = ts_utc(sistema, fecha, hora) + (-6 h). Acepta escalares o vectores, igual que ts_local_estandar."""
    return ts_local_estandar(sistema, fecha, hora) + pd.Timedelta(hours=desfase_a_cdmx_horas(sistema))


def utc_a_cdmx(ts_utc_idx) -> pd.DatetimeIndex:
    """UTC (tz-aware, o tz-naive interpretado como UTC) -> hora estandar de CDMX (UTC-6 fijo), tz-naive."""
    idx = pd.DatetimeIndex(ts_utc_idx)
    if idx.tz is not None:
        idx = idx.tz_convert("UTC").tz_localize(None)
    return idx + pd.Timedelta(hours=CDMX_UTC_OFFSET_HOURS)


def sql_ts_cdmx(sistema_col: str = "sistema", fecha_col: str = "fecha", hora_col: str = "hora") -> str:
    """Expresion DuckDB equivalente a ts_cdmx (sin limite de anos; NULL si el sistema no es SIN/BCA/BCS)."""
    shift = " ".join(f"WHEN '{s}' THEN {desfase_a_cdmx_horas(s)}" for s in SISTEMAS)
    return (f"({sql_ts_local_estandar(sistema_col, fecha_col, hora_col)} "
            f"+ to_hours(CASE {sistema_col} {shift} ELSE NULL END))")
