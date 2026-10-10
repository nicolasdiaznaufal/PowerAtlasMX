"""Pruebas de pipeline/quality.py sobre datos sinteticos (no tocan data/db)."""
import datetime as dt
import sys
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import quality as Q  # noqa: E402
import clock as C  # noqa: E402

D = dt.date


def nodo_dia(sistema, nodo, fechas, cal):
    """Nodo con horas completas (= esperadas) en `fechas`."""
    c = cal[cal.sistema == sistema].set_index("fecha")["esperadas"]
    return pd.DataFrame({"sistema": sistema, "nodo": nodo, "fecha": pd.to_datetime(list(fechas)),
                         "horas": [int(c[pd.Timestamp(f)]) for f in fechas]})


def rango(a, b):
    return pd.date_range(a, b, freq="D")


@pytest.fixture(scope="module")
def cal():
    return Q.calendario(D(2023, 1, 1), D(2025, 12, 31), sistemas=("SIN", "BCA"))


def test_hueco_dentro_de_vida_vs_nodo_que_aun_no_entra(cal):
    # A: completo con un hueco de 10 dias. B: entra el 2024-07-01 (sin hueco).
    fa = rango("2023-01-01", "2025-12-31").difference(rango("2024-03-01", "2024-03-10"))
    a = nodo_dia("SIN", "A", fa, cal)
    b = nodo_dia("SIN", "B", rango("2024-07-01", "2025-12-31"), cal)
    r = Q.cobertura_nodos(pd.concat([a, b]), cal).set_index("nodo")
    assert r.loc["A", "dias_hueco"] == 10 and r.loc["A", "horas_hueco"] == 240
    assert r.loc["A", "pct_fuera_catalogo"] == 0
    assert r.loc["B", "horas_hueco"] == 0 and r.loc["B", "pct_hueco_vida"] == 0
    assert r.loc["B", "pct_fuera_catalogo"] > 40          # "aun no estaba", no es hueco
    assert r.loc["B", "estado"] == "entra" and r.loc["A", "estado"] == "completo"
    assert r.loc["B", "primera_fecha"] == D(2024, 7, 1)


def test_nodo_que_sale(cal):
    r = Q.cobertura_nodos(nodo_dia("SIN", "S", rango("2023-01-01", "2024-06-30"), cal), cal).iloc[0]
    assert r.estado == "sale" and r.horas_hueco == 0 and r.ultima_fecha == D(2024, 6, 30)


def test_dias_23_y_25_horas_no_son_huecos(cal):
    # BCA: 2024-03-10 (23 h) y 2024-11-03 (25 h). Presentes = esperadas -> 0 huecos.
    r = Q.cobertura_nodos(nodo_dia("BCA", "X", rango("2024-03-01", "2024-11-30"), cal), cal).iloc[0]
    assert r.horas_hueco == 0
    dias = (D(2024, 11, 30) - D(2024, 3, 1)).days + 1
    assert r.horas_esperadas_vida == dias * 24 - 1 + 1       # -1 (23 h) +1 (25 h)
    assert r.horas_con_datos == r.horas_esperadas_vida
    # el dia de 23 h con 23 horas es completo; si faltara 1 hora seria hueco de 1 h (no de 2)
    nd = nodo_dia("BCA", "X", rango("2024-03-01", "2024-03-31"), cal)
    nd.loc[nd.fecha == "2024-03-10", "horas"] = 22
    r2 = Q.cobertura_nodos(nd, cal).iloc[0]
    assert r2.horas_hueco == 1 and r2.dias_hueco == 0


def test_dia_parcial_cuenta_como_dia_con_datos_y_hueco_en_horas(cal):
    nd = nodo_dia("SIN", "P", rango("2024-01-01", "2024-01-31"), cal)
    nd.loc[5, "horas"] = 12
    r = Q.cobertura_nodos(nd, cal).iloc[0]
    assert r.horas_hueco == 12 and r.dias_con_datos == 31 and r.dias_hueco == 0


