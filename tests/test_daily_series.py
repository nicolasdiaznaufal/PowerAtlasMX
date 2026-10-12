"""Serie diaria (pipeline/daily_series.py, daily_gates.py, daily_build.py; docs/TECNICO.md §13).

Parte 1 (siempre): ejemplo a mano, unidades, identidades, nulos, definicion de area, codificacion y presupuesto.
Parte 2 (datos reales; se omite si no existe $NODAL_DATA_ROOT/data/solar_v2/daily/manifest.json): puertas del
manifiesto, tamanos, identidades sobre lo decodificado y recalculo independiente (pandas + clock.ts_cdmx) de un nodo."""
import gzip
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import daily_gates as G  # noqa: E402
import daily_series as S  # noqa: E402

ND = 4


def _hand():
    """Dia 0: 24 h (300 salvo 10 h = 500, 11 h = 1000); dia 1: 3 h (10 h = -50, 11 h = 200, 20 h = 100);
    dia 2: 1 h (10 h = 100) sin clima valido; dia 3: sin PML. y = 0.5 a las 10 h y 0.25 a las 11 h [MWh/MWp]."""
    p0 = {h: 300.0 for h in range(24)}
    p0.update({10: 500.0, 11: 1000.0})
    hp = [(h, p) for h, p in p0.items()] + [(34, -50.0), (35, 200.0), (44, 100.0), (58, 100.0)]
    h = np.array([x[0] for x in hp])
    pml = np.array([x[1] for x in hp])
    cents = {"pml": np.rint(100 * pml).astype(np.int64), "energia": np.rint(100 * (pml - 3)).astype(np.int64),
             "perdidas": np.full(len(h), 100, np.int64), "congestion": np.full(len(h), 200, np.int64)}
    grid = np.zeros(ND * 24)
    for d in range(ND):
        grid[d * 24 + 10], grid[d * 24 + 11] = 0.5, 0.25
    grid[48:72] = np.nan                                # dia 2: clima no valido
    return h, pml, cents, grid


def test_a_mano():
    h, pml, cents, grid = _hand()
    pm = S.pml_daily(h, cents, pml, ND)
    cf = S.solar_daily(h, pml, grid, pm["pml_avg"])
    assert list(pm["n_horas"][:3]) == [24, 3, 1] and np.isnan(pm["n_horas"][3])
    assert pm["pml_avg"][0] == pytest.approx((22 * 300 + 500 + 1000) / 24)          # 337.5 MXN/MWh
    assert pm["pml_avg"][1] == pytest.approx(250 / 3)
    assert pm["energia_avg"][0] == pytest.approx(337.5 - 3)
    assert pm["perdidas_avg"][1] == pytest.approx(1.0) and pm["congestion_avg"][0] == pytest.approx(2.0)
    assert pm["spread"][0] == 700 and pm["spread"][1] == 250 and pm["spread"][2] == 0
    assert cf["y_day"][0] == pytest.approx(0.75) and cf["horas_solares"][0] == 2       # MWh/MWp
    assert cf["ingreso_dia"][0] == pytest.approx(0.5 * 500 + 0.25 * 1000)              # 500 MXN/MWp
    assert cf["p_cap_dia"][0] == pytest.approx(500 / 0.75)
    assert cf["vf_dia"][0] == pytest.approx(500 / 0.75 / 337.5)
    assert cf["ingreso_dia"][1] == pytest.approx(0.5 * -50 + 0.25 * 200)               # 25
    assert cf["vf_dia"][1] == pytest.approx((25 / 0.75) / (250 / 3))                   # 0.4
    for f in S.CFG_FIELDS:                              # dia 2: con PML pero sin clima; dia 3: sin PML
        assert np.isnan(cf[f][2]) and np.isnan(cf[f][3])
    assert np.isfinite(pm["pml_avg"][2]) and np.isnan(pm["pml_avg"][3])
    assert pm["_cent_pml"][0] == 22 * 30000 + 50000 + 100000


def test_y_day_solo_horas_con_pml():
    """y_day suma solo las horas con PML (como y_f publicado): dia 1 tiene las horas 10 y 11 -> 0.75; si falta la
    hora 11, 0.5."""
    h, pml, cents, grid = _hand()
    k = h != 35
    pm = S.pml_daily(h[k], {c: v[k] for c, v in cents.items()}, pml[k], ND)
    cf = S.solar_daily(h[k], pml[k], grid, pm["pml_avg"])
    assert cf["y_day"][1] == pytest.approx(0.5) and cf["horas_solares"][1] == 1
    assert S.y24_day(grid)[1] == pytest.approx(0.75) and np.isnan(S.y24_day(grid)[2])


