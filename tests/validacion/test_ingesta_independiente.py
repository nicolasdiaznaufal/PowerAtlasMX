"""Validación independiente de la ingesta (ingest_portal.py -> Parquet -> build_duckdb.py -> pml.duckdb).

Se recalcula TODO desde los CSV crudos de data/raw/cenace con un parser propio (DuckDB read_csv,
todo como texto, salto hasta la fila 'Fecha' localizada aquí). No se importa nada de pipeline/.
Todas las pruebas que leen datos son `pesado` y se omiten si faltan los datos.
"""
from __future__ import annotations

import datetime as dt
import re
import subprocess
from pathlib import Path

import pytest

from conftest import DB_PATH, PARQUET_ROOT, RAW_ROOT, ROOT

pytestmark = pytest.mark.pesado

FILAS_ESPERADAS = 151_050_393
DIAS_ESPERADOS = (dt.date(2026, 9, 30) - dt.date(2020, 1, 1)).days + 1  # 2,465
CABECERA = {
    "Sistema Interconectado Nacional": "SIN",
    "Sistema Interconectado Baja California": "BCA",
    "Sistema Interconectado Baja California Sur": "BCS",
}
# Muestra nombrada (>= 15): las 6 cabeceras mentirosas, 'Dic' de varios años y archivos de cada sistema/año.
MUESTRA = [
    "SIN MDA Mes Ene01 v2022", "SIN MDA Mes Ene01 v2023", "BCA MDA Mes Ene01 v2022",
    "BCA MDA Mes Ene01 v2023", "BCS MDA Mes Ene01 v2022", "BCS MDA Mes Ene01 v2023",
    "SIN MDA Mes Dic01 v2021", "BCA MDA Mes Dic02 v2021", "BCS MDA Mes Dic01 v2021",
    "SIN MDA Mes Dic02 v2023", "BCA MDA Mes Dic01 v2025", "BCS MDA Mes Dic02 v2026",
    "SIN MDA Mes Oct02 v2020", "BCA MDA Mes Mar01 v2020", "BCS MDA Mes Abr01 v2022",
    "SIN MDA Mes Nov01 v2022", "BCA MDA Mes Nov01 v2025", "SIN MDA Mes Sep02 v2026",
]


def _csvs() -> list[Path]:
    return sorted(RAW_ROOT.rglob("*.csv")) if RAW_ROOT.exists() else []


def _meta(f: Path) -> dict:
    """Cabecera leída aquí: línea 3 = sistema, línea 5 = 'Mes de ...', fila del encabezado 'Fecha'."""
    with open(f, encoding="utf-8") as fh:
        lines = [next(fh, "") for _ in range(30)]
    clean = [ln.strip().strip('"').strip() for ln in lines]
    hdr = next(i for i, ln in enumerate(lines) if ln.split(",")[0].strip().strip('"').strip() == "Fecha")
    toks = [t for t in ("SIN", "BCA", "BCS") if f" {t} " in f.name]
    return {"filename": str(f), "fn": f.name, "sis_cab": CABECERA.get(clean[2]), "linea3": clean[2],
            "linea5": clean[4], "tok": toks[0] if len(toks) == 1 else None, "skip": hdr + 1}