def _meses(n, cal, inicio="2023-01-01"):
    fin = (pd.Timestamp(inicio) + pd.DateOffset(months=n)) - pd.Timedelta(days=1)
    return nodo_dia("SIN", "N", rango(inicio, fin), cal)


def test_regla_12_meses_en_el_limite(cal):
    r11 = Q.cobertura_nodos(_meses(11, cal), cal).iloc[0]
    r12 = Q.cobertura_nodos(_meses(12, cal), cal).iloc[0]
    assert r11.meses_de_datos == 11 and not r11.valido and r11.confianza == "baja"
    assert r12.meses_de_datos == 12 and r12.valido and r12.confianza == "alta"


def test_mes_con_datos_es_literal_un_dia_basta(cal):
    # 11 meses completos + 1 solo dia del mes 12 => 12 meses con datos (definicion literal)
    nd = pd.concat([_meses(11, cal), nodo_dia("SIN", "N", [D(2023, 12, 15)], cal)])
    r = Q.cobertura_nodos(nd, cal).iloc[0]
    assert r.meses_de_datos == 12 and r.valido and r.meses_90pct == 11


def test_mes_sin_horas_no_cuenta(cal):
    nd = _meses(12, cal)
    nd.loc[nd.fecha.dt.month == 6, "horas"] = 0
    r = Q.cobertura_nodos(nd, cal).iloc[0]
    assert r.meses_de_datos == 11 and not r.valido


def test_bandera_de_periodo_arbitrario(cal):
    nd = _meses(24, cal)  # 2023-01..2024-12
    # periodo de 11 meses completos: baja; de 12: no; de 36 (solo 24 con datos): no
    b = lambda i, f: Q.baja_confianza_periodo(nd, i, f).iloc[0]  # noqa: E731
    assert b("2023-01-01", "2023-11-30").baja_confianza
    assert b("2023-01-01", "2023-11-30").meses_de_datos == 11
    assert not b("2023-01-01", "2023-12-31").baja_confianza
    assert not b("2023-01-01", "2025-12-31").baja_confianza
    # periodo que se traslapa 5 meses con la vida del nodo => baja confianza aunque tenga 24 en total
    x = b("2024-08-01", "2025-12-31")
    assert x.meses_de_datos == 5 and x.baja_confianza
    # nodo sin datos en el periodo: aparece con 0 y baja confianza
    r = Q.baja_confianza_periodo(nd, "2025-01-01", "2025-12-31", nodos=nd[["sistema", "nodo"]])
    assert r.iloc[0].meses_de_datos == 0 and r.iloc[0].baja_confianza


def test_bandera_periodo_con_hueco_no_cuenta_meses_vacios(cal):
    nd = _meses(12, cal)
    nd = nd[nd.fecha.dt.month != 3]
    r = Q.baja_confianza_periodo(nd, "2023-01-01", "2023-12-31").iloc[0]
    assert r.meses_de_datos == 11 and r.baja_confianza


# ------------------------------------------------------------ outliers (DuckDB en memoria)
@pytest.fixture()
def con():
    c = duckdb.connect(":memory:")
    c.execute("""CREATE TABLE pml_hourly(sistema VARCHAR, fecha DATE, hora INTEGER, nodo VARCHAR,
                 pml DOUBLE, energia DOUBLE, perdidas DOUBLE, congestion DOUBLE)""")
    rng = np.random.default_rng(0)
    rows = []
    for s in ("SIN", "BCA", "BCS"):
        for nodo in ("N1", "N2", "N3"):
            for d in pd.date_range("2024-01-01", "2024-01-20"):
                for h in range(1, 25):
                    e = 500 + 20 * np.sin(h / 4) + rng.normal(0, 5)
                    rows.append((s, d.date(), h, nodo, round(e + 3 - 1, 2), round(e, 2), 3.0, -1.0))
    df = pd.DataFrame(rows, columns=["sistema", "fecha", "hora", "nodo", "pml", "energia", "perdidas", "congestion"])
    c.register("df", df)
    c.execute("INSERT INTO pml_hourly SELECT * FROM df")
    return c