def test_identidades_y_nulos():
    rng = np.random.default_rng(1)
    nd = 60
    h = np.sort(rng.choice(nd * 24, nd * 20, replace=False))
    pml = rng.normal(400, 300, len(h))
    cents = {c: np.rint(100 * pml).astype(np.int64) for c in S.COMP}
    hod = np.arange(nd * 24) % 24
    grid = np.where((hod >= 7) & (hod <= 18), rng.uniform(0, 0.9, nd * 24), 0.0)
    grid[5 * 24:6 * 24] = 0.0                           # dia sin produccion -> p_cap y vf nulos, y=0, ingreso=0
    pm = S.pml_daily(h, cents, pml, nd)
    cf = S.solar_daily(h, pml, grid, pm["pml_avg"])
    ok = np.isfinite(cf["p_cap_dia"])
    np.testing.assert_allclose(cf["ingreso_dia"][ok], cf["y_day"][ok] * cf["p_cap_dia"][ok], rtol=1e-12)
    v = np.isfinite(cf["vf_dia"])
    np.testing.assert_allclose(cf["vf_dia"][v], cf["p_cap_dia"][v] / pm["pml_avg"][v], rtol=1e-12)
    assert not v[pm["pml_avg"] <= 0].any()              # vf nulo si pml_avg <= 0
    assert cf["y_day"][5] == 0 and cf["ingreso_dia"][5] == 0 and np.isnan(cf["p_cap_dia"][5])
    # suma por ventana: media ponderada por horas de pml_avg = suma de centavos / horas (puerta a)
    st = G.window_pml(pm, np.full(nd, 202001))["completo"]
    assert st["hw"]["pml_avg"] / st["n"] == pytest.approx(cents["pml"].sum() / 100 / len(h), rel=1e-12)
    assert st["n"] == len(h)


def test_hora_duplicada_falla():
    with pytest.raises(ValueError):
        S.pml_daily(np.array([1, 1]), {c: np.array([1, 2]) for c in S.COMP}, np.array([1.0, 2.0]), 1)


def test_reloj_y_rejilla():
    """Indice CDMX (inicio de hora) -> posicion; dias no validos -> NaN; fuera de rango se ignora."""
    idx = pd.date_range("2019-12-31 22:00", periods=30, freq="h")
    valid = np.ones(30, bool)
    valid[-3:] = False
    g = S.y_grid(idx, np.arange(30, dtype=float), valid, 2)
    assert g[0] == 2.0 and g[1] == 3.0                  # 2020-01-01 00:00 CDMX es la posicion 0
    assert np.isnan(g[25:]).all() and S.hour_index([pd.Timestamp("2020-01-02 05:00")])[0] == 29
    assert list(S.month_of_days(33)[[0, 30, 31, 32]]) == [202001, 202001, 202002, 202002]


def test_puerta_c_mes_sintetico():
    nd = S.n_days("2024-09-30")
    ym = S.month_of_days(nd)
    grid = np.zeros(nd * 24)
    grid[(np.arange(nd * 24) % 24) == 12] = 0.6
    d_inv = int(np.nonzero(ym == 202409)[0][3])
    grid[d_inv * 24:(d_inv + 1) * 24] = np.nan          # sept con 29 dias validos
    ytab = np.zeros((2, 24))
    ytab[:, 12] = 0.6
    h = np.arange((nd - 61) * 24, nd * 24)
    pml = np.full(len(h), 100.0)
    pm = S.pml_daily(h, {c: np.full(len(h), 10000) for c in S.COMP}, pml, nd)
    cf = S.solar_daily(h, pml, grid, pm["pml_avg"])
    out = G.window_cfg(cf, pm, ym, h, pml, grid, (np.array([202408, 202409]), ytab, np.array([31.0, 29.0])))
    assert out["c"]["max_rel"] < 1e-12 and out["c"]["nd_mismatch"] == 0 and out["c"]["months_all_days"] == 1
    assert out["y_vs_y24"] == 0 and out["win"]["completo"]["dias_sin_clima"] == 1


