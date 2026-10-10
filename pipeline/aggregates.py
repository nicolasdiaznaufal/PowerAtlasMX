"""Agregados mensuales ADITIVOS por nodo x mes x hora del dia x configuracion (agent kpis).

Formulas, unidades y convenciones completas: docs/TECNICO.md, seccion "Agregados aditivos".

Entradas (solo lectura)
    data/db/pml.duckdb, tabla pml_hourly (sistema, fecha, hora publicada 1..n, nodo, pml, energia,
        perdidas, congestion; MXN/MWh, 2 decimales).
    data/baselines/solar_baselines_month_hour.parquet (solar.py): y(mes, hora) en MWh/MWp para
        'fixed' y 'tracker', dia promedio del mes en hora CDMX (UTC-6 fijo, inicio de hora), 2015-2025
        (columna clock = 'CDMX estandar UTC-6 fijo'; se exige).
    data/quality/nodos_calidad.parquet (calidad): meses_de_datos, confianza, valido, estado.

Salidas (data/aggregates/, git-ignored)
    agregados_comunes.parquet  (sistema, nodo, anio, mes, hora) -> sumas que NO dependen de la
                               configuracion FV (todos los nodos con PML, con o sin baseline).
    agregados_config.parquet   (sistema, nodo, anio, mes, hora, config) -> sumas ponderadas por y
                               (solo nodos con baseline solar).
    agregados_nodos.parquet    un renglon por nodo: calidad + coordenadas (fuente/precision) + si tiene
                               baseline y por que no.
    agregados_meta.json        reloj, periodo civil de los datos y, por sistema, la ventana de datos en
                               hora CDMX y los MESES DE BORDE (incompletos por construccion).

Definiciones
    ts   = clock.ts_cdmx(sistema, fecha, hora): INICIO de la hora publicada en el reloj COMUN, hora CDMX
           (UTC-6 fijo, sin horario de verano) para los TRES sistemas (= ts_local_estandar + 0 h SIN,
           +1 h BCS, +2 h BCA). En SQL: clock.sql_ts_cdmx(). (anio, mes, hora) = year(ts), month(ts),
           hour(ts). Nunca (fecha, hora-1).
    y    = produccion FV en esa hora por MWp DC instalado [MWh/MWp] = baseline climatologico de
           solar.py en (month(ts), hour(ts)) para la configuracion. Es el MISMO valor para todas las
           horas de un mismo (mes calendario, hora del dia) en cualquier ano: perfil de ano tipico
           2015-2025 aplicado a cada hora real de PML [estimado; ver TECNICO.md].
    Dias de 23/25 horas: cada hora publicada se convierte a su propio instante CDMX y entra una sola
    vez en su (anio, mes, hora) CDMX; el dia de 25 h aporta 25 horas y el de 23 h, 23. En hora CDMX
    cada hora del calendario aparece exactamente una vez por nodo (sin huecos ni duplicados), asi que
    un mes completo tiene dias_del_mes x 24 horas.
    Bordes de los datos (por el corrimiento a CDMX de BCA +2 h y BCS +1 h): enero de 2020 no tiene
    sus primeras 2 (BCA) / 1 (BCS) horas, y el ultimo dato (2026-09-30 hora 24) cae en 2026-10-01
    CDMX, lo que crea un octubre de 2026 de 1-2 h. Esas celdas SE CONSERVAN (la suma total sigue
    igual al numero de filas), pero sus meses se declaran 'borde' en agregados_meta.json y kpis.py
    nunca los cuenta como mes/ano completo ni los incluye en el periodo por defecto.

Sumas (columna = definicion; la suma corre sobre las horas con PML de esa celda)
    n_horas               = #horas                                         [h]
    n_pml_le0             = #horas con pml <= 0                            [h]
    sum_pml_cent          = sum(round(100*pml))   (entero, centavos)       [centavo MXN/MWh x h]
    sum_energia_cent, sum_perdidas_cent, sum_congestion_cent: igual con cada componente
    sum_y                 = sum(y)                                         [MWh/MWp]
    sum_y_pml             = sum(y*pml)                                     [MXN/MWp]
    sum_y_le0             = sum(y where pml <= 0)                          [MWh/MWp]
    sum_y_energia, sum_y_perdidas, sum_y_congestion = sum(y*componente)    [MXN/MWp]
    y_mwh_por_mwp         = y de la celda (constante en la celda)          [MWh/MWp]
Los PML vienen con 2 decimales exactos (verificado: |100*pml - round(100*pml)| < 5e-10), asi que
las sumas en centavos enteros son EXACTAS y se combinan sin error en cualquier rango de meses.
"""
from __future__ import annotations

