"""Validación independiente de pipeline/clock.py (validador).

Los valores esperados NO salen de clock.py: se derivan (1) de la regla legal escrita aquí con
calendar y (2) de las zonas IANA vía zoneinfo; ambas se contrastan entre sí antes de usarse.
clock.py solo se importa como objeto bajo prueba.
"""
from __future__ import annotations

import calendar
import datetime as dt
import re
import subprocess
import sys
from datetime import timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pytest

from conftest import ROOT

sys.path.insert(0, str(ROOT / "pipeline"))
import clock as C  # noqa: E402  (objeto bajo prueba)

ANIOS = range(2020, 2027)
DIA0, DIA1 = dt.date(2020, 1, 1), dt.date(2026, 12, 31)
DATOS_FIN = dt.date(2026, 9, 30)
IANA = {"SIN": "America/Mexico_City", "BCS": "America/Mazatlan", "BCA": "America/Tijuana"}
STD = {"SIN": -6, "BCS": -7, "BCA": -8}  # zona legal: Centro, Pacífico MX, Noroeste/PST


# ---------------------------------------------------------------- derivación independiente
def _domingos(y: int, m: int) -> list[dt.date]:
    return [dt.date(y, m, d) for d in range(1, calendar.monthrange(y, m)[1] + 1)
            if calendar.weekday(y, m, d) == calendar.SUNDAY]


def regla_propia(sistema: str, y: int):
    """(primavera, otoño) por la regla legal, escrita aquí sin mirar clock.py."""
    if sistema == "BCA":  # EE.UU. desde 2007: 2o domingo de marzo, 1er domingo de noviembre
        return _domingos(y, 3)[1], _domingos(y, 11)[0]
    if y <= 2022:  # México 2002-2022: 1er domingo de abril, último domingo de octubre
        return _domingos(y, 4)[0], _domingos(y, 10)[-1]
    return None  # Ley de los Husos Horarios (DOF 2022-10-28): sin verano en SIN/BCS


def largo_dia_iana(sistema: str, d: dt.date) -> int:
    """Horas entre la medianoche civil de d y la de d+1 en la zona IANA."""
    z = ZoneInfo(IANA[sistema])
    a = dt.datetime(d.year, d.month, d.day, tzinfo=z).astimezone(timezone.utc)
    n = d + timedelta(days=1)
    b = dt.datetime(n.year, n.month, n.day, tzinfo=z).astimezone(timezone.utc)
    return int((b - a) / timedelta(hours=1))


def dias():
    d = DIA0
    while d <= DIA1:
        yield d
        d += timedelta(days=1)


def cambios_propios():
    out = []
    for s in C.SISTEMAS:
        for y in ANIOS:
            r = regla_propia(s, y)
            if r:
                out += [(s, r[0], 23), (s, r[1], 25)]
    return sorted(out)


def esperado_utc(sistema: str, d: dt.date, hora: int) -> dt.datetime:
    """Inicio de la hora publicada `hora` (que termina) = medianoche civil + (hora-1) h reales, en UTC."""
    z = ZoneInfo(IANA[sistema])
    m = dt.datetime(d.year, d.month, d.day, tzinfo=z).astimezone(timezone.utc)
    return (m + timedelta(hours=hora - 1)).replace(tzinfo=None)


def malla(sistema: str) -> pd.DataFrame:
    rows = [(d, h) for d in dias() for h in range(1, largo_dia_iana(sistema, d) + 1)]
    return pd.DataFrame(rows, columns=["fecha", "hora"])


# ---------------------------------------------------------------- 1. fechas de cambio
def test_regla_propia_coincide_con_iana():
    """Dos derivaciones independientes (regla escrita a mano vs tzdata) dan los mismos 26 cambios."""
    iana = sorted((s, d, n) for s in C.SISTEMAS for d in dias() if (n := largo_dia_iana(s, d)) != 24)
    assert iana == cambios_propios()
    assert len(iana) == 6 + 6 + 14  # SIN 3 años x2, BCS idem, BCA 7 años x2


def test_tzdata_conoce_ley_2022():
    """Si el tzdata del sistema fuera viejo (<2022f), la comparación anterior no probaría nada."""
    assert ZoneInfo("America/Mexico_City").utcoffset(dt.datetime(2023, 7, 1)) == timedelta(hours=-6)
    assert ZoneInfo("America/Mazatlan").utcoffset(dt.datetime(2023, 7, 1)) == timedelta(hours=-7)


def test_offsets_estandar_coinciden_con_zona_legal():
    assert C.STD_UTC_OFFSET_HOURS == STD
    for s, z in IANA.items():
        assert ZoneInfo(z).utcoffset(dt.datetime(2024, 1, 15)) == timedelta(hours=STD[s])


