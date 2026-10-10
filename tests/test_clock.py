"""Pruebas de pipeline/clock.py: una por cada cambio de horario 2020-2026 por sistema + pruebas por sistema.

Las pruebas contra datos usan data/db/pml.duckdb en SOLO LECTURA y se omiten si no existe."""
import datetime as dt
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import clock as C  # noqa: E402

DB = ROOT / "data" / "db" / "pml.duckdb"
D = dt.date

# Lista escrita a mano (independiente de la regla del modulo). (sistema, fecha, horas publicadas)
CAMBIOS = [
    ("SIN", D(2020, 4, 5), 23), ("SIN", D(2020, 10, 25), 25),
    ("SIN", D(2021, 4, 4), 23), ("SIN", D(2021, 10, 31), 25),
    ("SIN", D(2022, 4, 3), 23), ("SIN", D(2022, 10, 30), 25),
    ("BCS", D(2020, 4, 5), 23), ("BCS", D(2020, 10, 25), 25),
    ("BCS", D(2021, 4, 4), 23), ("BCS", D(2021, 10, 31), 25),
    ("BCS", D(2022, 4, 3), 23), ("BCS", D(2022, 10, 30), 25),
    ("BCA", D(2020, 3, 8), 23), ("BCA", D(2020, 11, 1), 25),
    ("BCA", D(2021, 3, 14), 23), ("BCA", D(2021, 11, 7), 25),
    ("BCA", D(2022, 3, 13), 23), ("BCA", D(2022, 11, 6), 25),
    ("BCA", D(2023, 3, 12), 23), ("BCA", D(2023, 11, 5), 25),
    ("BCA", D(2024, 3, 10), 23), ("BCA", D(2024, 11, 3), 25),
    ("BCA", D(2025, 3, 9), 23), ("BCA", D(2025, 11, 2), 25),
    ("BCA", D(2026, 3, 8), 23), ("BCA", D(2026, 11, 1), 25),
]
ZONA_IANA = {"SIN": "America/Mexico_City", "BCS": "America/Mazatlan", "BCA": "America/Tijuana"}


@pytest.fixture(scope="module")
def con():
    if not DB.exists():
        pytest.skip("sin data/db/pml.duckdb")
    import duckdb
    c = duckdb.connect(str(DB), read_only=True)
    c.execute("SET memory_limit='3GB'; SET threads=4")
    yield c
    c.close()


@pytest.fixture(scope="module")
def horas_publicadas(con):
    """(sistema, fecha) -> (horas distintas, hora max, min y max de filas por nodo) en los dias de cambio
    y en los mismos dias de los sistemas que NO cambian."""
    fechas = sorted({f for _, f, _ in CAMBIOS})
    lst = ",".join(f"DATE '{f}'" for f in fechas)
    q = f"""with nd as (select sistema, fecha, nodo, count(*) n, max(hora) mx from pml_hourly
             where fecha in ({lst}) group by all)
            select sistema, fecha, min(n), max(n), min(mx), max(mx) from nd group by all"""
    return {(s, f): r for s, f, *r in con.execute(q).fetchall()}


def test_lista_de_cambios_coincide_con_regla():
    assert sorted(C.fechas_cambio()) == sorted(CAMBIOS)


@pytest.mark.parametrize("sistema,fecha,n", CAMBIOS, ids=[f"{s}-{f}" for s, f, _ in CAMBIOS])
def test_cambio_de_horario(sistema, fecha, n, request):
    """Una prueba por cambio: horas esperadas, mapeo de extremos, continuidad con dia previo y siguiente,
    y (si hay datos) que TODAS las nodo-dia publicadas tengan exactamente n horas 1..n."""
    assert C.horas_en_dia(sistema, fecha) == n
    prev, nxt = fecha - dt.timedelta(days=1), fecha + dt.timedelta(days=1)
    n_prev = C.horas_en_dia(sistema, prev)
    t = lambda f, h: C.ts_local_estandar(sistema, f, h)  # noqa: E731
    one = pd.Timedelta(hours=1)
    # continuidad: fin de la ultima hora del dia previo = inicio de la hora 1; idem al dia siguiente
    assert t(prev, n_prev) + one == t(fecha, 1)
    assert t(fecha, n) + one == t(nxt, 1)
    serie = pd.Series([t(fecha, h) for h in range(1, n + 1)])
    assert (serie.diff().dropna() == one).all()
    if n == 23:  # primavera: medianoche aun estandar; el dia cubre 00:00-23:00 estandar
        assert t(fecha, 1) == pd.Timestamp(fecha)
        assert t(nxt, 1) == pd.Timestamp(fecha) + pd.Timedelta(hours=23)
    else:  # otono: medianoche en verano = 23:00 estandar del dia previo; el dia cubre 25 h
        assert t(fecha, 1) == pd.Timestamp(fecha) - one
        assert t(fecha, 25) == pd.Timestamp(fecha) + pd.Timedelta(hours=23)
        assert t(nxt, 1) == pd.Timestamp(nxt)
    with pytest.raises(ValueError):
        t(fecha, n + 1)
    # evidencia en datos
    if not DB.exists():
        pytest.skip("sin datos")
    hp = request.getfixturevalue("horas_publicadas")
    if (sistema, fecha) not in hp:
        pytest.skip(f"{fecha} fuera del rango de datos")
    nmin, nmax, mxmin, mxmax = hp[(sistema, fecha)]
    assert nmin == nmax == mxmin == mxmax == n
    # los sistemas que no cambian ese dia publican 24 h
    for otro in C.SISTEMAS:
        if otro != sistema and (otro, fecha) in hp and C.horas_en_dia(otro, fecha) == 24:
            assert tuple(hp[(otro, fecha)]) == (24, 24, 24, 24), otro