import datetime as dt
import functools
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import clock  # noqa: E402

RELOJ = "CDMX estandar UTC-6 fijo"

DB = ROOT / "data" / "db" / "pml.duckdb"
BASELINE_MH = ROOT / "data" / "baselines" / "solar_baselines_month_hour.parquet"
BASELINE_META = ROOT / "data" / "baselines" / "solar_baselines_metadata.json"
CALIDAD = ROOT / "data" / "quality" / "nodos_calidad.parquet"
OUT = ROOT / "data" / "aggregates"

CONFIGS = ("fixed", "tracker")
KEYS = ["sistema", "nodo", "anio", "mes", "hora"]
COMUNES = ["n_horas", "n_pml_le0", "sum_pml_cent", "sum_energia_cent", "sum_perdidas_cent",
           "sum_congestion_cent"]
PONDERADAS = ["sum_y", "sum_y_pml", "sum_y_le0", "sum_y_energia", "sum_y_perdidas", "sum_y_congestion"]
COMPONENTES = ("pml", "energia", "perdidas", "congestion")


def conectar(db: Path = DB, memory: str | None = None) -> duckdb.DuckDBPyConnection:
    """Conexion en memoria con la base adjunta READ_ONLY como `db` (las tablas temporales no tocan
    el archivo)."""
    con = duckdb.connect()
    con.execute(f"SET memory_limit='{memory or os.environ.get('KPIS_MEM', '6GB')}'")
    con.execute("SET threads=6; SET preserve_insertion_order=false")
    con.execute(f"SET temp_directory='{tempfile.mkdtemp(prefix='kpis_duckdb_')}'")
    con.execute(f"ATTACH '{db}' AS db (READ_ONLY)")
    return con


def cargar_baseline(path: Path = BASELINE_MH) -> pd.DataFrame:
    """Perfil y(mes, hora) por nodo y config: columnas nodo, config, mes, hora, y_mwh_por_mwp.
    Exige 12 x 24 valores finitos y >= 0 por (nodo, config); si no, error (no se rellena)."""
    b = pd.read_parquet(path)
    b = b[~b["loc_id"].astype(str).str.startswith("cell_")]
    b = b.rename(columns={"loc_id": "nodo", "month": "mes", "hour": "hora",
                          "mwh_per_mwp_mean_day": "y_mwh_por_mwp"})[["nodo", "config", "mes", "hora", "y_mwh_por_mwp"]]
    b["nodo"] = b["nodo"].astype(str)
    b["config"] = b["config"].astype(str)
    b["mes"] = b["mes"].astype("int64")
    b["hora"] = b["hora"].astype("int64")
    cnt = b.groupby(["nodo", "config"]).size()
    if (cnt != 288).any() or not np.isfinite(b["y_mwh_por_mwp"]).all() or (b["y_mwh_por_mwp"] < 0).any():
        raise ValueError("baseline incompleto o invalido (se esperan 12x24 valores finitos >= 0)")
    if "clock" in pd.read_parquet(path, columns=["clock"]).columns:
        relojes = set(pd.read_parquet(path, columns=["clock"])["clock"].astype(str))
        if relojes != {RELOJ}:
            raise ValueError(f"baseline en otro reloj: {relojes} (se espera {RELOJ})")
    if set(b["config"]) != set(CONFIGS):
        raise ValueError(f"configs inesperadas en baseline: {set(b['config'])}")
    return b.reset_index(drop=True)


def _sql_hourly(where: str) -> str:
    ts = clock.sql_ts_cdmx("sistema", "fecha", "hora")
    return (f"SELECT sistema, nodo, {ts} AS ts, pml, energia, perdidas, congestion "
            f"FROM db.pml_hourly WHERE {where}")


def _sql_comunes(where: str) -> str:
    cents = ", ".join(f"CAST(sum(CAST(round(100*{c}) AS BIGINT)) AS BIGINT) AS sum_{c}_cent" for c in COMPONENTES)
    return f"""
        WITH h AS ({_sql_hourly(where)})
        SELECT sistema, nodo, year(ts)::INTEGER AS anio, month(ts)::INTEGER AS mes, hour(ts)::INTEGER AS hora,
               count(*)::BIGINT AS n_horas, sum(CASE WHEN pml <= 0 THEN 1 ELSE 0 END)::BIGINT AS n_pml_le0,
               {cents}
        FROM h GROUP BY ALL"""


