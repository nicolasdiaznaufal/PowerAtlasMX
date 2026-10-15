"""KPIs por config x variante de clima (pipeline/kpis_variants*.py).

Parte 1 (siempre): ejemplo calculado a mano y propiedades de las puertas.
Parte 2 (datos reales, se omite si no existen): archivos de $NODAL_DATA_ROOT/data/solar_v2/web/ (o del checkout
principal) contra el publicado, solar_v2/scalars.parquet y un recalculo independiente (numpy puro) de 3 nodos."""
import gzip
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import kpis as K  # noqa: E402
import kpis_variants as KV  # noqa: E402


# ------------------------------------------------------------------ parte 1: a mano
def _com():
    filas = []
    for h in range(24):
        pml = {10: 500.0, 11: 1000.0}.get(h, 300.0)
        filas.append({"sistema": "SIN", "nodo": "N1", "anio": 2024, "mes": 8, "hora": h, "n_horas": 31,
                      "n_pml_le0": 1 if h == 10 else 0, "sum_pml_cent": int(round(31 * pml * 100)),
                      "sum_energia_cent": 0, "sum_perdidas_cent": 0, "sum_congestion_cent": 31 * 100 * 2})
    return pd.DataFrame(filas)


def _tablas(y10, y11, variant, key):
    y = [0.0] * 24
    y[10], y[11] = y10, y11
    return pd.DataFrame({"nodo": ["N1"], "config": ["fixed"], "variant": [variant], "key": [key], "nd": [31.0], "y": [y]})


def test_a_mano_mean():
    ag = KV.combinar_variante(_com(), KV.tabla_larga(_tablas(0.5, 0.25, "mean", 8), "fixed", "mean"), "mean")
    t = K._metricas_nodo(ag, "2024-08", "2024-08").loc["N1"]
    # sum_y = 31*(0.5+0.25) = 23.25 ; sum_y_pml = 31*(0.5*500 + 0.25*1000) = 15500
    assert t["y_f"] == pytest.approx(23.25, rel=1e-12)
    assert t["ingreso"] == pytest.approx(15500.0, rel=1e-12)
    assert t["p_cap"] == pytest.approx(15500 / 23.25, rel=1e-12)
    assert t["pml_medio"] == pytest.approx((22 * 300 + 500 + 1000) / 24, rel=1e-12)       # 337.5
    assert t["vf"] == pytest.approx((15500 / 23.25) / 337.5, rel=1e-12)
    assert t["pct_e0"] == pytest.approx(100 * 0.5 * 1 / 23.25, rel=1e-12)
    assert t["ingreso_atajo"] == pytest.approx(23.25 * 337.5, rel=1e-12)
    assert t["vf_dia_promedio"] == pytest.approx((0.5 * 500 + 0.25 * 1000) / (337.5 * 0.75), rel=1e-12)
    assert t["spread_punta_solar"] == pytest.approx(300 - (10 * 300 + 500 + 1000) / 12, rel=1e-12)   # -75
    assert t["congestion_media"] == pytest.approx(2.0)


def test_a_mano_win_usa_anio_mes():
    tab = _tablas(0.2, 0.4, "win", 202408)
    ag = KV.combinar_variante(_com(), KV.tabla_larga(tab, "fixed", "win"), "win")
    t = K._metricas_nodo(ag, "2024-08", "2024-08").loc["N1"]
    assert t["p_cap"] == pytest.approx((0.2 * 500 + 0.4 * 1000) / 0.6, rel=1e-12)     # 833.33
    with pytest.raises(ValueError):                       # clave mes (8) no sirve para win
        KV.combinar_variante(_com(), KV.tabla_larga(_tablas(0.2, 0.4, "win", 8), "fixed", "win"), "win")


def test_reales_mismo_deflactor():
    inpc = {"base": "2026-09", "inpc": {"2024-08": 100.0, "2026-09": 110.0}}
    ag = KV.combinar_variante(_com(), KV.tabla_larga(_tablas(0.5, 0.25, "mean", 8), "fixed", "mean"), "mean")
    r = K._metricas_nodo(K.a_reales(ag, inpc)[0], "2024-08", "2024-08").loc["N1"]
    assert r["p_cap"] == pytest.approx(1.1 * 15500 / 23.25, rel=1e-12)
    assert r["y_f"] == pytest.approx(23.25, rel=1e-12)      # la produccion no se deflacta