@pytest.mark.parametrize("sistema", C.SISTEMAS)
def test_horas_en_dia_todos_los_dias(sistema):
    """horas_en_dia y fechas_cambio de clock.py == derivación propia, día por día 2020-2026."""
    malos = [(d, C.horas_en_dia(sistema, d), largo_dia_iana(sistema, d)) for d in dias()
             if C.horas_en_dia(sistema, d) != largo_dia_iana(sistema, d)]
    assert malos == []
    assert sorted(x for x in C.fechas_cambio() if x[0] == sistema) == \
        [x for x in cambios_propios() if x[0] == sistema]


def test_una_prueba_por_cambio_en_test_clock():
    """Criterio: una prueba por cada cambio de horario. Se cuenta lo que pytest REALMENTE colecta."""
    r = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider",
                        str(ROOT / "tests" / "test_clock.py")], capture_output=True, text=True, cwd=ROOT)
    ids = set(re.findall(r"test_cambio_de_horario\[(\w+)-(\d{4}-\d{2}-\d{2})\]", r.stdout))
    esperado = {(s, d.isoformat()) for s, d, _ in cambios_propios()}
    assert esperado - ids == set(), f"cambios sin prueba: {sorted(esperado - ids)}"
    assert ids - esperado == set(), f"pruebas de cambios inexistentes: {sorted(ids - esperado)}"


# ---------------------------------------------------------------- 2. conversión a hora estándar
@pytest.mark.parametrize("sistema", C.SISTEMAS)
def test_ts_utc_y_local_estandar_vs_zoneinfo(sistema):
    """Todas las (fecha, hora 1..n) de 2020-2026, incluidas horas 23/25 de los días de cambio."""
    g = malla(sistema)
    exp_utc = pd.to_datetime([esperado_utc(sistema, d, h) for d, h in zip(g.fecha, g.hora)])
    got_utc = pd.DatetimeIndex(C.ts_utc(sistema, g.fecha, g.hora))
    got_loc = pd.DatetimeIndex(C.ts_local_estandar(sistema, g.fecha, g.hora))
    assert (got_utc == exp_utc).all()
    assert (got_loc == exp_utc + pd.Timedelta(hours=STD[sistema])).all()
    # continuo y único en toda la malla (sin saltos ni duplicados)
    assert got_loc.is_unique and (np.diff(got_loc.values) == np.timedelta64(1, "h")).all()
    # ida y vuelta UTC -> local estándar
    assert (C.utc_a_local_estandar(sistema, exp_utc.tz_localize("UTC")) == got_loc).all()


@pytest.mark.parametrize("sistema,fecha,n", cambios_propios(), ids=lambda v: str(v))
def test_bordes_dia_de_cambio(sistema, fecha, n):
    t = lambda d, h: C.ts_local_estandar(sistema, d, h)  # noqa: E731
    f0 = pd.Timestamp(fecha)
    if n == 23:  # 00:00..22:00 estándar; la hora civil 02-03 no existe
        assert t(fecha, 1) == f0 and t(fecha, 23) == f0 + pd.Timedelta(hours=22)
        for bad in (0, 24, 25):
            with pytest.raises(ValueError):
                t(fecha, bad)
    else:  # 25 h: de 23:00 estándar del día previo a 23:00 estándar del día
        assert t(fecha, 1) == f0 - pd.Timedelta(hours=1)
        assert t(fecha, 25) == f0 + pd.Timedelta(hours=23)
        assert t(fecha, 25) + pd.Timedelta(hours=1) == t(fecha + timedelta(days=1), 1)
        with pytest.raises(ValueError):
            t(fecha, 26)
    with pytest.raises(ValueError):  # hora 25 en el día siguiente (normal) es inválida
        t(fecha + timedelta(days=1), 25)


@pytest.mark.parametrize("sistema", C.SISTEMAS)
def test_sql_igual_a_derivacion_propia(sistema):
    import duckdb

    g = malla(sistema)
    g["exp"] = [esperado_utc(sistema, d, h) + timedelta(hours=STD[sistema]) for d, h in zip(g.fecha, g.hora)]
    con = duckdb.connect()
    con.register("g", g)
    got = con.execute(f"select {C.sql_ts_local_estandar(sistema_col=repr(sistema))} = exp from g").fetchnumpy()
    assert got[list(got)[0]].all()


