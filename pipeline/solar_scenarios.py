"""
solar_scenarios.py - Irradiancia (GHI, POA fijo/seguidor) y escenarios "cielo despejado" sobre el camino
de produccion existente de pipeline/solar.py (NO redefine perdidas, orientacion ni reloj).

Reutiliza sin cambios: solar.hourly_pv_power (mismo modelo, mismas perdidas), solar.site_geometry,
solar.to_cdmx (reloj comun CDMX estandar via clock.py), solar.baseline_month_hour / climatology_month_hour.
Aqui solo se agrega: (1) cielo despejado (Ineichen + Linke), (2) agregacion de irradiancia, (3) perfiles
dia-tipico por ventana.

Unidades
    ghi_wm2, poa_wm2          W/m2 (media de la hora)  ->  kWh/m2 en esa hora = W/m2 / 1000 (paso de 1 h)
    *_kwh_m2_day / _month     kWh/m2 por dia promedio del mes / por mes
    y                          MWh/MWp por hora (= kWh/kWp), igual que node_profiles.json fila 'y'

Supuestos propios (los de planta viven en solar.PlantAssumptions)
    - Cielo despejado = Ineichen (pvlib) con turbidez de Linke mensual de pvlib (climatologia SoDa),
      elevacion 0 m [estimado: se desconoce la altura de la subestacion], reescalado a GHI despejada NASA
      CLRSKY_SFC_SW_DWN en modo 'nasa_scaled' (default) para que el "cielo despejado" y el "real" salgan del
      MISMO producto y la perdida por nubes sea consistente. [estimado]
    - Temperatura y viento del dia despejado = los de las horas reales (los dias despejados son algo mas
      calidos: produccion despejada ligeramente sobreestimada, ~0.2-0.4 %). [estimado]
    - Horas con GHI real faltante -> NaN tambien en despejado (misma mascara de dias validos).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

try:
    import solar
except ImportError:  # importado como pipeline.solar_scenarios
    from pipeline import solar

CONFIGS = ("tracker", "fixed")
CLEAR_MODES = ("nasa_scaled", "ineichen")
DAYS = solar.DAYS_IN_MONTH


def clear_sky_frame(df_utc: pd.DataFrame, lat: float, lon: float, geom: dict, mode: str = "nasa_scaled",
                    elevation_m: float = 0.0) -> pd.DataFrame:
    """Copia de df_utc con ghi/dni/dhi de cielo despejado (W/m2), mismo indice (inicio de hora UTC).

    mode 'ineichen': Ineichen-Perez + Linke mensual (pvlib). mode 'nasa_scaled': Ineichen reescalado por
    hora a CLRSKY_SFC_SW_DWN de NASA (el factor solo se aplica con GHI Ineichen > 50 W/m2)."""
    import pvlib
    if mode not in CLEAR_MODES:
        raise ValueError(f"mode debe ser uno de {CLEAR_MODES}")
    mid = geom["mid"]
    linke = pvlib.clearsky.lookup_linke_turbidity(mid, lat, lon)
    am_abs = pvlib.atmosphere.get_absolute_airmass(geom["am"], pvlib.atmosphere.alt2pres(elevation_m))
    cs = pvlib.clearsky.ineichen(geom["azen"], am_abs, linke, altitude=elevation_m, dni_extra=geom["dni_x"])
    ghi, dni, dhi = (cs[c].clip(lower=0).values for c in ("ghi", "dni", "dhi"))
    if mode == "nasa_scaled" and "clrsky_ghi_wm2" in df_utc:
        f = np.where(ghi > 50.0, df_utc["clrsky_ghi_wm2"].values / np.where(ghi > 50.0, ghi, 1.0), 1.0)
        f = np.where(np.isfinite(f) & (f > 0), np.clip(f, 0.5, 1.5), 1.0)   # acota factores absurdos
        ghi, dni, dhi = ghi * f, dni * f, dhi * f
    out = df_utc.copy()
    ok = df_utc["ghi_wm2"].notna().values        # misma mascara de datos validos que el caso real
    out["ghi_wm2"] = np.where(ok, ghi, np.nan)
    out["dni_wm2"] = np.where(ok, dni, np.nan)
    out["dhi_wm2"] = np.where(ok, dhi, np.nan)
    return out


def run_scenarios(df_utc: pd.DataFrame, lat: float, lon: float, a: solar.PlantAssumptions = solar.DEFAULT,
                  years=solar.BASELINE_YEARS, clear_mode: str = "nasa_scaled") -> dict:
    """{(escenario, config): DataFrame horario CDMX} para escenario in ('real','clear') y config in CONFIGS.
    Columnas de solar.hourly_pv_power (+ date, month, hour, year). Solo dias validos se agregan despues."""
    geom = solar.site_geometry(df_utc.index, lat, lon)
    frames = {"real": df_utc, "clear": clear_sky_frame(df_utc, lat, lon, geom, clear_mode)}
    out = {}
    for scen, df in frames.items():
        for cfg in CONFIGS:
            out[(scen, cfg)] = solar.to_cdmx(solar.hourly_pv_power(df, lat, lon, "fixed" if cfg == "fixed" else "tracker",
                                                                   a, geom=geom, dni_dhi_source="nasa"))
    return out


def month_hour_table(local: pd.DataFrame, years=solar.BASELINE_YEARS) -> pd.DataFrame:
    """Media (mes, hora CDMX) de ghi_wm2, poa_wm2 y y (MWh/MWp) sobre dias validos de `years`; + n_days."""
    v = solar.restrict_years(local, years)
    v = v[solar.valid_day_mask(v)]
    g = v.groupby(["month", "hour"])
    res = g[["ghi_wm2", "poa_wm2", "energy_mwh_per_mwp"]].mean()
    res = res.rename(columns={"energy_mwh_per_mwp": "y"})
    res["n_days"] = g["date"].nunique()
    return res.reset_index()


def monthly_kwh_m2(mh: pd.DataFrame, col: str) -> np.ndarray:
    """Climatologia mensual (12 valores, kWh/m2-mes) = suma_hora(media W/m2)/1000 x dias del mes."""
    day = mh.groupby("month")[col].sum() / 1000.0
    return np.array([day.get(m, np.nan) * DAYS[m] for m in range(1, 13)])


def monthly_y(mh: pd.DataFrame) -> np.ndarray:
    """MWh/MWp-mes (= kWh/kWp-mes) = suma_hora(y) x dias del mes. Suma anual = annual_from_month_hour."""
    day = mh.groupby("month")["y"].sum()
    return np.array([day.get(m, np.nan) * DAYS[m] for m in range(1, 13)])


def window_months(start: str, end: str) -> list[tuple[int, int]]:
    """[(anio, mes)] de la ventana inclusiva 'YYYY-MM'..'YYYY-MM'."""
    return [(p.year, p.month) for p in pd.period_range(start, end, freq="M")]


def typical_day_window(mh: pd.DataFrame, col: str, start: str, end: str, scale: float = 1.0) -> np.ndarray:
    """Dia tipico de 24 horas (hora CDMX) de una ventana: media de la tabla (mes, hora) ponderada por dias del
    mes (misma ponderacion que node_profiles.json: sum sobre horas / n_horas). scale=1e-3 pasa W/m2 a kWh/m2."""
    ym = window_months(start, end)
    w = pd.Series({m: 0.0 for m in range(1, 13)})
    for y, m in ym:
        w[m] += pd.Period(f"{y}-{m:02d}").days_in_month
    piv = mh.pivot(index="month", columns="hour", values=col).reindex(range(1, 13)).reindex(columns=range(24))
    use = w[w > 0].index
    return (piv.loc[use].mul(w[use], axis=0).sum() / w[use].sum()).values * scale


def cloud_loss(y_real: float, y_clear: float) -> float:
    """Perdida por nubes = 1 - real/despejado (adimensional). NaN si no hay base."""
    return float("nan") if not y_clear or not np.isfinite(y_clear) else 1.0 - y_real / y_clear
