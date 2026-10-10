import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import solar as S  # noqa: E402

LAT, LON = 29.07, -110.96


def synth_clear_day_utc(days=3, start="2025-06-20"):
    """Serie sintetica: GHI de cielo despejado Ineichen via pvlib (W/m2), T2M=30 C. Indice UTC inicio de hora."""
    import pvlib
    idx = pd.date_range(start, periods=24 * days, freq="h", tz="UTC")
    loc = pvlib.location.Location(LAT, LON, tz="UTC")
    cs = loc.get_clearsky(idx + pd.Timedelta(minutes=30), model="ineichen")
    return pd.DataFrame({"ghi_wm2": cs["ghi"].values, "t2m_c": 30.0}, index=idx)


def test_missing_999_is_nan_not_value(tmp_path):
    d = {"celda": [29, -111], "GHI": {"2025010100": 500.0, "2025010101": -999, "2025010102": None, "2025010103": 0.0},
         "T2M": {"2025010100": 20.0, "2025010101": -999, "2025010102": 21.0, "2025010103": 19.0}}
    p = tmp_path / "c.json"
    p.write_text(json.dumps(d))
    df = S.load_nasa_cell(p)
    assert df["ghi_wm2"].isna().tolist() == [False, True, True, False]
    assert np.isnan(df["t2m_c"].iloc[1])
    assert df["ghi_wm2"].iloc[3] == 0.0           # 0 es dato valido (noche), no faltante
    assert df.index.tz is not None


def test_missing_ghi_gives_nan_energy_not_zero():
    df = synth_clear_day_utc(2)
    df.iloc[30, 0] = np.nan
    pv = S.hourly_pv_power(df, LAT, LON, "tracker")
    assert np.isnan(pv["energy_mwh_per_mwp"].iloc[30])
    assert pv["energy_mwh_per_mwp"].drop(pv.index[30]).notna().all()


def test_night_is_zero_and_nonnegative():
    df = synth_clear_day_utc(2)
    for cfg in ("fixed", "tracker"):
        pv = S.hourly_pv_power(df, LAT, LON, cfg)
        assert (pv["power_w_per_mwp"] >= 0).all()
        night = df["ghi_wm2"] == 0
        assert night.any()
        assert (pv.loc[night, "power_w_per_mwp"] == 0).all()


def test_tracker_ge_fixed_on_clear_day():
    df = synth_clear_day_utc(3)
    f = S.hourly_pv_power(df, LAT, LON, "fixed")["energy_mwh_per_mwp"].sum()
    t = S.hourly_pv_power(df, LAT, LON, "tracker")["energy_mwh_per_mwp"].sum()
    assert t > f > 0


def test_units_wh_mwh_conversion():
    df = synth_clear_day_utc(1)
    pv = S.hourly_pv_power(df, LAT, LON, "tracker")
    assert np.allclose(pv["energy_wh_per_mwp"], pv["power_w_per_mwp"] * 1.0)       # 1 h
    assert np.allclose(pv["energy_mwh_per_mwp"] * 1e6, pv["energy_wh_per_mwp"])
    assert S.wh_to_mwh(2.5e6) == 2.5


def test_energy_matches_hand_calculation_single_hour():
    """Hora con sol alto: P = 1e6 W x (poa_eff/1000) x (1+gamma(Tc-25)) x derate. Con poa_global 1000 W/m2
    sobre la superficie, iam=1 y tcell 25 -> 1e6 x derate. Verificamos la formula con el modelo."""
    df = synth_clear_day_utc(1)
    a = S.DEFAULT
    pv = S.hourly_pv_power(df, LAT, LON, "fixed", a)
    r = pv.loc[pv["poa_wm2"].idxmax()]
    # cota superior: poa_eff <= poa_global; temperatura de celda > 25 -> factor < 1
    upper = 1e6 * r["poa_wm2"] / 1000 * a.system_derate
    assert r["power_w_per_mwp"] <= upper * (1 + 1e-9)
    # reconstruccion inversa: factor termico implicito entre 0.80 y 1.0 para tcell realista
    assert r["tcell_c"] > 25
    ratio = r["power_w_per_mwp"] / upper
    assert 0.80 < ratio < 1.0
    assert ratio == pytest.approx((1 + a.gamma_pdc_per_c * (r["tcell_c"] - 25)) * (1 - 0.0), rel=0.06)