@pytest.mark.parametrize("sistema", C.SISTEMAS)
def test_coincide_con_zona_iana(sistema):
    """Fuera de los dias de cambio, ts_utc = hora civil de la zona IANA convertida a UTC (2020-2026)."""
    z = ZoneInfo(ZONA_IANA[sistema])
    dias = pd.date_range("2020-01-01", "2026-12-31", freq="D")
    dias = [d.date() for d in dias if C.horas_en_dia(sistema, d.date()) == 24]
    f = pd.Series(sorted(dias * 24))
    h = pd.Series(list(range(1, 25)) * len(dias))
    got = C.ts_utc(sistema, f, h)
    civ = pd.to_datetime(f) + pd.to_timedelta(h - 1, unit="h")
    exp = civ.dt.tz_localize(z).dt.tz_convert("UTC").dt.tz_localize(None)
    assert (got.values == exp.values).all()


@pytest.mark.parametrize("sistema", ["SIN", "BCS"])
def test_sin_bcs_fijos_desde_2023(sistema):
    for y in range(2023, 2027):
        assert C.cambios_horario(sistema, y) is None
    assert C.ts_local_estandar(sistema, D(2024, 7, 1), 1) == pd.Timestamp("2024-07-01 00:00")
    # en verano 2021 la hora publicada 1 empieza a las 23:00 estandar del dia previo
    assert C.ts_local_estandar(sistema, D(2021, 7, 1), 1) == pd.Timestamp("2021-06-30 23:00")


def test_bca_verano_todos_los_anos():
    for y in range(2020, 2027):
        assert C.ts_local_estandar("BCA", D(y, 7, 1), 13) == pd.Timestamp(f"{y}-07-01 11:00")
        assert C.ts_local_estandar("BCA", D(y, 1, 15), 13) == pd.Timestamp(f"{y}-01-15 12:00")


def test_offsets_estandar():
    assert C.STD_UTC_OFFSET_HOURS == {"SIN": -6, "BCS": -7, "BCA": -8}
    assert C.ts_utc("BCA", D(2024, 1, 15), 1) == pd.Timestamp("2024-01-15 08:00")
    idx = pd.DatetimeIndex(["2024-01-15 08:00"], tz="UTC")
    assert C.utc_a_local_estandar("BCA", idx)[0] == pd.Timestamp("2024-01-15 00:00")


def test_vectorizado_igual_a_escalar():
    f = [D(2022, 10, 29), D(2022, 10, 30), D(2022, 10, 30), D(2022, 10, 31)]
    h = [24, 1, 25, 1]
    v = C.ts_local_estandar("SIN", f, h)
    assert list(v) == [C.ts_local_estandar("SIN", a, b) for a, b in zip(f, h)]


@pytest.mark.parametrize("sistema", C.SISTEMAS)
def test_datos_continuos_y_unicos(con, sistema):
    """Con la expresion SQL: en todo 2020-2026 cada (fecha, hora) publicada mapea a un instante estandar
    unico y consecutivo (sin huecos ni duplicados). Tambien verifica SQL == Python en una muestra."""
    expr = C.sql_ts_local_estandar(sistema_col=f"'{sistema}'")
    q = f"""with k as (select distinct fecha, hora from pml_hourly where sistema='{sistema}'),
            t as (select fecha, hora, {expr} ts from k)
            select count(*), count(distinct ts), min(ts), max(ts),
                   sum(case when ts - lag_ts <> INTERVAL 1 HOUR then 1 else 0 end)
            from (select *, lag(ts) over (order by ts) lag_ts from t)"""
    n, nd, tmin, tmax, saltos = con.execute(q).fetchone()
    assert n == nd
    assert saltos == 0
    assert n == int((pd.Timestamp(tmax) - pd.Timestamp(tmin)) / pd.Timedelta(hours=1)) + 1
    muestra = con.execute(f"""select fecha, hora, {expr}
        from (select distinct fecha, hora from pml_hourly where sistema='{sistema}'
              and fecha in (DATE '2020-03-08', DATE '2020-04-05', DATE '2020-10-25', DATE '2020-11-01',
                            DATE '2022-07-01', DATE '2024-07-01'))""").fetchall()
    for f, h, ts in muestra:
        assert pd.Timestamp(ts) == C.ts_local_estandar(sistema, f, h)