def _set(con, nodo, fecha, hora, **kw):
    for k, v in kw.items():
        con.execute(f"UPDATE pml_hourly SET {k}=? WHERE sistema='SIN' AND nodo=? AND fecha=? AND hora=?",
                    [v, nodo, fecha, hora])


def test_outliers_marcan_y_no_borran(con):
    n0 = con.execute("SELECT count(*) FROM pml_hourly").fetchone()[0]
    _set(con, "N1", D(2024, 1, 5), 10, pml=50000.0, energia=49996.0)      # extremo + salto
    _set(con, "N2", D(2024, 1, 6), 3, pml=-1200.0, energia=-1204.0)      # negativo (+salto)
    _set(con, "N3", D(2024, 1, 7), 8, pml=900.0)                          # descomposicion (+salto)
    m, p, st = Q.outliers(con)
    assert con.execute("SELECT count(*) FROM pml_hourly").fetchone()[0] == n0   # nada se borra
    s = m[m.sistema == "SIN"]
    a = s[(s.nodo == "N1") & (s.hora == 10)].iloc[0]
    assert a.extremo and a.salto
    b = s[(s.nodo == "N2") & (s.hora == 3)].iloc[0]
    assert b.negativo and b.pml == -1200.0
    c = s[(s.nodo == "N3") & (s.hora == 8)].iloc[0]
    assert c.descomposicion and not c.extremo
    assert not m[(m.sistema != "SIN")].descomposicion.any()
    assert len(s) < len(con.execute("SELECT * FROM pml_hourly WHERE sistema='SIN'").df())


def test_descomposicion_tolerancia_002(con):
    _set(con, "N1", D(2024, 1, 5), 4, pml=500.0, energia=500.0, perdidas=0.0, congestion=0.02)   # justo en 0.02
    _set(con, "N1", D(2024, 1, 5), 5, pml=500.0, energia=500.0, perdidas=0.0, congestion=0.05)   # 0.05 > 0.02
    m, _, _ = Q.outliers(con)
    d = m[(m.sistema == "SIN") & m.descomposicion]
    assert list(d.hora) == [5]


def test_corridas_planas(con):
    for h in range(1, 21):
        _set(con, "N2", D(2024, 1, 10), h, pml=123.45, energia=123.45 - 2)
    _, p, _ = Q.outliers(con, min_plano=12)
    r = p[(p.sistema == "SIN") & (p.nodo == "N2")]
    assert len(r) == 1 and r.iloc[0].horas == 20 and r.iloc[0].pml == 123.45


def test_marcar_sistemicos_aisla_nodos(con):
    for nodo in ("N1", "N2", "N3"):   # evento sistemico: los 3 nodos a la vez
        _set(con, nodo, D(2024, 1, 8), 12, pml=30000.0, energia=29996.0)
    _set(con, "N1", D(2024, 1, 9), 12, pml=30000.0, energia=29996.0)  # 1 de 3 nodos = 33 % (> 5 %, con 3 nodos no hay 'aislado')
    m, _, _ = Q.outliers(con)
    nd = con.execute("SELECT sistema,nodo,fecha,count(*)::INT horas FROM pml_hourly GROUP BY ALL").df()
    m = Q.marcar_sistemicos(m, nd)
    sin = m[m.sistema == "SIN"]
    ev = sin[(sin.fecha == "2024-01-08") & sin.extremo]
    assert len(ev) == 3 and (ev.frac_extremo == 1.0).all() and not ev.extremo_aislado.any()
    ai = sin[(sin.fecha == "2024-01-09") & sin.extremo]
    assert len(ai) == 1 and ai.iloc[0].frac_extremo == pytest.approx(1 / 3)
    assert len(sin) == len(m[m.sistema == "SIN"])           # no se pierden filas