def test_total_energy_sanity_vs_hand_calc():
    """1 dia despejado de junio a 29N: GHI ~ 8-8.5 kWh/m2/d; tracker ~ +25-35 % sobre eso en POA.
    Energia/MWp ~ POA(kWh/m2) x PR(~0.78) -> 5-9 MWh/MWp-dia."""
    df = synth_clear_day_utc(1, "2025-06-21")
    ghi_kwh = df["ghi_wm2"].sum() / 1000.0
    pv = S.hourly_pv_power(df, LAT, LON, "tracker")
    e = pv["energy_mwh_per_mwp"].sum()
    assert 7.0 < ghi_kwh < 9.5
    assert 0.9 * ghi_kwh < e < 1.45 * ghi_kwh
    poa_kwh = pv["poa_wm2"].sum() / 1000
    assert e / poa_kwh == pytest.approx(0.78, abs=0.10)       # PR implícito


def test_system_derate_and_degradation():
    a = S.PlantAssumptions(loss_soiling=0.1, loss_dc_mismatch_wiring=0, loss_availability=0, loss_inverter=0,
                           loss_ac_transformer=0)
    assert a.system_derate == pytest.approx(0.9)
    assert S.degradation_factor(1) == 1.0
    assert S.degradation_factor(11, 0.005) == pytest.approx(0.995 ** 10)
    with pytest.raises(ValueError):
        S.degradation_factor(0)


def test_clock_comes_from_clock_module():
    import clock
    ts = pd.DatetimeIndex(["2025-06-21 18:00"], tz="UTC")
    assert S.STD_UTC_OFFSET_HOURS is clock.STD_UTC_OFFSET_HOURS
    assert S.utc_to_market_clock(ts, "SIN")[0] == pd.Timestamp("2025-06-21 12:00")
    assert S.utc_to_market_clock(ts, "BCS")[0] == pd.Timestamp("2025-06-21 11:00")
    assert S.utc_to_market_clock(ts, "BCA")[0] == pd.Timestamp("2025-06-21 10:00")


def test_to_cdmx_is_common_clock_and_relabels_only():
    """Mismo instante UTC -> misma etiqueta CDMX para cualquier sistema; energia total intacta."""
    df = synth_clear_day_utc(3)
    pv = S.hourly_pv_power(df, LAT, LON, "tracker")
    c = S.to_cdmx(pv)
    loc_bca = S.to_local(pv, "BCA")
    assert (c.index == S.utc_to_cdmx(pv.index)).all()
    assert (c.index - loc_bca.index == pd.Timedelta(hours=2)).all()          # BCA: CDMX = local + 2 h
    assert c["energy_mwh_per_mwp"].sum() == pytest.approx(loc_bca["energy_mwh_per_mwp"].sum())
    assert c["hour"].iloc[0] == c.index[0].hour and S.CLOCK_NAME == "CDMX estandar UTC-6 fijo"


def test_solar_noon_shifts_with_longitude_in_cdmx_clock():
    """Un sitio en BCA (lon -115) tiene su pico ~2 h despues que uno en lon -99 en el MISMO reloj CDMX."""
    import pvlib
    def peak(lon):
        idx = pd.date_range("2025-03-20", periods=24, freq="h", tz="UTC")
        cs = pvlib.location.Location(32.0, lon, tz="UTC").get_clearsky(idx + pd.Timedelta(minutes=30))
        pv = S.hourly_pv_power(pd.DataFrame({"ghi_wm2": cs["ghi"].values, "t2m_c": 20.0}, index=idx), 32.0, lon, "tracker")
        return S.to_cdmx(pv)["ghi_wm2"].idxmax().hour
    assert peak(-115.0) - peak(-99.0) in (1, 2, 3)
    assert peak(-99.0) in (11, 12, 13)


