"""Calidad y cobertura de datos por nodo (agent calidad).

Entradas : data/db/pml.duckdb, tabla pml_hourly (se abre SOLO LECTURA y se agrega en SQL).
Salidas  : data/quality/ (git-ignored): nodos_calidad.parquet/.csv, cobertura_mes.parquet,
           cobertura_dia.parquet, outliers.parquet, planos.parquet, calidad_resumen.json.
Ejecutar : .venv/bin/python pipeline/quality.py

Definiciones (todas documentadas aqui y en docs/CORRECCIONES.md)
------------------------------------------------------------------
* Horas esperadas de un (sistema, fecha) = clock.horas_en_dia (23/24/25). Nunca 24 fijo.
* Dia con datos de un nodo = tiene >= 1 fila. Horas presentes = filas (no hay duplicados ni PML nulos
  en el historico; si hubiera, un PML nulo NO cuenta como hora presente).
* "Mes con datos" (definicion LITERAL, sin umbral de cobertura): mes calendario en el que el nodo
  tiene al menos 1 hora con PML. Un mes parcial (el nodo entra o sale a mitad de mes) cuenta.
  Informativo y NO usado en la regla: `meses_90pct` = meses con >= 90 % de sus horas esperadas.
  Si el negocio quiere un umbral de cobertura mensual, es decision del orquestador.
* Vida activa de un nodo = [primera fecha con datos, ultima fecha con datos]. Dentro de ella, las horas
  que faltan son HUECOS (pct_hueco_vida). Fuera de ella, el nodo "aun no estaba en el catalogo" o
  "ya salio" (pct_fuera_catalogo): NO son huecos.
* Nodo valido: meses_de_datos >= 12 (MIN_MESES). confianza = "alta" si valido, "baja" si no.
* Baja confianza en un periodo arbitrario [inicio, fin]: meses con datos del nodo DENTRO del periodo
  (meses calendario con >= 1 hora en dias del periodo) < 12.

Outliers (se MARCAN, nunca se borran; ninguna fila se excluye de pml_hourly)
---------------------------------------------------------------------------
Umbrales tecnicos (no de negocio), por sistema, con estadisticos robustos (mediana y MAD*1.4826):
* extremo        : |pml - mediana| > K_EXTREMO * sigma_robusto  (sobre todo el sistema)
* negativo       : pml < 0 (informativo: pueden ser legitimos; el PML puede ser negativo)
* salto          : |pml_t - pml_{t-1}| > K_SALTO * sigma_robusto(delta) en horas consecutivas del nodo
* descomposicion : |pml - (energia + perdidas + congestion)| > TOL_DESCOMP (0.02) + EPS (1e-6; con
                   datos a 2 decimales, |dif| = 0.02 exacto es ruido de punto flotante, no discrepancia)
* aislado        : extremo/salto en el que < UMBRAL_SISTEMICO de los nodos del sistema tienen el mismo
                   flag esa hora (los demas son eventos sistemicos, p.ej. escasez; probablemente reales)
* plano (corrida): >= MIN_PLANO horas consecutivas con exactamente el mismo pml en un nodo
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import clock  # noqa: E402

DB = ROOT / "data" / "db" / "pml.duckdb"
OUT = ROOT / "data" / "quality"

MIN_MESES = 12
PCT_MES_COMPLETO = 0.90      # solo informativo (meses_90pct)
K_EXTREMO = 25.0
K_SALTO = 40.0
TOL_DESCOMP = 0.02
EPS_DESCOMP = 1e-6          # los datos tienen 2 decimales: |dif| = 0.02 es ruido de punto flotante
UMBRAL_SISTEMICO = 0.05     # un flag es 'aislado' si <5 % de los nodos del sistema lo tienen esa hora
MIN_PLANO = 12
SISTEMAS = clock.SISTEMAS


# ---------------------------------------------------------------- cobertura (puro pandas)
def calendario(inicio: dt.date, fin: dt.date, sistemas=SISTEMAS) -> pd.DataFrame:
    """(sistema, fecha, esperadas) con horas_en_dia, un renglon por sistema y dia."""
    fechas = pd.date_range(inicio, fin, freq="D")
    rows = [(s, f, clock.horas_en_dia(s, f.date())) for s in sistemas for f in fechas]
    return pd.DataFrame(rows, columns=["sistema", "fecha", "esperadas"])


def _mes(s: pd.Series) -> pd.Series:
    return s.dt.to_period("M").dt.to_timestamp()


def cobertura_nodos(nodo_dia: pd.DataFrame, cal: pd.DataFrame) -> pd.DataFrame:
    """Calidad por nodo a partir de `nodo_dia` (sistema, nodo, fecha, horas presentes).

    `cal` es el calendario del periodo analizado (sistema, fecha, esperadas); define el periodo
    total. Devuelve un renglon por (sistema, nodo)."""
    nd = nodo_dia.copy()
    nd["fecha"] = pd.to_datetime(nd["fecha"])
    cal = cal.copy()
    cal["fecha"] = pd.to_datetime(cal["fecha"])
    nd = nd[nd["horas"] > 0].merge(cal, on=["sistema", "fecha"], how="inner")
    nd["mes"] = _mes(nd["fecha"])

    g = nd.groupby(["sistema", "nodo"], sort=True)
    res = g.agg(primera_fecha=("fecha", "min"), ultima_fecha=("fecha", "max"),
                dias_con_datos=("fecha", "size"), horas_con_datos=("horas", "sum"),
                meses_de_datos=("mes", "nunique")).reset_index()

    # horas esperadas del periodo total y de la vida activa, por sistema
    cal = cal.sort_values(["sistema", "fecha"])
    cal["cum"] = cal.groupby("sistema")["esperadas"].cumsum()
    cal = cal.set_index(["sistema", "fecha"])
    tot = cal.groupby(level=0)["esperadas"].sum()
    dias_tot = cal.groupby(level=0)["esperadas"].size()

    def _cum(s, f, prev=False):
        c = cal["cum"]
        if prev:
            f = f - pd.Timedelta(days=1)
            return c.get((s, f), 0)
        return c.get((s, f))

    esp_vida = [_cum(s, u) - _cum(s, p, prev=True)
                for s, p, u in zip(res.sistema, res.primera_fecha, res.ultima_fecha)]
    res["horas_esperadas_vida"] = np.array(esp_vida, dtype="int64")
    res["horas_esperadas_periodo"] = res["sistema"].map(tot).astype("int64")
    res["dias_vida"] = (res["ultima_fecha"] - res["primera_fecha"]).dt.days + 1
    res["dias_periodo"] = res["sistema"].map(dias_tot).astype("int64")
    res["horas_hueco"] = res["horas_esperadas_vida"] - res["horas_con_datos"]
    res["dias_hueco"] = res["dias_vida"] - res["dias_con_datos"]
    res["pct_hueco_vida"] = 100.0 * res["horas_hueco"] / res["horas_esperadas_vida"]
    res["pct_fuera_catalogo"] = 100.0 * (res["horas_esperadas_periodo"] - res["horas_esperadas_vida"]) \
        / res["horas_esperadas_periodo"]
    res["pct_faltante_periodo"] = 100.0 * (res["horas_esperadas_periodo"] - res["horas_con_datos"]) \
        / res["horas_esperadas_periodo"]

    # meses con >= 90 % de sus horas esperadas (informativo)
    esp_mes = cal.reset_index()
    esp_mes["mes"] = _mes(esp_mes["fecha"])
    esp_mes = esp_mes.groupby(["sistema", "mes"], as_index=False)["esperadas"].sum() \
        .rename(columns={"esperadas": "esp_mes"})
    hm = nd.groupby(["sistema", "nodo", "mes"], as_index=False)["horas"].sum().merge(
        esp_mes, on=["sistema", "mes"])
    hm["completo"] = hm["horas"] >= PCT_MES_COMPLETO * hm["esp_mes"]
    res = res.merge(hm.groupby(["sistema", "nodo"], as_index=False)["completo"].sum()
                    .rename(columns={"completo": "meses_90pct"}), on=["sistema", "nodo"], how="left")
    res["meses_90pct"] = res["meses_90pct"].fillna(0).astype(int)

    ini = cal.groupby(level=0).apply(lambda d: d.index.get_level_values(1).min())
    fin = cal.groupby(level=0).apply(lambda d: d.index.get_level_values(1).max())
    entra = res["primera_fecha"] > res["sistema"].map(ini)
    sale = res["ultima_fecha"] < res["sistema"].map(fin)
    res["estado"] = np.select(
        [entra & sale, entra, sale], ["entra_y_sale", "entra", "sale"], default="completo")
    res["valido"] = res["meses_de_datos"] >= MIN_MESES
    res["confianza"] = np.where(res["valido"], "alta", "baja")
    for c in ("primera_fecha", "ultima_fecha"):
        res[c] = res[c].dt.date
    return res


def meses_de_datos_en_periodo(nodo_dia: pd.DataFrame, inicio, fin) -> pd.DataFrame:
    """Meses calendario con >= 1 hora de datos, por (sistema, nodo), usando solo dias en [inicio, fin]
    (ambos incluidos). Un mes parcial cuenta si el nodo tiene datos en sus dias dentro del periodo."""
    f = pd.to_datetime(nodo_dia["fecha"])
    m = (f >= pd.Timestamp(inicio)) & (f <= pd.Timestamp(fin)) & (nodo_dia["horas"] > 0)
    d = nodo_dia[m].assign(mes=_mes(f[m]))
    out = d.groupby(["sistema", "nodo"], as_index=False)["mes"].nunique() \
        .rename(columns={"mes": "meses_de_datos"})
    return out


def baja_confianza_periodo(nodo_dia: pd.DataFrame, inicio, fin, min_meses: int = MIN_MESES,
                           nodos: pd.DataFrame | None = None) -> pd.DataFrame:
    """Bandera de baja confianza para un periodo arbitrario [inicio, fin].

    Devuelve (sistema, nodo, meses_de_datos, baja_confianza); baja_confianza = meses_de_datos <
    min_meses. Si se pasa `nodos` (sistema, nodo), los que no tienen datos en el periodo aparecen
    con 0 meses y baja confianza (no desaparecen)."""
    r = meses_de_datos_en_periodo(nodo_dia, inicio, fin)
    if nodos is not None:
        r = nodos[["sistema", "nodo"]].drop_duplicates().merge(r, on=["sistema", "nodo"], how="left")
        r["meses_de_datos"] = r["meses_de_datos"].fillna(0).astype(int)
    r["baja_confianza"] = r["meses_de_datos"] < min_meses
    return r


# ---------------------------------------------------------------- lectura SQL
def _con(db: Path = DB) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(str(db), read_only=True)
    con.execute("SET memory_limit='10GB'; SET threads=6")
    return con


def leer_nodo_dia(con) -> pd.DataFrame:
    return con.execute(
        "SELECT sistema, nodo, fecha, count(pml)::INTEGER AS horas FROM pml_hourly "
        "GROUP BY ALL ORDER BY sistema, nodo, fecha").df()


# ---------------------------------------------------------------- outliers (SQL)
def _cols_comunes(ts):
    return (f"sistema, nodo, fecha, hora, {ts} AS ts, pml, energia, perdidas, congestion")


def outliers(con, k_extremo=K_EXTREMO, k_salto=K_SALTO, tol=TOL_DESCOMP, min_plano=MIN_PLANO,
             n_chunks: int = 8):
    """Devuelve (filas_marcadas DataFrame, planos DataFrame, stats dict por sistema)."""
    ts = clock.sql_ts_local_estandar()
    stats: dict = {}
    marcadas, planos = [], []
    for s in SISTEMAS:
        med, mad = con.execute(
            "SELECT median(pml), median(abs(pml - (SELECT median(pml) FROM pml_hourly WHERE sistema=?)))"
            " FROM pml_hourly WHERE sistema=?", [s, s]).fetchone()
        sig = 1.4826 * mad
        n_nodos = con.execute("SELECT count(DISTINCT nodo) FROM pml_hourly WHERE sistema=?", [s]).fetchone()[0]
        chunks = n_chunks if n_nodos >= 200 else 1
        # escala robusta de los saltos: submuestra de nodos (hash) si el sistema es grande
        sub = "AND hash(nodo) % 8 = 0" if chunks > 1 else ""
        dsig = con.execute(f"""
            WITH d AS (SELECT pml - lag(pml) OVER (PARTITION BY nodo ORDER BY {ts}) dp
                       FROM pml_hourly WHERE sistema=? {sub})
            SELECT median(abs(dp - (SELECT median(dp) FROM d))) FROM d WHERE dp IS NOT NULL""",
            [s]).fetchone()[0]
        sig_d = 1.4826 * dsig
        thr_ext = k_extremo * sig
        thr_salto = k_salto * sig_d
        stats[s] = dict(mediana_pml=med, mad_pml=mad, sigma_robusto=sig, umbral_extremo=thr_ext,
                        sigma_delta=sig_d, umbral_salto=thr_salto, n_nodos=n_nodos)
        for i in range(chunks):
            w = f"sistema=? AND hash(nodo) % {chunks} = {i}"
            df = con.execute(f"""
                WITH b AS (
                  SELECT {_cols_comunes(ts)},
                         pml - lag(pml) OVER (PARTITION BY nodo ORDER BY {ts}) AS dp
                  FROM pml_hourly WHERE {w})
                SELECT sistema, nodo, fecha, hora, ts, pml, energia, perdidas, congestion, dp,
                       (abs(pml - ?) > ?) AS extremo, (pml < 0) AS negativo,
                       (abs(dp) > ?) AS salto,
                       (abs(pml - (energia + perdidas + congestion)) > ?) AS descomposicion
                FROM b
                WHERE abs(pml - ?) > ? OR pml < 0 OR abs(dp) > ?
                   OR abs(pml - (energia + perdidas + congestion)) > ?""",
                [s, med, thr_ext, thr_salto, tol + EPS_DESCOMP, med, thr_ext, thr_salto, tol + EPS_DESCOMP]).df()
            marcadas.append(df)
            pl = con.execute(f"""
                WITH b AS (
                  SELECT nodo, {ts} AS ts, pml,
                         CASE WHEN pml IS NOT DISTINCT FROM lag(pml) OVER (PARTITION BY nodo ORDER BY {ts})
                              THEN 0 ELSE 1 END AS nuevo
                  FROM pml_hourly WHERE {w}),
                c AS (SELECT *, sum(nuevo) OVER (PARTITION BY nodo ORDER BY ts) AS run FROM b)
                SELECT ? AS sistema, nodo, min(ts) AS inicio, max(ts) AS fin, count(*)::INTEGER AS horas,
                       any_value(pml) AS pml
                FROM c GROUP BY nodo, run HAVING count(*) >= ?""", [s, s, min_plano]).df()
            planos.append(pl)
    m = pd.concat(marcadas, ignore_index=True) if marcadas else pd.DataFrame()
    p = pd.concat(planos, ignore_index=True) if planos else pd.DataFrame()
    return m, p, stats


def marcar_sistemicos(m: pd.DataFrame, nodo_dia: pd.DataFrame) -> pd.DataFrame:
    """Agrega frac_extremo / frac_salto (fraccion de nodos del sistema con el flag en esa fecha-hora) y
    extremo_aislado / salto_aislado (fraccion < UMBRAL_SISTEMICO). No elimina filas."""
    m = m.copy()
    n = nodo_dia.assign(fecha=pd.to_datetime(nodo_dia["fecha"])).groupby(["sistema", "fecha"])["nodo"] \
        .nunique().rename("n_nodos_dia").reset_index()
    m["fecha"] = pd.to_datetime(m["fecha"])
    m = m.merge(n, on=["sistema", "fecha"], how="left")
    for tipo in ("extremo", "salto"):
        c = m.groupby(["sistema", "fecha", "hora"])[tipo].transform("sum")
        m[f"frac_{tipo}"] = np.where(m[tipo], c / m["n_nodos_dia"], 0.0)
        m[f"{tipo}_aislado"] = m[tipo] & (m[f"frac_{tipo}"] < UMBRAL_SISTEMICO)
    return m.drop(columns="n_nodos_dia")


# ---------------------------------------------------------------- pipeline completo
def resumen_humano(nodos: pd.DataFrame) -> dict:
    out = {}
    for s, d in nodos.groupby("sistema"):
        out[s] = dict(
            nodos_total=int(len(d)), nodos_validos_12m=int(d.valido.sum()),
            nodos_menos_12m=int((~d.valido).sum()),
            nodos_completos=int((d.estado == "completo").sum()),
            nodos_entran=int(d.estado.isin(["entra", "entra_y_sale"]).sum()),
            nodos_salen=int(d.estado.isin(["sale", "entra_y_sale"]).sum()),
            nodos_con_huecos=int((d.horas_hueco > 0).sum()),
            horas_hueco_total=int(d.horas_hueco.sum()),
            pct_hueco_vida_max=float(d.pct_hueco_vida.max()),
            pct_hueco_vida_ponderado=float(100 * d.horas_hueco.sum() / d.horas_esperadas_vida.sum()),
        )
    return out


def run(db: Path = DB, out: Path = OUT) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    con = _con(db)
    nd = leer_nodo_dia(con)
    fmin, fmax = nd["fecha"].min(), nd["fecha"].max()
    cal = calendario(pd.Timestamp(fmin).date(), pd.Timestamp(fmax).date())
    nodos = cobertura_nodos(nd, cal)
    nodos["meses_de_datos"] = nodos["meses_de_datos"].astype(int)

    nd["fecha"] = pd.to_datetime(nd["fecha"])
    nd.to_parquet(out / "cobertura_dia.parquet", index=False)
    nd2 = nd.assign(mes=_mes(nd["fecha"])).merge(cal.assign(fecha=pd.to_datetime(cal.fecha)),
                                                 on=["sistema", "fecha"])
    cm = nd2.groupby(["sistema", "nodo", "mes"], as_index=False).agg(
        horas=("horas", "sum"), horas_esperadas_mes=("esperadas", "sum"), dias_con_datos=("fecha", "size"))
    cm.to_parquet(out / "cobertura_mes.parquet", index=False)

    m, p, st = outliers(con)
    con.close()
    m = marcar_sistemicos(m, nd)
    # conteos por nodo en nodos_calidad
    cnt = m.groupby(["sistema", "nodo"]).agg(
        n_extremo=("extremo", "sum"), n_negativo=("negativo", "sum"),
        n_salto=("salto", "sum"), n_extremo_aislado=("extremo_aislado", "sum"),
        n_salto_aislado=("salto_aislado", "sum"), n_descomposicion=("descomposicion", "sum")).reset_index()
    pc = p.groupby(["sistema", "nodo"]).agg(n_corridas_planas=("horas", "size"),
                                            horas_planas=("horas", "sum")).reset_index()
    nodos = nodos.merge(cnt, on=["sistema", "nodo"], how="left").merge(pc, on=["sistema", "nodo"], how="left")
    for c in ("n_extremo", "n_extremo_aislado", "n_salto_aislado", "n_negativo", "n_salto", "n_descomposicion", "n_corridas_planas", "horas_planas"):
        nodos[c] = nodos[c].fillna(0).astype(int)
    nodos.to_parquet(out / "nodos_calidad.parquet", index=False)
    nodos.to_csv(out / "nodos_calidad.csv", index=False)
    m.to_parquet(out / "outliers.parquet", index=False)
    p.to_parquet(out / "planos.parquet", index=False)

    # resumen
    res = dict(generado=dt.datetime.now().isoformat(timespec="seconds"),
               periodo=[str(pd.Timestamp(fmin).date()), str(pd.Timestamp(fmax).date())],
               regla=dict(min_meses=MIN_MESES, mes_con_datos=">= 1 hora con PML en el mes calendario",
                          horas_esperadas="clock.horas_en_dia (23/24/25)"),
               umbrales_outlier=dict(k_extremo=K_EXTREMO, k_salto=K_SALTO, tol_descomposicion=TOL_DESCOMP,
                                     min_plano_horas=MIN_PLANO),
               sistemas=resumen_humano(nodos), estadisticos=st, outliers={}, nodos_validos={}, top={})
    for s in SISTEMAS:
        ms = m[m.sistema == s]
        ps = p[p.sistema == s]
        res["outliers"][s] = dict(
            extremo=int(ms.extremo.sum()), extremo_alto=int((ms.extremo & (ms.pml > st[s]["mediana_pml"])).sum()),
            extremo_bajo=int((ms.extremo & (ms.pml < st[s]["mediana_pml"])).sum()),
            negativo=int(ms.negativo.sum()), pml_min=float(ms.pml.min()) if len(ms) else None,
            extremo_aislado=int(ms.extremo_aislado.sum()), salto_aislado=int(ms.salto_aislado.sum()),
            salto=int(ms.salto.sum()), descomposicion=int(ms.descomposicion.sum()),
            descomposicion_max_abs=float((ms.pml - (ms.energia + ms.perdidas + ms.congestion)).abs().max()),
            corridas_planas=int(len(ps)), horas_en_corridas_planas=int(ps.horas.sum()),
            corridas_planas_pml_cero=int((ps.pml == 0).sum()),
            corrida_plana_max_horas=int(ps.horas.max()) if len(ps) else 0)
        res["nodos_validos"][s] = sorted(nodos[(nodos.sistema == s) & nodos.valido].nodo.tolist())
        cols = ["nodo", "ts", "pml", "energia", "perdidas", "congestion"]
        top = {}
        top["extremo_alto_aislado"] = ms[ms.extremo_aislado].nlargest(10, "pml")[cols]
        top["negativo"] = ms[ms.negativo].nsmallest(10, "pml")[cols]
        top["salto_aislado"] = ms[ms.salto_aislado].assign(a=lambda d: d.dp.abs()).nlargest(10, "a")[cols + ["dp"]]
        top["descomposicion"] = ms[ms.descomposicion].assign(
            a=lambda d: (d.pml - d.energia - d.perdidas - d.congestion).abs()).nlargest(10, "a")[cols]
        res["top"][s] = {k: json.loads(v.to_json(orient="records", date_format="iso")) for k, v in top.items()}
        res["top"][s]["plano"] = json.loads(ps.nlargest(10, "horas").to_json(orient="records", date_format="iso"))
    (out / "calidad_resumen.json").write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str))

    # insumo para data/index.json: meses_de_datos y confianza por nodo
    idx = nodos[["sistema", "nodo", "meses_de_datos", "confianza", "primera_fecha", "ultima_fecha"]]
    idx.to_json(out / "index_calidad.json", orient="records", force_ascii=False)
    return res


if __name__ == "__main__":
    r = run()
    print(json.dumps({k: r[k] for k in ("sistemas", "outliers", "estadisticos")}, indent=1, default=str))
