"""Pruebas de pipeline/aggregates.py (agent kpis).

1. Sinteticas (siempre corren): reloj en dias de 23/25 h, sumas en centavos exactas, sum_y = y*n,
   ninguna hora perdida ni duplicada.
2. Exactitud aditiva en 10 nodos reales (se omiten sin data/): los KPIs calculados desde los
   agregados mes x hora (combinando cualquier rango de meses) igualan a los calculados hora por hora
   por un camino independiente (reloj CDMX en Python `clock.ts_cdmx`, baseline leido directo del
   parquet de solar, sumas con math.fsum). Enteros: igualdad exacta. Flotantes: |rel| <= 1e-11
   (solo cambia el orden de suma; lo observado es ~1e-14).
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import aggregates as AG  # noqa: E402
import clock  # noqa: E402
import kpis as K  # noqa: E402

AGG = ROOT / "data" / "aggregates"
DB = ROOT / "data" / "db" / "pml.duckdb"
BASE = ROOT / "data" / "baselines" / "solar_baselines_month_hour.parquet"

# 10 nodos: 7 regiones del SIN + BCA; hueco real de 177 dias (03EGM-230); entradas tardias
# (03MNO-115 en 2026-07 con < 12 meses, 07CFP-400 BCA en 2024-06 -> reloj CDMX +2 h y mes de borde 2026-10);
# 03DEA-230: codigo RETIRADO (renombrado a 03DEC-230), coordenadas del nodo renombrado;
# muchos PML negativos (04MPP-115, 05CJM-115).
NODOS_10 = ["01AAN-85", "03DEA-230", "02AAA-115", "03EGM-230", "03MNO-115", "04MPP-115", "05CJM-115",
            "06AAT-115", "07CFP-400", "08AKD-115"]
REL = 1e-11


# ------------------------------------------------------------------------------- utilidades
def db_sintetica(tmp_path: Path, filas: list[tuple]) -> Path:
    """filas = (sistema, fecha, hora, nodo, pml, energia, perdidas, congestion)."""
    p = tmp_path / "pml.duckdb"
    con = duckdb.connect(str(p))
    con.execute("CREATE TABLE pml_hourly (sistema VARCHAR, fecha DATE, hora INTEGER, nodo VARCHAR, pml DOUBLE,"
                " energia DOUBLE, perdidas DOUBLE, congestion DOUBLE)")
    con.executemany("INSERT INTO pml_hourly VALUES (?, ?, ?, ?, ?, ?, ?, ?)", filas)
    con.close()
    return p


def base_sintetica(nodo: str, y: dict[tuple[int, int], float], y_tracker: dict | None = None) -> pd.DataFrame:
    """Perfil 12x24 (mes, hora) -> y; lo no indicado = 0. tracker = fixed salvo que se de otro."""
    rows = []
    for cfg, d in (("fixed", y), ("tracker", y_tracker if y_tracker is not None else y)):
        for m in range(1, 13):
            for h in range(24):
                rows.append((nodo, cfg, m, h, float(d.get((m, h), 0.0))))
    return pd.DataFrame(rows, columns=["nodo", "config", "mes", "hora", "y_mwh_por_mwp"])


def dia(sistema, fecha, nodo, pml_de_hora, n=None):
    n = n or clock.horas_en_dia(sistema, pd.Timestamp(fecha).date())
    out = []
    for h in range(1, n + 1):
        p = float(pml_de_hora(h))
        out.append((sistema, fecha, h, nodo, p, p - 5.0, 3.0, 2.0))
    return out


# ------------------------------------------------------------------------------- sinteticas
def test_dia_25h_bca_en_reloj_cdmx(tmp_path):
    # BCA 2021-11-06 (verano) y 2021-11-07 (25 h). PML = 10*hora. Medianoche en verano en ambos dias:
    # local estandar = hora - 2; CDMX = local estandar + 2 h  ->  ts_cdmx = fecha + hora (horas).
    #   11-06 hora 24 -> 11-07 00:00; 11-07 hora 24 -> 11-08 00:00; hora 25 -> 11-08 01:00.
    filas = dia("BCA", "2021-11-06", "N1", lambda h: 10 * h) + dia("BCA", "2021-11-07", "N1", lambda h: 10 * h)
    assert len(filas) == 49
    con = AG.conectar(db_sintetica(tmp_path, filas), memory="1GB")
    com, cfg = AG.agregar(con, base=base_sintetica("N1", {(11, 12): 1.0}))
    assert int(com["n_horas"].sum()) == 49
    c0 = com[com["hora"] == 0].iloc[0]
    assert c0["n_horas"] == 2 and c0["sum_pml_cent"] == 100 * (240 + 240)
    c1 = com[com["hora"] == 1].iloc[0]
    assert c1["n_horas"] == 3 and c1["sum_pml_cent"] == 100 * (10 + 10 + 250)
    c12 = com[com["hora"] == 12].iloc[0]
    assert c12["n_horas"] == 2 and c12["sum_pml_cent"] == 100 * (120 + 120)   # hora publicada 12
    f = cfg[(cfg["config"] == "fixed") & (cfg["hora"] == 12)].iloc[0]
    assert f["sum_y"] == 2.0 and f["sum_y_pml"] == 240.0
    ts = pd.concat([clock.ts_cdmx("BCA", pd.Series(["2021-11-06"] * 24), pd.Series(range(1, 25))),
                    clock.ts_cdmx("BCA", pd.Series(["2021-11-07"] * 25), pd.Series(range(1, 26)))])
    assert ts.is_unique and (ts.diff().dropna() == pd.Timedelta(hours=1)).all()


def test_bca_y_bcs_cruzan_ano_y_mes_en_cdmx(tmp_path):
    # BCA 2021-12-31 (invierno): CDMX = hora - 1 + 2 -> horas 23 y 24 caen el 2022-01-01 00:00 y 01:00.
    # BCS 2023-06-30 (sin verano desde 2022-10-30): CDMX = hora - 1 + 1 -> hora 24 cae el 2023-07-01 00:00.
    filas = dia("BCA", "2021-12-31", "NA", lambda h: h) + dia("BCS", "2023-06-30", "NB", lambda h: h)
    con = AG.conectar(db_sintetica(tmp_path, filas), memory="1GB")
    com, _ = AG.agregar(con, base=pd.concat([base_sintetica("NA", {}), base_sintetica("NB", {})]))
    a = com[com["nodo"] == "NA"].groupby(["anio", "mes"])["n_horas"].sum().to_dict()
    assert a == {(2021, 12): 22, (2022, 1): 2}
    assert int(com[(com["nodo"] == "NA") & (com["anio"] == 2022) & (com["hora"] == 0)]["sum_pml_cent"].iloc[0]) == 2300
    b = com[com["nodo"] == "NB"].groupby(["anio", "mes"])["n_horas"].sum().to_dict()
    assert b == {(2023, 6): 23, (2023, 7): 1}
    assert int(com[(com["nodo"] == "NB") & (com["mes"] == 6)]["hora"].min()) == 1   # 00:00 local = 01:00 CDMX


def test_meses_borde_y_horas_posibles():
    fi, ff = "2020-01-01", "2026-09-30"
    assert AG.meses_borde("SIN", fi, ff) == []
    assert AG.meses_borde("BCA", fi, ff) == ["2020-01", "2026-10"]
    assert AG.meses_borde("BCS", fi, ff) == ["2020-01", "2026-10"]
    # BCA: faltan las 2 primeras horas de ene-2020 en CDMX; BCS 1. El ultimo dato (30-sep hora 24) cae en 1-oct 00:00.
    assert AG.horas_posibles_mes("BCA", 2020, 1, fi, ff) == 742
    assert AG.horas_posibles_mes("BCS", 2020, 1, fi, ff) == 743
    assert AG.horas_posibles_mes("SIN", 2020, 1, fi, ff) == 744
    assert AG.horas_posibles_mes("BCA", 2026, 10, fi, ff) == 1 and AG.horas_posibles_mes("BCS", 2026, 10, fi, ff) == 1
    assert AG.horas_posibles_mes("SIN", 2026, 10, fi, ff) == 0
    assert AG.horas_posibles_mes("BCA", 2026, 9, fi, ff) == 720


def test_dia_23h_sin_y_frontera_de_mes(tmp_path):
    # SIN 2022-04-03 (23 h, medianoche estandar) y 2022-04-04 (medianoche en verano).
    filas = dia("SIN", "2022-04-03", "N2", lambda h: h) + dia("SIN", "2022-04-04", "N2", lambda h: h)
    assert len(filas) == 47
    con = AG.conectar(db_sintetica(tmp_path, filas), memory="1GB")
    com, _ = AG.agregar(con, base=base_sintetica("N2", {}))
    assert int(com["n_horas"].sum()) == 47
    # 04-03 (23 h): hora h -> 04-03 (h-1):00, h = 1..23 -> 00:00..22:00.
    # 04-04 (verano): hora h -> 04-04 (h-2):00 -> hora 1 = 04-03 23:00, hora 24 = 04-04 22:00.
    # Resultado: 47 instantes estandar consecutivos y unicos; la hora del dia 23 aparece 1 vez.
    ts = pd.concat([clock.ts_cdmx("SIN", pd.Series(["2022-04-03"] * 23), pd.Series(range(1, 24))),
                    clock.ts_cdmx("SIN", pd.Series(["2022-04-04"] * 24), pd.Series(range(1, 25)))])
    assert ts.is_unique and (ts.diff().dropna() == pd.Timedelta(hours=1)).all()
    esperado = ts.dt.hour.value_counts().sort_index()
    got = com.groupby("hora")["n_horas"].sum()
    assert got.to_dict() == esperado.to_dict()


def test_frontera_de_mes_en_verano(tmp_path):
    # SIN 2021-06-01 hora 1 (verano) -> 2021-05-31 23:00 estandar: cuenta en MAYO.
    filas = dia("SIN", "2021-05-31", "N3", lambda h: 100) + dia("SIN", "2021-06-01", "N3", lambda h: 200)
    con = AG.conectar(db_sintetica(tmp_path, filas), memory="1GB")
    com, _ = AG.agregar(con, base=base_sintetica("N3", {}))
    por_mes = com.groupby("mes")["n_horas"].sum().to_dict()
    assert por_mes == {5: 25, 6: 23}
    # celda (mayo, 23 h) = 05-30 23:00 (hora 1 del 31, PML 100) + 05-31 23:00 (hora 1 del 1-jun, PML 200)
    assert int(com[(com["mes"] == 5) & (com["hora"] == 23)]["sum_pml_cent"].iloc[0]) == 100 * (100 + 200)


def test_sumas_centavos_exactas_y_sum_y(tmp_path):
    rng = np.random.default_rng(0)
    vals = np.round(rng.uniform(-50, 3000, 24 * 40), 2)
    filas = []
    for i, f in enumerate(pd.date_range("2021-01-01", periods=40, freq="D")):
        for h in range(1, 25):
            p = float(vals[i * 24 + h - 1])
            filas.append(("SIN", f.date().isoformat(), h, "N4", p, round(p * 0.9, 2), round(p * 0.07, 2),
                          round(p - round(p * 0.9, 2) - round(p * 0.07, 2), 2)))
    yd = {(m, h): 0.1 * max(0, 6 - abs(h - 12)) for m in range(1, 13) for h in range(24)}
    con = AG.conectar(db_sintetica(tmp_path, filas), memory="1GB")
    com, cfg = AG.agregar(con, base=base_sintetica("N4", yd))
    assert int(com["sum_pml_cent"].sum()) == int(np.round(vals * 100).astype("int64").sum())
    assert int(com["n_pml_le0"].sum()) == int((vals <= 0).sum())
    j = cfg.merge(com, on=AG.KEYS)
    assert np.allclose(j["sum_y"], j["y_mwh_por_mwp"] * j["n_horas"], rtol=0, atol=1e-12)


def test_baseline_incompleto_falla(tmp_path):
    bad = base_sintetica("N", {}).iloc[:-1]          # falta una celda (mes, hora)
    p = tmp_path / "b.parquet"
    bad.rename(columns={"nodo": "loc_id", "mes": "month", "hora": "hour",
                        "y_mwh_por_mwp": "mwh_per_mwp_mean_day"}).to_parquet(p)
    with pytest.raises(ValueError):
        AG.cargar_baseline(p)


# ------------------------------------------------------------------------------- 10 nodos reales
@pytest.fixture(scope="module")
def reales():
    if not (DB.exists() and (AGG / "agregados_config.parquet").exists() and BASE.exists()):
        pytest.skip("sin data/db, data/aggregates o baselines")
    con = duckdb.connect()
    con.execute(f"ATTACH '{DB}' AS db (READ_ONLY)")
    lista = ", ".join(f"'{n}'" for n in NODOS_10)
    h = con.execute(f"SELECT sistema, nodo, fecha, hora, pml, energia, perdidas, congestion FROM db.pml_hourly "
                    f"WHERE nodo IN ({lista})").df()
    con.close()
    b = pd.read_parquet(BASE)
    b = b[b["loc_id"].isin(NODOS_10)].rename(columns={"loc_id": "nodo", "month": "m", "hour": "hd",
                                                      "mwh_per_mwp_mean_day": "y"})
    com = pd.read_parquet(AGG / "agregados_comunes.parquet", filters=[("nodo", "in", NODOS_10)])
    cfg = pd.read_parquet(AGG / "agregados_config.parquet", filters=[("nodo", "in", NODOS_10)])
    return h, b, com, cfg


def _directo(h: pd.DataFrame, b: pd.DataFrame, nodo: str, cfg: str) -> pd.DataFrame:
    d = h[h["nodo"] == nodo].copy()
    s = d["sistema"].iloc[0]
    ts = clock.ts_cdmx(s, d["fecha"].reset_index(drop=True), d["hora"].reset_index(drop=True))
    d["ts"] = ts.values
    d["ym"] = d["ts"].dt.year * 100 + d["ts"].dt.month
    d["m"], d["hd"] = d["ts"].dt.month, d["ts"].dt.hour
    bb = b[(b["nodo"] == nodo) & (b["config"] == cfg)][["m", "hd", "y"]]
    d = d.merge(bb.astype({"m": "int32", "hd": "int32"}), on=["m", "hd"], how="left", validate="many_to_one")
    assert d["y"].notna().all() and len(d) == (h["nodo"] == nodo).sum()
    return d


def _kpis_directos(d: pd.DataFrame) -> dict:
    """KPIs hora por hora, sin pasar por agregados."""
    f = math.fsum
    y, p = d["y"].to_numpy(), d["pml"].to_numpy()
    n = len(d)
    P, I = f(y), f(y * p)
    B = f(p) / n
    C = I / P
    return {"n_horas": n, "sum_pml_cent": int(np.round(p * 100).astype("int64").sum()),
            "n_pml_le0": int((p <= 0).sum()), "produccion_mwh_por_mwp": P, "ingreso_mxn_por_mwp": I,
            "precio_base_mxn_mwh": B, "precio_capturado_mxn_mwh": C, "vf": C / B,
            "mwh_por_mwp_en_riesgo": f(y[p <= 0]), "pct_energia_pml_le0": 100 * f(y[p <= 0]) / P,
            "precio_capturado_energia": f(y * d["energia"].to_numpy()) / P,
            "precio_capturado_perdidas": f(y * d["perdidas"].to_numpy()) / P,
            "precio_capturado_congestion": f(y * d["congestion"].to_numpy()) / P,
            "precio_base_congestion": f(d["congestion"].to_numpy()) / n}


def _rangos(d):
    ym = sorted(d["ym"].unique())
    a0, a1 = ym[0] // 100, ym[-1] // 100
    r = [(None, None), ("2021-03", "2022-10"), ("2024-01", "2024-01"), ("2025-06", "2026-09")]
    r += [(f"{a}-01", f"{a}-12") for a in range(a0, a1 + 1)]
    r.append((f"{ym[0] // 100}-{ym[0] % 100:02d}", f"{ym[0] // 100}-{ym[0] % 100:02d}"))   # primer mes (parcial)
    return r


MAX_REL_OBSERVADO: dict = {}


@pytest.mark.parametrize("cfg", ["fixed", "tracker"])
@pytest.mark.parametrize("nodo", NODOS_10)
def test_agregados_igual_a_horario_10_nodos(reales, nodo, cfg):
    h, b, com, cfgdf = reales
    d = _directo(h, b, nodo, cfg)
    ag = AG.combinar(com[com["nodo"] == nodo], cfgdf[cfgdf["nodo"] == nodo], cfg)
    assert int(ag["n_horas"].sum()) == len(d)                      # ninguna hora perdida/duplicada
    peor = 0.0
    for desde, hasta in _rangos(d):
        sel = d
        if desde:
            sel = sel[sel["ym"] >= int(desde.replace("-", ""))]
        if hasta:
            sel = sel[sel["ym"] <= int(hasta.replace("-", ""))]
        k = K.kpis_de_sumas(K.sumar(K.filtrar(ag, desde, hasta)))
        if len(sel) == 0:
            assert k["n_horas"] == 0
            continue
        ref = _kpis_directos(sel)
        for c in ("n_horas", "sum_pml_cent", "n_pml_le0"):
            got = k[c] if c in k else int(K.sumar(K.filtrar(ag, desde, hasta))[c])
            assert got == ref[c], (nodo, cfg, desde, hasta, c)
        for c, v in ref.items():
            if c in ("n_horas", "sum_pml_cent", "n_pml_le0"):
                continue
            if v == 0:
                assert abs(k[c]) <= 1e-9, (c, k[c])
                continue
            rel = abs(k[c] - v) / abs(v)
            peor = max(peor, rel)
            assert rel <= REL, (nodo, cfg, desde, hasta, c, k[c], v)
    MAX_REL_OBSERVADO[(nodo, cfg)] = peor


def test_resumen_hueco_03EGM(reales):
    """03EGM-230: hueco real de 177 dias -> ese ano NO es completo y no entra en peor/mediana/mejor."""
    h, b, com, cfgdf = reales
    ag = AG.combinar(com[com["nodo"] == "03EGM-230"], cfgdf[cfgdf["nodo"] == "03EGM-230"], "fixed")
    r = K.resumen(ag, "2020-01", "2026-09")
    anual = {a["anio"]: a for a in r["anual"]}
    assert anual[2023]["completo"] is False and anual[2023]["cobertura_pct"] < 60
    assert 2023 not in r["ingreso_anual"]["anios_completos"]
    assert r["cobertura"]["horas"] == 49393                     # = horas_con_datos de calidad


def test_meta_y_bordes_reales():
    p = AGG / "agregados_meta.json"
    if not p.exists():
        pytest.skip("sin data/aggregates")
    import json
    m = json.loads(p.read_text())
    assert m["reloj"] == "CDMX estandar UTC-6 fijo" and m["periodo_meses"] == ["2020-01", "2026-09"]
    assert m["sistemas"]["BCA"]["meses_borde"] == ["2020-01", "2026-10"] and m["sistemas"]["SIN"]["meses_borde"] == []
    com = pd.read_parquet(AGG / "agregados_comunes.parquet", columns=["sistema", "anio", "mes", "n_horas"])
    assert int(com["n_horas"].sum()) == 151_050_393
    oct26 = com[(com["anio"] == 2026) & (com["mes"] == 10)]
    assert set(oct26["sistema"]) <= {"BCA", "BCS"} and (oct26["n_horas"] == 1).all()


def test_renombrados_tienen_baseline_y_coordenadas():
    p = AGG / "agregados_nodos.parquet"
    if not p.exists():
        pytest.skip("sin data/aggregates")
    t = pd.read_parquet(p).set_index("nodo")
    for viejo in ("03POR-115", "03DEA-230", "03CBO-69", "03AMX-69", "03JTC-115", "03VTS-115"):
        assert t.loc[viejo, "tiene_baseline"] and str(t.loc[viejo, "coord_source"]).startswith("renombre:")
        assert "renombrado" in str(t.loc[viejo, "coord_precision"])
    assert int(t["tiene_baseline"].sum()) == 2456