def test_align_production_pml_uses_ts_cdmx_dst_days_kept():
    """SIN 2021-10-31 (25 h publicadas): ninguna se descarta. Hora 1 publicada (00:00 civil, verano) =
    23:00 del dia previo en CDMX estandar. Idem 23 h el 2021-04-04."""
    import clock
    idx = pd.date_range("2021-10-30 23:00", periods=27, freq="h")
    prod = pd.DataFrame({"energy_mwh_per_mwp": np.arange(27.0)}, index=idx)
    pml = pd.DataFrame({"fecha": pd.Timestamp("2021-10-31"), "hora": np.arange(1, 26), "pml": 100.0 + np.arange(25)})
    m = S.align_production_pml(prod, pml, "SIN")
    assert len(m) == 25
    assert m["ts_cdmx"].iloc[0] == pd.Timestamp("2021-10-30 23:00")
    assert (m["ts_cdmx"].diff().dropna() == pd.Timedelta(hours=1)).all()
    idx2 = pd.date_range("2021-04-04 00:00", periods=30, freq="h")
    prod2 = pd.DataFrame({"energy_mwh_per_mwp": 1.0}, index=idx2)
    pml2 = pd.DataFrame({"fecha": pd.Timestamp("2021-04-04"), "hora": np.arange(1, 24), "pml": 1.0})
    assert len(S.align_production_pml(prod2, pml2, "SIN")) == 23
    with pytest.raises(ValueError):
        S.align_production_pml(prod2, pml2.assign(hora=np.arange(2, 25)), "SIN")        # hora 24 no existe
    assert clock.ts_cdmx("SIN", pd.Timestamp("2024-03-10"), 1) == pd.Timestamp("2024-03-10 00:00")


def test_align_bca_and_bcs_shift_in_cdmx():
    """Misma hora publicada en invierno: BCS cae +1 h y BCA +2 h respecto a su hora local (CDMX)."""
    pml = pd.DataFrame({"fecha": pd.Timestamp("2025-01-15"), "hora": [1], "pml": 1.0})
    idx = pd.date_range("2025-01-15 00:00", periods=5, freq="h")
    prod = pd.DataFrame({"energy_mwh_per_mwp": 1.0}, index=idx)
    ts = {s: S.align_production_pml(prod, pml, s)["ts_cdmx"].iloc[0] for s in ("SIN", "BCS", "BCA")}
    assert ts["SIN"] == pd.Timestamp("2025-01-15 00:00")
    assert ts["BCS"] == pd.Timestamp("2025-01-15 01:00")
    assert ts["BCA"] == pd.Timestamp("2025-01-15 02:00")


def test_nasa_dni_dhi_used_directly_when_valid_else_erbs():
    idx = pd.date_range("2025-06-21 18:30", periods=4, freq="h")
    ghi = pd.Series([800.0, 800.0, 800.0, np.nan], index=idx)
    dni = pd.Series([700.0, np.nan, 700.0, 700.0], index=idx)
    dhi = pd.Series([100.0, 100.0, 5000.0, 100.0], index=idx)       # fila 3: DHI > GHI -> invalido
    zen = pd.Series(30.0, index=idx)
    x = pd.Series(1361.0, index=idx)
    r = S.nasa_dni_dhi(ghi, dni, dhi, zen, x)
    assert r["dni_dhi_src"].tolist() == ["nasa", "erbs", "erbs", "nodata"]
    assert r["dni_wm2"].iloc[0] == 700.0 and r["dhi_wm2"].iloc[0] == 100.0
    assert r["dhi_wm2"].iloc[2] < 5000
    assert np.isnan(r["dni_wm2"].iloc[3])
    below = S.nasa_dni_dhi(ghi.iloc[:1], dni.iloc[:1], dhi.iloc[:1], pd.Series([95.0], index=idx[:1]), x.iloc[:1])
    assert below["dni_dhi_src"].iloc[0] == "below_horizon" and below["dni_wm2"].iloc[0] == 0.0


def test_nasa_dni_dhi_path_matches_hourly_pv_and_differs_from_erbs():
    df = synth_clear_day_utc(2)
    import pvlib
    mid = df.index + pd.Timedelta(minutes=30)
    cs = pvlib.location.Location(LAT, LON, tz="UTC").get_clearsky(mid, model="ineichen")
    df["dni_wm2"], df["dhi_wm2"] = cs["dni"].values, cs["dhi"].values
    df["ws2m_ms"] = 4.0
    n = S.hourly_pv_power(df, LAT, LON, "tracker")
    e = S.hourly_pv_power(df, LAT, LON, "tracker", dni_dhi_source="erbs")
    assert (n["dni_dhi_src"] == "nasa").sum() > 0 and (e["dni_dhi_src"] == "erbs").sum() > 0
    assert n["energy_mwh_per_mwp"].sum() != pytest.approx(e["energy_mwh_per_mwp"].sum(), rel=1e-6)
    # viento real: la celda se enfria respecto a 1 m/s
    base = S.hourly_pv_power(df.drop(columns="ws2m_ms"), LAT, LON, "tracker")
    assert n["tcell_c"].max() < base["tcell_c"].max()
    assert n["wind10_ms"].iloc[0] == pytest.approx(4.0 * 5 ** (1 / 7))