def _sql_config(where: str) -> str:
    return f"""
        WITH h AS ({_sql_hourly(where)})
        SELECT h.sistema, h.nodo, year(h.ts)::INTEGER AS anio, month(h.ts)::INTEGER AS mes,
               hour(h.ts)::INTEGER AS hora, b.config,
               any_value(b.y_mwh_por_mwp) AS y_mwh_por_mwp,
               sum(b.y_mwh_por_mwp) AS sum_y,
               sum(b.y_mwh_por_mwp * h.pml) AS sum_y_pml,
               sum(CASE WHEN h.pml <= 0 THEN b.y_mwh_por_mwp ELSE 0 END) AS sum_y_le0,
               sum(b.y_mwh_por_mwp * h.energia) AS sum_y_energia,
               sum(b.y_mwh_por_mwp * h.perdidas) AS sum_y_perdidas,
               sum(b.y_mwh_por_mwp * h.congestion) AS sum_y_congestion
        FROM h JOIN base b ON b.nodo = h.nodo AND b.mes = month(h.ts) AND b.hora = hour(h.ts)
        GROUP BY ALL"""


def _in_list(nodos) -> str:
    return "nodo IN (" + ", ".join("'" + str(n).replace("'", "''") + "'" for n in nodos) + ")"


def agregar(con, nodos: list[str] | None = None, base: pd.DataFrame | None = None,
            chunk: int = 400) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(comunes, config) para `nodos` (None = todos). `base` = cargar_baseline(); los nodos sin
    baseline solo aparecen en `comunes`. Procesa por lotes de `chunk` nodos (memoria acotada)."""
    base = cargar_baseline() if base is None else base
    con.register("base_df", base)
    con.execute("CREATE OR REPLACE TEMP TABLE base AS SELECT * FROM base_df")
    if nodos is None:
        nodos = [r[0] for r in con.execute("SELECT DISTINCT nodo FROM db.pml_hourly ORDER BY 1").fetchall()]
    con_base = set(base["nodo"])
    com, cfg = [], []
    for i in range(0, len(nodos), chunk):
        lote = list(nodos[i:i + chunk])
        com.append(con.execute(_sql_comunes(_in_list(lote))).df())
        lb = [n for n in lote if n in con_base]
        if lb:
            cfg.append(con.execute(_sql_config(_in_list(lb))).df())
    comunes = pd.concat(com, ignore_index=True) if com else pd.DataFrame(columns=KEYS + COMUNES)
    config = pd.concat(cfg, ignore_index=True) if cfg else pd.DataFrame(columns=KEYS + ["config", "y_mwh_por_mwp"] + PONDERADAS)
    for c in ("sistema", "nodo"):
        comunes[c] = comunes[c].astype(str)
        config[c] = config[c].astype(str)
    if len(config):
        config["config"] = config["config"].astype(str)
    comunes = comunes.sort_values(KEYS).reset_index(drop=True)
    config = config.sort_values(KEYS + ["config"]).reset_index(drop=True)
    _verificar(comunes, config)
    return comunes, config


def _verificar(comunes: pd.DataFrame, config: pd.DataFrame) -> None:
    """Invariantes baratos: claves unicas, n_horas por celda <= dias del mes, config cubre las celdas
    de comunes de sus nodos, y sum_y = y * n_horas (y constante por celda)."""
    if comunes.duplicated(KEYS).any() or config.duplicated(KEYS + ["config"]).any():
        raise AssertionError("claves duplicadas en agregados")
    dim = pd.to_datetime(dict(year=comunes["anio"], month=comunes["mes"], day=1)).dt.days_in_month
    if (comunes["n_horas"] > dim).any() or (comunes["n_horas"] < 1).any():
        raise AssertionError("n_horas fuera de [1, dias_del_mes] en alguna celda")
    if len(config):
        j = config.merge(comunes[KEYS + ["n_horas"]], on=KEYS, how="left", validate="many_to_one")
        if j["n_horas"].isna().any():
            raise AssertionError("celda config sin celda comun")
        if not np.allclose(j["sum_y"], j["y_mwh_por_mwp"] * j["n_horas"], rtol=1e-12, atol=1e-12):
            raise AssertionError("sum_y != y * n_horas")
        nn = config["nodo"].unique()
        nc = comunes[comunes["nodo"].isin(nn)]
        if len(nc) * len(CONFIGS) != len(config):
            raise AssertionError("config no cubre todas las celdas comunes de sus nodos")


def ventana_cdmx(sistema: str, fecha_ini, fecha_fin) -> tuple[pd.Timestamp, pd.Timestamp]:
    """[primer, ultimo] instante CDMX (inicio de hora) que pueden tener los datos de `sistema` si el
    periodo civil publicado va de fecha_ini hora 1 a fecha_fin hora n (n = horas_en_dia)."""
    return _ventana(sistema, str(pd.Timestamp(fecha_ini).date()), str(pd.Timestamp(fecha_fin).date()))


@functools.lru_cache(maxsize=None)
def _ventana(sistema: str, fi: str, ff: str) -> tuple[pd.Timestamp, pd.Timestamp]:
    a, b = dt.date.fromisoformat(fi), dt.date.fromisoformat(ff)
    return (clock.ts_cdmx(sistema, a, 1), clock.ts_cdmx(sistema, b, clock.horas_en_dia(sistema, b)))


def horas_posibles_mes(sistema: str, anio: int, mes: int, fecha_ini, fecha_fin) -> int:
    """Horas del mes CDMX (anio, mes) que caen dentro de la ventana de datos del sistema."""
    a, b = ventana_cdmx(sistema, fecha_ini, fecha_fin)
    m0 = pd.Timestamp(year=int(anio), month=int(mes), day=1)
    m1 = m0 + pd.offsets.MonthBegin(1) - pd.Timedelta(hours=1)        # ultimo inicio de hora del mes
    lo, hi = max(a, m0), min(b, m1)
    return 0 if hi < lo else int((hi - lo) / pd.Timedelta(hours=1)) + 1


def meses_borde(sistema: str, fecha_ini, fecha_fin) -> list[str]:
    """Meses CDMX ('YYYY-MM') tocados por la ventana de datos pero no cubiertos completos por ella."""
    a, b = ventana_cdmx(sistema, fecha_ini, fecha_fin)
    out = []
    for p in pd.period_range(a, b, freq="M"):
        esp = p.days_in_month * 24
        if horas_posibles_mes(sistema, p.year, p.month, fecha_ini, fecha_fin) != esp:
            out.append(f"{p.year:04d}-{p.month:02d}")
    return out


def meta(fecha_ini, fecha_fin) -> dict:
    """Reloj, periodo civil y bordes por sistema (para kpis.py y el contrato)."""
    fi, ff = pd.Timestamp(fecha_ini), pd.Timestamp(fecha_fin)
    return {"reloj": RELOJ, "fecha_ini_civil": str(fi.date()), "fecha_fin_civil": str(ff.date()),
            "periodo_meses": [f"{fi.year:04d}-{fi.month:02d}", f"{ff.year:04d}-{ff.month:02d}"],
            "sistemas": {s: {"desfase_a_cdmx_horas": clock.desfase_a_cdmx_horas(s),
                             "ventana_cdmx": [str(x) for x in ventana_cdmx(s, fi, ff)],
                             "meses_borde": meses_borde(s, fi, ff)} for s in clock.SISTEMAS}}


def combinar(comunes: pd.DataFrame, config: pd.DataFrame, cfg: str) -> pd.DataFrame:
    """Une comunes + una config: una fila por (sistema, nodo, anio, mes, hora) con todas las sumas."""
    c = config[config["config"] == cfg].drop(columns=["config"])
    return comunes.merge(c, on=KEYS, how="inner", validate="one_to_one")


def tabla_nodos(comunes: pd.DataFrame, base: pd.DataFrame, calidad_path: Path = CALIDAD,
                meta_path: Path = BASELINE_META) -> pd.DataFrame:
    """Un renglon por nodo con PML: calidad (meses_de_datos, confianza, valido, estado, pct) y
    tiene_baseline + motivo_sin_baseline (nunca se omite un nodo en silencio)."""
    q = pd.read_parquet(calidad_path)
    q["nodo"] = q["nodo"].astype(str)
    q["sistema"] = q["sistema"].astype(str)
    nodos = comunes[["sistema", "nodo"]].drop_duplicates()
    t = nodos.merge(q[["sistema", "nodo", "primera_fecha", "ultima_fecha", "meses_de_datos", "confianza",
                       "valido", "estado", "horas_con_datos", "horas_hueco", "pct_hueco_vida",
                       "pct_faltante_periodo", "n_negativo"]], on=["sistema", "nodo"], how="left")
    t["tiene_baseline"] = t["nodo"].isin(set(base["nodo"]))
    sin_celda: set[tuple[int, int]] = set()
    if meta_path.exists():
        m = json.loads(meta_path.read_text())
        sin_celda = {tuple(c) for c in m.get("nodes_skipped_no_climate_cell", {}).get("cells_needed", [])}
    try:
        import solar
        coords = solar.load_node_coords(ROOT)
        coords["nodo"] = coords["nodo"].astype(str)
    except Exception:  # pragma: no cover
        coords = pd.DataFrame(columns=["nodo", "lat", "lon", "coord_source", "coord_precision"])
    t = t.merge(coords[["nodo", "lat", "lon", "coord_source", "coord_precision"]], on="nodo", how="left")
    en_catalogo = _codigos_catalogo()

    def motivo(r):
        if r.tiene_baseline:
            return None
        if pd.isna(r.lat):
            if r.nodo in en_catalogo:
                return ("sin_coordenadas: el nodo esta en el catalogo NodosP pero sin municipio con centroide "
                        "(p. ej. interconexion 'No Aplica'); no hay ubicacion para el clima")
            return ("sin_coordenadas: el nodo ya no esta en el catalogo NodosP (v2026-07-16) y no tiene renombre "
                    "declarado en 'Control de Cambios'; no hay ubicacion para el clima")
        import math
        cell = (math.floor(r.lat), math.floor(r.lon))
        if cell in sin_celda or r.sistema in ("BCA", "BCS"):
            return (f"sin_clima (en espera): falta la celda NASA POWER {cell[0]:+d},{cell[1]:+d} en data/cache/nasa "
                    "(baseline BCA/BCS en espera, ver solar_baselines_metadata.json)")
        return "sin_baseline: motivo no identificado"
    t["motivo_sin_baseline"] = [motivo(r) for r in t.itertuples()]
    return t.sort_values(["sistema", "nodo"]).reset_index(drop=True)


def _codigos_catalogo() -> set[str]:
    try:
        import openpyxl
        xl = next((ROOT / "data" / "ref").glob("Cat*NodosP*.xlsx"))
        ws = openpyxl.load_workbook(xl, read_only=True, data_only=True).worksheets[0]
        return {str(r[3]) for r in ws.iter_rows(min_row=3, values_only=True) if r and r[3]}
    except Exception:  # pragma: no cover
        return set()


def main(out: Path = OUT) -> dict:
    t0 = time.time()
    out.mkdir(parents=True, exist_ok=True)
    con = conectar()
    base = cargar_baseline()
    comunes, config = agregar(con, base=base)
    nodos = tabla_nodos(comunes, base)
    comunes.to_parquet(out / "agregados_comunes.parquet", index=False)
    config.to_parquet(out / "agregados_config.parquet", index=False)
    nodos.to_parquet(out / "agregados_nodos.parquet", index=False)
    tot, fi, ff = con.execute("SELECT count(*), min(fecha), max(fecha) FROM db.pml_hourly").fetchone()
    m = meta(fi, ff)
    (out / "agregados_meta.json").write_text(json.dumps(m, indent=1))
    # ningun dato fuera de la ventana CDMX de su sistema
    for s_, v in m["sistemas"].items():
        c = comunes[comunes["sistema"] == s_]
        if len(c):
            ym = c["anio"] * 100 + c["mes"]
            a, b = (pd.Timestamp(x) for x in v["ventana_cdmx"])
            if ym.min() < a.year * 100 + a.month or ym.max() > b.year * 100 + b.month:
                raise AssertionError(f"celdas fuera de la ventana CDMX de {s_}")
    res = {"filas_pml": int(tot), "filas_en_agregados": int(comunes["n_horas"].sum()),
           "nodos": int(len(nodos)), "nodos_con_baseline": int(nodos["tiene_baseline"].sum()),
           "celdas_comunes": int(len(comunes)), "celdas_config": int(len(config)),
           "meses_borde": {k: v["meses_borde"] for k, v in m["sistemas"].items()},
           "segundos": round(time.time() - t0, 1)}
    if res["filas_pml"] != res["filas_en_agregados"]:
        raise AssertionError(f"se perdieron horas: {res}")
    return res


if __name__ == "__main__":
    print(json.dumps(main(), indent=1))
