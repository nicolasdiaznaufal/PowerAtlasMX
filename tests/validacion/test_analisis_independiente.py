"""Validación independiente de data/analysis/ (recálculo del deck "Nodal Solar Value") — validador.

Camino propio: pml_hourly (solo lectura) + reloj CDMX por zoneinfo (_indep.mapa_cdmx) + perfil y del parquet de
baselines + INPC (deflactor por mes CDMX) + región/entidad/municipio de index.json. Definiciones tomadas del deck
(texto publicado) y de TECNICO.md §11; nada se importa de pipeline/.
"""
from __future__ import annotations

import json
import math
import re
import statistics as st

import pandas as pd
import pytest

from _indep import mapa_cdmx
from conftest import ROOT

AN = ROOT / "data" / "analysis" / "analysis.json"
ANN = ROOT / "data" / "analysis" / "analysis_nodos.json"
DECK = ROOT / "Nodal Solar Value.md"
INDEX = ROOT / "data" / "index.json"
NODES = ROOT / "data" / "nodes"
BASE_MH = ROOT / "data" / "baselines" / "solar_baselines_month_hour.parquet"
INPC_CSV = ROOT / "data" / "ref" / "inpc_mensual.csv"
LCOE = 714.0
VENTANAS = {"completo": ("2020-01", "2026-09"), "deck_2024_25": ("2024-08", "2025-07"),
            "deck_2025_26": ("2025-08", "2026-07"), "deck_2024_25_ago_jun": ("2024-08", "2025-06"),
            "deck_2025_26_ago_jun": ("2025-08", "2026-06")}
DOCE = ("deck_2024_25", "deck_2025_26")


def _ym(s):
    return int(s.replace("-", ""))