@pytest.fixture(scope="module")
def crudo(db):
    """Agregados por archivo y por (sistema, fecha, hora) recalculados desde los CSV crudos."""
    fs = _csvs()
    if len(fs) == 0:
        pytest.skip("sin CSV crudos en data/raw/cenace")
    import pandas as pd

    meta = pd.DataFrame([_meta(f) for f in fs])
    db.register("meta_df", meta)
    db.execute("create or replace temp table meta as select * from meta_df")
    cols = "{'f':'VARCHAR','h':'VARCHAR','n':'VARCHAR','p':'VARCHAR','e':'VARCHAR','l':'VARCHAR','g':'VARCHAR'}"
    partes = []
    for skip, grp in meta.groupby("skip"):
        lst = "[" + ",".join("'" + p.replace("'", "''") + "'" for p in grp.filename) + "]"
        partes.append(f"""select filename, try_cast(trim(f) as DATE) fecha, try_cast(trim(h) as INTEGER) hora,
            trim(n) nodo, try_cast(replace(trim(p), ',', '') as DOUBLE) pml,
            try_cast(replace(trim(e), ',', '') as DOUBLE) energia, try_cast(replace(trim(l), ',', '') as DOUBLE) perd,
            try_cast(replace(trim(g), ',', '') as DOUBLE) cong
            from read_csv({lst}, skip={int(skip)}, header=false, columns={cols}, quote='"', delim=',',
                          filename=true, null_padding=true)""")
    db.execute("create or replace temp view crudo as " + " union all ".join(partes))
    db.execute("""create or replace temp table c_arch as
        select filename, count(*) n, count(fecha) n_fecha, count(hora) n_hora, count(pml) n_pml,
               count(*) filter (where nodo is null or nodo = '') n_sin_nodo,
               min(fecha) fmin, max(fecha) fmax, sum(pml) spml, min(pml) pmin, max(pml) pmax,
               min(hora) hmin, max(hora) hmax,
               count(*) filter (where abs(pml - (energia + perd + cong)) > 0.015) n_res_015,
               count(*) filter (where abs(pml - (energia + perd + cong)) > 0.02 + 1e-9) n_res_02,
               count(*) filter (where energia is null or perd is null or cong is null) n_comp_null
        from crudo group by filename""")
    db.execute("""create or replace temp table c_fh as
        select m.sis_cab sistema, c.fecha, c.hora, count(*) n, sum(c.pml) spml, sum(c.energia) se, sum(c.cong) sg,
               count(distinct c.filename) narch
        from crudo c join meta m using (filename) group by all""")
    return meta


@pytest.fixture(scope="module")
def db_fh(db):
    db.execute("""create or replace temp table d_fh as select sistema, fecha, hora, count(*) n, sum(pml) spml,
                  sum(energia) se, sum(congestion) sg from db.pml_hourly group by all""")
    return "d_fh"


@pytest.fixture(scope="module")
def pq_fh(db):
    if not PARQUET_ROOT.exists():
        pytest.skip("sin Parquet")
    glob = str(PARQUET_ROOT / "**" / "*.parquet")
    db.execute(f"""create or replace temp table p_fh as
        select cast(sistema as varchar) sistema, cast(fecha as date) fecha, cast(hora as int) hora, count(*) n,
               sum(pml) spml, sum(energia) se, sum(congestion) sg
        from read_parquet('{glob}', hive_partitioning = false) group by all""")
    return "p_fh"


# ------------------------------------------------------------------ inventario y cabeceras
def test_486_archivos_y_sistema_de_linea_3(crudo):
    assert len(crudo) == 486
    assert crudo.sis_cab.notna().all(), crudo[crudo.sis_cab.isna()].linea3.unique()
    assert (crudo.sis_cab == crudo.tok).all()
    assert crudo.sis_cab.value_counts().to_dict() == {"SIN": 162, "BCA": 162, "BCS": 162}


def test_archivos_parciales_no_csv():
    """Restos de descargas (p. ej. '.X.csv.Pzfc8b') no deben confundirse con datos: se listan."""
    if not RAW_ROOT.exists():
        pytest.skip("sin CSV crudos")
    restos = [p.name for p in RAW_ROOT.rglob("*") if p.is_file() and ".csv" in p.name and p.suffix != ".csv"]
    # Hallazgo informativo: no rompe la ingesta (rglob '*.csv' no los toma), pero conviene borrarlos.
    assert all(n.startswith(".") for n in restos), restos


def test_parseo_crudo_completo(db, crudo):
    r = db.execute("""select sum(n), sum(n_fecha), sum(n_hora), sum(n_pml), sum(n_sin_nodo), sum(n_comp_null)
                      from c_arch""").fetchone()
    assert r == (FILAS_ESPERADAS,) * 4 + (0, 0)


def test_cabeceras_mentirosas_son_exactamente_6(db, crudo):
    """Línea 5 ('Mes de X de AAAA') vs año real de la columna Fecha."""
    rows = db.execute("""select m.fn, m.linea5, a.fmin, a.fmax from c_arch a join meta m using (filename)
                         where m.linea5 not ilike '%' || year(a.fmin)::varchar || '%'""").fetchall()
    nombres = sorted(re.search(r"(SIN|BCA|BCS) MDA Mes Ene01 v(\d{4})", r[0]).group(0) for r in rows)
    assert nombres == sorted(f"{s} MDA Mes Ene01 v{y}" for s in ("SIN", "BCA", "BCS") for y in (2022, 2023))
    for fn, l5, fmin, fmax in rows:
        y = int(re.search(r"v(\d{4})", fn).group(1))
        assert (fmin, fmax) == (dt.date(y, 1, 1), dt.date(y, 1, 15)), fn
        assert str(y - 1) in l5  # la cabecera dice el año anterior


