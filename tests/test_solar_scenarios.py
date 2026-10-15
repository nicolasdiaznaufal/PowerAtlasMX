"""Pruebas fisicas de pipeline/solar_scenarios.py (sinteticas, sin data/). Unidades: W/m2, kWh/m2, MWh/MWp."""
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import solar  # noqa: E402
import solar_scenarios as sc  # noqa: E402

YEARS = (2023, 2024)


def synth(lat=23.0, lon=-102.0, kt=0.7, nan_hours=0):
    """Dos anos horarios UTC: GHI real = kt x despejado (Ineichen), CLRSKY = Ineichen, T=25 C, viento 2 m/s."""
    idx = pd.date_range("2023-01-01", "2024-12-31 23:00", freq="h", tz="UTC")
    g = solar.site_geometry(idx, lat, lon)
    df = pd.DataFrame({"ghi_wm2": 0.0, "t2m_c": 25.0, "ws2m_ms": 2.0}, index=idx)
    clear = sc.clear_sky_frame(pd.DataFrame({"ghi_wm2": 1.0, "t2m_c": 25.0}, index=idx), lat, lon, g, "ineichen")
    df["clrsky_ghi_wm2"] = clear["ghi_wm2"].values
    df["ghi_wm2"] = clear["ghi_wm2"].values * kt
    if nan_hours:
        df.iloc[5000:5000 + nan_hours, df.columns.get_loc("ghi_wm2")] = np.nan
    return df


@pytest.fixture(scope="module")
def run():
    df = synth()
    r = sc.run_scenarios(df, 23.0, -102.0)
    return df, r, {k: sc.month_hour_table(v, YEARS) for k, v in r.items()}


def annual(mh):
    return solar.annual_from_month_hour(mh.rename(columns={"y": "mwh_per_mwp_mean_day"}))["annual_mwh_per_mwp"]


def test_tracker_ge_fixed_real_and_clear(run):
    _, _, mh = run
    for scen in ("real", "clear"):
        assert annual(mh[(scen, "tracker")]) > annual(mh[(scen, "fixed")])


def test_clear_ge_real_hourly_and_annual(run):
    _, r, mh = run
    for cfg in sc.CONFIGS:
        assert annual(mh[("clear", cfg)]) > annual(mh[("real", cfg)])
        # Por DIA, no por hora: con el sol detras del panel fijo (atardecer de verano) la difusa de un cielo
        # nublado puede superar a la de uno despejado en una hora aislada (diferencia fisica, < 25 Wh/kWp).
        a = r[("clear", cfg)].groupby("date")["energy_mwh_per_mwp"].sum()
        b = r[("real", cfg)].groupby("date")["energy_mwh_per_mwp"].sum()
        assert (a >= b - 1e-9).all()


def test_night_is_zero(run):
    df, r, _ = run
    night = (df["clrsky_ghi_wm2"] == 0).values
    for k, v in r.items():
        assert (v["energy_mwh_per_mwp"].values[night] == 0).all(), k


def test_capacity_factor_in_mexican_range(run):
    df = synth(kt=0.8)                      # indice de claridad tipico del altiplano mexicano
    r = sc.run_scenarios(df, 23.0, -102.0)
    mh = {k: sc.month_hour_table(v, YEARS) for k, v in r.items()}
    cf_t = annual(mh[("real", "tracker")]) / 8760.0
    cf_f = annual(mh[("real", "fixed")]) / 8760.0
    assert 0.22 <= cf_t <= 0.32            # rango de FC AC seguidor en Mexico (22-30 %)
    assert 0.80 <= cf_f / cf_t <= 0.92     # fijo / seguidor tipico a 23 N


def test_seasonal_shape_fixed_flatter_than_tracker(run):
    _, _, mh = run
    f = sc.monthly_y(mh[("clear", "fixed")])
    t = sc.monthly_y(mh[("clear", "tracker")])
    assert np.isfinite(f).all() and np.isfinite(t).all()
    assert t.argmax() in (3, 4, 5)         # pico de seguidor: abr-jun
    assert (f.max() / f.min()) < (t.max() / t.min())