def test_comparar_detecta_fuera_de_tolerancia():
    a = pd.DataFrame({"p_cap": [100.0, 200.0]}, index=["a", "b"])
    KV.comparar(a, a * (1 + 5e-7), ["p_cap"])
    with pytest.raises(AssertionError):
        KV.comparar(a, a * (1 + 5e-6), ["p_cap"])
    with pytest.raises(AssertionError):
        KV.comparar(a, a.iloc[:1], ["p_cap"])


# ------------------------------------------------------------------ parte 2: datos reales
MAIN = Path("/Users/nicolasdiaznaufal/Documents/REPSA/App/nodal-solar")
ROOT = Path(os.environ["NODAL_DATA_ROOT"]) if os.environ.get("NODAL_DATA_ROOT") else MAIN
WEB = ROOT / "data/solar_v2/web"
real = pytest.mark.skipif(not (WEB / "reconciliation.json").exists(), reason="sin data/solar_v2/web")


def _j(n):
    return json.loads((WEB / n).read_text())


@real
def test_tracker_identico_al_publicado():
    assert (WEB / "analysis_nodos_tracker.json").read_bytes() == (ROOT / "data/analysis/analysis_nodos.json").read_bytes()
    g = _j("reconciliation.json")["gates"]
    assert g["tracker_json_vs_publicado"]["max_rel"] <= 1e-6
    for cfg in ("tracker", "fixed"):
        assert max(e for w in g[f"mean_vs_ruta_publicada_{cfg}"].values() for e in w.values()) <= 1e-6
        assert g[f"y_f_vs_solar_scalars_{cfg}"]["y_f_max_err_rel"] <= 1e-6
    assert g["n_horas_identico"] is True


@real
def test_esquema_ids_y_orden():
    pub, fijo = _j("analysis_nodos_tracker.json"), _j("analysis_nodos_fijo.json")
    assert list(fijo) == list(pub) and fijo["ids"] == pub["ids"] and fijo["config"] == "fijo"
    for v in pub["ventanas"]:
        assert list(fijo["ventanas"][v]) == list(pub["ventanas"][v])
        for c in ("n_horas", "pml_medio", "congestion_media", "spread_punta_solar", "pml_medio_real"):
            assert fijo["ventanas"][v][c] == pub["ventanas"][v][c]          # independientes de la config
    for cfg in ("tracker", "fijo"):
        vs = _j(f"variant_scalars_{cfg}.json")
        assert vs["ids"] == pub["ids"] and vs["variants"][0] == "mean" and "clear" not in vs["variants"]
        for w in ("Y1", "Y2"):
            assert vs["shared"][w]["n_horas"] == pub["ventanas"][KV.VENT_WEB[w]]["n_horas"]
            for v in vs["variants"]:
                for c in vs["fields"]:
                    assert len(vs["data"][v][w][c]) == len(pub["ids"])


@real
def test_identidades_y_fijo_menor():
    for cfg in ("tracker", "fijo"):
        vs = _j(f"variant_scalars_{cfg}.json")
        for w in ("Y1", "Y2"):
            pm = np.array(vs["shared"][w]["pml_medio"], dtype=float)
            for v in vs["variants"]:
                d = {c: np.array(vs["data"][v][w][c], dtype=float) for c in vs["fields"]}
                ex = _j(f"variant_extra/{cfg}/{v}.json")["data"][w]
                d.update({c: np.array(x, dtype=float) for c, x in ex.items()})
                ok = ~np.isnan(d["p_cap"])
                assert np.allclose(d["vf"][ok], d["p_cap"][ok] / pm[ok], rtol=2e-4, atol=1e-4)
                assert np.allclose(d["ingreso"][ok], d["y_f"][ok] * d["p_cap"][ok], rtol=1e-6)
                assert np.allclose(d["ingreso_real"][ok], d["y_f"][ok] * d["p_cap_real"][ok], rtol=1e-6)
                assert np.allclose(d["ingreso_atajo"][ok], d["y_f"][ok] * pm[ok], rtol=1e-6)
                assert ((d["pct_e0"][ok] >= 0) & (d["pct_e0"][ok] <= 100)).all()
                assert (d["yf_annual_equiv"][ok] >= d["y_f"][ok] - 1e-3).all()     # sin anualizar y_f
    t, f = _j("variant_scalars_tracker.json"), _j("variant_scalars_fijo.json")
    for v in t["variants"]:
        for w in ("Y1", "Y2"):
            a, b = np.array(f["data"][v][w]["y_f"], float), np.array(t["data"][v][w]["y_f"], float)
            ok = ~np.isnan(a)
            assert (a[ok] < b[ok]).all()
            dv = np.abs(np.array(f["data"][v][w]["vf"], float) - np.array(t["data"][v][w]["vf"], float))[ok]
            assert dv.max() <= 0.15, f"{v}/{w}: vf_fijo vs tracker {dv.max()}"