@pytest.mark.parametrize("muestra", MUESTRA)
def test_muestra_por_archivo_vs_parquet_y_duckdb(db, crudo, muestra):
    fila = crudo[crudo.fn.str.contains(muestra, regex=False)]
    assert len(fila) == 1, muestra
    f = fila.iloc[0]
    a = db.execute("select n, fmin, fmax, spml, pmin, pmax, hmin, hmax from c_arch where filename = ?",
                   [f.filename]).fetchone()
    n, fmin, fmax, spml, pmin, pmax, hmin, hmax = a
    if " Dic0" in f.fn:  # 'Dic vYYYY' = diciembre de YYYY-1
        y = int(re.search(r"v(\d{4})", f.fn).group(1))
        assert fmin.year == fmax.year == y - 1 and fmin.month == fmax.month == 12
    q = """select count(*), min(fecha), max(fecha), sum(pml), min(pml), max(pml), min(hora), max(hora)
           from {src} where sistema = ? and fecha between ? and ?"""
    glob = str(PARQUET_ROOT / f"sistema={f.sis_cab}" / "**" / "*.parquet")
    for src in ("db.pml_hourly",
                f"(select cast(sistema as varchar) sistema, cast(fecha as date) fecha, hora, pml "
                f"from read_parquet('{glob}', hive_partitioning = false))"):
        b = db.execute(q.format(src=src), [f.sis_cab, fmin, fmax]).fetchone()
        assert b[0] == n and b[1:3] == (fmin, fmax) and b[4:] == (pmin, pmax, hmin, hmax), (src, a, b)
        assert b[3] == pytest.approx(spml, rel=1e-12, abs=1e-6), src


def test_todos_los_archivos_vs_duckdb(db, crudo, db_fh):
    """Por archivo (los 486): n, sum(pml), min/max de fecha contra DuckDB en el mismo (sistema, rango)."""
    malos = db.execute("""
        with d as (select sistema, fecha, sum(n) n, sum(spml) spml from d_fh group by all)
        select m.fn, a.n, sum(d.n), a.spml, sum(d.spml)
        from c_arch a join meta m using (filename)
        left join d on d.sistema = m.sis_cab and d.fecha between a.fmin and a.fmax
        group by all
        having a.n is distinct from sum(d.n) or abs(a.spml - sum(d.spml)) > 1e-6 * greatest(1, abs(a.spml))
        limit 20""").fetchall()
    assert malos == []


def test_archivos_no_se_solapan(db, crudo):
    assert db.execute("select count(*) from c_fh where narch > 1").fetchone()[0] == 0


def test_crudo_igual_a_duckdb_por_sistema_fecha_hora(db, crudo, db_fh):
    r = db.execute("""select count(*) from c_fh c full join d_fh d using (sistema, fecha, hora)
        where c.n is distinct from d.n
           or abs(c.spml - d.spml) > 1e-7 * greatest(1, abs(c.spml))
           or abs(c.se - d.se) > 1e-7 * greatest(1, abs(c.se))
           or abs(c.sg - d.sg) > 1e-7 * greatest(1, abs(c.sg))""").fetchone()[0]
    assert r == 0


def test_parquet_igual_a_duckdb(db, db_fh, pq_fh):
    assert db.execute("select sum(n) from p_fh").fetchone()[0] == FILAS_ESPERADAS
    assert db.execute("select count(*) from db.pml_hourly").fetchone()[0] == FILAS_ESPERADAS
    r = db.execute("""select count(*) from p_fh p full join d_fh d using (sistema, fecha, hora)
        where p.n is distinct from d.n or abs(p.spml - d.spml) > 1e-7 * greatest(1, abs(p.spml))""").fetchone()[0]
    assert r == 0


# ------------------------------------------------------------------ DuckDB
def test_sin_claves_duplicadas(db):
    assert db.execute("""select count(*) from (select 1 from db.pml_hourly
                         group by sistema, fecha, hora, nodo having count(*) > 1)""").fetchone()[0] == 0


