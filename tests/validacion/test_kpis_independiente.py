"""Validación independiente de aggregates.py + kpis.py + contrato JSON 1.1 (validador).

Camino propio: pml_hourly (DuckDB, solo lectura) + reloj CDMX por zoneinfo (_indep.mapa_cdmx = instante
UTC − 6 h; NO clock.py) + perfil y(mes, hora) leído directo de data/baselines/solar_baselines_month_hour.parquet;
sumas de PML en DECIMAL(18,2) exacto; KPIs con las fórmulas publicadas en docs/TECNICO.md §4; reglas de año/mes
completo, meses de borde y pesos reales (INPC) reimplementadas aquí desde su definición publicada.
"""
from __future__ import annotations

import json
import math
import re
import shutil
import statistics as st
import subprocess
import tempfile
from pathlib import Path

import pandas as pd
import pytest

from _indep import horas_anio, kpis_desde_sumas, mapa_cdmx
from conftest import DATA_ROOT, ROOT

pytestmark = pytest.mark.pesado

AGG = DATA_ROOT / "data" / "aggregates"
NODES = DATA_ROOT / "data" / "nodes"
INDEX = DATA_ROOT / "data" / "index.json"
BASE_MH = DATA_ROOT / "data" / "baselines" / "solar_baselines_month_hour.parquet"
INPC_CSV = DATA_ROOT / "data" / "ref" / "inpc_mensual.csv"
# Muestra nueva (ronda CDMX): pedidos + renombrados + 95 % + <12 meses + 9 al azar (semilla 20261010)
NODOS = ["07CFP-400", "03DEA-230", "03PCL-115", "03JTC-115", "03EGM-230", "03MNO-115", "08BNV-115",
         "02NXM-230", "04MPP-115",
         "03ACR-115", "03GAS-115", "05ALI-115", "05AND-230", "03ASM-115", "03MRR-115", "08SAM-115", "05INW-115",
         "08HOL-115"]
CONFIGS = ("fixed", "tracker")
P0, P1 = "2020-01", "2026-09"
# Bordes derivados aquí: BCA/BCS empiezan 2020-01-01 02:00/01:00 CDMX y terminan 2026-10-01 00:00 CDMX
BORDE = {"SIN": set(), "BCA": {"2020-01", "2026-10"}, "BCS": {"2020-01", "2026-10"}}


def _rel(a, b):
    return abs(a - b) / max(1.0, abs(b))


def _ym(a, m):
    return f"{int(a):04d}-{int(m):02d}"


def _dim(a, m):
    return pd.Period(_ym(a, m)).days_in_month


@pytest.fixture(scope="module")
def prep(db):
    if not (AGG.exists() and BASE_MH.exists() and INDEX.exists()):
        pytest.skip("faltan agregados / baselines / contrato")
    relojes = db.execute(f"select distinct clock from read_parquet('{BASE_MH}')").fetchall()
    assert relojes == [("CDMX estandar UTC-6 fijo",)]
    db.register("mapa_df", mapa_cdmx())
    db.execute("create or replace temp table mapa as select sistema, fecha, hora, ts from mapa_df")
    db.execute(f"""create or replace temp table base as
        select loc_id nodo, config, month mes, hour hora, mwh_per_mwp_mean_day y
        from read_parquet('{BASE_MH}') where loc_id not like 'cell_%'""")
    return db


def _sql(nivel: str) -> str:
    h = ", p.hora_std hora" if nivel == "celda" else ""
    return f"""
      select p.sistema, p.nodo, b.config, p.anio, p.mes{h},
             count(*) n, (sum(p.pml::DECIMAL(18,2)) * 100)::BIGINT cpml, (sum(p.energia::DECIMAL(18,2)) * 100)::BIGINT cen,
             (sum(p.perdidas::DECIMAL(18,2)) * 100)::BIGINT cper, (sum(p.congestion::DECIMAL(18,2)) * 100)::BIGINT ccon,
             count(*) filter (where p.pml <= 0) nle0, sum(b.y) P, sum(b.y * p.pml) I,
             coalesce(sum(b.y) filter (where p.pml <= 0), 0) E0, sum(b.y * p.energia) Ien, sum(b.y * p.perdidas) Iper,
             sum(b.y * p.congestion) Icon
      from lote p join base_lote b on b.nodo = p.nodo and b.mes = p.mes and b.hora = p.hora_std
      group by all"""