@pytest.mark.parametrize("sistema", C.SISTEMAS)
def test_sql_sin_limite_de_anios(sistema):
    """Hallazgo previo: el SQL solo cubría 2020-2030. Ahora debe igualar a zoneinfo fuera de ese rango
    (días 1 y 15 de cada mes + días de cambio, 2010-2019 y 2027-2060). Antes de 2010 Tijuana seguía la regla
    mexicana (IANA), así que la regla de EE.UU. de clock.py no vale para BCA < 2010 (fuera del alcance de datos)."""
    import duckdb

    d0 = [dt.date(y, m, k) for y in [*range(2010, 2020), *range(2027, 2061)] for m in range(1, 13) for k in (1, 15)]
    d0 += [d for y in range(2027, 2061) for d in (regla_propia("BCA", y) if sistema == "BCA" else ())]
    rows = [(d, h, esperado_utc(sistema, d, h) + timedelta(hours=STD[sistema]))
            for d in d0 for h in range(1, largo_dia_iana(sistema, d) + 1)]
    g = pd.DataFrame(rows, columns=["fecha", "hora", "exp"])
    con = duckdb.connect()
    con.register("g", g)
    malos = con.execute(f"select fecha, hora, exp, {C.sql_ts_local_estandar(sistema_col=repr(sistema))} got "
                        f"from g where got <> exp limit 5").fetchall()
    assert malos == []
    lit = C.sql_ts_local_estandar(sistema_col="'BCA'", fecha_col="DATE '2031-07-01'", hora_col="13")
    assert pd.Timestamp(con.execute(f"select {lit}").fetchone()[0]) == pd.Timestamp("2031-07-01 11:00")


# ---------------------------------------------------------------- 3. documentación
def test_tecnico_md_coincide_con_codigo():
    txt = (ROOT / "docs" / "TECNICO.md").read_text(encoding="utf-8")
    sec = txt[txt.index("BEGIN clock-qa"):txt.index("END clock-qa")]
    # tabla de fechas: cada fila Sistema | 23 h | 25 h
    for s in C.SISTEMAS:
        fila = re.search(rf"^\| {s} \| (\d{{4}}-[^|]+)\| ([^|]+)\|", sec, re.M)
        assert fila, s
        doc23 = set(re.findall(r"\d{4}-\d{2}-\d{2}", fila.group(1)))
        doc25 = set(re.findall(r"\d{4}-\d{2}-\d{2}", fila.group(2)))
        exp = [(d, n) for x, d, n in cambios_propios() if x == s and d <= DATOS_FIN]
        assert doc23 == {d.isoformat() for d, n in exp if n == 23}, s
        assert doc25 == {d.isoformat() for d, n in exp if n == 25}, s
    for s, off in STD.items():  # offsets de la tabla de convención
        assert re.search(rf"^\| {s} \| UTC−{-off} \|", sec, re.M), s
    assert "ts = fecha 00:00 + (hora − 1) h − (1 h si la medianoche civil de `fecha` está en verano)" in sec
    assert "primavera < fecha ≤ otoño" in sec


# ---------------------------------------------------------------- 4. contra los datos (pesado)
def _esperado_df():
    rows = [(s, d, n) for s in C.SISTEMAS for d in dias() if d <= DATOS_FIN
            for n in [largo_dia_iana(s, d)]]
    return pd.DataFrame(rows, columns=["sistema", "fecha", "n_esp"])


@pytest.fixture(scope="module")
def nodo_dia(db):
    db.execute("""create or replace temp table v_nd as
                  select sistema, nodo, fecha, count(*)::int n, min(hora) hmin, max(hora) hmax
                  from db.pml_hourly group by all""")
    return "v_nd"


@pytest.mark.pesado
def test_horas_por_nodo_dia_iguales_a_regla(db, nodo_dia):
    """Cada nodo-día tiene horas 1..n contiguas y n = largo del día civil (23/25 SOLO en días de cambio)."""
    assert db.execute("select count(*) from (select 1 from db.pml_hourly "
                      "group by sistema, fecha, hora, nodo having count(*) > 1)").fetchone()[0] == 0
    db.register("esp", _esperado_df())
    malos = db.execute(f"""select v.sistema, v.fecha, v.n, e.n_esp, count(*) nodos
        from {nodo_dia} v left join esp e using (sistema, fecha)
        where e.n_esp is null or v.n <> e.n_esp or v.hmin <> 1 or v.hmax <> v.n
        group by all order by 1, 2 limit 50""").fetchall()
    assert malos == []


@pytest.mark.pesado
def test_hora_25_filas(db):
    """7,946 filas con hora=25 en total (12 días distintos x nodos); 2023-2025 solo BCA."""
    r = dict(db.execute("""select case when year(fecha) >= 2023 then 'post' else 'pre' end, count(*)
                           from db.pml_hourly where hora = 25 group by 1""").fetchall())
    assert r.get("pre", 0) + r.get("post", 0) == 7946
    assert db.execute("select count(*) from db.pml_hourly where hora=25 and year(fecha)>=2023 "
                      "and sistema<>'BCA'").fetchone()[0] == 0


