"""Modelo FV independiente (validador) escrito desde docs/TECNICO.md §9 A1-A4, no desde solar.py.

Supuestos documentados: sol en el punto medio de la hora (SPA); DNI/DHI de NASA si son válidos
(finitos, >= 0, DHI <= 1.05*GHI + 5), si no Erbs; sol bajo el horizonte -> todo difuso; fijo al sur con
inclinación 0.76|lat| + 3.1; seguidor 1 eje N-S ±60°, backtracking GCR 0.35; Perez 1990, albedo 0.20;
IAM ASHRAE b = 0.05 sobre la directa; SAPM open-rack glass-glass con viento a 10 m = WS2M (10/2)^(1/7);
gamma -0.35 %/°C; pérdidas 2 %, 3 %, 1 %, 2.5 %, 1.5 % multiplicadas; DC/AC = 1.
Baseline: día promedio por (mes, hora local estándar) sobre días locales con las 24 h de GHI, 2015-2025.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

DERATE = 0.98 * 0.97 * 0.99 * 0.975 * 0.985


def energia_horaria(df: pd.DataFrame, lat: float, lon: float, config: str) -> pd.Series:
    import pvlib

    idx = df.index  # inicio de hora UTC, tz-aware
    mid = idx + pd.Timedelta(minutes=30)
    sp = pvlib.solarposition.get_solarposition(mid, lat, lon, method="nrel_numpy")
    zen = pd.Series(sp["apparent_zenith"].values, idx)
    azi = pd.Series(sp["azimuth"].values, idx)
    dni_x = pd.Series(np.asarray(pvlib.irradiance.get_extra_radiation(mid)), idx)
    ghi = df["ghi_wm2"]
    ok = (df["dni_wm2"].notna() & df["dhi_wm2"].notna() & (df["dni_wm2"] >= 0) & (df["dhi_wm2"] >= 0)
          & (df["dhi_wm2"] <= 1.05 * ghi + 5))
    er = pvlib.irradiance.erbs(ghi, zen.clip(upper=90), idx)
    dni = df["dni_wm2"].where(ok, er["dni"])
    dhi = df["dhi_wm2"].where(ok, er["dhi"])
    abajo = zen >= 90
    dni = dni.where(~abajo, 0.0)
    dhi = dhi.where(~abajo, ghi)
    if config == "fixed":
        tilt = pd.Series(0.76 * abs(lat) + 3.1, idx)
        saz = pd.Series(180.0, idx)
    else:
        tr = pvlib.tracking.singleaxis(zen, azi, axis_tilt=0, axis_azimuth=180, max_angle=60,
                                       backtrack=True, gcr=0.35)
        tilt = tr["surface_tilt"].fillna(0.0)
        saz = tr["surface_azimuth"].fillna(90.0)
    am = pvlib.atmosphere.get_relative_airmass(zen)
    poa = pvlib.irradiance.get_total_irradiance(tilt, saz, zen, azi, dni, ghi, dhi, dni_extra=dni_x,
                                                airmass=am, albedo=0.2, model="perez",
                                                model_perez="allsitescomposite1990")
    aoi = pvlib.irradiance.aoi(tilt, saz, zen, azi)
    iam = pvlib.iam.ashrae(aoi, b=0.05).fillna(0.0)
    direct = poa["poa_direct"].fillna(0.0).clip(lower=0) * iam
    diff = poa["poa_diffuse"].fillna(0.0).clip(lower=0)
    eff = direct + diff
    glob = poa["poa_global"].fillna(0.0).clip(lower=0)
    w10 = df["ws2m_ms"] * (10 / 2) ** (1 / 7)
    p = pvlib.temperature.TEMPERATURE_MODEL_PARAMETERS["sapm"]["open_rack_glass_glass"]
    tc = pvlib.temperature.sapm_cell(glob, df["t2m_c"], w10, **p)
    mw = (eff / 1000.0) * (1 - 0.0035 * (tc - 25.0)) * DERATE  # MW por MWp == MWh/MWp en 1 h
    return mw.where(ghi.notna())


def baseline_mes_hora(df: pd.DataFrame, lat: float, lon: float, config: str, offset_h: int) -> pd.DataFrame:
    e = energia_horaria(df, lat, lon, config)
    loc = e.copy()
    loc.index = e.index.tz_convert(None) + pd.Timedelta(hours=offset_h)
    f = pd.DataFrame({"e": loc.values, "ghi": df["ghi_wm2"].values}, index=loc.index)
    f = f[(f.index.year >= 2015) & (f.index.year <= 2025)]
    f["date"] = f.index.normalize()
    valid = f["ghi"].notna().groupby(f["date"]).transform("sum") == 24
    f = f[valid]
    g = f.groupby([f.index.month, f.index.hour])["e"].mean()
    g.index.names = ["month", "hour"]
    return g.rename("y").reset_index()