def test_monthly_sums_equal_annual(run):
    _, _, mh = run
    m = mh[("real", "tracker")]
    assert sc.monthly_y(m).sum() == pytest.approx(annual(m), rel=1e-12)


def test_window_typical_day_weighted_by_days(run):
    _, _, mh = run
    m = mh[("real", "fixed")]
    full = sc.typical_day_window(m, "y", "2024-08", "2025-07")
    assert full.shape == (24,)
    assert full.sum() * 365.0 == pytest.approx(annual(m), rel=1e-9)
    one = sc.typical_day_window(m, "y", "2024-08", "2024-08")
    assert one.sum() == pytest.approx(m[m.month == 8]["y"].sum(), rel=1e-12)


def test_irradiance_units_kwh_m2(run):
    _, _, mh = run
    ghi = sc.monthly_kwh_m2(mh[("clear", "tracker")], "ghi_wm2")
    assert 1700 < ghi.sum() < 2800         # kWh/m2-ano despejado a 23 N
    poa_t = sc.monthly_kwh_m2(mh[("clear", "tracker")], "poa_wm2").sum()
    poa_f = sc.monthly_kwh_m2(mh[("clear", "fixed")], "poa_wm2").sum()
    assert poa_t > poa_f > 0.85 * ghi.sum()


def test_clock_solar_noon_shifts_with_longitude_in_cdmx():
    peak = {}
    for lon in (-99.0, -115.0):
        r = sc.run_scenarios(synth(25.0, lon, 1.0), 25.0, lon)
        mh = sc.month_hour_table(r[("clear", "fixed")], YEARS)
        peak[lon] = int(mh.groupby("hour")["y"].mean().idxmax())
    assert peak[-115.0] - peak[-99.0] in (1, 2)   # 16 grados = ~1.07 h; reloj CDMX comun


def test_missing_ghi_is_nan_not_zero_in_both_scenarios():
    df = synth(nan_hours=48)
    r = sc.run_scenarios(df, 23.0, -102.0)
    bad = df["ghi_wm2"].isna().values
    for k, v in r.items():
        assert v["energy_mwh_per_mwp"].values[bad].size == 48
        assert np.isnan(v["energy_mwh_per_mwp"].values[bad]).all(), k


def test_nasa_scaled_matches_nasa_clear_ghi_and_ineichen_does_not():
    df = synth()
    df["clrsky_ghi_wm2"] = df["clrsky_ghi_wm2"] * 0.9
    g = solar.site_geometry(df.index, 23.0, -102.0)
    scaled = sc.clear_sky_frame(df, 23.0, -102.0, g, "nasa_scaled")
    pure = sc.clear_sky_frame(df, 23.0, -102.0, g, "ineichen")
    hi = (pure["ghi_wm2"] > 100).values
    assert np.allclose(scaled["ghi_wm2"].values[hi], df["clrsky_ghi_wm2"].values[hi], rtol=1e-9)
    assert not np.allclose(pure["ghi_wm2"].values[hi], df["clrsky_ghi_wm2"].values[hi], rtol=1e-3)


def test_cloud_loss():
    assert sc.cloud_loss(75.0, 100.0) == pytest.approx(0.25)
    assert np.isnan(sc.cloud_loss(1.0, 0.0))


@pytest.mark.skipif(not os.environ.get("NODAL_DATA_ROOT"), reason="requiere data/ del checkout principal")
def test_reproduces_published_tracker_and_fixed():
    root = Path(os.environ["NODAL_DATA_ROOT"])
    import solar_pilot as sp
    row, _ = sp.run_node(root, None, "01AAN-85", 20.269047, -98.942901, "SIN")
    assert abs(row["repro_err_tracker_pct"]) < 0.01
    assert abs(row["repro_err_fixed_pct"]) < 0.01
    assert row["yf_published"] == pytest.approx(row["yf_rebuilt"], rel=1e-6)