@real
def test_y_f_igual_a_scalars_de_solar():
    sc = pd.read_parquet(ROOT / "data/solar_v2/scalars.parquet")
    for cfg, web in KV.CFG_WEB.items():
        vs = _j(f"variant_scalars_{web}.json")
        s = sc[(sc.config == cfg)].set_index(["variant", "window", "nodo"]).sort_index()
        for v in vs["variants"]:
            for w in ("Y1", "Y2"):
                a = np.array(vs["data"][v][w]["y_f"], float)
                ok = ~np.isnan(a)
                ref = s.loc[(v, w)].reindex(np.array(vs["ids"])[ok])["y_f"].to_numpy()
                assert np.allclose(a[ok], ref, rtol=1e-6, atol=1e-4)


def _recalculo_numpy(nodo, config, variante, desde, hasta):
    """Independiente de kpis.py: sumas directas de los parquet y del CSV de INPC."""
    c = pd.read_parquet(ROOT / "data/aggregates/agregados_comunes.parquet", filters=[("nodo", "==", nodo)])
    ym = c.anio * 100 + c.mes
    c = c[(ym >= int(desde.replace("-", ""))) & (ym <= int(hasta.replace("-", "")))]
    t = pd.read_parquet(ROOT / "data/solar_v2/tables_month_hour.parquet", filters=[("nodo", "==", nodo)])
    t = t[(t.config == config) & (t.variant == variante)]
    y = {int(k): np.asarray(v, float) for k, v in zip(t.key, t.y)}
    key = (c.anio * 100 + c.mes) if variante == "win" else c.mes
    yy = np.array([y[int(k)][int(h)] for k, h in zip(key, c.hora)])
    inpc = pd.read_csv(ROOT / "data/ref/inpc_mensual.csv", dtype={"mes": str}).dropna(subset=["inpc"])
    m = dict(zip(inpc.mes, inpc.inpc))
    f = np.array([m[max(m)] / m[f"{a:04d}-{b:02d}"] for a, b in zip(c.anio, c.mes)])
    pml = c.sum_pml_cent.to_numpy() / 100
    sy, syp = (yy * c.n_horas).sum(), (yy * pml).sum()
    return {"y_f": sy, "ingreso": syp, "p_cap": syp / sy, "vf": (syp / sy) / (pml.sum() / c.n_horas.sum()),
            "pct_e0": 100 * (yy * c.n_pml_le0).sum() / sy, "p_cap_real": (yy * pml * f).sum() / sy}


@real
@pytest.mark.parametrize("cfg,var,w", [("fixed", "y2020", "Y1"), ("tracker", "win", "Y2"), ("fixed", "mean", "Y2")])
def test_tres_nodos_recalculo_independiente(cfg, var, w):
    vs = _j(f"variant_scalars_{KV.CFG_WEB[cfg]}.json")
    ex = _j(f"variant_extra/{KV.CFG_WEB[cfg]}/{var}.json")["data"][w]
    de, ha = K.VENTANAS_ANALISIS[KV.VENT_WEB[w]]
    for nodo in ("01AAN-85", vs["ids"][len(vs["ids"]) // 2], vs["ids"][-1]):
        i = vs["ids"].index(nodo)
        if vs["data"][var][w]["p_cap"][i] is None:
            continue
        r = _recalculo_numpy(nodo, cfg, var, de, ha)
        for c in ("y_f", "ingreso", "p_cap", "vf"):
            assert vs["data"][var][w][c][i] == pytest.approx(r[c], rel=1e-6, abs=6e-5), (nodo, c)
        for c in ("pct_e0", "p_cap_real"):
            assert ex[c][i] == pytest.approx(r[c], rel=1e-6, abs=6e-5), (nodo, c)


@real
def test_sin_nan_ni_999_y_presupuestos():
    lim = {"analysis_nodos_fijo.json": 600_000, "variant_scalars_tracker.json": 2_000_000,
           "variant_scalars_fijo.json": 2_000_000, "node_profiles_fijo.json": 1_100_000}
    for n, b in lim.items():
        raw = (WEB / n).read_bytes()
        assert len(gzip.compress(raw, 9)) <= b, n
        assert b"NaN" not in raw and b"Infinity" not in raw and b"-999" not in raw, n
    for p in (WEB / "variant_extra").rglob("*.json"):
        raw = p.read_bytes()
        assert len(gzip.compress(raw, 9)) <= 150_000 and b"NaN" not in raw and b"-999" not in raw, p