def _por_lotes(con, nodos, lote=100, where_extra="true", nivel="celda"):
    """Recalculo por lotes de nodos en dos pasos (PML + reloj CDMX, luego perfil y): memoria acotada."""
    out = []
    for i in range(0, len(nodos), lote):
        lst = ",".join("'" + n + "'" for n in nodos[i:i + lote])
        con.execute(f"""create or replace temp table lote as
            select p.*, m.ts, year(m.ts)::int anio, month(m.ts)::int mes, hour(m.ts)::int hora_std
            from (select * from db.pml_hourly where nodo in ({lst}) and {where_extra}) p
            join mapa m using (sistema, fecha, hora)""")
        con.execute(f"create or replace temp table base_lote as select * from base where nodo in ({lst})")
        out.append(con.execute(_sql(nivel)).df())
        con.execute("drop table lote; drop table base_lote")
    return pd.concat(out, ignore_index=True)


@pytest.fixture(scope="module")
def mias(prep):
    return _por_lotes(prep, NODOS)


@pytest.fixture(scope="module")
def todos_mes(prep):
    """Sumas mensuales (mes CDMX) de los 2,456 nodos con baseline, por config."""
    nodos = [x[0] for x in prep.execute("select distinct nodo from base order by 1").fetchall()]
    return _por_lotes(prep, nodos, lote=100, nivel="mes")