def test_parquet_loader_missing_and_neg(tmp_path):
    idx = pd.date_range("2025-01-01", periods=3, freq="h", tz="UTC", name="ts_utc_hour_start")
    pd.DataFrame({"ghi_wm2": [100.0, -999.0, np.nan], "dni_wm2": [1.0, 2.0, 3.0], "dhi_wm2": [1, 1, 1.0],
                  "t2m_c": [20.0, 20, 20], "ws2m_ms": [2.0, 2, 2]}, index=idx).to_parquet(tmp_path / "c.parquet")
    d = S.load_climate_cell(tmp_path / "c.parquet")
    assert d["ghi_wm2"].isna().tolist() == [False, True, True]
    assert d.index.tz is not None
    # JSON antiguo sigue funcionando
    (tmp_path / "c.json").write_text(json.dumps({"GHI": {"2025010100": 5.0, "2025010101": -999}, "T2M": {"2025010100": 1.0}}))
    j = S.load_climate_cell(tmp_path / "c.json")
    assert j["ghi_wm2"].iloc[0] == 5.0 and np.isnan(j["ghi_wm2"].iloc[1])


def test_partial_year_not_annualised_and_year_filter():
    df = synth_clear_day_utc(3)
    loc = S.to_cdmx(S.hourly_pv_power(df, LAT, LON, "tracker"))
    assert S.annual_by_year(loc)["mwh_per_mwp_year"].isna().all()       # 3 dias: no se anualiza
    assert S.restrict_years(loc, [2024]).empty
    assert len(S.restrict_years(loc, [2025])) == len(loc)


def test_valid_day_excludes_incomplete_days_and_annual_needs_all_months():
    df = synth_clear_day_utc(3)
    df.iloc[40, 0] = np.nan                      # rompe un dia local
    pv = S.hourly_pv_power(df, LAT, LON, "tracker")
    loc = S.to_cdmx(pv)
    m = S.valid_day_mask(loc)
    bad_day = loc.index[40].normalize()
    assert not m[loc["date"] == bad_day].any()
    mh = S.baseline_month_hour(loc)
    ann = S.annual_from_month_hour(mh)
    assert np.isnan(ann["annual_mwh_per_mwp"])    # solo junio: no se inventa un anual
    assert 1 in ann["months_missing"]


def test_annual_and_cf_hand_computed():
    mh = pd.DataFrame([{"month": m, "hour": 12, "mwh_per_mwp_mean_day": 1.0, "n_days": 20} for m in range(1, 13)])
    ann = S.annual_from_month_hour(mh)
    assert ann["annual_mwh_per_mwp"] == pytest.approx(365.0)          # 1 MWh/MWp x 365 d
    assert ann["cf"] == pytest.approx(365.0 / 8760.0)


def test_sine_shape_sums_to_one_and_zero_outside():
    y = S.sine_shape()
    assert y.sum() == pytest.approx(1.0)
    assert y[:6].sum() == 0 and y[18:].sum() == 0
    assert y.argmax() in (11, 12)


def test_cell_of():
    assert S.cell_of(29.07, -110.96) == (29, -111)
    assert S.cell_of(14.68, -92.15) == (14, -93)


def test_node_coords_renamed_nodes_placed_with_source():
    root = Path(__file__).resolve().parents[1]
    if not list((root / "data" / "ref").glob("Cat*NodosP*.xlsx")):
        pytest.skip("sin catalogo")
    n = S.load_node_coords(root).set_index("nodo")
    assert n.loc["03DEA-230", "coord_source"] == "renombre:03DEC-230"
    assert n.loc["03DEA-230", "lat"] == n.loc["03DEC-230", "lat"]
    assert "03VAR-115" not in n.index                   # municipio sin centroide: no se inventa
    assert "07IVY-230" not in n.index                    # interconexion extranjera: sin coordenadas
