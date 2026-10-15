"""Validación independiente de los baselines solares (data/baselines/*) contra el caché NASA, con un modelo
pvlib propio escrito desde docs/TECNICO.md §9 (tests/validacion/_pv_indep.py), no desde solar.py."""
from __future__ import annotations

import calendar

import numpy as np
import pandas as pd
import pytest

from _pv_indep import baseline_mes_hora
from conftest import DATA_ROOT

BL = DATA_ROOT / "data" / "baselines"
CELDAS = DATA_ROOT / "data" / "cache" / "nasa" / "climatologia" / "celdas"
DIM365 = pd.Series([calendar.monthrange(2023, m)[1] for m in range(1, 13)], index=range(1, 13))
# (loc_id, offset del reloj del perfil): todos en reloj CDMX UTC-6 fijo desde la ronda CDMX
# nodo del ejemplo A4 (SIN), el único nodo BCA, un nodo retirado/renombrado, una celda del noroeste
LUGARES = [("01AAN-85", -6), ("07CFP-400", -6), ("03DEA-230", -6), ("cell_+29_-111", -6)]


@pytest.fixture(scope="module")
def sb():
    if not (BL / "solar_baselines.parquet").exists():
        pytest.skip("sin baselines")
    return pd.read_parquet(BL / "solar_baselines.parquet")


@pytest.fixture(scope="module")
def mh():
    if not (BL / "solar_baselines_month_hour.parquet").exists():
        pytest.skip("sin baselines mes x hora")
    return pd.read_parquet(BL / "solar_baselines_month_hour.parquet")


def test_perfil_completo_finito_y_sin_999(mh):
    g = mh.groupby(["loc_id", "config"]).size()
    assert (g == 288).all()
    y = mh["mwh_per_mwp_mean_day"]
    assert np.isfinite(y).all() and y.min() >= 0 and y.max() < 1.0  # MWh/MWp en 1 h: < 1 con derate 0.904


def test_noche_cero(mh):
    noche = mh[mh["hour"].isin([0, 1, 2, 3, 21, 22, 23])]
    assert (noche["mwh_per_mwp_mean_day"] == 0).all()


def test_anual_y_fc_consistentes_con_perfil(sb, mh):
    a = (mh.groupby(["loc_id", "config", "month"])["mwh_per_mwp_mean_day"].sum()
         .mul(DIM365, level="month").groupby(["loc_id", "config"]).sum().rename("a").reset_index())
    j = sb.merge(a, on=["loc_id", "config"])
    assert len(j) == len(sb)
    assert ((j.a - j.annual_mwh_per_mwp).abs() / j.a).max() < 1e-9
    assert ((j.cf - j.annual_mwh_per_mwp / 8760).abs()).max() < 1e-9


def test_rangos_fc_y_seguidor_mayor(sb):
    f, t = sb[sb.config == "fixed"], sb[sb.config == "tracker"]
    assert f.cf.between(0.15, 0.25).all() and t.cf.between(0.17, 0.30).all()
    p = sb.pivot_table(index="loc_id", columns="config", values="annual_mwh_per_mwp")
    assert (p.tracker > p.fixed).all()
    assert p.tracker.div(p.fixed).between(1.10, 1.30).all()


def test_periodo_2015_2025(sb):
    ab = pd.read_parquet(BL / "solar_annual_by_year.parquet")
    assert (sb.years_used == 11).all()
    assert ab.loc[ab.mwh_per_mwp_year.notna(), "year"].between(2015, 2025).all()
    x = (ab[ab.year.between(2015, 2025)].groupby(["loc_id", "config"]).mwh_per_mwp_year
         .agg(["min", "median", "max"]).reset_index().merge(sb, on=["loc_id", "config"]))
    assert (x["min"] - x.annual_year_min).abs().max() < 1e-9
    assert (x["max"] - x.annual_year_max).abs().max() < 1e-9


def test_dias_validos_por_mes(mh):
    """n_days por mes = todos los días de 2015-2025 de ese mes (o casi): ninguno inventado, ninguno de 2026."""
    nd = mh.groupby(["loc_id", "month"]).n_days.max()
    tope = {m: sum(calendar.monthrange(y, m)[1] for y in range(2015, 2026)) for m in range(1, 13)}
    lim = pd.Series([tope[m] for m in nd.index.get_level_values("month")], index=nd.index)
    assert (nd <= lim).all() and (nd >= 0.95 * lim).all()


def test_nodo_usa_la_celda_de_su_centroide(sb, mh):
    n = sb[sb.loc_type == "node"]
    assert ((np.floor(n.lat) == n.cell_lat) & (np.floor(n.lon) == n.cell_lon)).all()
    assert n.loc_id.nunique() == 2456 and dict(n.drop_duplicates("loc_id").system.value_counts()) == {"SIN": 2455, "BCA": 1}
    assert set(sb.clock) == {"CDMX estandar UTC-6 fijo"} and set(mh.clock) == {"CDMX estandar UTC-6 fijo"}
    # nodo retirado con el perfil del código nuevo (mismas coordenadas => mismo perfil)
    for viejo, nuevo in (("03DEA-230", "03DEC-230"), ("03POR-115", "03PCL-115")):
        a = mh[mh.loc_id == viejo].sort_values(["config", "month", "hour"]).mwh_per_mwp_mean_day.to_numpy()
        b = mh[mh.loc_id == nuevo].sort_values(["config", "month", "hour"]).mwh_per_mwp_mean_day.to_numpy()
        assert len(a) == 576 and (a == b).all()


def test_celdas_nasa_sin_999_y_en_utc_inicio_de_hora():
    fs = sorted(CELDAS.glob("celda_*.parquet"))
    if not fs:
        pytest.skip("sin caché NASA")
    for f in fs:
        d = pd.read_parquet(f)
        assert str(d.index.tz) == "UTC" and (d.index.minute == 0).all(), f.name
        assert (d.min(numeric_only=True) > -100).all(), f.name  # -999 nunca como valor


@pytest.mark.parametrize("loc,off", LUGARES)
@pytest.mark.parametrize("config", ["fixed", "tracker"])
def test_pvlib_independiente(sb, mh, loc, off, config):
    """Perfil mes x hora recalculado con pvlib propio: anual dentro de 0.1 %, cada celda (mes, hora) dentro de
    0.01 MWh/MWp, misma hora pico; y el reloj desplazado ±1 h ajusta claramente peor (alineación correcta)."""
    r = sb[(sb.loc_id == loc) & (sb.config == config)].iloc[0]
    f = CELDAS / f"celda_{int(r.cell_lat):+03d}_{int(r.cell_lon):+04d}.parquet"
    if not f.exists():
        pytest.skip("sin celda NASA")
    df = pd.read_parquet(f)
    th = mh[(mh.loc_id == loc) & (mh.config == config)][["month", "hour", "mwh_per_mwp_mean_day"]]

    def err(o):
        j = baseline_mes_hora(df, r.lat, r.lon, config, o).merge(th, on=["month", "hour"])
        return j, (j.y - j.mwh_per_mwp_mean_day).abs().max()

    j, e0 = err(off)
    assert len(j) == 288
    a_m = (j.groupby("month").y.sum() * DIM365).sum()
    assert abs(a_m / r.annual_mwh_per_mwp - 1) < 1e-3
    assert e0 < 0.01
    assert j.groupby("hour").y.sum().idxmax() == j.groupby("hour").mwh_per_mwp_mean_day.sum().idxmax()
    for o in (off - 1, off + 1):
        assert err(o)[1] > 10 * e0