def test_sistema_invalido():
    with pytest.raises(ValueError):
        C.ts_local_estandar("XX", D(2024, 1, 1), 1)
    with pytest.raises(ValueError):
        C.ts_local_estandar("SIN", D(2024, 1, 1), 0)


@pytest.mark.parametrize("sistema", C.SISTEMAS)
def test_sql_igual_a_python_sin_limite_de_anios(sistema):
    """La expresion SQL deriva las reglas del ano de la fecha: igual a Python dia por dia 2000-2060
    (incluye BCA en verano despues de 2030 y los dias de cambio, horas 1 y 2)."""
    import duckdb
    fechas = pd.date_range("2000-01-01", "2060-12-31", freq="D").date
    df = pd.DataFrame({"fecha": list(fechas) * 2, "hora": [1] * len(fechas) + [2] * len(fechas)})
    got = duckdb.connect().execute(
        f"select {C.sql_ts_local_estandar(sistema_col=repr(sistema))} from df").fetchdf().iloc[:, 0]
    exp = C.ts_local_estandar(sistema, df.fecha, df.hora)
    assert (got.values == exp.values).all()
    if sistema == "BCA":
        expr = C.sql_ts_local_estandar(sistema_col="'BCA'", fecha_col="DATE '2031-07-01'", hora_col="13")
        got31 = duckdb.connect().execute(f"select {expr}").fetchone()[0]
        assert pd.Timestamp(got31) == pd.Timestamp("2031-07-01 11:00")


# ------------------------------------------------------------------ reloj comun CDMX (UTC-6 fijo)
def _dias_densos():
    """Rejilla diaria 2020-2026 + algunos anos fuera (2019, 2030-2031, 2045)."""
    r = list(pd.date_range("2020-01-01", "2026-12-31", freq="D").date)
    for a, b in [("2019-01-01", "2019-12-31"), ("2030-01-01", "2031-12-31"), ("2045-01-01", "2045-12-31")]:
        r += list(pd.date_range(a, b, freq="D").date)
    return r


def _grilla(sistema, dias):
    f, h = [], []
    for d in dias:
        n = C.horas_en_dia(sistema, d)
        f += [d] * n
        h += list(range(1, n + 1))
    return pd.Series(f), pd.Series(h)


def test_offsets_cdmx():
    assert C.CDMX_UTC_OFFSET_HOURS == -6
    assert {s: C.desfase_a_cdmx_horas(s) for s in C.SISTEMAS} == {"SIN": 0, "BCS": 1, "BCA": 2}
    with pytest.raises(ValueError):
        C.desfase_a_cdmx_horas("XX")


@pytest.mark.parametrize("sistema,desfase", [("SIN", 0), ("BCS", 1), ("BCA", 2)])
def test_cdmx_vs_local_estandar_y_utc(sistema, desfase):
    """SIN: identidad con ts_local_estandar; BCS +1 h; BCA +2 h; y ts_cdmx = ts_utc - 6 h, en toda la rejilla."""
    f, h = _grilla(sistema, _dias_densos())
    cd = C.ts_cdmx(sistema, f, h)
    assert ((cd - C.ts_local_estandar(sistema, f, h)) == pd.Timedelta(hours=desfase)).all()
    assert (cd == C.ts_utc(sistema, f, h) - pd.Timedelta(hours=6)).all()
    assert (C.utc_a_cdmx(pd.DatetimeIndex(C.ts_utc(sistema, f, h))) == pd.DatetimeIndex(cd)).all()


