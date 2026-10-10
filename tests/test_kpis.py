"""Pruebas de pipeline/kpis.py (agent kpis).

A. Tres nodos CALCULADOS A MANO (sinteticos, de punta a punta: DuckDB -> aggregates.agregar -> kpis).
   Cada caso trae en comentarios los insumos y la cuenta a mano; los valores esperados son fracciones
   exactas escritas aqui, no salidas del codigo.
B. Tres nodos REALES verificados por un camino independiente (SQL plano con la regla de reloj escrita a
   mano para ese mes, sin aggregates.py ni clock.py). Los numeros quedaron anotados abajo y se comparan
   contra los agregados (parquet) y contra el contrato publicado (data/nodes/*.json).
C. Pruebas unitarias de cada KPI, identidades, finanzas con insumos sinteticos explicitos y la
   NEGATIVA a calcular con supuestos PENDIENTE.
D. Contrato (data/index.json, data/nodes/*.json): esquema, cobertura de nodos, coherencia JSON <-> KPIs.
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
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
DATA = ROOT / "data"
approx = pytest.approx


# ------------------------------------------------------------------------------- utilidades
def _db(tmp_path, filas):
    p = tmp_path / "pml.duckdb"
    con = duckdb.connect(str(p))
    con.execute("CREATE TABLE pml_hourly (sistema VARCHAR, fecha DATE, hora INTEGER, nodo VARCHAR, pml DOUBLE,"
                " energia DOUBLE, perdidas DOUBLE, congestion DOUBLE)")
    con.executemany("INSERT INTO pml_hourly VALUES (?, ?, ?, ?, ?, ?, ?, ?)", filas)
    con.close()
    return p


def _base(nodo, fixed: dict, tracker: dict | None = None):
    rows = [(nodo, cfg, m, h, float(d.get((m, h), 0.0)))
            for cfg, d in (("fixed", fixed), ("tracker", fixed if tracker is None else tracker))
            for m in range(1, 13) for h in range(24)]
    return pd.DataFrame(rows, columns=["nodo", "config", "mes", "hora", "y_mwh_por_mwp"])


def _dia(sistema, fecha, nodo, f):
    n = clock.horas_en_dia(sistema, dt.date.fromisoformat(fecha))
    # componentes: energia = pml - 5, perdidas = 3, congestion = 2 (pml = suma exacta)
    return [(sistema, fecha, h, nodo, float(f(h)), float(f(h)) - 5.0, 3.0, 2.0) for h in range(1, n + 1)]


def _pipeline(tmp_path, filas, base, cfg):
    con = AG.conectar(_db(tmp_path, filas), memory="1GB")
    com, cf = AG.agregar(con, base=base)
    return AG.combinar(com, cf, cfg)


def _k(ag, desde=None, hasta=None):
    return K.kpis_de_sumas(K.sumar(K.filtrar(ag, desde, hasta)))


# =============================================================================================
# A. Tres nodos calculados a mano
# =============================================================================================
def _h1_filas():
    # SIN, 2021-01-01 y 2021-01-02 (enero: sin verano -> hora estandar = hora publicada - 1).
    # PML = 50 en todas las horas salvo: dia 1 hora 12 = 100, hora 13 = 200; dia 2 hora 12 = -10, hora 13 = 300.
    esp = {("2021-01-01", 12): 100, ("2021-01-01", 13): 200, ("2021-01-02", 12): -10, ("2021-01-02", 13): 300}
    return [r for f in ("2021-01-01", "2021-01-02") for r in _dia("SIN", f, "H1", lambda h, f=f: esp.get((f, h), 50))]


def test_mano_H1_fixed(tmp_path):
    # y (enero): hora 11 -> 0.5, hora 12 -> 0.25 MWh/MWp; resto 0.
    # n = 48 h; sum PML = 44*50 + 100 + 200 - 10 + 300 = 2200 + 590 = 2790 -> B = 2790/48 = 58.125
    # P = 2*0.5 + 2*0.25 = 1.5 MWh/MWp
    # I = 0.5*100 + 0.25*200 + 0.5*(-10) + 0.25*300 = 50 + 50 - 5 + 75 = 170 MXN/MWp
    # C = 170/1.5 = 113.333...; VF = C/B = (170*48)/(1.5*2790) = 8160/4185 = 1.949820788...
    # E0 = 0.5 (dia 2, hora 11 con PML -10) -> %E0 = 0.5/1.5 = 33.33 %; horas PML<=0: 1/48 = 2.0833 %
    # Componentes: C_energia = C - 5 = 108.333..., C_perdidas = 3, C_congestion = 2, basis = 5
    # B_energia = B - 5 = 53.125; cobertura ene-2021: 48 de 744 h -> 93.548 % faltante
    ag = _pipeline(tmp_path, _h1_filas(), _base("H1", {(1, 11): 0.5, (1, 12): 0.25}), "fixed")
    k = _k(ag)
    assert k["n_horas"] == 48
    assert k["precio_base_mxn_mwh"] == approx(58.125, rel=1e-15)
    assert k["produccion_mwh_por_mwp"] == approx(1.5, rel=1e-15)
    assert k["ingreso_mxn_por_mwp"] == approx(170.0, rel=1e-15)
    assert k["precio_capturado_mxn_mwh"] == approx(340 / 3, rel=1e-15)
    assert k["vf"] == approx(8160 / 4185, rel=1e-14)
    assert k["mwh_por_mwp_en_riesgo"] == approx(0.5)
    assert k["pct_energia_pml_le0"] == approx(100 / 3, rel=1e-14)
    assert k["pct_horas_pml_le0"] == approx(100 / 48, rel=1e-14)
    assert k["precio_capturado_energia"] == approx(340 / 3 - 5, rel=1e-14)
    assert k["precio_capturado_perdidas"] == approx(3.0) and k["precio_capturado_congestion"] == approx(2.0)
    assert k["delta_capturado_vs_energia_mxn_mwh"] == approx(5.0, rel=1e-12)
    assert k["precio_base_energia"] == approx(53.125, rel=1e-14)
    assert k["residuo_componentes_mxn_mwh"] == approx(0.0, abs=1e-12)
    r = K.resumen(ag, "2021-01", "2021-01")
    assert r["cobertura"]["horas_esperadas"] == 744
    assert r["cobertura"]["pct_horas_faltantes"] == approx(100 * (1 - 48 / 744), rel=1e-14)
    d = r["descomposicion"]
    assert d["producto"] == approx(170.0, rel=1e-14)


def test_mano_H1_tracker(tmp_path):
    # tracker: y(1,11) = 0.25, y(1,12) = 0.5
    # I = 0.25*100 + 0.5*200 + 0.25*(-10) + 0.5*300 = 25 + 100 - 2.5 + 150 = 272.5; P = 1.5
    # C = 181.666...; VF = 272.5*48 / (1.5*2790) = 13080/4185 = 3.125448028...; %E0 = 0.25/1.5 = 16.67 %
    ag = _pipeline(tmp_path, _h1_filas(), _base("H1", {(1, 11): 0.5, (1, 12): 0.25},
                                                 {(1, 11): 0.25, (1, 12): 0.5}), "tracker")
    k = _k(ag)
    assert k["ingreso_mxn_por_mwp"] == approx(272.5, rel=1e-15)
    assert k["precio_capturado_mxn_mwh"] == approx(272.5 / 1.5, rel=1e-15)
    assert k["vf"] == approx(13080 / 4185, rel=1e-14)
    assert k["pct_energia_pml_le0"] == approx(100 / 6, rel=1e-14)


def test_mano_H2_bca_dia_de_25h(tmp_path):
    # BCA 2021-11-06 (verano, 24 h) y 2021-11-07 (fin de verano, 25 h). PML = 10 x hora publicada.
    # Ambas medianoches en verano: hora local estandar = hora - 2; reloj CDMX = local estandar + 2 h
    #   -> hora CDMX = hora publicada (hora 1 = 01:00 CDMX; la hora 24 = 00:00 del dia siguiente).
    # y (noviembre, reloj CDMX): hora 12 -> 1.0; resto 0. La hora CDMX 12 es la hora publicada 12.
    # n = 49; sum PML = 10*(1+..+24) + 10*(1+..+25) = 3000 + 3250 = 6250 -> B = 6250/49 = 127.5510...
    # P = 2; I = 120 + 120 = 240; C = 120; VF = 120*49/6250 = 0.9408
    # Reloj local estandar (esquema 1.0) habria tomado la hora 14 -> 140; (fecha, hora-1) -> 130.
    filas = _dia("BCA", "2021-11-06", "H2", lambda h: 10 * h) + _dia("BCA", "2021-11-07", "H2", lambda h: 10 * h)
    assert len(filas) == 49
    ag = _pipeline(tmp_path, filas, _base("H2", {(11, 12): 1.0}), "fixed")
    k = _k(ag)
    assert k["n_horas"] == 49
    assert k["precio_base_mxn_mwh"] == approx(6250 / 49, rel=1e-15)
    assert k["precio_capturado_mxn_mwh"] == approx(120.0, rel=1e-15)
    assert k["precio_capturado_mxn_mwh"] not in (approx(130.0), approx(140.0))
    assert k["vf"] == approx(0.9408, rel=1e-14)
    assert k["mwh_por_mwp_en_riesgo"] == 0 and k["pct_energia_pml_le0"] == 0


def _h3_filas():
    # SIN 2021-05-31 (PML 100 todo el dia) y 2021-06-01 (PML 200, salvo hora 14 = -50). Ambos en verano:
    # hora estandar = hora - 2; la hora 1 del 1-jun es 31-may 23:00 -> pertenece a MAYO.
    return (_dia("SIN", "2021-05-31", "H3", lambda h: 100)
            + _dia("SIN", "2021-06-01", "H3", lambda h: -50 if h == 14 else 200))


def test_mano_H3_frontera_de_mes_y_vf_negativo(tmp_path):
    # y: mayo hora 12 -> 0.4; junio hora 12 -> 0.6.
    # Mayo (25 h): 24 h a 100 (hora 1..24 del 31 = 30-may 23:00 .. 31-may 22:00) + hora 1 del 1-jun (200)
    #   sum = 2600 -> B = 104; P = 0.4 (31-may 12:00 = hora 14, PML 100); I = 40; C = 100; VF = 100/104
    # Junio (23 h): 22 h a 200 + 1 h a -50 -> sum = 4350 -> B = 189.1304...; P = 0.6; I = -30; C = -50;
    #   VF = -50*23/4350 = -0.264367816... (VF negativo: el FV captura precio negativo); E0 = 0.6 -> 100 %
    # Todo: n = 48; sum = 6950; B = 144.7916...; P = 1; I = 10 (= 40 - 30, aditivo); VF = 10*48/6950
    ag = _pipeline(tmp_path, _h3_filas(), _base("H3", {(5, 12): 0.4, (6, 12): 0.6}), "fixed")
    may, jun, tot = _k(ag, "2021-05", "2021-05"), _k(ag, "2021-06", "2021-06"), _k(ag)
    assert (may["n_horas"], jun["n_horas"], tot["n_horas"]) == (25, 23, 48)
    assert may["precio_base_mxn_mwh"] == approx(104.0) and may["vf"] == approx(100 / 104, rel=1e-14)
    assert jun["precio_base_mxn_mwh"] == approx(4350 / 23, rel=1e-14)
    assert jun["precio_capturado_mxn_mwh"] == approx(-50.0, rel=1e-14)
    assert jun["vf"] == approx(-1150 / 4350, rel=1e-14)
    assert jun["pct_energia_pml_le0"] == approx(100.0)
    assert tot["ingreso_mxn_por_mwp"] == approx(may["ingreso_mxn_por_mwp"] + jun["ingreso_mxn_por_mwp"])
    assert tot["ingreso_mxn_por_mwp"] == approx(10.0, rel=1e-14)
    assert tot["vf"] == approx(480 / 6950, rel=1e-14)
    assert tot["pct_energia_pml_le0"] == approx(60.0, rel=1e-14)


# =============================================================================================
# B. Tres nodos reales, camino independiente (SQL plano, regla de reloj escrita a mano por mes)
# =============================================================================================
# Calculado con DuckDB directo sobre pml_hourly + solar_baselines_month_hour.parquet:
#   ts = fecha + (hora - s) h, s = 1 en meses sin verano y s = 2 en meses con verano (SIN jul-2022,
#   BCA jul-2025), incluyendo el dia previo para capturar la hora 1 que cae en el mes; n = horas cuyo
#   ts cae en el mes. B = sum(pml)/n, C = sum(y*pml)/sum(y), P = sum(y), I = sum(y*pml).
REALES = {
    ("01AAN-85", "2024-01", "fixed"): dict(n=744, B=752.6891666666659, C=607.0475169497336, P=133.1112081624374, I=80804.82839318673),
    ("01AAN-85", "2024-01", "tracker"): dict(n=744, B=752.6891666666659, C=615.7050699174939, P=139.03692684615194, I=85605.74076492347),
    ("01AAN-85", "2022-07", "fixed"): dict(n=744, B=1653.5670698924723, C=1604.4650470054432, P=135.40280020094715, I=217249.06018908133),
    ("03EGM-230", "2024-01", "fixed"): dict(n=744, B=634.3168548387098, C=512.6823511756525, P=164.9275236229053, I=84555.43058456905),
    ("03EGM-230", "2024-01", "tracker"): dict(n=744, B=634.3168548387098, C=522.435800801341, P=173.7269238942907, I=90761.16460546738),
    ("07CFP-400", "2025-01", "fixed"): dict(n=744, B=1008.9193279569902, C=740.0852099053349, P=150.90795018466284, I=111684.74198880001),
    ("07CFP-400", "2025-07", "tracker"): dict(n=744, B=954.5859408602151, C=903.2194444763077, P=247.70919116906168, I=223735.75803939538),
    ("03DEA-230", "2021-01", "tracker"): dict(n=744, B=658.1863306451602, C=608.5454847193173, P=171.64760366794437, I=104455.37417501847),
}
# Reloj CDMX escrito a mano: ts = fecha + (hora - s) h con s = 1 (SIN invierno), 2 (SIN verano 2022),
# -1 (BCA invierno: -1 + 2) y 0 (BCA verano: -2 + 2). En 07CFP-400 el precio capturado es IDENTICO al del
# reloj local (perfil y precios se corren juntos); solo cambia B por las 2 horas de frontera de mes.


@pytest.fixture(scope="module")
def agg_reales():
    if not (AGG / "agregados_config.parquet").exists():
        pytest.skip("sin data/aggregates")
    nodos = sorted({k[0] for k in REALES})
    com = pd.read_parquet(AGG / "agregados_comunes.parquet", filters=[("nodo", "in", nodos)])
    cfg = pd.read_parquet(AGG / "agregados_config.parquet", filters=[("nodo", "in", nodos)])
    return com, cfg


@pytest.mark.parametrize("clave", list(REALES))
def test_reales_contra_camino_independiente(agg_reales, clave):
    nodo, mes, cfg = clave
    com, cf = agg_reales
    ag = AG.combinar(com[com["nodo"] == nodo], cf[cf["nodo"] == nodo], cfg)
    k = _k(ag, mes, mes)
    e = REALES[clave]
    assert k["n_horas"] == e["n"]
    assert k["precio_base_mxn_mwh"] == approx(e["B"], rel=1e-12)
    assert k["precio_capturado_mxn_mwh"] == approx(e["C"], rel=1e-12)
    assert k["produccion_mwh_por_mwp"] == approx(e["P"], rel=1e-12)
    assert k["ingreso_mxn_por_mwp"] == approx(e["I"], rel=1e-12)


@pytest.mark.parametrize("clave", list(REALES))
def test_reales_contra_contrato_json(clave):
    nodo, mes, cfg = clave
    p = DATA / "nodes" / f"{nodo}.json"
    if not p.exists():
        pytest.skip("sin data/nodes")
    d = json.loads(p.read_text())
    k = K.kpis_desde_doc(d, cfg, mes, mes)                  # esquema 1.1: reconstruccion del navegador
    e = REALES[clave]
    assert k["n_horas"] == e["n"]
    assert k["precio_base_mxn_mwh"] == approx(e["B"], rel=1e-12)       # centavos enteros: exacto
    assert k["precio_capturado_mxn_mwh"] == approx(e["C"], rel=1e-12)  # perfil y sin redondeo
    assert k["ingreso_mxn_por_mwp"] == approx(e["I"], rel=1e-12)


# =============================================================================================
# C. Unitarias
# =============================================================================================
def test_kpis_de_sumas_vacio_y_base_no_positiva():
    k = K.kpis_de_sumas({"n_horas": 0})
    assert k["precio_base_mxn_mwh"] is None and k["vf"] is None and k["precio_capturado_mxn_mwh"] is None
    s = {"n_horas": 2, "sum_pml_cent": -1000, "sum_y": 1.0, "sum_y_pml": 5.0, "sum_y_le0": 0.0, "n_pml_le0": 1,
         "sum_energia_cent": 0, "sum_perdidas_cent": 0, "sum_congestion_cent": 0, "sum_y_energia": 0.0,
         "sum_y_perdidas": 0.0, "sum_y_congestion": 0.0}
    k = K.kpis_de_sumas(s)
    assert k["precio_base_mxn_mwh"] == -5.0 and k["vf"] is None      # B <= 0 -> VF no definido
    assert K.descomposicion(k) is None
    s["sum_y"] = 0.0
    assert K.kpis_de_sumas(s)["precio_capturado_mxn_mwh"] is None    # sin produccion (p. ej. de noche)


def test_identidad_ingreso_produccion_base_vf():
    rng = np.random.default_rng(1)
    for _ in range(200):
        n = int(rng.integers(1, 10_000))
        s = {"n_horas": n, "sum_pml_cent": int(rng.integers(1, 10**9)), "sum_y": float(rng.uniform(0.1, 3000)),
             "sum_y_pml": float(rng.uniform(-1e5, 5e6))}
        k = K.kpis_de_sumas(s)
        d = K.descomposicion(k)
        assert d["producto"] == approx(s["sum_y_pml"], rel=1e-13, abs=1e-9)


def test_filtrar_y_horas_esperadas():
    df = pd.DataFrame({"anio": [2023, 2023, 2024, 2024], "mes": [11, 12, 1, 2], "hora": [0] * 4, "n_horas": [1, 2, 3, 4]})
    assert K.filtrar(df, "2023-12", "2024-01")["n_horas"].tolist() == [2, 3]
    assert K.filtrar(df, None, "2023-12")["n_horas"].sum() == 3
    assert K.horas_esperadas_mes(2024, 2) == 29 * 24 and K.horas_esperadas_mes(2023, 2) == 28 * 24


def _anual(filas):
    return pd.DataFrame(filas, columns=["anio", "completo", "vf", "ingreso_mxn_por_mwp", "produccion_mwh_por_mwp",
                                        "precio_base_mxn_mwh"])


def test_peor_mediana_mejor_solo_anos_completos_mediana_baja():
    # ingresos 2020..2025 = 5,3,4,6,1,2 (completos) y 2026 = 0.5 (incompleto, se ignora)
    # orden ascendente: 2024(1), 2025(2), 2021(3), 2022(4), 2020(5), 2023(6); M = 6 -> mediana baja = 3er = 2021
    ing = {2020: 5, 2021: 3, 2022: 4, 2023: 6, 2024: 1, 2025: 2, 2026: 0.5}
    a = _anual([(y, y != 2026, 0.9, v, v / (0.9 * 2.0), 2.0) for y, v in ing.items()])
    r = K.peor_mediana_mejor(a)
    assert r["m"] == 6 and r["texto"] == "6 anos completos"
    assert (r["peor"]["anio"], r["mediana"]["anio"], r["mejor"]["anio"]) == (2024, 2021, 2023)
    for c in ("peor", "mediana", "mejor"):
        assert r[c]["producto"] == approx(r[c]["ingreso_mxn_por_mwp"], rel=1e-14)
    # impar: M = 3 -> mediana = la del medio
    r3 = K.peor_mediana_mejor(a[a["anio"].isin([2020, 2021, 2022])])
    assert r3["mediana"]["anio"] == 2022 and r3["texto"] == "3 anos completos"
    r0 = K.peor_mediana_mejor(a[a["anio"] == 2026])
    assert r0["m"] == 0 and r0["peor"] is None and r0["mediana"] is None


def test_tendencia_vf():
    a = _anual([(y, True, 0.9 - 0.02 * (y - 2020), 1, 1, 1) for y in range(2020, 2026)])
    t = K.vf_tendencia(a)
    assert t["pendiente_vf_por_anio"] == approx(-0.02, rel=1e-12) and t["m"] == 6
    assert K.vf_tendencia(a.head(2))["pendiente_vf_por_anio"] is None          # < 3 anos
    a.loc[a["anio"] == 2025, "completo"] = False
    assert K.vf_tendencia(a)["m"] == 5


def test_vf_minimo_mensual_excluye_meses_incompletos():
    m = pd.DataFrame({"anio": [2024] * 3, "mes": [1, 2, 3], "completo": [True, False, True], "vf": [0.8, 0.1, 0.7]})
    assert K.vf_minimo_mensual(m) == {"mes": "2024-03", "vf": 0.7, "m_meses": 2}
    assert K.vf_minimo_mensual(m[m["mes"] == 2]) is None


def test_serie_anual_completo_bisiesto():
    cols = {c: 0 for c in K.CAMPOS}
    df = pd.DataFrame([{**cols, "anio": 2024, "mes": 1, "hora": 0, "n_horas": 8784, "sum_pml_cent": 100 * 8784,
                        "sum_y": 1.0, "sum_y_pml": 1.0},
                       {**cols, "anio": 2025, "mes": 1, "hora": 0, "n_horas": 8759, "sum_pml_cent": 100 * 8759,
                        "sum_y": 1.0, "sum_y_pml": 1.0}])
    a = K.serie_anual(df).set_index("anio")
    assert bool(a.loc[2024, "completo"]) and not bool(a.loc[2025, "completo"])
    assert a.loc[2025, "cobertura_pct"] == approx(100 * 8759 / 8760)


def test_resumen_ano_fuera_de_rango_no_es_completo(tmp_path):
    # un ano con todas sus horas pero el rango solo cubre parte -> no cuenta como completo
    cols = {c: 0 for c in K.CAMPOS}
    rows = [{**cols, "anio": 2024, "mes": m, "hora": 0, "n_horas": pd.Timestamp(2024, m, 1).days_in_month * 24,
             "sum_pml_cent": 1000, "sum_y": 1.0, "sum_y_pml": 5.0} for m in range(1, 13)]
    df = pd.DataFrame(rows)
    assert K.resumen(df, "2024-01", "2024-12")["ingreso_anual"]["m"] == 1
    assert K.resumen(df, "2024-02", "2024-12")["ingreso_anual"]["m"] == 0


# ---------------------------------------------------------------- finanzas (insumos sinteticos)
def test_van_tir_lcoe_a_mano():
    assert K.van(0.10, [-100, 110]) == approx(0.0, abs=1e-12)
    assert K.tir([-100, 110]) == approx(0.10, abs=1e-10)
    # -100 + 60x + 60x^2 = 0, x = 1/(1+r) -> x = (-1 + sqrt(1 + 20/3))/2 -> r = 1/x - 1
    x = (-1 + math.sqrt(1 + 20 / 3)) / 2
    assert K.tir([-100, 60, 60]) == approx(1 / x - 1, abs=1e-10)
    assert K.tir([100, 10]) is None                     # sin cambio de signo
    assert K.tir([-100, 230, -132]) is None             # dos cambios de signo: TIR no unica
    assert K.flujos(100, 1000, 10, 3, 0.5) == [-1000, 90, 40, 15]
    # LCOE: (1000 + 10/1.1 + 10/1.21) / (100/1.1 + 100/1.21) = (1210 + 11 + 10)/(110 + 100) = 1231/210
    assert K.lcoe(1000, 10, 100, 2, 0.10, 0.0) == approx(1231 / 210, rel=1e-14)
    # break-even: ingreso = LCOE x energia -> VAN = 0 (con degradacion)
    lc = K.lcoe(5000, 40, 1800, 25, 0.08, 0.005)
    assert K.van(0.08, K.flujos(lc * 1800, 5000, 40, 25, 0.005)) == approx(0.0, abs=1e-6)


def _sup_ok():
    return {"estado": "confirmado",
            "financiero": {"tasa_descuento_real_anual": 0.08, "vida_util_anios": 25, "degradacion_anual": 0.005,
                           "capex": {"valor": 0.8, "unidad": "USD/Wp"}, "opex": {"valor": 12, "unidad": "USD/kWp-ano"},
                           "tipo_cambio_mxn_por_usd": 20.0},
            "semaforo": {"metrica": "tir_menos_tasa", "umbral_viable": 0.02, "umbral_no_viable": 0.0},
            "escenarios": {"crisis": {"descripcion": "x", "factor_precio_capturado": 0.5, "factor_produccion": 1.0,
                                      "factor_capex": 1.0, "factor_opex": 1.0}}}


def test_financiero_con_insumos_sinteticos():
    f = K.financiero(_sup_ok(), ingreso_anio1=2_000_000.0, produccion_anio1=2000.0, vf=0.9)
    assert f["capex_mxn_por_mwp"] == approx(0.8 * 1e6 * 20)          # 16,000,000 MXN/MWp
    assert f["opex_mxn_por_mwp_anio"] == approx(12 * 1e3 * 20)       # 240,000 MXN/MWp-ano
    assert len(f["flujos_mxn_por_mwp"]) == 26
    assert K.van(f["tir"], f["flujos_mxn_por_mwp"]) == approx(0.0, abs=1e-3)
    assert f["break_even_ppa_mxn_mwh"] == f["lcoe_mxn_mwh"]
    assert f["break_even_pml_base_mxn_mwh"] == approx(f["lcoe_mxn_mwh"] / 0.9)
    assert K.a_usd(_sup_ok(), 2000.0) == 100.0
    assert K.veredicto(_sup_ok(), 0.03)["clase"] == "viable"
    assert K.veredicto(_sup_ok(), 0.01)["clase"] == "neutral"
    assert K.veredicto(_sup_ok(), -0.01)["clase"] == "no_viable"
    e = K.escenario(_sup_ok(), "crisis", 2_000_000.0, 2000.0, 0.9)
    assert e["flujos_mxn_por_mwp"][1] == approx(1_000_000.0 - 240_000.0)
    assert K.n_de_m([0.05, 0.10, None, 0.07], 0.07) == {"n": 2, "m": 3, "texto": "2 de 3 anos"}
    t = K.tir_n_de_m(_sup_ok(), [{"ingreso_mxn_por_mwp": 2e6, "produccion_mwh_por_mwp": 2000, "vf": 0.9},
                                 {"ingreso_mxn_por_mwp": 1e6, "produccion_mwh_por_mwp": 2000, "vf": 0.9}])
    assert t["m"] == 2 and t["n"] == 1 and t["texto"] == "1 de 2 anos"


# ---------------------------------------------------------------- PENDIENTE: negativa a calcular
def test_plantilla_supuestos_todo_pendiente():
    sup = K.cargar_supuestos()
    assert sup, "config/supuestos.yaml debe existir"
    pend = K.pendientes(sup)
    for c in ("estado", "financiero.tasa_descuento_real_anual", "financiero.capex.valor", "financiero.opex.valor",
              "financiero.tipo_cambio_mxn_por_usd", "financiero.degradacion_anual", "financiero.vida_util_anios",
              "semaforo.umbral_viable", "escenarios.base.factor_precio_capturado", "escenarios.crisis.descripcion"):
        assert c in pend
    # ninguna hoja con valor definido: todo es PENDIENTE
    def hojas(d):
        for v in d.values():
            yield from (hojas(v) if isinstance(v, dict) else [v])
    assert all(K.es_pendiente(v) for v in hojas(sup))


@pytest.mark.parametrize("llamada", [
    lambda s: K.financiero(s, 1e6, 2000.0, 0.9),
    lambda s: K.a_usd(s, 100.0),
    lambda s: K.veredicto(s, 0.1),
    lambda s: K.escenario(s, "base", 1e6, 2000.0, 0.9),
    lambda s: K.tir_n_de_m(s, [{"ingreso_mxn_por_mwp": 1e6, "produccion_mwh_por_mwp": 2000.0, "vf": 0.9}]),
])
def test_rechaza_con_supuestos_pendientes(llamada):
    with pytest.raises(K.SupuestoPendiente):
        llamada(K.cargar_supuestos())
    with pytest.raises(K.SupuestoPendiente):
        llamada({})                                     # archivo ausente = todo pendiente
    s = _sup_ok()
    s["estado"] = "PENDIENTE"                           # valores llenos pero sin confirmar -> tambien rechaza
    s["escenarios"]["base"] = s["escenarios"]["crisis"]
    with pytest.raises(K.SupuestoPendiente):
        llamada(s)


def test_bloque_financiero_pendiente_devuelve_nulos():
    res = {"ingreso_anual": {"mediana": {"ingreso_mxn_por_mwp": 1e6, "produccion_mwh_por_mwp": 2000.0, "vf": 0.9}}}
    b = K.bloque_financiero(K.cargar_supuestos(), res)
    assert b["estado"] == "PENDIENTE"
    assert b["tir"] is None and b["van_mxn_por_mwp"] is None and b["lcoe_mxn_mwh"] is None and b["veredicto"] is None
    assert "financiero.capex.valor" in b["pendientes"] and "semaforo.umbral_viable" in b["pendientes"]
    ok = K.bloque_financiero(_sup_ok(), res)
    assert ok["estado"] == "calculado" and ok["tir"] is not None


def test_parser_yaml_simple():
    t = "a: 1\nb:\n  c: PENDIENTE  # comentario\n  d: '#no es comentario'\n  e:\n    f: 0.5\ng: true\n"
    assert K.parse_yaml_simple(t) == {"a": 1, "b": {"c": "PENDIENTE", "d": "#no es comentario", "e": {"f": 0.5}}, "g": True}
    with pytest.raises(ValueError):
        K.parse_yaml_simple("a:\n  - 1\n")
    with pytest.raises(ValueError):
        K.parse_yaml_simple("a: 1\na: 2\n")
    # la plantilla real se lee igual con el parser minimo
    assert K.parse_yaml_simple((ROOT / "config" / "supuestos.yaml").read_text())["financiero"]["capex"]["unidad"] == "PENDIENTE"


# =============================================================================================
# D. Contrato publicado
# =============================================================================================
@pytest.fixture(scope="module")
def indice():
    p = DATA / "index.json"
    if not p.exists():
        pytest.skip("sin data/index.json")
    return json.loads(p.read_text())


def test_index_esquema_y_cobertura(indice):
    assert indice["schema_version"] == K.SCHEMA_VERSION
    dt.datetime.fromisoformat(indice["generated_at"])
    assert indice["rotulo"] == "precio capturado MDA (referencia)"
    nodos = indice["nodos"]
    assert indice["conteo"]["nodos"] == len(nodos) == len({n["id"] for n in nodos})
    q = pd.read_parquet(DATA / "quality" / "nodos_calidad.parquet")
    assert set(q["nodo"].astype(str)) == {n["id"] for n in nodos}            # ningun nodo omitido
    for n in nodos:
        for c in ("id", "nombre", "sistema", "region", "lat", "lon", "meses_de_datos", "confianza"):
            assert c in n
        if n["ficha"]:
            assert (DATA / n["ficha"]).exists() and n["kpis"] is not None
        else:
            assert n["motivo_sin_ficha"] and n["kpis"] is None                # sin omision silenciosa
    b = pd.read_parquet(DATA / "baselines" / "solar_baselines.parquet")
    con_base = set(b.loc[b["loc_type"] == "node", "loc_id"].astype(str))
    assert {n["id"] for n in nodos if n["ficha"]} == con_base
    assert indice["conteo"]["con_ficha"] == 2456
    assert sum(1 for n in nodos if n["ficha"] and n["sistema"] == "SIN") == 2455
    assert indice["supuestos"]["estado"] == "PENDIENTE"


def test_nodos_json_coherentes(indice):
    ids = [n["id"] for n in indice["nodos"] if n["ficha"]]
    rng = np.random.default_rng(7)
    fijos = {"01AAN-85", "03EGM-230", "07CFP-400", "03DEA-230", "03DEC-230"}
    muestra = sorted(set(rng.choice(ids, size=min(25, len(ids)), replace=False)) | (fijos & set(ids)))
    com = pd.read_parquet(AGG / "agregados_comunes.parquet", filters=[("nodo", "in", muestra)])
    cfgp = pd.read_parquet(AGG / "agregados_config.parquet", filters=[("nodo", "in", muestra)])
    meta = json.loads((AGG / "agregados_meta.json").read_text())
    gz = []
    for nid in muestra:
        raw = (DATA / "nodes" / f"{nid}.json").read_bytes()
        gz.append(len(gzip.compress(raw, 9)))
        d = json.loads(raw)
        assert d["schema_version"] == "1.2.0" == K.SCHEMA_VERSION and d["id"] == nid
        dt.datetime.fromisoformat(d["generated_at"])
        a = d["agregados"]
        assert a["reloj"]["referencia"].startswith("CDMX estandar UTC-6 fijo")
        L = 24 * len(a["meses"])
        for c in K.COMUNES_JSON:
            assert len(a[c]) == L
        for c in AG.PONDERADAS + ["sum_energia_cent"]:   # esquema 1.1: no se publican, se reconstruyen
            assert c not in a
        c_n = com[com["nodo"] == nid]
        for cfg in AG.CONFIGS:
            assert len(a["perfil_y"][cfg]) == 288
            k = d["kpis"][cfg]
            assert k["rotulo"] == "precio capturado MDA (referencia)"
            comb = AG.combinar(c_n, cfgp[cfgp["nodo"] == nid], cfg)
            ref = K.resumen(comb, *meta["periodo_meses"], sistema=d["sistema"], meta=meta)
            j = K.kpis_desde_doc(d, cfg, *meta["periodo_meses"])
            assert j["n_horas"] == ref["n_horas"]
            for c in ("precio_base_mxn_mwh", "precio_capturado_mxn_mwh", "vf", "pct_energia_pml_le0",
                      "ingreso_mxn_por_mwp", "precio_capturado_congestion"):
                if ref[c] is None:
                    continue
                assert j[c] == approx(ref[c], rel=1e-12, abs=1e-12), (nid, cfg, c)
            if k["descomposicion"]:
                assert k["descomposicion"]["producto"] == approx(k["ingreso_mxn_por_mwp"], rel=1e-9)
            f = k["financiero"]
            assert f["estado"] == "PENDIENTE" and f["tir"] is None and f["veredicto"] is None
            assert f["break_even_ppa_mxn_mwh"] is None and f["break_even_pml_base_mxn_mwh"] is None
    assert max(gz) < 45 * 1024 and float(np.median(gz)) < 36 * 1024     # objetivo ~30 KB gz


def test_esquema_11_reconstruccion_exacta(indice):
    """Lo que el navegador reconstruye (perfil y x sumas comunes) = sumas completas del parquet:
    enteros (horas, centavos, horas PML<=0) IDENTICOS; y identico bit a bit; ponderadas rel <= 1e-12."""
    nodos = [n for n in ("01AAN-85", "07CFP-400", "03DEA-230", "03EGM-230") if (DATA / "nodes" / f"{n}.json").exists()]
    if not nodos:
        pytest.skip("sin fichas")
    com = pd.read_parquet(AGG / "agregados_comunes.parquet", filters=[("nodo", "in", nodos)])
    cfgp = pd.read_parquet(AGG / "agregados_config.parquet", filters=[("nodo", "in", nodos)])
    for nid in nodos:
        d = json.loads((DATA / "nodes" / f"{nid}.json").read_text())
        a = d["agregados"]
        grid = pd.DataFrame([(int(m[:4]), int(m[5:]), h) for m in a["meses"] for h in range(24)],
                            columns=["anio", "mes", "hora"])
        g = grid.merge(com[com["nodo"] == nid], on=["anio", "mes", "hora"], how="left")
        for c in AG.COMUNES:
            got = K.energia_cent(d) if c == "sum_energia_cent" else a[c]
            assert got == [int(x) for x in g[c].fillna(0)], (nid, c)              # enteros identicos
        for cfg in AG.CONFIGS:
            gc = grid.merge(cfgp[(cfgp["nodo"] == nid) & (cfgp["config"] == cfg)], on=["anio", "mes", "hora"], how="left")
            w = K.reconstruir(d, cfg)
            yj = [a["perfil_y"][cfg][(m - 1) * 24 + h] for m, h in zip(grid["mes"], grid["hora"])]
            ok = gc["y_mwh_por_mwp"].notna()
            assert all(yj[i] == float(v) for i, v in zip(np.where(ok)[0], gc.loc[ok, "y_mwh_por_mwp"]))  # bit a bit
            for c in AG.PONDERADAS:
                ref = gc[c].fillna(0.0).to_numpy()
                got = np.asarray(w[c])
                assert np.all(np.abs(got - ref) <= 1e-12 * np.maximum(np.abs(ref), 1.0)), (nid, cfg, c)


def test_sin_cifras_usd_ni_veredicto(indice):
    d = json.loads((DATA / "nodes" / "01AAN-85.json").read_text())

    def claves(o, pref=""):
        if isinstance(o, dict):
            for k, v in o.items():
                yield pref + k, v
                yield from claves(v, pref + k + ".")
    for k, v in claves(d):
        if "usd" in k.lower() or "veredicto" in k.lower() or k.lower().endswith("semaforo"):
            assert v is None, k


def test_index_reloj_config_defecto_renombres(indice):
    assert indice["config_defecto"] == K.CONFIG_DEFECTO == "tracker"
    r = indice["reloj"]["sistemas"]
    assert (r["SIN"]["desfase_a_cdmx_horas"], r["BCS"]["desfase_a_cdmx_horas"], r["BCA"]["desfase_a_cdmx_horas"]) == (0, 1, 2)
    assert (r["SIN"]["offset_estandar_utc_horas"], r["BCS"]["offset_estandar_utc_horas"], r["BCA"]["offset_estandar_utc_horas"]) == (-6, -7, -8)
    for s_ in ("SIN", "BCA", "BCS"):
        assert r[s_]["nota_es"] and r[s_]["nota_en"]
    assert indice["periodo_datos"]["meses_borde"]["BCA"] == ["2020-01", "2026-10"]
    assert indice["umbral_anio_completo"] == K.UMBRAL_ANIO_COMPLETO == 1.0
    by = {n["id"]: n for n in indice["nodos"]}
    pares = {"03POR-115": "03PCL-115", "03DEA-230": "03DEC-230", "03CBO-69": "03JAG-69",
             "03AMX-69": "03ALX-69", "03JTC-115": "03JTD-115", "03VTS-115": "03VKA-115"}
    for viejo, nuevo in pares.items():
        v = by[viejo]
        assert v["ficha"] and v["coord_fuente"] == f"renombre:{nuevo}" and v["renombrado_a"] == nuevo
        assert "renombrado" in v["coord_precision"]
        assert by[nuevo]["renombre_de"] == viejo
    bca = json.loads((DATA / "nodes" / "07CFP-400.json").read_text())
    assert bca["nota_reloj"] is True and bca["agregados"]["reloj"]["desfase_a_cdmx_horas"] == 2
    assert abs(bca["mediodia_solar_cdmx"] - bca["centroide_energia_cdmx"]["tracker"]) < 0.25
    sin = json.loads((DATA / "nodes" / "01AAN-85.json").read_text())
    assert sin["nota_reloj"] is False and abs(sin["mediodia_solar_cdmx"] - (12 + 98.942901 / 15 - 6)) < 1e-3


# =============================================================================================
# E. Reloj, bordes, umbral de ano completo, pesos reales (sinteticos)
# =============================================================================================
def _celdas(meses_n: dict, pml_cent_por_hora=10000, y=0.5):
    """Una celda por (anio, mes) en la hora 12 con n horas; sumas coherentes."""
    cols = {c: 0 for c in K.CAMPOS}
    rows = []
    for (a, m), n in meses_n.items():
        rows.append({**cols, "anio": a, "mes": m, "hora": 12, "n_horas": n, "sum_pml_cent": pml_cent_por_hora * n,
                     "sum_energia_cent": pml_cent_por_hora * n, "sum_y": y * n,
                     "sum_y_pml": y * n * pml_cent_por_hora / 100, "sum_y_energia": y * n * pml_cent_por_hora / 100})
    return pd.DataFrame(rows)


def test_umbral_100_y_sin_anualizar():
    # 2021 con 95.89 % de las horas: con el umbral vigente (100 %) NO es completo; su ingreso es la suma
    # de las horas disponibles (no se anualiza) y no entra en peor/mediana/mejor.
    assert K.UMBRAL_ANIO_COMPLETO == 1.0 and K.UMBRAL_MES_COMPLETO == 1.0
    n21 = int(round(0.9589 * 8760))
    df = _celdas({(2021, 1): n21, (2022, 1): 8760})
    a = K.serie_anual(df).set_index("anio")
    assert not bool(a.loc[2021, "completo"]) and bool(a.loc[2022, "completo"])
    assert a.loc[2021, "ingreso_mxn_por_mwp"] == approx(0.5 * n21 * 100)            # suma, sin x 8760/n
    assert K.peor_mediana_mejor(a.reset_index())["anios_completos"] == [2022]


def test_meses_borde_nunca_completos():
    meta = {"fecha_ini_civil": "2020-01-01", "fecha_fin_civil": "2026-09-30",
            "sistemas": {"BCA": {"meses_borde": ["2020-01", "2026-10"]}}}
    cols = {c: 0 for c in K.CAMPOS}
    rows = [{**cols, "anio": 2020, "mes": m, "hora": 0, "n_horas": pd.Timestamp(2020, m, 1).days_in_month * 24,
             "sum_pml_cent": 100, "sum_y": 1.0, "sum_y_pml": 1.0} for m in range(1, 13)]
    df = pd.DataFrame(rows)                       # aunque traiga todas las horas, ene-2020 de BCA es borde
    r = K.resumen(df, "2020-01", "2020-12", sistema="BCA", meta=meta)
    assert r["ingreso_anual"]["m"] == 0 and "2020-01" in r["cobertura"]["meses_borde_en_periodo"]
    assert r["cobertura"]["horas_esperadas"] == 8784 - 2
    m = K.serie_mensual(df, {"2020-01"}).set_index("mes")
    assert not bool(m.loc[1, "completo"]) and bool(m.loc[2, "completo"])


def test_bloque_reloj_y_mediodia():
    b = K.bloque_reloj()
    assert b["referencia"] == "CDMX estandar UTC-6 fijo (hora del SIN)" and b["utc_offset_referencia_horas"] == -6
    assert {s: v["desfase_a_cdmx_horas"] for s, v in b["sistemas"].items()} == {"SIN": 0, "BCA": 2, "BCS": 1}
    assert "+2 h" in b["sistemas"]["BCA"]["nota_es"] and "+2 h" in b["sistemas"]["BCA"]["nota_en"]
    assert K.bloque_reloj("BCS")["desfase_a_cdmx_horas"] == 1
    # longitud -90: mediodia solar medio a las 12:00 CDMX; -105: 13:00
    assert K.mediodia_solar_cdmx(-90.0) == approx(12.0) and K.mediodia_solar_cdmx(-105.0) == approx(13.0)
    perfil = [0.0] * 288
    for m in range(12):
        perfil[m * 24 + 11] = perfil[m * 24 + 12] = 1.0
    assert K.centroide_energia_cdmx(perfil) == approx(12.0)


def test_pesos_reales_inpc_sintetico(tmp_path):
    # INPC: ene-2024 = 100, feb-2024 = 125 -> base = feb-2024; deflactor ene = 1.25, feb = 1.0
    p = tmp_path / "inpc.csv"
    p.write_text("mes,inpc\n2024-01,100\n2024-02,125\n")
    inpc = K.cargar_inpc(p)
    assert inpc["base"] == "2024-02" and K.deflactor(inpc, "2024-01") == 1.25 and K.deflactor(inpc, "2024-03") is None
    # ene: 10 h a 100 MXN/MWh (10000 cent), y = 0.5; feb: 10 h a 200 MXN/MWh, y = 0.5
    df = pd.concat([_celdas({(2024, 1): 10}, 10000), _celdas({(2024, 2): 10}, 20000)], ignore_index=True)
    dr, falt = K.a_reales(df, inpc)
    assert falt == []
    k = K.kpis_de_sumas(K.sumar(dr))
    # base real = (10*100*1.25 + 10*200)/20 = 162.5; capturado real = (5*125 + 5*200)/10 = 162.5; ingreso = 1625
    assert k["precio_base_mxn_mwh"] == approx(162.5) and k["precio_capturado_mxn_mwh"] == approx(162.5)
    assert k["ingreso_mxn_por_mwp"] == approx(1625.0)
    assert int(df["sum_pml_cent"].sum()) == 300000 and pd.api.types.is_integer_dtype(df["sum_pml_cent"])  # nominal intacto
    r = K.bloque_reales(df, "2024-01", "2024-02", inpc)
    assert r["estado"] == "calculado" and r["base_mes"] == "2024-02" and r["precio_base_mxn_mwh"] == approx(162.5)
    # mes con datos sin INPC -> no se extrapola
    r2 = K.bloque_reales(pd.concat([df, _celdas({(2024, 3): 5})], ignore_index=True), "2024-01", "2024-03", inpc)
    assert r2["estado"] == "no_disponible" and "2024-03" in r2["motivo"]
    assert K.bloque_reales(df, "2024-01", "2024-02", None)["estado"] == "no_disponible"
    assert K.cargar_inpc(tmp_path / "no_existe.csv") is None


# =============================================================================================
# F. Esquema 1.2 (reales en index) y analisis del deck (data/analysis/)
# =============================================================================================
AN = DATA / "analysis"


def test_index_12_reales(indice):
    assert indice["schema_version"] == "1.2.0" == K.SCHEMA_VERSION
    assert indice["pesos_reales"]["base_mes"] == "2026-09"
    n = next(x for x in indice["nodos"] if x["id"] == "01AAN-85")
    d = json.loads((DATA / "nodes" / "01AAN-85.json").read_text())
    for c in AG.CONFIGS:
        r = d["kpis"][c]["reales"]
        assert r["estado"] == "calculado"
        assert n["kpis"][c]["precio_capturado_real_mxn_mwh"] == approx(r["precio_capturado_mxn_mwh"], abs=1e-4)
        assert n["kpis"][c]["precio_base_real_mxn_mwh"] == approx(r["precio_base_mxn_mwh"], abs=1e-4)
    con = [x for x in indice["nodos"] if x["ficha"]]
    assert all(x["kpis"]["tracker"]["precio_capturado_real_mxn_mwh"] is not None for x in con)


@pytest.fixture(scope="module")
def analisis_doc():
    if not (AN / "analysis.json").exists():
        pytest.skip("sin data/analysis")
    return json.loads((AN / "analysis.json").read_text()), json.loads((AN / "analysis_nodos.json").read_text())


def test_analisis_identidades_por_nodo(analisis_doc):
    _, nod = analisis_doc
    for v in K.VENTANAS_12M:
        w = nod["ventanas"][v]
        for i in range(len(nod["ids"])):
            if w["p_cap"][i] is None:
                continue
            yf, pc, pm = w["y_f"][i], w["p_cap"][i], w["pml_medio"][i]
            assert w["ingreso"][i] == approx(yf * pc, rel=1e-6, abs=0.05)          # R = Y_f x P_cap
            assert w["ingreso_atajo"][i] == approx(yf * pm, rel=1e-6, abs=0.05)    # R_short = Y_f x PML medio
            assert w["vf"][i] == approx(pc / pm, rel=1e-4, abs=1e-4)                # VF = P_cap / PML medio


def test_analisis_area_y_escenario(analisis_doc):
    doc, _ = analisis_doc
    e = doc["escenario_deck"]
    assert e["lcoe_mxn_mwh"] == 714.0 and e["tipo_cambio_mxn_por_usd"] == 17.84 and "NO de config/supuestos.yaml" in e["advertencia"]
    assert K.pendientes(K.cargar_supuestos())                                   # supuestos del proyecto intactos
    for v in K.VENTANAS_12M:
        n = doc["ventanas"][v]["por_config"]["tracker"]["nacional"]
        assert n["vf"] == approx(n["p_cap"] / n["pml_medio"], rel=1e-5)
        assert n["sobreestimacion_atajo_pct"] == approx(100 * (n["ingreso_atajo_mxn_por_mwp"] / n["ingreso_mxn_por_mwp"] - 1), rel=1e-5)
        assert n["vf_req_nominal"] == approx(714.0 / n["pml_medio"], rel=1e-5)
        assert n["vf_req_real"] == approx(714.0 / n["pml_medio_real"], rel=1e-5)
        p = doc["ventanas"][v]["por_config"]["tracker"]["pyg_deck"]
        assert p["costo_mxn_por_mwp"] == approx(p["energia_mwh_por_mwp"] * 714.0, rel=1e-6)
        assert p["slide"] == 9 and p["margen_mxn_por_mwp_real"] is not None and p["margen_mxn_por_mwp_nominal"] is not None
    for f in doc["comparacion_deck"]:
        assert {"cifra", "deck", "nuestra", "reproducido", "motivo_probable"} <= set(f)
    flags = [i for i in doc["insights"] if i.get("bandera")]
    assert len(flags) == sum(1 for f in doc["comparacion_deck"] if f["reproducido"] is False)
    assert set(doc["mapa_diapositivas"]) == {str(i) for i in range(1, 11)} | {"supuestos", "A1-A5"}
    # numeracion del usuario: cada insight y cada comparacion llevan `slide`; 8-10 tienen insights
    assert all("slide" in i for i in doc["insights"]) and all("slide" in f for f in doc["comparacion_deck"])
    assert {8, 9, 10} <= {i["slide"] for i in doc["insights"]}
    assert doc["tabla_vf_regiones"]["slide"] == 7 and doc["escenario_deck"]["slide"] == [8, 9]
    regs = {r["region"] for r in doc["tabla_vf_regiones"]["regiones"]}
    assert regs == {"CENTRAL", "ORIENTAL", "OCCIDENTAL", "NOROESTE", "NORTE", "NORESTE", "PENINSULAR"}
    pen = next(r for r in doc["tabla_vf_regiones"]["regiones"] if r["region"] == "PENINSULAR")
    assert pen["deck_impreso"]["vf_2024_25"] == 0.95
    assert pen["cambio"]["delta_vf_ago_jun"] == approx(pen["2025_26_ago_jun"]["vf"] - pen["2024_25_ago_jun"]["vf"], abs=1e-5)
    ex = doc["ventanas"]["deck_2025_26"]["por_config"]["tracker"]["explorador"]
    assert ex["slide"] == 4 and ex["perfil_horario_estados"] and ex["vf_mensual_regiones"]
    for v, x in doc["cobertura_lcoe_real_vs_nominal"]["ventanas"].items():
        assert x["delta_pp"] == approx(x["pct_real"] - x["pct_nominal"], abs=1e-5)
        n = doc["ventanas"][v]["por_config"]["tracker"]["nacional"]
        assert x["n_real"] == n["n_nodos_cubren_lcoe_real"] and x["n_nominal"] == n["n_nodos_cubren_lcoe_nominal"]


def test_analisis_perfil_nacional_se_recompone_desde_fichas(analisis_doc):
    """El perfil horario nacional (promedio entre nodos del promedio horario de cada nodo) se reconstruye
    con las fichas publicadas (esquema 1.x) sobre los nodos del universo de la ventana."""
    doc, nod = analisis_doc
    v = "deck_2025_26"
    de, ha = K.VENTANAS_ANALISIS[v]
    ids = [i for i, x in zip(nod["ids"], nod["ventanas"][v]["p_cap"]) if x is not None]
    pml = np.zeros(24)
    yy = np.zeros(24)
    for nid in ids:
        d = json.loads((DATA / "nodes" / f"{nid}.json").read_text())
        a = d["agregados"]
        n_h, c_h, y_h = np.zeros(24), np.zeros(24), np.zeros(24)
        for i, mes in enumerate(a["meses"]):
            if de <= mes <= ha:
                m = int(mes[5:7])
                for h in range(24):
                    k = i * 24 + h
                    n_h[h] += a["n_horas"][k]
                    c_h[h] += a["sum_pml_cent"][k]
                    y_h[h] += a["perfil_y"]["tracker"][(m - 1) * 24 + h] * a["n_horas"][k]
        pml += c_h / 100 / n_h
        yy += y_h / n_h
    ref = doc["ventanas"][v]["por_config"]["tracker"]["perfil_horario_nacional"]
    assert np.allclose(pml / len(ids), ref["pml_h"], rtol=0, atol=2e-6)
    assert np.allclose(yy / len(ids), ref["y_h_mwh_por_mwp"], rtol=0, atol=2e-6)


def test_analisis_determinista(tmp_path):
    if not (AGG / "agregados_config.parquet").exists():
        pytest.skip("sin data/aggregates")
    sub = ["01AAN-85", "02AAA-115", "04MPP-115", "05CJM-115", "08AKD-115", "06AAT-115"]
    a = K.analisis(out_dir=tmp_path / "a", nodos_lim=sub, con_db=False)
    b = K.analisis(out_dir=tmp_path / "b", nodos_lim=sub, con_db=False)
    a.pop("generated_at"), b.pop("generated_at")
    assert a == b
    ra = json.loads((tmp_path / "a" / "analysis_nodos.json").read_text())
    rb = json.loads((tmp_path / "b" / "analysis_nodos.json").read_text())
    ra.pop("generated_at"), rb.pop("generated_at")
    assert ra == rb


def test_tolerancia_y_area_sinteticas():
    assert K._tol(0.95) == approx(0.019) and K._tol(5.9) == approx(0.118) and K._tol(0) == 0.5 and K._tol(836) == approx(16.72)
    t = pd.DataFrame({"pml_medio": [100.0, 300.0], "p_cap": [80.0, 150.0], "vf": [0.8, 0.5], "pct_e0": [0.0, 2.0],
                      "energia_media": [90, 280], "perdidas_media": [5, 10], "congestion_media": [5, 10],
                      "spread_punta_solar": [50, 60], "vf_dia_promedio": [0.8, 0.5], "y_f": [2000.0, 1000.0],
                      "ingreso": [160000.0, 150000.0], "ingreso_atajo": [200000.0, 300000.0]})
    t.attrs["doce_meses"] = True
    a = K._area(t, 100.0)
    # VF del area = cociente de promedios: (80+150)/2 / ((100+300)/2) = 115/200 = 0.575 (no el promedio de VF = 0.65)
    assert a["vf"] == approx(0.575) and a["pct_nodos_cubren_lcoe_nominal"] == 50.0 and a["n_nodos_cubren_lcoe_nominal"] == 1
    assert a["vf_req_nominal"] == approx(0.5) and a["margen_mxn_mwh_nominal"] == approx(15.0)
    # margen por MWp = promedio de Y_f x (P_cap - LCOE) = (2000*(-20) + 1000*50)/2 = 5000
    assert a["margen_mxn_por_mwp_anio_nominal"] == approx(5000.0)
    assert "pct_nodos_cubren_lcoe_real" not in a                       # sin columnas reales no se inventan
    # con precios reales (x1.25): P_cap real 100 y 187.5 -> ambos cubren 100
    t["p_cap_real"], t["pml_medio_real"] = t["p_cap"] * 1.25, t["pml_medio"] * 1.25
    b = K._area(t, 100.0)
    assert b["pct_nodos_cubren_lcoe_real"] == 100.0 and b["vf_req_real"] == approx(100 / 250)
    assert a["sobreestimacion_atajo_pct"] == approx(100 * (250000 / 155000 - 1))