def test_dias_por_sistema(db):
    r = db.execute("""select sistema, count(distinct fecha), min(fecha), max(fecha)
                      from db.pml_hourly group by 1 order by 1""").fetchall()
    assert r == [(s, DIAS_ESPERADOS, dt.date(2020, 1, 1), dt.date(2026, 9, 30)) for s in ("BCA", "BCS", "SIN")]


def test_nodo_en_un_solo_sistema(db):
    assert db.execute("""select count(*) from (select nodo from db.pml_hourly group by nodo
                         having count(distinct sistema) > 1)""").fetchone()[0] == 0


def test_componentes_suman_pml(db, crudo):
    """pml = energía + pérdidas + congestión dentro del redondeo a centavos (|r| <= 0.02).
    Filas en el borde 0.015 < |r| <= 0.02: se cuentan (esperado: redondeo de 4 cifras a 2 decimales)."""
    n015, n02, nnull = db.execute("""select
        count(*) filter (where abs(pml - (energia + perdidas + congestion)) > 0.015),
        count(*) filter (where abs(pml - (energia + perdidas + congestion)) > 0.02 + 1e-9),
        count(*) filter (where pml is null or energia is null or perdidas is null or congestion is null
                         or isnan(pml)) from db.pml_hourly""").fetchone()
    assert n02 == 0 and nnull == 0
    assert n015 == db.execute("select sum(n_res_015) from c_arch").fetchone()[0]  # mismo número que el crudo
    assert n015 == 11_690


def test_energia_uniforme_por_sistema_hora(db):
    """El componente de energía es único por (sistema, fecha, hora): prueba de que no se mezclan sistemas."""
    assert db.execute("""select count(*) from (select 1 from db.pml_hourly group by sistema, fecha, hora
                         having min(energia) <> max(energia))""").fetchone()[0] == 0


def test_plausibilidad_rangos(db):
    r = {s: (lo, hi) for s, lo, hi in db.execute(
        "select sistema, min(pml), max(pml) from db.pml_hourly group by 1").fetchall()}
    # Rangos observados en MXN/MWh; un cambio de escala (p. ej. MXN/kWh o x1000) los rompe.
    for s, (lo, hi) in r.items():
        assert -5_000 < lo < 0 < 10_000 < hi < 100_000, (s, lo, hi)


def test_nodos_con_pocos_dias_documentados(db):
    """Nodos con < 30 días: se listan para el dueño de calidad (no es error de ingesta)."""
    pocos = db.execute("""select sistema, nodo, count(distinct fecha) d from db.pml_hourly
                          group by all having d < 30 order by d""").fetchall()
    assert {(s, n) for s, n, _ in pocos} == {("BCS", "07TCB-230"), ("SIN", "05APR-115"), ("SIN", "03TLJ-230")}


def test_rango_de_hora(db):
    r = db.execute("""select min(hora), max(hora), count(distinct (sistema, fecha)) filter (where hora = 25)
                      from db.pml_hourly""").fetchone()
    assert r[0] == 1 and r[1] == 25 and r[2] == 12  # 12 (sistema, día): SIN 3 + BCS 3 + BCA 6
    # el detalle (25 solo en días de otoño, todos los nodos) está en test_clock_independiente


# ------------------------------------------------------------------ git
def test_datos_ignorados_por_git():
    if not (ROOT / ".git").exists():
        pytest.skip("no hay repo git")
    muestras = [DB_PATH, PARQUET_ROOT / "sistema=SIN" / "anio=2024" / "mes=01" / "part.parquet"]
    muestras += _csvs()[:3] + [ROOT / "x.duckdb", ROOT / "pipeline" / "x.parquet", ROOT / "tests" / "x.csv"]
    r = subprocess.run(["git", "check-ignore", "--no-index", *map(str, muestras)], cwd=ROOT,
                       capture_output=True, text=True)
    ignorados = set(r.stdout.split("\n")) - {""}
    assert ignorados == set(map(str, muestras)), set(map(str, muestras)) - ignorados
    tracked = subprocess.run(["git", "ls-files", "--cached"], cwd=ROOT, capture_output=True, text=True).stdout
    assert not [t for t in tracked.splitlines() if t.endswith((".parquet", ".duckdb", ".csv"))
                and not t.startswith("legacy/outputs/")]