def test_area_definicion():
    """Media entre miembros con dato ese dia; VF = media p_cap / media pml_avg sobre el MISMO conjunto."""
    nan = np.nan
    pm = [{"n_horas": np.array([24, 24, nan]), "pml_avg": np.array([100., 200., nan])},
          {"n_horas": np.array([24, nan, nan]), "pml_avg": np.array([300., nan, nan])}]
    pc = [np.array([150., nan, nan]), np.array([600., nan, nan])]
    acc = S.AreaAcc(3)
    for p, c in zip(pm, pc):
        p = {**p, **{f: p["pml_avg"] for f in S.PML_FIELDS[2:]}}
        cfg = {"y_day": np.array([1., 1., nan]), "horas_solares": np.array([10., 10., nan]), "p_cap_dia": c,
               "vf_dia": c / p["pml_avg"], "ingreso_dia": c}
        acc.add(p, {k: cfg for k in S.CONFIGS})
    r = acc.result()
    assert list(r["pml"]["n_nodos"]) == [2, 1, 0]
    assert r["pml"]["pml_avg"][0] == 200 and r["pml"]["pml_avg"][1] == 200 and np.isnan(r["pml"]["pml_avg"][2])
    t = r["tracker"]
    assert t["n_nodos"][0] == 2 and t["n_nodos"][1] == 0
    assert t["vf_dia"][0] == pytest.approx(((150 + 600) / 2) / ((100 + 300) / 2))      # 1.875, no media de vf (2.25)
    assert np.isnan(t["vf_dia"][1]) and t["pml_avg"][0] == 200


def test_codificacion_y_presupuesto():
    """Ida y vuelta: error <= escala/2 y None <-> NaN. Documento de nodo realista (2 465 dias) <= 120 KB gz."""
    nd = 2465
    rng = np.random.default_rng(7)
    walk = 800 + np.cumsum(rng.normal(0, 40, nd))
    pm = {"n_horas": np.full(nd, 24.0), "pml_avg": walk, "energia_avg": walk * 0.97,
          "perdidas_avg": rng.normal(15, 5, nd), "congestion_avg": rng.normal(2, 8, nd),
          "spread": np.abs(rng.normal(600, 200, nd))}
    y = np.clip(rng.normal(7, 1.2, nd), 0, None)
    pc = walk * rng.uniform(0.6, 1.0, nd)
    cf = {"y_day": y, "horas_solares": np.full(nd, 12.0), "p_cap_dia": pc, "vf_dia": pc / walk, "ingreso_dia": y * pc}
    pm["pml_avg"][5] = np.nan
    doc = S.node_doc("X", nd, pm, {k: cf for k in S.CONFIGS})
    assert doc["pml"]["pml_avg"][5] is None and doc["n"] == nd and doc["start"] == "2020-01-01"
    for f in S.PML_FIELDS:
        dec = S.decode(doc["pml"][f], doc["scale"][f])
        assert np.nanmax(np.abs(dec - pm[f])) <= doc["scale"][f] / 2 + 1e-9
    for f in S.CFG_FIELDS:
        assert np.max(np.abs(S.decode(doc["tracker"][f], doc["scale"][f]) - cf[f])) <= doc["scale"][f] / 2 + 1e-9
    gz = len(gzip.compress(json.dumps(doc, separators=(",", ":")).encode(), 9))
    assert gz <= 120_000, gz


def test_ma7_ratio_cociente_de_sumas():
    """7 dias: dia 2 con pml_avg ~0 (vf_dia enorme) no domina; dia 5 nulo se salta; < 4 validos -> NaN."""
    ing = np.array([500., 400., 300., 600., 450., np.nan, 350.])
    y = np.array([1., 1., 1., 1., 1., np.nan, 0.5])
    pml = np.array([400., 500., 0.01, 600., 300., 200., 700.])
    n = np.array([24., 24., 24., 24., 12., 24., 24.])
    pc, vf = S.ma7_ratio(ing, y, pml, n)
    k = [0, 1, 2, 3, 4, 6]
    pc_ref = ing[k].sum() / y[k].sum()                                   # 2600 / 5.5
    pm_ref = (n[k] * pml[k]).sum() / n[k].sum()
    assert pc[6] == pytest.approx(pc_ref) and vf[6] == pytest.approx(pc_ref / pm_ref)
    assert np.isnan(pc[:3]).all() and np.isfinite(pc[3])                 # minimo 4 dias validos
    assert vf[6] < 2 < (300 / 0.01)                                      # la media de vf_dia daria ~ 4 000
    m = S.ma7(pml, n)
    assert m[6] == pytest.approx((n * pml).sum() / n.sum())