@pytest.fixture(scope="module")
def index():
    if not INDEX.exists():
        pytest.skip("sin data/index.json")
    return json.loads(INDEX.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def inpc():
    if not INPC_CSV.exists():
        pytest.skip("sin data/ref/inpc_mensual.csv")
    t = pd.read_csv(INPC_CSV, dtype={"mes": str})
    return dict(zip(t.mes, t.inpc.astype(float)))


def _doc(n):
    return json.loads((NODES / f"{n}.json").read_text(encoding="utf-8"))


def _k(df, f=None):
    """KPIs de un conjunto de filas; con f (Serie por fila) aplica el deflactor a las sumas de precio."""
    w = 1.0 if f is None else f
    cp = float((df.cpml.astype(float) * w).sum()) / 100.0 if f is not None else int(df.cpml.sum()) / 100.0
    return kpis_desde_sumas(int(df.n.sum()), cp, float(df.P.sum()), float((df.I * w).sum()), float(df.E0.sum()),
                            int(df.nle0.sum()))


def _periodo(d):
    ym = d.anio * 100 + d.mes
    return d[(ym >= 202001) & (ym <= 202609)]


def _anios(d, sistema, umbral=1.0, f=None):
    """{anio: kpis + completo} con la regla publicada: n >= ceil(umbral*horas), sin mes de borde, 12 meses
    dentro del periodo (=> <= 2025)."""
    out = {}
    for a, g in d.groupby("anio"):
        ka = _k(g, None if f is None else f.loc[g.index])
        sin_borde = not any(b.startswith(f"{int(a)}-") for b in BORDE[sistema])
        ka["completo"] = bool(sin_borde and int(a) <= 2025 and ka["n_horas"] >= math.ceil(umbral * horas_anio(int(a))))
        out[int(a)] = ka
    return out


def _pmm(anual):
    comp = sorted((ka["ingreso_mxn_por_mwp"], a) for a, ka in anual.items() if ka["completo"] and ka["vf"] is not None)
    if not comp:
        return [], None, None, None
    return sorted(a for _, a in comp), comp[0][1], comp[(len(comp) - 1) // 2][1], comp[-1][1]


# ------------------------------------------------------------------ 1. entrada
def test_pml_exactamente_2_decimales(db):
    r = db.execute("""select count(*) filter (where abs(100*pml - round(100*pml)) > 1e-6
                        or abs(100*energia - round(100*energia)) > 1e-6
                        or abs(100*perdidas - round(100*perdidas)) > 1e-6
                        or abs(100*congestion - round(100*congestion)) > 1e-6) from db.pml_hourly""").fetchone()[0]
    assert r == 0


def test_baseline_cubre_la_muestra(prep):
    got = {r[0] for r in prep.execute("select distinct nodo from base").fetchall()}
    assert set(NODOS) <= got and len(got) == 2456


# ------------------------------------------------------------------ 2. agregados (llaves CDMX)
def test_agregados_iguales_a_recalculo(prep, mias):
    lst = ",".join(f"'{n}'" for n in NODOS)
    com = prep.execute(f"select * from read_parquet('{AGG / 'agregados_comunes.parquet'}') where nodo in ({lst})").df()
    cfg = prep.execute(f"select * from read_parquet('{AGG / 'agregados_config.parquet'}') where nodo in ({lst})").df()
    m = mias.merge(cfg, on=["sistema", "nodo", "config", "anio", "mes", "hora"], how="outer", indicator=True)
    assert (m["_merge"] == "both").all(), m[m["_merge"] != "both"].head()
    m = m.merge(com, on=["sistema", "nodo", "anio", "mes", "hora"], how="left")
    assert (m.n == m.n_horas).all() and (m.nle0 == m.n_pml_le0).all()
    assert (m.cpml == m.sum_pml_cent).all() and (m.cen == m.sum_energia_cent).all()
    assert (m.cper == m.sum_perdidas_cent).all() and (m.ccon == m.sum_congestion_cent).all()
    for a, b in (("P", "sum_y"), ("I", "sum_y_pml"), ("E0", "sum_y_le0"), ("Ien", "sum_y_energia"),
                 ("Iper", "sum_y_perdidas"), ("Icon", "sum_y_congestion")):
        err = ((m[a] - m[b]).abs() / m[b].abs().clip(lower=1)).max()
        assert err < 1e-9, (a, err)


def test_suma_total_de_horas_en_agregados(prep):
    n = prep.execute(f"select sum(n_horas) from read_parquet('{AGG / 'agregados_comunes.parquet'}')").fetchone()[0]
    assert n == prep.execute("select count(*) from db.pml_hourly").fetchone()[0] == 151_050_393


def test_dias_23_25_en_reloj_cdmx(prep):
    """07CFP-400 (BCA): cada mes CDMX completo tiene días x 24 en cada hora, incluidos meses con días de
    23/25 h; BCA 2024-11-03 hora 1 = 07:00 UTC = 01:00 CDMX y hora 25 = 2024-11-04 01:00 CDMX."""
    com = prep.execute(f"""select anio, mes, hora, n_horas from read_parquet('{AGG / 'agregados_comunes.parquet'}')
                           where nodo = '07CFP-400'""").df()
    for (a, mth) in [(2024, 11), (2025, 3), (2025, 7), (2025, 11), (2026, 3)]:
        c = com[(com.anio == a) & (com.mes == mth)]
        assert len(c) == 24 and (c.n_horas == _dim(a, mth)).all(), (a, mth, c.n_horas.tolist())
    t = prep.execute("""select hora, ts from mapa where sistema='BCA' and fecha = DATE '2024-11-03'
                        and hora in (1, 25) order by hora""").fetchall()
    assert [str(x[1]) for x in t] == ["2024-11-03 01:00:00", "2024-11-04 01:00:00"]


def test_hora_menos_1_daria_otro_precio_capturado(prep):
    q = """with h as (select p.pml, {ts} ts from db.pml_hourly p {join}
                      where p.nodo='07CFP-400' and year(p.fecha)=2025)
           select sum(b.y*h.pml)/sum(b.y) from h join base b on b.nodo='07CFP-400' and b.config='fixed'
             and b.mes=month(h.ts) and b.hora=hour(h.ts)"""
    ok = prep.execute(q.format(ts="m.ts", join="join mapa m using (sistema, fecha, hora)")).fetchone()[0]
    malo = prep.execute(q.format(ts="p.fecha::timestamp + to_hours(p.hora - 1)", join="")).fetchone()[0]
    assert abs(ok - malo) > 1.0, (ok, malo)


# ------------------------------------------------------------------ 3. bordes (D)
def test_meses_borde(prep):
    meta = json.loads((AGG / "agregados_meta.json").read_text())
    assert {s: set(v["meses_borde"]) for s, v in meta["sistemas"].items()} == BORDE
    assert {s: v["desfase_a_cdmx_horas"] for s, v in meta["sistemas"].items()} == {"SIN": 0, "BCS": 1, "BCA": 2}
    # horas por nodo en los meses de borde (nodos con datos el primer / último día)
    r = prep.execute(f"""select sistema, anio, mes, min(n), max(n), count(*) from (
        select sistema, nodo, anio, mes, sum(n_horas) n from read_parquet('{AGG / 'agregados_comunes.parquet'}')
        where (anio = 2020 and mes = 1) or (anio = 2026 and mes = 10) group by all) group by all order by 1, 2""").fetchall()
    d = {(s, a, m): (lo, hi) for s, a, m, lo, hi, _ in r}
    assert d[("BCA", 2020, 1)][1] == 742 and d[("BCS", 2020, 1)][1] == 743 and d[("SIN", 2020, 1)][1] == 744
    assert d[("BCA", 2026, 10)] == (1, 1) and d[("BCS", 2026, 10)] == (1, 1) and ("SIN", 2026, 10) not in d


@pytest.mark.parametrize("nodo", NODOS)
def test_kpis_periodo_anuales_y_mensuales(mias, index, nodo):
    doc = _doc(nodo)
    sistema = doc["sistema"]
    idx = {e["id"]: e for e in index["nodos"]}[nodo]
    for cfg in CONFIGS:
        d = _periodo(mias[(mias.nodo == nodo) & (mias.config == cfg)])
        k = _k(d)
        j = doc["kpis"][cfg]
        assert j["n_horas"] == k["n_horas"]
        for c in ("precio_base_mxn_mwh", "precio_capturado_mxn_mwh", "vf", "produccion_mwh_por_mwp",
                  "ingreso_mxn_por_mwp", "pct_energia_pml_le0", "mwh_por_mwp_en_riesgo", "pct_horas_pml_le0"):
            assert abs(j[c] - k[c]) <= 1e-6 * max(1, abs(k[c])) + 1e-6, (cfg, c, j[c], k[c])
        dsc = j["descomposicion"]
        assert _rel(dsc["produccion_mwh_por_mwp"] * dsc["precio_base_mxn_mwh"] * dsc["vf"], k["ingreso_mxn_por_mwp"]) < 2e-6
        for c in ("precio_capturado_mxn_mwh", "precio_base_mxn_mwh", "vf", "pct_energia_pml_le0"):
            assert abs(idx["kpis"][cfg][c] - k[c]) <= 5.1e-5 * max(1, abs(k[c])), (cfg, c)
        anual = _anios(d, sistema)
        ja = {r["anio"]: r for r in j["anual"]}
        assert set(ja) == set(anual)
        for a, ka in anual.items():
            assert ja[a]["completo"] == ka["completo"] and ja[a]["n_horas"] == ka["n_horas"], (cfg, a)
            assert _rel(ja[a]["ingreso_mxn_por_mwp"], ka["ingreso_mxn_por_mwp"]) < 1e-6
        comp, pe, me, mj = _pmm(anual)
        ia = j["ingreso_anual"]
        assert ia["anios_completos"] == comp
        if comp:
            assert (ia["peor"]["anio"], ia["mediana"]["anio"], ia["mejor"]["anio"]) == (pe, me, mj)
            for key in ("peor", "mediana", "mejor"):
                assert _rel(ia[key]["producto"], ia[key]["ingreso_mxn_por_mwp"]) < 2e-6
        else:
            assert ia["peor"] is None and ia["mediana"] is None and ia["mejor"] is None
        # meses completos (para VF mínimo): días x 24 y no borde
        mm = d.groupby(["anio", "mes"]).agg(n=("n", "sum"), I=("I", "sum"), P=("P", "sum"), c=("cpml", "sum"))
        comp_m = [(a, m_, (r.I / r.P) / (r.c / 100 / r.n)) for (a, m_), r in mm.iterrows()
                  if r.n == _dim(a, m_) * 24 and _ym(a, m_) not in BORDE[sistema] and r.P > 0 and r.c > 0]
        vm = j["vf_minimo_mensual"]
        if comp_m:
            a, m_, v = min(comp_m, key=lambda x: x[2])
            assert vm["m_meses"] == len(comp_m) and vm["mes"] == _ym(a, m_) and abs(vm["vf"] - v) < 1e-5
            assert vm["mes"] not in BORDE[sistema]
        else:
            assert vm is None


def test_casos_especiales(mias):
    exp = {"03EGM-230": [2021, 2022, 2024, 2025], "03MNO-115": [], "08BNV-115": [], "07CFP-400": [2025],
           "03DEA-230": [2020, 2021], "03PCL-115": [2023, 2024, 2025], "03JTC-115": [2020, 2021, 2022, 2023, 2024, 2025]}
    for n, anios in exp.items():
        for cfg in CONFIGS:
            assert _doc(n)["kpis"][cfg]["ingreso_anual"]["anios_completos"] == anios, (n, cfg)
    egm = mias[(mias.nodo == "03EGM-230") & (mias.config == "fixed")]
    falt = {a: horas_anio(a) - int(g.n.sum()) for a, g in egm.groupby("anio")}
    assert falt[2023] == 177 * 24 and falt[2021] == falt[2022] == falt[2024] == falt[2025] == 0


# ------------------------------------------------------------------ 4. reconstrucción desde el JSON 1.1 (B)
@pytest.mark.parametrize("nodo", NODOS)
def test_reconstruccion_json_11(mias, nodo):
    """Energía en centavos = pml − pérdidas − congestión − residuo (enteros exactos) y sumas ponderadas =
    y × sumas comunes; se comparan contra MIS sumas horarias directas Σ y·x de pml_hourly."""
    doc = _doc(nodo)
    a = doc["agregados"]
    cel = {(int(r.anio), int(r.mes), int(r.hora)): r for r in
           mias[(mias.nodo == nodo) & (mias.config == "fixed")].itertuples()}
    celt = {(int(r.anio), int(r.mes), int(r.hora)): r for r in
            mias[(mias.nodo == nodo) & (mias.config == "tracker")].itertuples()}
    for i, mes in enumerate(a["meses"]):
        an, mo = int(mes[:4]), int(mes[5:])
        for h in range(24):
            k = i * 24 + h
            r = cel.get((an, mo, h))
            if r is None:
                assert a["n_horas"][k] == 0
                continue
            ecent = a["sum_pml_cent"][k] - a["sum_perdidas_cent"][k] - a["sum_congestion_cent"][k] - a["sum_residuo_cent"][k]
            assert (a["n_horas"][k], a["n_pml_le0"][k], a["sum_pml_cent"][k], a["sum_perdidas_cent"][k],
                    a["sum_congestion_cent"][k], ecent) == (r.n, r.nle0, r.cpml, r.cper, r.ccon, r.cen)
            assert abs(a["sum_residuo_cent"][k]) <= 2 * r.n
            for cfg, rr in (("fixed", r), ("tracker", celt[(an, mo, h)])):
                y = a["perfil_y"][cfg][(mo - 1) * 24 + h]
                for got, exp in ((y * a["n_horas"][k], rr.P), (y * a["sum_pml_cent"][k] / 100, rr.I),
                                 (y * a["n_pml_le0"][k], rr.E0), (y * ecent / 100, rr.Ien),
                                 (y * a["sum_congestion_cent"][k] / 100, rr.Icon)):
                    assert abs(got - exp) <= 1e-9 * max(1, abs(exp)), (nodo, cfg, mes, h)


def test_snippet_js_de_tecnico_con_node(mias):
    """Ejecuta el fragmento JS publicado en TECNICO.md §6 con node sobre las fichas de la muestra y compara
    con los KPIs publicados y con mi recálculo."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node no disponible")
    txt = (ROOT / "docs" / "TECNICO.md").read_text(encoding="utf-8")
    js = re.search(r"```js\n(.*?)```", txt, re.S).group(1)
    runner = js + """
const fs = require('fs');
const out = {};
for (const id of JSON.parse(process.argv[2])) {
  const doc = JSON.parse(fs.readFileSync(process.argv[3] + '/' + id + '.json', 'utf8'));
  out[id] = {fixed: kpis(doc, 'fixed', '2020-01', '2026-09'), tracker: kpis(doc, 'tracker', '2020-01', '2026-09')};
}
console.log(JSON.stringify(out));
"""
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "kpis.js"
        p.write_text(runner)
        r = subprocess.run([node, str(p), json.dumps(NODOS), str(NODES)], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    res = json.loads(r.stdout)
    for n in NODOS:
        doc = _doc(n)
        for cfg in CONFIGS:
            js_k, pub = res[n][cfg], doc["kpis"][cfg]
            mine = _k(_periodo(mias[(mias.nodo == n) & (mias.config == cfg)]))
            for jk, pk in (("B", "precio_base_mxn_mwh"), ("C", "precio_capturado_mxn_mwh"), ("VF", "vf"),
                           ("ingreso", "ingreso_mxn_por_mwp"), ("produccion", "produccion_mwh_por_mwp"),
                           ("pctE0", "pct_energia_pml_le0")):
                assert abs(js_k[jk] - pub[pk]) <= 1e-6 * max(1, abs(pub[pk])) + 1e-6, (n, cfg, jk)
                assert abs(js_k[jk] - mine[pk]) <= 1e-9 * max(1, abs(mine[pk])), (n, cfg, jk)


# ------------------------------------------------------------------ 5. pesos reales (C)
def test_inpc_archivo_plausible(inpc):
    meses = sorted(inpc)
    assert len(meses) == 81 and meses[0] == "2020-01" and meses[-1] == "2026-09"
    exp = [str(p) for p in pd.period_range("2020-01", "2026-09", freq="M")]
    assert meses == exp
    v = pd.Series([inpc[m] for m in meses], index=meses)
    mom = v.pct_change().dropna() * 100
    assert mom.abs().max() < 2.0  # variación mensual del INPC general
    # inflación anual dic/dic (INEGI, publicada): 2020 3.15 %, 2021 7.36 %, 2022 7.82 %, 2023 4.66 %, 2024 4.21 %
    for y, pct in ((2020, 3.15), (2021, 7.36), (2022, 7.82), (2023, 4.66), (2024, 4.21)):
        got = 100 * (v[f"{y}-12"] / v[f"{y - 1}-12"] - 1) if y > 2020 else 100 * (v["2020-12"] / 105.934 - 1)
        assert abs(got - pct) < 0.03, (y, got)


@pytest.mark.parametrize("nodo", NODOS)
def test_reales(mias, inpc, nodo):
    doc = _doc(nodo)
    a = doc["agregados"]
    base = max(inpc)
    assert base == "2026-09" and doc["kpis"]["fixed"]["reales"]["base_mes"] == base
    for i, mes in enumerate(a["meses"]):
        f = a["deflactor_inpc"][i]
        if mes in inpc:
            assert abs(f - inpc[base] / inpc[mes]) < 1e-12, mes
        else:
            assert f is None, mes  # 2026-10: sin INPC, sin extrapolación
    for cfg in CONFIGS:
        d = _periodo(mias[(mias.nodo == nodo) & (mias.config == cfg)])
        f = d.apply(lambda r: inpc[base] / inpc[_ym(r.anio, r.mes)], axis=1)
        k = _k(d, f)
        rl = doc["kpis"][cfg]["reales"]
        assert rl["estado"] == "calculado"
        for c in ("precio_base_mxn_mwh", "precio_capturado_mxn_mwh", "vf", "ingreso_mxn_por_mwp"):
            assert abs(rl[c] - k[c]) <= 1e-6 * max(1, abs(k[c])) + 1e-6, (cfg, c, rl[c], k[c])
        anual = _anios(d, doc["sistema"], f=f)
        ra = {r["anio"]: r for r in rl["anual"]}
        for an, ka in anual.items():
            assert _rel(ra[an]["ingreso_mxn_por_mwp"], ka["ingreso_mxn_por_mwp"]) < 1e-6
            assert ra[an]["completo"] == ka["completo"]
        comp, pe, me, mj = _pmm(anual)
        ia = rl["ingreso_anual"]
        assert ia["anios_completos"] == comp
        if comp:
            assert (ia["peor"]["anio"], ia["mediana"]["anio"], ia["mejor"]["anio"]) == (pe, me, mj)


# ------------------------------------------------------------------ 6. todos los nodos vs index.json
def test_todos_los_nodos_index_vs_recalculo(todos_mes, index, inpc):
    d = _periodo(todos_mes).copy()
    f = (d.anio.astype(int).map("{:04d}".format) + "-" + d.mes.astype(int).map("{:02d}".format)).map(
        lambda m: inpc["2026-09"] / inpc[m])
    d["cpml_r"], d["I_r"] = d.cpml.astype(float) * f, d.I * f
    r = d.groupby(["nodo", "config"], as_index=False).agg(
        n=("n", "sum"), cpml=("cpml", "sum"), P=("P", "sum"), I=("I", "sum"), E0=("E0", "sum"), nle0=("nle0", "sum"),
        cpml_r=("cpml_r", "sum"), I_r=("I_r", "sum"))
    idx = {e["id"]: e for e in index["nodos"] if e["kpis"]}
    assert len(idx) == r.nodo.nunique() == 2456
    peor = []
    for row in r.itertuples():
        k = kpis_desde_sumas(int(row.n), int(row.cpml) / 100.0, row.P, row.I, row.E0, int(row.nle0))
        j = idx[row.nodo]["kpis"][row.config]
        for c in ("precio_capturado_mxn_mwh", "precio_base_mxn_mwh", "vf", "pct_energia_pml_le0"):
            if abs(j[c] - k[c]) > 5.1e-5 * max(1, abs(k[c])):
                peor.append((row.nodo, row.config, c, j[c], k[c]))
        # 1.2.0: pesos de hoy (base 2026-09), deflactor por mes CDMX
        kr = kpis_desde_sumas(int(row.n), row.cpml_r / 100.0, row.P, row.I_r, row.E0, int(row.nle0))
        for ci, cr in (("precio_capturado_real_mxn_mwh", "precio_capturado_mxn_mwh"),
                       ("precio_base_real_mxn_mwh", "precio_base_mxn_mwh"), ("vf_real", "vf")):
            if abs(j[ci] - kr[cr]) > 5.1e-5 * max(1, abs(kr[cr])):
                peor.append((row.nodo, row.config, ci, j[ci], kr[cr]))
    assert peor == []


# ------------------------------------------------------------------ 7. experimento 95 % vs 100 % (D)
def _resumen_umbral(d, sistema, u):
    anual = _anios(d, sistema, umbral=u)
    comp, pe, me, mj = _pmm(anual)
    ca = [a for a in comp if anual[a]["vf"] is not None]
    if len(ca) >= 3:
        x = pd.Series(ca, dtype=float)
        yv = pd.Series([anual[a]["vf"] for a in ca])
        tend = round(float(((x - x.mean()) * (yv - yv.mean())).sum() / ((x - x.mean()) ** 2).sum()), 6)
    else:
        tend = None
    mm = d.groupby(["anio", "mes"]).agg(n=("n", "sum"), I=("I", "sum"), P=("P", "sum"), c=("cpml", "sum"))
    cm = [(a, m_, (r.I / r.P) / (r.c / 100 / r.n)) for (a, m_), r in mm.iterrows()
          if r.n >= math.ceil(u * _dim(a, m_) * 24) and _ym(a, m_) not in BORDE[sistema] and r.P > 0 and r.c > 0]
    vmin = min(cm, key=lambda x: x[2])[:2] if cm else None
    return {a: anual[a]["completo"] for a in anual}, (pe, me, mj, tend, len(cm), vmin)


def test_experimento_95_vs_100(todos_mes, index):
    sis = {e["id"]: e["sistema"] for e in index["nodos"]}
    flips, cambian = set(), set()
    for (n, cfg), d in _periodo(todos_mes).groupby(["nodo", "config"]):
        c100, k100 = _resumen_umbral(d, sis[n], 1.0)
        c95, k95 = _resumen_umbral(d, sis[n], 0.95)
        flips |= {(n, a) for a in c100 if c100[a] != c95[a]}
        if k100 != k95:
            cambian.add(n)
    assert flips == {("02LHA-115", 2021), ("02NXM-230", 2021), ("03PCL-115", 2022), ("03SFM-115", 2022),
                     ("04MPP-115", 2023), ("05TRE-115", 2020), ("06PGI-115", 2025)}
    assert len(cambian) == 13, sorted(cambian)
    assert {"02NXM-230", "05TRE-115", "03PCL-115", "03SFM-115", "04MPP-115"} <= cambian


# ------------------------------------------------------------------ 8. plausibilidad (SIN)
def test_medianas_sin_publicadas(index):
    e = [x for x in index["nodos"] if x["sistema"] == "SIN" and x["valido"] and x["kpis"]]
    assert len(e) == 2433  # TECNICO.md §7
    med = lambda c, cfg: st.median(x["kpis"][cfg][c] for x in e)  # noqa: E731
    assert round(med("precio_base_mxn_mwh", "fixed"), 1) == 827.2
    assert round(med("precio_capturado_mxn_mwh", "fixed"), 1) == 732.1
    assert round(med("precio_capturado_mxn_mwh", "tracker"), 1) == 739.9
    assert round(med("vf", "fixed"), 3) == 0.885 and round(med("vf", "tracker"), 3) == 0.896
    assert round(med("pct_energia_pml_le0", "fixed"), 2) == 0.41
    assert round(med("pct_energia_pml_le0", "tracker"), 2) == 0.37


def _medianas_ingreso(index):
    e = [x["id"] for x in index["nodos"] if x["sistema"] == "SIN" and x["valido"] and x["kpis"]]
    out = {}
    for cfg in CONFIGS:
        v = {"peor": [], "mediana": [], "mejor": []}
        for n in e:
            ia = _doc(n)["kpis"][cfg]["ingreso_anual"]
            for kk in v:
                if ia[kk]:
                    v[kk].append(ia[kk]["ingreso_mxn_por_mwp"])
        out[cfg] = tuple(round(st.median(v[kk]) / 1e6, 2) for kk in ("peor", "mediana", "mejor"))
    return out


def test_tecnico_md_ingreso_coincide_con_contrato(index):
    txt = (ROOT / "docs" / "TECNICO.md").read_text(encoding="utf-8")
    fila = next(ln for ln in txt.splitlines() if ln.startswith("| Ingreso por MWp-año"))
    nums = [tuple(float(x) for x in re.findall(r"\d+\.\d+", c)) for c in fila.split("|")[2:4]]
    out = _medianas_ingreso(index)
    assert nums == [out["fixed"], out["tracker"]] == [(1.06, 1.23, 2.02), (1.26, 1.48, 2.45)]


def test_mejor_peor_anio_modas(index):
    """TECNICO.md §7: mejor año casi siempre 2022; peor casi siempre 2020, o 2025."""
    from collections import Counter

    b, w = Counter(), Counter()
    for x in index["nodos"]:
        if x["kpis"]:
            ia = _doc(x["id"])["kpis"]["fixed"]["ingreso_anual"]
            if ia["mejor"]:
                b[ia["mejor"]["anio"]] += 1
                w[ia["peor"]["anio"]] += 1
    assert b.most_common(1)[0][0] == 2022 and b[2022] / sum(b.values()) > 0.9
    assert [a for a, _ in w.most_common(2)] == [2020, 2025]


def test_contra_legado(prep):
    leg = pd.read_csv(ROOT / "legacy" / "outputs" / "kpis_nodo_2024-08-01_2025-07-31_nasa.csv")
    leg = leg[leg.dias == 365]
    nodos = [x[0] for x in prep.execute("select distinct nodo from base order by 1").fetchall()]
    m = _por_lotes(prep, nodos, lote=100, nivel="mes",
                   where_extra="fecha between DATE '2024-08-01' and DATE '2025-07-31' and sistema='SIN'")
    m = m[m.config == "tracker"]
    r = m.groupby("nodo").agg(n=("n", "sum"), cpml=("cpml", "sum"), P=("P", "sum"), I=("I", "sum")).reset_index()
    r["B"], r["C"] = r.cpml / 100.0 / r.n, r.I / r.P
    j = leg.merge(r, on="nodo")
    j = j[j.n == 8760]
    assert len(j) > 2000
    assert (j.B - j.pml_promedio).abs().max() < 0.005
    dc = (j.C - j.precio_captura_fv)
    assert abs(dc.median()) < 10 and dc.abs().quantile(0.95) < 60
    ratio = j.I / (j.ingreso_fv_mxn_por_kwp * 1000)
    assert 0.95 < ratio.median() < 1.02