def test_ejemplos_cdmx():
    # invierno: hora 1 de BCA (00:00 PST) = 02:00 CDMX; BCS 00:00 MST = 01:00 CDMX
    assert C.ts_cdmx("BCA", D(2024, 1, 15), 1) == pd.Timestamp("2024-01-15 02:00")
    assert C.ts_cdmx("BCS", D(2024, 1, 15), 1) == pd.Timestamp("2024-01-15 01:00")
    assert C.ts_cdmx("SIN", D(2024, 1, 15), 1) == pd.Timestamp("2024-01-15 00:00")
    # verano BCA: hora 1 civil = 00:00 PDT = 23:00 PST = 01:00 CDMX
    assert C.ts_cdmx("BCA", D(2024, 7, 1), 1) == pd.Timestamp("2024-07-01 01:00")
    # verano SIN 2021: hora 1 civil (CDT) = 23:00 CDMX estandar del dia previo
    assert C.ts_cdmx("SIN", D(2021, 7, 1), 1) == pd.Timestamp("2021-06-30 23:00")
    # utc_a_cdmx acepta tz-aware y tz-naive
    assert C.utc_a_cdmx(pd.DatetimeIndex(["2024-01-15 06:00"], tz="UTC"))[0] == pd.Timestamp("2024-01-15")
    assert C.utc_a_cdmx(["2024-01-15 06:00"])[0] == pd.Timestamp("2024-01-15")


@pytest.mark.parametrize("sistema,fecha,n", CAMBIOS, ids=[f"cdmx-{s}-{f}" for s, f, _ in CAMBIOS])
def test_cambio_en_reloj_cdmx(sistema, fecha, n):
    """Cada dia de cambio, con el dia previo y el siguiente, mapea a horas CDMX consecutivas, sin huecos
    ni duplicados; la hora 25 (otono) es la ultima y empalma con la hora 1 del dia siguiente."""
    dias = [fecha - dt.timedelta(days=1), fecha, fecha + dt.timedelta(days=1)]
    f, h = _grilla(sistema, dias)
    ts = C.ts_cdmx(sistema, f, h)
    assert ts.is_unique and (ts.diff().dropna() == pd.Timedelta(hours=1)).all()
    assert len(ts) == C.horas_en_dia(sistema, dias[0]) + n + 24
    k = C.desfase_a_cdmx_horas(sistema)
    if n == 25:
        assert C.ts_cdmx(sistema, fecha, 25) == pd.Timestamp(fecha) + pd.Timedelta(hours=23 + k)
        assert C.ts_cdmx(sistema, fecha, 25) + pd.Timedelta(hours=1) == C.ts_cdmx(sistema, dias[2], 1)
    else:
        assert C.ts_cdmx(sistema, fecha, 23) == pd.Timestamp(fecha) + pd.Timedelta(hours=22 + k)
        with pytest.raises(ValueError):
            C.ts_cdmx(sistema, fecha, 24)


@pytest.mark.parametrize("sistema", C.SISTEMAS)
def test_sql_cdmx_igual_a_python(sistema):
    import duckdb
    f, h = _grilla(sistema, _dias_densos())
    df = pd.DataFrame({"fecha": f, "hora": h})
    got = duckdb.connect().execute(f"select {C.sql_ts_cdmx(sistema_col=repr(sistema))} from df").fetchdf().iloc[:, 0]
    assert (got.values == C.ts_cdmx(sistema, f, h).values).all()
    df["sistema"] = sistema
    got2 = duckdb.connect().execute(f"select {C.sql_ts_cdmx()} from df").fetchdf().iloc[:, 0]
    assert (got2.values == got.values).all()


def test_sql_cdmx_sistema_desconocido_es_null():
    import duckdb
    e = C.sql_ts_cdmx(sistema_col="'XX'", fecha_col="DATE '2024-01-15'", hora_col="1")
    assert duckdb.connect().execute(f"select {e}").fetchone()[0] is None


@pytest.mark.parametrize("sistema", C.SISTEMAS)
def test_datos_por_nodo_continuos_en_cdmx(sistema):
    """Base completa (solo lectura): por (sistema, nodo) instantes CDMX unicos y paso exacto de 1 h entre
    filas de dias iguales o consecutivos (los huecos de dias faltantes de un nodo se permiten)."""
    if not DB.exists():
        pytest.skip("sin data/db/pml.duckdb")
    import tempfile
    import duckdb
    c = duckdb.connect()
    c.execute("SET memory_limit='4GB'; SET threads=4; SET preserve_insertion_order=false")
    c.execute(f"SET temp_directory='{tempfile.mkdtemp(prefix='clock_qa_')}'")
    c.execute(f"ATTACH '{DB}' AS db (READ_ONLY)")
    e = C.sql_ts_cdmx(sistema_col=f"'{sistema}'")
    n, dups, malos = c.execute(f"""
        with t as (select nodo, fecha, {e} ts from db.pml_hourly where sistema='{sistema}'),
        w as (select fecha, ts, lag(ts) over (partition by nodo order by ts) pts,
                     lag(fecha) over (partition by nodo order by ts) pf from t)
        select count(*), count(*) filter (where ts = pts),
               count(*) filter (where pts is not null and fecha - pf <= 1 and ts - pts <> INTERVAL 1 HOUR)
        from w""").fetchone()
    c.close()
    assert n > 0
    assert dups == 0
    assert malos == 0
