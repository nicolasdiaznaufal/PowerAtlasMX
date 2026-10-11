"""Pruebas de pipeline/solar_variants.py con serie sintetica (sin pvlib ni data/)."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import solar_variants as sv  # noqa: E402


def base(month, hour):
    return np.where((hour >= 6) & (hour <= 17), 0.1 * np.sin(np.pi * (hour - 5.5) / 12) * (1 + 0.02 * month), 0.0)


@pytest.fixture(scope="module")
def local():
    idx = pd.date_range("2015-01-01", "2026-07-31 23:00", freq="h")
    df = pd.DataFrame(index=idx)
    df["year"], df["month"], df["hour"] = idx.year, idx.month, idx.hour
    df["date"] = idx.normalize()
    f = 1 + 0.01 * (df["year"] - 2015)
    df["energy_mwh_per_mwp"] = base(df["month"].values, df["hour"].values) * f
    df["ghi_wm2"] = df["energy_mwh_per_mwp"] * 1000.0 + 0.0
    df["poa_wm2"] = df["ghi_wm2"] * 1.2
    df.loc[(df.year == 2018) & (df.month == 3), "ghi_wm2"] = np.nan    # mes sin datos -> y2018 no disponible
    return df


@pytest.fixture(scope="module")
def tabs(local):
    return sv.build_tables(local)


def test_year_variant_equals_scaled_base(tabs):
    t = tabs["y2020"]["y"]
    h = np.arange(24)
    for m in (1, 7, 12):
        assert np.allclose(t[m - 1], base(m, h) * 1.05)


def test_mean_is_pooled_over_2015_2025(tabs):
    assert np.allclose(tabs["mean"]["y"], tabs["y2020"]["y"], rtol=2e-3)   # factor medio = 1.05


def test_incomplete_year_unavailable_and_2026_not_a_year_variant(tabs):
    assert tabs["y2018"] is None
    assert "y2026" not in tabs
    assert tabs["mean"]["nd"][2] > 0           # el mean sigue teniendo marzo (otros anos)


def test_win_months_use_actual_month_weather(tabs):
    i = sv.WIN_YM.index(202508)
    assert np.allclose(tabs["win"]["y"][i], base(8, np.arange(24)) * 1.10)   # 2025 -> +10 %
    j = sv.WIN_YM.index(202607)
    assert tabs["win"]["nd"][j] == 31 and np.isfinite(tabs["win"]["y"][j]).all()


def test_annual_equiv_and_yf_with_full_hours_match(tabs):
    rows = np.array([[ym, h, ym_days * 1.0] for ym in sv.window_ym("Y1") for ym_days in [sv.ym_days(ym)]
                     for h in range(24)])
    n, yf, prof = sv.yf_and_profile(tabs["y2020"], rows, "Y1")
    assert n == pytest.approx(8760)
    assert yf == pytest.approx(sv.annual_equiv(tabs["y2020"]), rel=1e-12)
    assert prof.shape == (24,) and (prof[:5] == 0).all()
    nw, yfw, _ = sv.yf_and_profile(tabs["win"], rows, "Y1", win=True)
    assert yfw == pytest.approx(sv.annual_equiv(tabs["win"], "y", "Y1"), rel=1e-12)


def test_gap_hours_are_not_annualised(tabs):
    full = np.array([[ym, h, sv.ym_days(ym)] for ym in sv.window_ym("Y1") for h in range(24)], float)
    gap = full.copy()
    gap[gap[:, 1] == 12, 2] = 0.0                         # sin horas de las 12
    _, y_full, _ = sv.yf_and_profile(tabs["mean"], full, "Y1")
    n, y_gap, _ = sv.yf_and_profile(tabs["mean"], gap, "Y1")
    assert y_gap < y_full and n < 8760


def test_irradiance_units_and_day_weighting(tabs):
    m = sv.monthly_kwh_m2(tabs["mean"], "ghi")
    assert m.shape == (12,) and m.sum() == pytest.approx(
        sum(sv.DAYS[i] * tabs["mean"]["ghi"][i].sum() / 1000 for i in range(12)))
    d = sv.typical_day(tabs["mean"], "ghi", "Y1")
    assert d.shape == (24,)
    dm = sv.monthly_kwh_m2(tabs["mean"], "ghi", None)
    assert d.sum() * 365 == pytest.approx(dm.sum(), rel=1e-9)


def test_missing_month_gives_nan_not_zero(local):
    t = sv.build_tables(local)
    assert np.isnan(sv.annual_equiv(t["y2018"]))
    assert np.isnan(sv.typical_day(t["y2018"], "y", "Y1")).all()