def test_median_gate():
    z = {"p50": -0.004}
    assert G.median_gate({"tracker": {"Y1": z, "Y2": z}, "fijo": {"Y1": z, "Y2": {"p50": 0.02}}}) == 1
    assert G.median_gate({"tracker": {"Y1": None}}) == 1


# ------------------------------------------------------------------ parte 2: datos reales
MAIN = Path("/Users/nicolasdiaznaufal/Documents/REPSA/App/nodal-solar")
ROOT = Path(os.environ["NODAL_DATA_ROOT"]) if os.environ.get("NODAL_DATA_ROOT") else MAIN
DAILY = ROOT / "data/solar_v2/daily"
real = pytest.mark.skipif(not (DAILY / "manifest.json").exists(), reason="sin data/solar_v2/daily")


@pytest.fixture(scope="module")
def man():
    return json.loads((DAILY / "manifest.json").read_text())


@real
def test_real_puertas_y_tamanos(man):
    rec = man["reconciliation"]
    assert rec["ok"] and rec["e_areas"]["ok"] and not any(rec["summary"]["violations"].values())
    assert len(man["ids"]) == 2431 and not man["missing"] and man["start"] == "2020-01-01"
    assert man["sizes"]["node_gz_max"] <= 120_000
    assert isinstance(rec["e_areas"]["series_areas_ALL_yearly_pml"], dict)
    d = json.loads((DAILY / "deflator_mensual.json").read_text())
    assert d["base"] == "2026-09" and d["factor"][d["months"].index("2026-09")] == 1.0
    assert all(f is not None and f >= 1.0 - 1e-12 for f in d["factor"])
    assert {a["kind"] for a in man["areas"]} == {"all", "region", "state"}
    assert G.median_gate(rec["summary"]["d_daily_vs_win_rel"]) == 0     # puerta N3 sobre los datos publicados


@real
def test_real_nodo_independiente(man):
    """Un nodo: pml_avg y n_horas diarios recalculados con pandas + clock.ts_cdmx (no el SQL del build); identidades
    sobre lo decodificado (tolerancia de cuantizacion)."""
    import duckdb
    import clock
    nodo = man["ids"][0]
    doc = json.loads((DAILY / "nodes" / f"{nodo}.json").read_text())
    con = duckdb.connect(str(ROOT / "data/db/pml.duckdb"), read_only=True)
    t = con.execute("SELECT sistema, fecha, hora, pml FROM pml_hourly WHERE nodo = ? AND fecha BETWEEN "
                    "'2024-02-25' AND '2024-03-05'", [nodo]).df()
    t["ts"] = clock.ts_cdmx(t["sistema"].iloc[0], t["fecha"], t["hora"])
    t["d"] = (t["ts"] - S.D0).dt.days
    g = t.groupby("d")
    i0, i1 = (pd.Timestamp("2024-02-26") - S.D0).days, (pd.Timestamp("2024-03-04") - S.D0).days
    n = S.decode(doc["pml"]["n_horas"], 1)
    pa = S.decode(doc["pml"]["pml_avg"], doc["scale"]["pml_avg"])
    sp = S.decode(doc["pml"]["spread"], doc["scale"]["spread"])
    for d in range(i0, i1 + 1):
        x = g.get_group(d)["pml"]
        assert n[d] == len(x)
        assert abs(pa[d] - x.mean()) <= 0.05 + 0.005
        assert abs(sp[d] - (x.max() - x.min())) <= 0.05 + 1e-9
    for k in ("tracker", "fijo"):
        dec = {f: S.decode(doc[k][f], doc["scale"][f]) for f in S.CFG_FIELDS}
        ok = np.isfinite(dec["p_cap_dia"])
        y, p = dec["y_day"][ok], dec["p_cap_dia"][ok]
        bound = 0.05 + 0.5e-4 * np.abs(p) + 0.05 * y + 1e-9         # cuantizacion propagada (escala/2 de cada campo)
        assert (np.abs(dec["ingreso_dia"][ok] - y * p) <= bound).all()
        assert np.nanmax(dec["horas_solares"]) <= 24 and np.nanmin(dec["y_day"]) >= 0
    assert np.isnan(S.decode(doc["tracker"]["y_day"], 1e-4)[-1])     # sin clima despues de 2026-07-30