@pytest.mark.pesado
def test_tecnico_md_cifras_hora_25(db):
    """Hallazgo previo: TECNICO.md atribuía 7,946 filas a los días de 25 h de 2023-2025. El texto debe
    decir lo que da la base: 350 (solo BCA) y el total 7,946 = SIN + BCS + BCA."""
    import re as _re

    sec = (ROOT / "docs" / "TECNICO.md").read_text(encoding="utf-8")
    n_post = db.execute("select count(*) from db.pml_hourly where hora=25 and year(fecha) between 2023 and 2025"
                        ).fetchone()[0]
    assert db.execute("select count(*) from db.pml_hourly where hora=25 and year(fecha) between 2023 and 2025 "
                      "and sistema<>'BCA'").fetchone()[0] == 0
    por = dict(db.execute("select sistema, count(*) from db.pml_hourly where hora=25 group by 1").fetchall())
    fmt = lambda x: f"{x:,}"  # noqa: E731
    linea = next(ln for ln in sec.splitlines() if "2023-2025" in ln and "hora = 25" in ln)
    assert _re.search(rf"\b{_re.escape(fmt(n_post))} filas", linea), (n_post, linea)
    assert fmt(sum(por.values())) in linea
    for s_ in ("SIN", "BCS", "BCA"):
        assert f"{s_} {fmt(por[s_])}" in linea, (s_, por[s_])


@pytest.mark.pesado
@pytest.mark.parametrize("sistema", C.SISTEMAS)
def test_serie_por_nodo_sin_saltos_ni_duplicados(db, sistema):
    """Tras ts_local_estandar (calculado aquí por la vía zoneinfo, no por clock.py): por (sistema, nodo),
    instantes únicos; entre filas consecutivas de días consecutivos el paso es exactamente 1 h."""
    g = malla(sistema)
    g = g[g.fecha <= DATOS_FIN]
    g["ts"] = [esperado_utc(sistema, d, h) + timedelta(hours=STD[sistema]) for d, h in zip(g.fecha, g.hora)]
    db.register(f"map_{sistema}", g)
    n, nd, saltos, salto_dia = db.execute(f"""
        with t as (select p.nodo, p.fecha, m.ts from db.pml_hourly p
                   join map_{sistema} m on p.fecha = m.fecha and p.hora = m.hora
                   where p.sistema = '{sistema}'),
             w as (select nodo, fecha, ts, lag(ts) over (partition by nodo order by ts) pts,
                          lag(fecha) over (partition by nodo order by ts) pf from t)
        select count(*), count(distinct (nodo, ts)),
               count(*) filter (where pts is not null and fecha - pf <= 1 and ts - pts <> interval 1 hour),
               count(*) filter (where pts is not null and fecha - pf > 1 and ts - pts <= interval 24 hour)
        from w""").fetchone()
    total = db.execute(f"select count(*) from db.pml_hourly where sistema='{sistema}'").fetchone()[0]
    assert n == total  # toda fila mapea (ninguna (fecha, hora) fuera de la malla)
    assert nd == n
    assert saltos == 0
    assert salto_dia == 0


# ---------------------------------------------------------------- 5. reloj común CDMX (ronda CDMX)
@pytest.mark.parametrize("sistema", C.SISTEMAS)
def test_ts_cdmx_vs_zoneinfo(sistema):
    """ts_cdmx = instante UTC − 6 h (UTC-6 fijo, nunca DST) para toda (fecha, hora) 2020-2026; SQL y
    utc_a_cdmx idénticos; desfase = −6 − offset estándar."""
    import duckdb

    g = malla(sistema)
    exp = pd.to_datetime([esperado_utc(sistema, d, h) for d, h in zip(g.fecha, g.hora)]) - pd.Timedelta(hours=6)
    got = pd.DatetimeIndex(C.ts_cdmx(sistema, g.fecha, g.hora))
    assert (got == exp).all() and got.is_unique
    assert C.desfase_a_cdmx_horas(sistema) == -6 - STD[sistema]
    assert (C.utc_a_cdmx((exp + pd.Timedelta(hours=6)).tz_localize("UTC")) == exp).all()
    g["exp"] = exp
    con = duckdb.connect()
    con.register("g", g)
    ok = con.execute(f"select bool_and({C.sql_ts_cdmx(sistema_col=repr(sistema))} = exp) from g").fetchone()[0]
    assert ok