@pytest.fixture(scope="module")
def an():
    if not AN.exists():
        pytest.skip("sin data/analysis/analysis.json")
    return json.loads(AN.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def ann():
    return json.loads(ANN.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def deck():
    if not DECK.exists():
        pytest.skip("sin el deck")
    return DECK.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def meta():
    idx = json.loads(INDEX.read_text(encoding="utf-8"))
    return pd.DataFrame([(e["id"], e["sistema"], e["region"], e["entidad"], e["municipio"]) for e in idx["nodos"]],
                        columns=["nodo", "sistema", "region", "entidad", "municipio"])


# ------------------------------------------------------------------ recálculo propio (pesado)
@pytest.fixture(scope="module")
def rec(db, meta):
    """Tablas temporales: a_mes (nodo, config, anio, mes) sumas mensuales 2020-01..2026-09 y a_cel (+hora)
    para 2024-08..2026-07; SIN con baseline; precios en centavos exactos; deflactor INPC por mes CDMX."""
    if not (BASE_MH.exists() and INDEX.exists()):
        pytest.skip("faltan baselines / índice")
    db.register("mapa_df", mapa_cdmx())
    db.execute("create or replace temp table mapa as select sistema, fecha, hora, ts from mapa_df")
    db.execute(f"""create or replace temp table base as select loc_id nodo, config, month mes, hour hora,
                   mwh_per_mwp_mean_day y from read_parquet('{BASE_MH}') where loc_id not like 'cell_%'""")
    t = pd.read_csv(INPC_CSV, dtype={"mes": str})
    base_v = float(t.loc[t.mes == t.mes.max(), "inpc"].iloc[0])
    t["f"] = base_v / t.inpc
    t["anio"], t["mes_n"] = t.mes.str[:4].astype(int), t.mes.str[5:].astype(int)
    db.register("inpc_df", t[["anio", "mes_n", "f"]])
    db.execute("create or replace temp table inpc as select anio, mes_n mes, f from inpc_df")
    db.register("meta_df", meta)
    db.execute("create or replace temp table meta as select * from meta_df")
    nodos = [r[0] for r in db.execute("""select distinct b.nodo from base b join meta m using (nodo)
                                         where m.sistema = 'SIN' order by 1""").fetchall()]
    db.execute("drop table if exists a_mes; drop table if exists a_cel")
    for i in range(0, len(nodos), 100):
        lst = ",".join("'" + n + "'" for n in nodos[i:i + 100])
        db.execute(f"""create or replace temp table lote as
            select p.nodo, p.pml, p.energia, p.perdidas, p.congestion, year(m.ts)::int anio, month(m.ts)::int mes,
                   hour(m.ts)::int hora
            from (select * from db.pml_hourly where nodo in ({lst})) p join mapa m using (sistema, fecha, hora)""")
        db.execute(f"create or replace temp table base_lote as select * from base where nodo in ({lst})")
        sel = """count(*) n, (sum(p.pml::DECIMAL(18,2)) * 100)::BIGINT cpml, (sum(p.energia::DECIMAL(18,2))*100)::BIGINT cen,
                 (sum(p.perdidas::DECIMAL(18,2))*100)::BIGINT cper, (sum(p.congestion::DECIMAL(18,2))*100)::BIGINT ccon,
                 sum(b.y) P, sum(b.y*p.pml) I, coalesce(sum(b.y) filter (where p.pml <= 0), 0) E0"""
        q_mes = f"""select p.nodo, b.config, p.anio, p.mes, {sel} from lote p join base_lote b
                    on b.nodo = p.nodo and b.mes = p.mes and b.hora = p.hora group by all"""
        q_cel = f"""select p.nodo, b.config, p.anio, p.mes, p.hora, {sel} from lote p join base_lote b
                    on b.nodo = p.nodo and b.mes = p.mes and b.hora = p.hora
                    where p.anio * 100 + p.mes between 202408 and 202607 group by all"""
        if i == 0:
            db.execute(f"create temp table a_mes as {q_mes}")
            db.execute(f"create temp table a_cel as {q_cel}")
        else:
            db.execute(f"insert into a_mes {q_mes}")
            db.execute(f"insert into a_cel {q_cel}")
        db.execute("drop table lote; drop table base_lote")
    return db


def nodos_ventana(con, v: str, cfg: str = "tracker") -> pd.DataFrame:
    """KPIs por nodo de la ventana con la regla de universo del deck (SIN, baseline, >= 7200 h, sin Cozumel)."""
    d, h = VENTANAS[v]
    df = con.execute(f"""
        with w as (select a.*, i.f from a_mes a join inpc i using (anio, mes)
                   where a.config = '{cfg}' and a.anio*100 + a.mes between {_ym(d)} and {_ym(h)})
        select w.nodo, m.region, m.entidad, sum(n) n, sum(cpml)/100.0/sum(n) pml_medio, sum(I)/sum(P) p_cap,
               100*sum(E0)/sum(P) pct_e0, sum(P) y_f, sum(I) ingreso, sum(ccon)/100.0/sum(n) congestion_media,
               sum(cen)/100.0/sum(n) energia_media, sum(cpml*f)/100.0/sum(n) pml_medio_real, sum(I*f)/sum(P) p_cap_real
        from w join meta m using (nodo) where m.municipio is distinct from 'COZUMEL'
        group by all having sum(n) >= 7200""").df()
    df["vf"] = df.p_cap / df.pml_medio
    df["ingreso_atajo"] = df.y_f * df.pml_medio
    df["ingreso_real"] = df.y_f * df.p_cap_real
    if v != "completo":
        hh = con.execute(f"""select nodo, hora, sum(n) n, sum(cpml)/100.0/sum(n) pml_h, sum(P)/sum(n) y_h
                             from a_cel where config = '{cfg}' and anio*100 + mes between {_ym(d)} and {_ym(h)}
                             group by all""").df()
        sp = {}
        vd = {}
        for nodo, g in hh.groupby("nodo"):
            g = g.set_index("hora").sort_index()
            punta = (g.loc[18:21, "pml_h"] * g.loc[18:21, "n"]).sum() / g.loc[18:21, "n"].sum()
            solar = (g.loc[6:17, "pml_h"] * g.loc[6:17, "n"]).sum() / g.loc[6:17, "n"].sum()
            sp[nodo] = punta - solar
            pm = (g.pml_h * g.n).sum() / g.n.sum()
            vd[nodo] = (g.y_h * g.pml_h).sum() / (pm * g.y_h.sum())
        df["spread_punta_solar"] = df.nodo.map(sp)
        df["vf_dia_promedio"] = df.nodo.map(vd)
    return df


def area(df: pd.DataFrame) -> dict:
    """Área = promedio simple entre nodos; VF = cociente de promedios (deck)."""
    o = {c: df[c].mean() for c in ("pml_medio", "p_cap", "pct_e0", "y_f", "ingreso", "ingreso_atajo",
                                   "congestion_media", "pml_medio_real", "p_cap_real", "ingreso_real")}
    o["n_nodos"] = len(df)
    o["vf"] = o["p_cap"] / o["pml_medio"]
    o["vf_mediana_nodos"] = df.vf.median()
    o["cubren_real"] = int((df.p_cap_real >= LCOE).sum())
    o["cubren_nominal"] = int((df.p_cap >= LCOE).sum())
    if "spread_punta_solar" in df:
        o["spread_punta_solar"] = df.spread_punta_solar.mean()
    return o


def _close(a, b, rel=1e-6, abs_=1e-6):
    return abs(a - b) <= max(abs_, rel * max(abs(a), abs(b)))


@pytest.fixture(scope="module")
def nv(rec):
    return {v: nodos_ventana(rec, v) for v in VENTANAS}


# ------------------------------------------------------------------ (a) universo, nodos y áreas
@pytest.mark.pesado
@pytest.mark.parametrize("v", list(VENTANAS))
def test_nodos_y_universo(nv, ann, v):
    mine = nv[v].set_index("nodo")
    w = ann["ventanas"][v]
    pub = {n: i for i, n in enumerate(ann["ids"]) if w["p_cap"][i] is not None}
    assert set(pub) == set(mine.index), (len(pub), len(mine), sorted(set(pub) ^ set(mine.index))[:5])
    campos = ["pml_medio", "p_cap", "vf", "pct_e0", "congestion_media", "pml_medio_real", "p_cap_real"]
    if v in DOCE:
        campos += ["y_f", "ingreso", "ingreso_atajo", "ingreso_real"]
    if v != "completo":
        campos += ["spread_punta_solar", "vf_dia_promedio"]
    # analysis_nodos.json publica 4 decimales: tolerancia = media unidad del 4o decimal o 2e-6 relativo
    malos = [(n, c, w[c][i], mine.at[n, c]) for n, i in pub.items() for c in campos
             if not _close(w[c][i], mine.at[n, c], rel=2e-6, abs_=5.1e-5)]
    assert malos == [], malos[:5]
    assert all(w["n_horas"][i] == mine.at[n, "n"] for n, i in pub.items())
    assert {ann["region"][i] for i in pub.values()} <= {"CENTRAL", "NORESTE", "NOROESTE", "NORTE", "OCCIDENTAL",
                                                        "ORIENTAL", "PENINSULAR"}


@pytest.mark.pesado
@pytest.mark.parametrize("v", ["deck_2024_25_ago_jun", "deck_2025_26", "deck_2025_26_ago_jun", "completo"])
def test_areas_nacional_regiones_estados(nv, an, v):
    df = nv[v]
    P = an["ventanas"][v]["por_config"]["tracker"]
    grupos = [("nacional", None, df)] + [("regiones", r, g) for r, g in df.groupby("region")] + \
             [("estados", e, g) for e, g in df.groupby("entidad") if e in ("SONORA", "YUCATAN", "JALISCO", "NUEVO LEON")]
    for tipo, k, g in grupos:
        pub = P[tipo] if tipo == "nacional" else P[tipo][k]
        o = area(g)
        assert pub["n_nodos"] == o["n_nodos"], (tipo, k)
        for c in ("pml_medio", "p_cap", "vf", "vf_mediana_nodos", "pct_e0", "congestion_media", "pml_medio_real",
                  "p_cap_real") + (("spread_punta_solar",) if v != "completo" else ()):
            assert _close(pub[c], o[c], rel=1e-6), (v, tipo, k, c, pub[c], o[c])
        # identidades de cabecera
        assert _close(pub["vf"], pub["p_cap"] / pub["pml_medio"], rel=1e-6)
        assert _close(pub["vf_req_real"], LCOE / pub["pml_medio_real"], rel=1e-6)
        assert _close(pub["vf_req_nominal"], LCOE / pub["pml_medio"], rel=1e-6)
        assert _close(pub["margen_mxn_mwh_real"], pub["p_cap_real"] - LCOE, rel=1e-6)
        assert pub["n_nodos_cubren_lcoe_real"] == o["cubren_real"] and pub["n_nodos_cubren_lcoe_nominal"] == o["cubren_nominal"]
        assert _close(pub["pct_nodos_cubren_lcoe_real"], 100 * o["cubren_real"] / o["n_nodos"], rel=1e-6)
        if v in DOCE:
            for c in ("y_f", "ingreso", "ingreso_atajo", "ingreso_real"):
                key = {"y_f": "y_f_mwh_por_mwp", "ingreso": "ingreso_mxn_por_mwp", "ingreso_atajo": "ingreso_atajo_mxn_por_mwp",
                       "ingreso_real": "ingreso_real_mxn_por_mwp"}[c]
                assert _close(pub[key], o[c], rel=1e-6), (tipo, k, c)
            # R = Y_f x P_cap y R_atajo = Y_f x PML medio por nodo => sobreestimación = R_atajo/R − 1
            assert _close(pub["sobreestimacion_atajo_pct"], 100 * (o["ingreso_atajo"] / o["ingreso"] - 1), rel=1e-6)
            assert _close(pub["margen_mxn_por_mwp_anio_real"], o["ingreso_real"] - o["y_f"] * LCOE, rel=1e-6)


@pytest.mark.pesado
def test_identidades_por_nodo(nv):
    for v in DOCE:
        d = nv[v]
        assert ((d.ingreso - d.y_f * d.p_cap).abs() <= 1e-6 * d.ingreso.abs()).all()
        assert ((d.ingreso_atajo / d.ingreso - 1) - (1 / d.vf - 1)).abs().max() < 1e-12


def test_cozumel(an, meta):
    coz = sorted(meta.loc[meta.municipio == "COZUMEL", "nodo"])
    assert sorted(an["universo"]["cozumel_excluidos"]) == coz and len(coz) == 3


# ------------------------------------------------------------------ (b) escenario del deck
def _norm(s):
    """Texto del deck sin marcas LaTeX/markdown de escape, espacios normalizados."""
    s = s.replace("\\(", "").replace("\\)", "").replace("\\_", "_").replace("\\", "")
    s = s.replace("\u2009", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def test_escenario_deck(an, deck):
    e = an["escenario_deck"]
    assert (e["lcoe_usd_mwh"], e["lcoe_bajo_usd_mwh"], e["tipo_cambio_mxn_por_usd"]) == (40.0, 20.0, 17.84)
    assert e["lcoe_mxn_mwh"] == round(40 * 17.84) == 714 and e["lcoe_bajo_mxn_mwh"] == round(20 * 17.84) == 357
    assert e["configuracion"] == "tracker" and e["potencia_mwp"] == 1.0
    t = _norm(deck)
    for frase in ("LCOE of 40 USD/MWh (714 MXN/MWh)", "20 USD/MWh LCOE (357 MXN/MWh)", "17.84 MXN/USD",
                  "single-axis tracker", "1 MWp"):
        assert frase in t, frase
    for c in e["citas"]:  # cada cita es textual del deck
        assert _norm(c) in t, c
    # lo que el deck no imprime no tiene valor numérico en el escenario
    planos = json.dumps(e)
    for k in ("capex", "o_and_m", "tasa", "vida_util", "tir", "van"):
        for kk, vv in e.items():
            if k in kk.lower():
                assert vv is None or isinstance(vv, (str, dict)), (kk, vv)
    for k, vv in e["no_indicados_en_el_deck"].items():
        assert isinstance(vv, str)
    assert not re.search(r'"(capex|opex|o_and_m|tasa_descuento|vida_util)[a-z_]*": *[0-9]', planos)


def test_supuestos_sigue_pendiente():
    txt = (ROOT / "config" / "supuestos.yaml").read_text(encoding="utf-8")
    vals = [ln.split(":", 1)[1].split("#")[0].strip() for ln in txt.splitlines()
            if ":" in ln and not ln.strip().startswith("#") and ln.split(":", 1)[1].split("#")[0].strip()]
    assert vals and all(v == "PENDIENTE" for v in vals), [v for v in vals if v != "PENDIENTE"]
    assert "714" not in txt and "17.84" not in txt


# ------------------------------------------------------------------ (c) pesos de hoy vs nominal
@pytest.mark.pesado
def test_cobertura_real_vs_nominal(nv, an):
    c = an["cobertura_lcoe_real_vs_nominal"]["ventanas"]
    for v in VENTANAS:
        o = area(nv[v])
        pub = c[v]
        assert (pub["n_nodos"], pub["n_real"], pub["n_nominal"]) == (o["n_nodos"], o["cubren_real"], o["cubren_nominal"]), v
        assert _close(pub["delta_pp"], 100 * (o["cubren_real"] - o["cubren_nominal"]) / o["n_nodos"], rel=1e-6)
    r = {v: (round(c[v]["pct_real"], 1), round(c[v]["pct_nominal"], 1)) for v in VENTANAS}
    assert r["completo"] == (80.6, 62.2) and r["deck_2024_25"] == (34.5, 31.6) and r["deck_2025_26"] == (5.2, 4.9)


# ------------------------------------------------------------------ (d) deck vs nuestro
TRANSCRIPCION = {  # cifra del deck -> texto literal en el deck
    586: "mean 586", 3643: "0–3,643", 836: "+836 MXN/MWh in Peninsular", -217: "−217 in Noroeste",
    0.86: "from 0.86 to 0.79", 0.79: "(VF 0.79)", 26: "by 26 % nationally", 0.95: "from 0.95 to 0.65",
    0.65: "from 0.95 to 0.65", 97: "VF fell at 97 % of nodes", 1500: "above 1,500 MXN/MWh", 260: "=260",
    2.75: "VF = 2.75", 5.9: "Noroeste 5.9 %", 5.8: "Norte 5.8 %", 33: "33 % in 2024–25", 5: "5 % in 2025–26",
    795: "795 of 2,407", 127: "127 of 2,420", 2407: "795 of 2,407", 2420: "127 of 2,420", 98: "(98 % of its nodes)",
    150: "**150**", 213: "(Norte: 213)", 0.98: "Spearman 0.98", 0.87: "Spearman 0.87", 0.58: "VF 0.58–0.65",
    53: "53–73 %", 73: "53–73 %",
}


def test_transcripcion_deck(an, deck):
    t = _norm(deck).replace("\\", "")
    for c in an["comparacion_deck"]:
        vals = c["deck"] if isinstance(c["deck"], list) else [c["deck"]]
        for x in vals:
            if x == 0 and "Top-20" in c["cifra"]:
                assert "share no node" in t or "0 of 20" in t
                continue
            if x == 0:
                assert "range 0–3,643" in t
                continue
            assert x in TRANSCRIPCION, (c["cifra"], x)
            assert TRANSCRIPCION[x] in t, (c["cifra"], x, TRANSCRIPCION[x])


@pytest.mark.pesado
def test_cifras_comparadas_rederivadas(nv, an, rec):
    """Re-deriva 12 de las cifras comparadas con el deck, con mi propio cálculo."""
    a26, a25 = nv["deck_2025_26_ago_jun"], nv["deck_2024_25_ago_jun"]
    d26 = nv["deck_2025_26"]
    nat26 = area(a26)
    got = {c["cifra"]: c["nuestra"] for c in an["comparacion_deck"]}
    g = lambda frag: next(v for k, v in got.items() if frag in k)  # noqa: E731
    assert _close(g("Sobreestimacion del atajo nacional"), 100 * (1 / nat26["vf"] - 1), rel=1e-6)
    assert round(100 * (1 / nat26["vf"] - 1), 1) == 25.2
    assert round(an["ventanas"]["deck_2025_26"]["por_config"]["tracker"]["nacional"]["sobreestimacion_atajo_pct"], 1) == \
        round(100 * (area(d26)["ingreso_atajo"] / area(d26)["ingreso"] - 1), 1) == 26.1
    pen = area(a25[a25.region == "PENINSULAR"])
    assert _close(g("VF Peninsular 2024-25"), pen["vf"]) and round(pen["vf"], 3) == 0.919
    assert g("Nodos con P_cap >= 714, 2025-26") == nat26["cubren_nominal"] == 118
    assert g("Nodos con P_cap >= 714, 2024-25") == area(a25)["cubren_nominal"] == 800
    nor = area(a26[a26.region == "NOROESTE"])
    assert _close(g("P_cap Noroeste"), nor["p_cap"]) and round(nor["p_cap"]) == 156
    assert _close(g("PML medio Noroeste"), nor["pml_medio"]) and _close(g("VF_req Noroeste"), LCOE / nor["pml_medio"])
    assert _close(g("% energia FV a PML<=0 Noroeste"), nor["pct_e0"])
    # Spearman atajo (Y_f·PML medio) vs real (Y_f·P_cap), 12 meses 2025-26
    rk = lambda s: s.rank(method="average")  # noqa: E731
    sp = lambda d: rk(d.ingreso_atajo).corr(rk(d.ingreso))  # noqa: E731
    assert _close(g("Spearman atajo vs real, nacional"), sp(d26), rel=1e-5) and round(sp(d26), 3) == 0.983
    ori = d26[d26.region == "ORIENTAL"]
    assert _close(g("Spearman atajo vs real, Oriental"), sp(ori), rel=1e-5) and round(sp(ori), 3) == 0.837
    top = len(set(ori.nlargest(20, "ingreso_atajo").nodo) & set(ori.nlargest(20, "ingreso").nodo))
    assert g("Top-20 comunes") == top == 0
    # λE: idéntico en todos los nodos SIN cada hora; media / mín / máx ago25-jul26
    lam = rec.execute("""select count(*) filter (where e_min <> e_max), avg(e_min), min(e_min), max(e_min), count(*) from (
        select fecha, hora, min(energia) e_min, max(energia) e_max from db.pml_hourly
        where sistema='SIN' and fecha between DATE '2025-08-01' and DATE '2026-07-31' group by all)""").fetchone()
    assert lam[0] == 0 and lam[4] == 8760
    assert _close(g("media ago25"), lam[1]) and g("minimo ago25") == lam[2] and g("maximo ago25") == lam[3]
    pen26 = area(d26[d26.region == "PENINSULAR"])
    assert _close(g("Congestion media Peninsular"), pen26["congestion_media"])
    # tolerancia y veredicto 'reproducido' coherentes: max(2 % rel, media unidad del último dígito)
    for c in an["comparacion_deck"]:
        if c["tipo"] != "valor":
            continue
        dec = len(str(c["deck"]).split(".")[1]) if "." in str(c["deck"]) else 0
        tol = max(0.02 * abs(c["deck"]), 0.5 * 10 ** -dec)
        assert _close(c["tolerancia"], tol, rel=1e-3, abs_=1e-3), c["cifra"]
        assert c["reproducido"] == (abs(c["nuestra"] - c["deck"]) <= tol + 1e-12), c["cifra"]


# ------------------------------------------------------------------ (e) insights
def _planos(o):
    if isinstance(o, dict):
        for v in o.values():
            yield from _planos(v)
    elif isinstance(o, list):
        for v in o:
            yield from _planos(v)
    elif isinstance(o, (int, float)) and not isinstance(o, bool):
        yield float(o)


CONSTANTES = {714, 357, 2020, 2024, 2025, 2026, 1, 20, 25, 30, 35, 40, 45, 50, 55, 60, 2015}


def test_insights_numeros_y_datos(an, deck):
    ins = an["insights"]
    assert len([i for i in ins if not i.get("bandera")]) == 16 and len(ins) == 26
    for i in ins:
        txt = i["texto_es"]
        limpio = re.sub(r"\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)-?\d{2,4}\b", "", txt)
        limpio = re.sub(r"\b20\d\d-\d\d\b", "", limpio)
        nums = re.findall(r"[-−+]?\d[\d,]*\.?\d*", limpio)
        assert nums, i["id"]  # ninguna afirmación sin cifra
        vals = list(_planos(i["valores"]))
        for s in nums:
            s2 = s.replace(",", "").replace("−", "-").replace("+", "")
            if s2 in ("-", ""):
                continue
            x = float(s2)
            dec = len(s2.split(".")[1]) if "." in s2 else 0
            ok = abs(x) in CONSTANTES or (i.get("bandera") and s.lstrip("+-−") in deck) or any(
                abs(round(v * k, dec) - x) < 1e-9 or abs(round(abs(v) * k, dec) - abs(x)) < 1e-9
                for v in vals for k in (1, 1e-6, 100))
            assert ok, (i["id"], s, txt)
    by = {i["id"]: i for i in ins if not i.get("bandera")}
    T = an["tabla_vf_regiones"]["nacional"]
    assert by["vf_nacional"]["valores"] == {"vf_2024_25": T["2024_25_ago_jun"]["vf"], "vf_2025_26": T["2025_26_ago_jun"]["vf"]}
    assert _close(by["atajo"]["valores"]["sobreestimacion_pct"], 100 * (1 / T["2025_26_ago_jun"]["vf"] - 1))
    t = an["tendencia_vf_entre_ventanas"]["deck_2024_25_ago_jun__deck_2025_26_ago_jun"]
    assert by["tendencia"]["valores"]["pct_nodos_vf_baja"] == t["pct_nodos_vf_baja"]
    pyg = an["ventanas"]["deck_2025_26"]["por_config"]["tracker"]["pyg_deck"]
    assert by["pyg_deck_2025_26"]["valores"]["margen_mxn_por_mwp_real"] == pyg["margen_mxn_por_mwp_real"]
    assert by["tendencia_larga"]["valores"]["n_nodos"] == an["tendencia_vf_anual_tracker"]["n_nodos"]
    reg = an["ventanas"]["deck_2025_26_ago_jun"]["por_config"]["tracker"]["regiones"]
    for r, v in by["pml_le0"]["valores"].items():
        assert v == reg[r]["pct_e0"]
    sens = {f["lcoe_usd_mwh"]: f for f in an["ventanas"]["deck_2025_26"]["por_config"]["tracker"]["sensibilidad_lcoe"]["filas"]}
    for usd, pct in ((20, 82), (30, 38), (40, 5), (50, 4)):
        assert round(sens[usd]["pct_nodos_cubren_real"]) == pct


@pytest.mark.pesado
def test_tendencia_vf_99pct_de_2380(rec, an, meta):
    """Pendiente MCO de VF (seguidor) por año completo 2020-2025 (8,760/8,784 h) con >= 3 años."""
    d = rec.execute("""select a.nodo, a.anio, sum(n) n, sum(cpml)/100.0/sum(n) b, sum(I)/sum(P) c
                       from a_mes a join meta m using (nodo)
                       where a.config = 'tracker' and a.anio between 2020 and 2025 and m.municipio is distinct from 'COZUMEL'
                       group by all""").df()
    d = d[d.n == d.anio.map(lambda y: 8784 if y % 4 == 0 else 8760)]
    d["vf"] = d.c / d.b
    pend = []
    for _, g in d.groupby("nodo"):
        if len(g) >= 3:
            x, y = g.anio.astype(float), g.vf
            pend.append(((x - x.mean()) * (y - y.mean())).sum() / ((x - x.mean()) ** 2).sum())
    t = an["tendencia_vf_anual_tracker"]
    assert len(pend) == t["n_nodos"] == 2380
    neg = 100 * sum(p < 0 for p in pend) / len(pend)
    assert _close(t["pct_pendiente_negativa"], neg, rel=1e-6) and round(neg) == 99
    assert _close(t["pendiente_mediana_vf_por_anio"], st.median(pend), rel=1e-4) and round(st.median(pend), 3) == -0.028


# ------------------------------------------------------------------ (f) diapositivas
def test_numeracion_de_diapositivas(an, ann):
    esperado = {1: "Title", 2: "Notation", 3: "Prices", 4: "explorer", 5: "Revenue", 6: "Value factor",
                7: "region", 8: "Profitability", 9: "P&L", 10: "Conclusions"}
    for k, palabra in esperado.items():
        assert palabra.lower() in an["mapa_diapositivas"][str(k)]["titulo"].lower(), k
    ok = set(range(1, 11))

    def tiene(o):
        s = o.get("slide")
        return (isinstance(s, list) and bool(s) and set(s) <= ok) or (isinstance(s, int) and s in ok)
    for i in an["insights"]:
        assert tiene(i), i["id"]
    for c in an["comparacion_deck"]:
        assert tiene(c), c["cifra"]
    for k in ("escenario_deck", "tendencia_vf_entre_ventanas", "tabla_vf_regiones", "cobertura_lcoe_real_vs_nominal"):
        assert tiene(an[k]), k
    for v, w in an["ventanas"].items():
        for cfg, p in w["por_config"].items():
            for k in ("perfil_horario_nacional", "vf_distribucion", "cubren_lcoe_bajo") + \
                     (("pyg_deck", "ranking_atajo_vs_real") if v in DOCE else ()) + \
                     (("explorador",) if cfg == "tracker" else ()) + (("sensibilidad_lcoe",) if "sensibilidad_lcoe" in p else ()):
                assert tiene(p[k]), (v, cfg, k)
    assert tiene(ann)
    sin = [k for k, v in an.items() if isinstance(v, dict) and "slide" not in v
           and k not in ("universo", "pesos_reales", "mapa_diapositivas", "diapositivas", "ventanas")]
    # secciones de nivel superior sin 'slide' (informativo; se reporta)
    assert set(sin) <= {"tendencia_vf_anual_tracker", "lambda_e_sin_2025_26"}, sin


# ------------------------------------------------------------------ (g) tabla de regiones y explorador
@pytest.mark.pesado
def test_tabla_vf_regiones(nv, an):
    T = {r["region"]: r for r in an["tabla_vf_regiones"]["regiones"]}
    assert len(T) == 7
    clave = {"2024_25_ago_jun": "deck_2024_25_ago_jun", "2025_26_ago_jun": "deck_2025_26_ago_jun",
             "2024_25": "deck_2024_25", "2025_26": "deck_2025_26"}
    for r in T:
        assert set(clave) <= set(T[r])
    for r in ("PENINSULAR", "NOROESTE", "ORIENTAL"):
        for k, v in clave.items():
            o = area(nv[v][nv[v].region == r])
            p = T[r][k]
            assert p["n_nodos"] == o["n_nodos"]
            for c in ("vf", "vf_mediana_nodos", "pml_medio", "p_cap", "pml_medio_real", "p_cap_real", "pct_e0",
                      "congestion_media", "spread_punta_solar"):
                assert _close(p[c], o[c], rel=1e-6), (r, k, c)
            assert _close(p["vf_req_real"], LCOE / o["pml_medio_real"], rel=1e-6)
        a, b = nv["deck_2024_25_ago_jun"], nv["deck_2025_26_ago_jun"]
        a, b = a[a.region == r].set_index("nodo"), b[b.region == r].set_index("nodo")
        com = a.index.intersection(b.index)
        assert _close(T[r]["cambio"]["pct_nodos_vf_baja"], 100 * (b.loc[com, "vf"] < a.loc[com, "vf"]).mean(), rel=1e-6)
        assert _close(T[r]["cambio"]["delta_vf_ago_jun"], area(b.reset_index())["vf"] - area(a.reset_index())["vf"], rel=1e-5)


def _perfil(con, v, nodos):
    d, h = VENTANAS[v]
    lst = ",".join("'" + n + "'" for n in nodos)
    hh = con.execute(f"""select nodo, hora, sum(cpml)/100.0/sum(n) pml_h, sum(cen)/100.0/sum(n) energia_h,
                                sum(ccon)/100.0/sum(n) congestion_h, sum(P)/sum(n) y_h
                         from a_cel where config = 'tracker' and anio*100+mes between {_ym(d)} and {_ym(h)}
                         and nodo in ({lst}) group by all""").df()
    return hh.groupby("hora")[["pml_h", "energia_h", "congestion_h", "y_h"]].mean()


@pytest.mark.pesado
def test_explorador_estados_y_perfil_nacional(rec, nv, an):
    v = "deck_2025_26"
    df = nv[v]
    P = an["ventanas"][v]["por_config"]["tracker"]
    for e in ("SONORA", "YUCATAN", "JALISCO"):
        mine = _perfil(rec, v, list(df[df.entidad == e].nodo))
        pub = P["explorador"]["perfil_horario_estados"][e]
        for c in ("pml_h", "energia_h", "congestion_h"):
            assert all(_close(pub[c][h], mine.at[h, c], rel=1e-6) for h in range(24)), (e, c)
    mine = _perfil(rec, v, list(df.nodo))
    pub = P["perfil_horario_nacional"]
    for c, k in (("pml_h", "pml_h"), ("y_h", "y_h_mwh_por_mwp")):
        assert all(_close(pub[k][h], mine.at[h, c], rel=1e-6, abs_=5.1e-7) for h in range(24)), c  # 6 decimales


# ------------------------------------------------------------------ (h) perfil nacional desde las fichas
@pytest.mark.pesado
def test_perfil_nacional_desde_fichas(nv, an):
    """Recompone el día promedio nacional (seguidor, ago25-jul26) SOLO con los arreglos de las fichas (reloj
    CDMX): por nodo Σ cent/Σ n y y·n/n por hora; luego promedio simple entre nodos del universo."""
    v = "deck_2025_26"
    d0, d1 = VENTANAS[v]
    acc = {k: [0.0] * 24 for k in ("pml", "y", "e")}
    nodos = list(nv[v].nodo)
    for n in nodos:
        a = json.loads((NODES / f"{n}.json").read_text(encoding="utf-8"))["agregados"]
        y = a["perfil_y"]["tracker"]
        nh, ch, ph, eh = [0] * 24, [0] * 24, [0.0] * 24, [0] * 24
        for i, mes in enumerate(a["meses"]):
            if not (d0 <= mes <= d1):
                continue
            m = int(mes[5:])
            for h in range(24):
                k = i * 24 + h
                nh[h] += a["n_horas"][k]
                ch[h] += a["sum_pml_cent"][k]
                ph[h] += y[(m - 1) * 24 + h] * a["n_horas"][k]
                eh[h] += a["sum_pml_cent"][k] - a["sum_perdidas_cent"][k] - a["sum_congestion_cent"][k] - a["sum_residuo_cent"][k]
        for h in range(24):
            acc["pml"][h] += ch[h] / 100 / nh[h] / len(nodos)
            acc["y"][h] += ph[h] / nh[h] / len(nodos)
            acc["e"][h] += eh[h] / 100 / nh[h] / len(nodos)
    pub = an["ventanas"][v]["por_config"]["tracker"]["perfil_horario_nacional"]
    for h in range(24):
        assert _close(pub["pml_h"][h], acc["pml"][h], rel=2e-6)
        assert _close(pub["energia_h"][h], acc["e"][h], rel=2e-6)
        assert _close(pub["y_h_mwh_por_mwp"][h], acc["y"][h], rel=2e-6, abs_=5.1e-7)
    pm = st.mean(nv[v].pml_medio)
    # barras de ingreso (diapositiva 5): producto de los promedios nacionales del día promedio
    for h in range(24):
        assert _close(pub["ingreso_real_h"][h], acc["y"][h] * acc["pml"][h], rel=2e-6, abs_=1e-3)
        assert _close(pub["ingreso_atajo_h"][h], acc["y"][h] * pm, rel=2e-6, abs_=1e-3)
