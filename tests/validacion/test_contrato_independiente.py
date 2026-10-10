"""Validación independiente del contrato (data/index.json, data/nodes/{id}.json) y del bloqueo PENDIENTE de
lo financiero; TIR/VAN/LCOE contra flujos calculados a mano (validador)."""
from __future__ import annotations

import datetime as dt
import gzip
import json
import math
import random
import re
import statistics as st
import sys

import pytest

from conftest import ROOT

INDEX = ROOT / "data" / "index.json"
NODES = ROOT / "data" / "nodes"
AGG = ROOT / "data" / "aggregates"
CAMPOS_INDEX = {"id", "nombre", "entidad", "municipio", "sistema", "region", "lat", "lon", "meses_de_datos",
                "confianza", "valido", "estado_calidad", "ficha", "motivo_sin_ficha", "kpis",
                "coord_fuente", "coord_precision", "renombrado_a", "renombre_de"}
COMUNES_JSON = ("n_horas", "n_pml_le0", "sum_pml_cent", "sum_perdidas_cent", "sum_congestion_cent", "sum_residuo_cent")
RENOMBRES = {"03POR-115": "03PCL-115", "03DEA-230": "03DEC-230", "03CBO-69": "03JAG-69", "03AMX-69": "03ALX-69",
             "03JTC-115": "03JTD-115", "03VTS-115": "03VKA-115"}
KPIS_INDEX = {"precio_capturado_mxn_mwh", "precio_base_mxn_mwh", "vf", "pct_energia_pml_le0",
              "precio_capturado_real_mxn_mwh", "precio_base_real_mxn_mwh", "vf_real"}  # 1.2.0
PROHIBIDAS = re.compile(r"(tir|van|lcoe|break_even|veredicto|semaforo|usd|escenario)", re.I)

sys.path.insert(0, str(ROOT / "pipeline"))


@pytest.fixture(scope="module")
def index():
    if not INDEX.exists():
        pytest.skip("sin data/index.json")
    return json.loads(INDEX.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def docs(index):
    return {e["id"]: json.loads((NODES / f"{e['id']}.json").read_text(encoding="utf-8"))
            for e in index["nodos"] if e["ficha"]}


# ------------------------------------------------------------------ estructura
def test_cabecera(index, docs):
    assert index["schema_version"] == "1.2.0"
    g = dt.datetime.fromisoformat(index["generated_at"])
    assert g.utcoffset() == dt.timedelta(0)
    assert {d["schema_version"] for d in docs.values()} == {"1.2.0"}  # fichas: misma forma que 1.1, versión 1.2
    assert {d["generated_at"] for d in docs.values()} == {index["generated_at"]}
    assert index["rotulo"] == "precio capturado MDA (referencia)"
    assert index["config_defecto"] == "tracker" and {d["kpis"]["config_defecto"] for d in docs.values()} == {"tracker"}
    assert index["umbral_anio_completo"] == 1.0 and index["umbral_mes_completo"] == 1.0
    pd_ = index["periodo_datos"]
    assert (pd_["desde"], pd_["hasta"], pd_["reloj"]) == ("2020-01", "2026-09", "CDMX estandar UTC-6 fijo")
    assert {k: set(v) for k, v in pd_["meses_borde"].items()} == {"SIN": set(), "BCA": {"2020-01", "2026-10"},
                                                                 "BCS": {"2020-01", "2026-10"}}
    assert index["pesos_reales"]["base_mes"] == "2026-09"


@pytest.mark.pesado
def test_todos_los_nodos_con_pml_listados(index, db):
    ids = [e["id"] for e in index["nodos"]]
    assert len(ids) == len(set(ids)) == 2659
    con_pml = {r[0] for r in db.execute("select distinct nodo from db.pml_hourly").fetchall()}
    assert set(ids) == con_pml
    sis = dict(db.execute("select nodo, any_value(sistema) from db.pml_hourly group by 1").fetchall())
    assert all(sis[e["id"]] == e["sistema"] for e in index["nodos"])


def test_campos_y_tipos_index(index):
    for e in index["nodos"]:
        assert set(e) == CAMPOS_INDEX, e["id"]
        assert isinstance(e["meses_de_datos"], int) and isinstance(e["valido"], bool)
        if e["ficha"]:
            assert e["ficha"] == f"nodes/{e['id']}.json" and e["motivo_sin_ficha"] is None
            assert set(e["kpis"]) == {"fixed", "tracker"}
            d = json.loads((NODES / f"{e['id']}.json").read_text(encoding="utf-8"))
            for c in ("fixed", "tracker"):
                assert set(e["kpis"][c]) == KPIS_INDEX
                assert all(isinstance(v, (int, float)) and math.isfinite(v) for v in e["kpis"][c].values())
                rl = d["kpis"][c]["reales"]  # 1.2: los *_real del índice = bloque reales de la ficha (4 dec.)
                for ki, kf in (("precio_capturado_real_mxn_mwh", "precio_capturado_mxn_mwh"),
                               ("precio_base_real_mxn_mwh", "precio_base_mxn_mwh"), ("vf_real", "vf")):
                    assert abs(e["kpis"][c][ki] - rl[kf]) <= 5.1e-5 * max(1, abs(rl[kf])), (e["id"], c, ki)
        else:
            assert e["kpis"] is None and isinstance(e["motivo_sin_ficha"], str) and e["motivo_sin_ficha"]


def _catalogo_codigos() -> set[str]:
    """Todas las celdas de texto del catálogo NodosP (lectura propia, sin columnas supuestas)."""
    import openpyxl

    xl = next((ROOT / "data" / "ref").glob("Cat*NodosP*.xlsx"))
    ws = openpyxl.load_workbook(xl, read_only=True, data_only=True).worksheets[0]
    return {str(v).strip() for row in ws.iter_rows(values_only=True) for v in row if isinstance(v, str)}


def test_fichas_y_motivos(index):
    from collections import Counter

    con = [e for e in index["nodos"] if e["ficha"]]
    sin = [e for e in index["nodos"] if not e["ficha"]]
    assert len(con) == 2456 and len(sin) == 203
    assert {p.stem for p in NODES.glob("*.json")} == {e["id"] for e in con}
    assert Counter(e["sistema"] for e in con) == {"SIN": 2455, "BCA": 1}
    cat = _catalogo_codigos()
    celdas = ROOT / "data" / "cache" / "nasa" / "climatologia" / "celdas"
    tipo = Counter()
    for e in sin:
        m = e["motivo_sin_ficha"]
        if m.startswith("sin_clima"):
            la, lo = re.search(r"([+-]\d+),([+-]\d+)", m).groups()
            assert int(la) == math.floor(e["lat"]) and int(lo) == math.floor(e["lon"])
            assert not (celdas / f"celda_{int(la):+03d}_{int(lo):+04d}.parquet").exists(), e["id"]
            tipo[("clima", e["sistema"])] += 1
        else:
            assert m.startswith("sin_coordenadas") and e["lat"] is None and e["lon"] is None
            tipo[("fuera_catalogo" if e["id"] not in cat else "sin_centroide")] += 1
            assert e["renombrado_a"] is None  # los retirados con renombre sí tienen ficha
    assert tipo == {("clima", "BCA"): 118, ("clima", "BCS"): 31, "fuera_catalogo": 44, "sin_centroide": 10}
    assert index["conteo"] == {"nodos": 2659, "con_ficha": 2456, "sin_ficha": 203}


@pytest.mark.pesado
def test_renombres(index, db):
    """Los 6 retirados toman coordenadas del código nuevo: fuera del catálogo, mismo nombre, datos contiguos
    (último día del viejo + 1 = primer día del nuevo) y sin solape."""
    e = {x["id"]: x for x in index["nodos"]}
    cat = _catalogo_codigos()
    for viejo, nuevo in RENOMBRES.items():
        assert e[viejo]["renombrado_a"] == nuevo and e[nuevo]["renombre_de"] == viejo
        assert viejo not in cat and nuevo in cat
        assert (e[viejo]["lat"], e[viejo]["lon"]) == (e[nuevo]["lat"], e[nuevo]["lon"]) and e[viejo]["ficha"]
        assert e[viejo]["coord_fuente"] == f"renombre:{nuevo}"
        f = dict(db.execute(f"""select nodo, [min(fecha), max(fecha)] from db.pml_hourly
                                where nodo in ('{viejo}', '{nuevo}') group by 1""").fetchall())
        assert f[viejo][1] + dt.timedelta(days=1) == f[nuevo][0], (viejo, f)
    assert sum(1 for x in e.values() if x["renombrado_a"]) == 6


def test_campos_documentados_en_tecnico(index, docs):
    txt = (ROOT / "docs" / "TECNICO.md").read_text(encoding="utf-8")
    sec = txt[txt.index("## 6. Contrato"):txt.index("## 7.")]
    citados = set()
    for ln in sec[sec.index("### `index.json`"):sec.index("### `nodes/")].splitlines():
        if ln.strip().startswith("- `") or ln.strip().startswith("- `id"):
            citados |= set(re.findall(r"[a-z_]+", ",".join(re.findall(r"`([a-z_, ]+)`", ln.split(":")[0]))))
    assert {"id", "coord_fuente", "coord_precision", "renombrado_a", "renombre_de", "ficha", "kpis"} <= citados
    assert citados - {"null"} <= CAMPOS_INDEX | {"config_defecto", "reloj", "periodo_datos", "umbral_anio_completo",
                                                   "umbral_mes_completo", "pesos_reales", "rotulo", "alcance",
                                                   "supuestos", "conteo", "motivo_sin_ficha"}
    d = next(iter(docs.values()))
    for k in COMUNES_JSON + ("perfil_y", "deflactor_inpc", "meses_borde", "layout", "reloj"):
        assert k in sec and k in d["agregados"], k
    for k in ("nota_reloj", "mediodia_solar_cdmx", "centroide_energia_cdmx", "calidad", "clima"):
        assert k in sec and k in d, k
    assert "sum_energia_cent" not in d["agregados"]  # no se publica (se reconstruye)
    assert "reales" in d["kpis"]["fixed"] and "financiero" in d["kpis"]["fixed"]


def test_arreglos_tipos_y_largos(docs):
    for n, d in docs.items():
        ag = d["agregados"]
        L = 24 * len(ag["meses"])
        meses = ag["meses"]
        a0 = dt.date.fromisoformat(meses[0] + "-01")
        esp = [f"{(a0.year * 12 + a0.month - 1 + i) // 12:04d}-{(a0.month - 1 + i) % 12 + 1:02d}" for i in range(len(meses))]
        assert meses == esp, n
        for k in COMUNES_JSON:
            assert len(ag[k]) == L and all(type(x) is int for x in ag[k]), (n, k)
        for c in ("fixed", "tracker"):
            y = ag["perfil_y"][c]
            assert len(y) == 288 and all(isinstance(v, (int, float)) and 0 <= v < 1 for v in y), (n, c)
        assert len(ag["deflactor_inpc"]) == len(meses)
        assert all(abs(r) <= 2 * h for r, h in zip(ag["sum_residuo_cent"], ag["n_horas"])), n
        assert set(ag["meses_borde"]) <= {"2020-01", "2026-10"} and (d["sistema"] != "SIN" or not ag["meses_borde"])


def test_kpis_reproducibles_desde_arreglos(docs):
    """Muestra de 60 fichas + especiales: puerto Python propio de la reconstrucción publicada (§6)."""
    rnd = random.Random(20261010)
    for n in rnd.sample(sorted(docs), 60) + ["03EGM-230", "07CFP-400", "03MNO-115", "03DEA-230"]:
        d = docs[n]
        ag = d["agregados"]
        idx = [i * 24 + h for i, m in enumerate(ag["meses"]) if "2020-01" <= m <= "2026-09" for h in range(24)]
        nh = sum(ag["n_horas"][k] for k in idx)
        B = sum(ag["sum_pml_cent"][k] for k in idx) / 100 / nh
        for c in ("fixed", "tracker"):
            y = ag["perfil_y"][c]
            yk = {k: y[(int(ag["meses"][k // 24][5:]) - 1) * 24 + k % 24] for k in idx}
            P = math.fsum(yk[k] * ag["n_horas"][k] for k in idx)
            I = math.fsum(yk[k] * ag["sum_pml_cent"][k] / 100 for k in idx)
            E0 = math.fsum(yk[k] * ag["n_pml_le0"][k] for k in idx)
            k_ = d["kpis"][c]
            assert k_["n_horas"] == nh
            assert abs(k_["precio_base_mxn_mwh"] - B) < 1e-6
            assert abs(k_["precio_capturado_mxn_mwh"] - I / P) / abs(I / P) < 1e-6
            assert abs(k_["vf"] - (I / P) / B) < 1e-5
            assert abs(k_["pct_energia_pml_le0"] - 100 * E0 / P) < 1e-4


def test_tamanos_json(docs):
    gz = [len(gzip.compress((NODES / f"{n}.json").read_bytes(), 9)) / 1024 for n in docs]
    assert round(st.median(gz), 1) == 31.6 and round(max(gz), 1) == 34.5  # TECNICO.md §6
    assert len(gzip.compress(INDEX.read_bytes(), 9)) == 230_251  # 1.2.0 (TECNICO.md §6)


# ------------------------------------------------------------------ reloj (E)
def test_bloque_reloj(index, docs):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    r = index["reloj"]
    assert r["utc_offset_referencia_horas"] == -6
    std = {"SIN": -6, "BCS": -7, "BCA": -8}
    for s, b in r["sistemas"].items():
        assert b["offset_estandar_utc_horas"] == std[s] and b["desfase_a_cdmx_horas"] == -6 - std[s]
        assert ("+%d h" % (-6 - std[s])) in b["nota_es"] or s == "SIN"
        assert ("+%d h" % (-6 - std[s])) in b["nota_en"] or s == "SIN"
    off = lambda z, y, m: ZoneInfo(z).utcoffset(datetime(y, m, 15)).total_seconds() / 3600  # noqa: E731
    civ = r["sistemas"]
    # SIN: UTC-5 en verano 2020-2022, UTC-6 fijo después
    assert off("America/Mexico_City", 2021, 7) == -5 and off("America/Mexico_City", 2023, 7) == -6
    assert "UTC-5" in civ["SIN"]["hora_civil_publicada"] and "2022-10-30" in civ["SIN"]["hora_civil_publicada"]
    # BCS: UTC-6 (= CDMX estándar) en veranos 2020-2022; UTC-7 constante desde 2022-10-30
    assert all(off("America/Mazatlan", y, 7) == -6 for y in (2020, 2021, 2022))
    assert all(off("America/Mazatlan", y, m) == -7 for y in (2023, 2024, 2025, 2026) for m in (1, 7))
    t = civ["BCS"]["hora_civil_publicada"]
    assert "UTC-7" in t and "UTC-6 en verano 2020-2022" in t and "igual a CDMX" in t and "2022-10-30" in t
    assert "UTC-6 in summer 2020-2022, same as CDMX" in civ["BCS"]["nota_en"]
    # BCA: DST de EE.UU. todos los años: -8 invierno, -7 verano
    assert all(off("America/Tijuana", y, 1) == -8 and off("America/Tijuana", y, 7) == -7 for y in range(2020, 2027))
    t = civ["BCA"]["hora_civil_publicada"]
    assert "UTC-8" in t and "CDMX-2 h" in t and "UTC-7" in t and "CDMX-1 h" in t and "EE.UU." in t
    assert "US DST every year" in civ["BCA"]["nota_en"]
    for n, d in docs.items():
        assert d["nota_reloj"] == (d["sistema"] != "SIN")
        assert d["agregados"]["reloj"]["sistema"] == d["sistema"]
        assert d["agregados"]["reloj"]["desfase_a_cdmx_horas"] == -6 - std[d["sistema"]]


def test_mediodia_solar_y_centroide(docs):
    """mediodia_solar_cdmx = 12 − lon/15 − 6 y el centroide de energía que calculo yo del perfil_y (punto medio
    de cada hora) queda a menos de 0.5 h (un error de reloj daría ±1/±2 h). En todos los nodos el centroide
    cae entre −0.45 y +0.1 h del mediodía medio (antes por nubosidad vespertina), BCA incluido."""
    rnd = random.Random(7)
    muestra = rnd.sample(sorted(docs), 12) + ["07CFP-400", "01AAN-85", "03DEA-230"]
    diffs = []
    for n in muestra:
        d = docs[n]
        assert abs(d["mediodia_solar_cdmx"] - (12 - d["lon"] / 15 - 6)) < 6e-4, n
        for c in ("fixed", "tracker"):
            y = d["agregados"]["perfil_y"][c]
            por_h = [sum(y[m * 24 + h] for m in range(12)) for h in range(24)]
            cen = sum(v * (h + 0.5) for h, v in enumerate(por_h)) / sum(por_h)
            assert abs(cen - d["centroide_energia_cdmx"][c]) < 6e-4, (n, c)
            diffs.append(cen - d["mediodia_solar_cdmx"])
            assert abs(cen - d["mediodia_solar_cdmx"]) < 0.5, (n, c, cen, d["mediodia_solar_cdmx"])
    assert len(diffs) >= 20
    todas = [d["centroide_energia_cdmx"][c] - d["mediodia_solar_cdmx"] for d in docs.values() for c in ("fixed", "tracker")]
    assert -0.45 < min(todas) and max(todas) < 0.1
    b = docs["07CFP-400"]
    assert abs(b["mediodia_solar_cdmx"] - 13.569) < 1e-9 and abs(b["centroide_energia_cdmx"]["fixed"] - 13.569) < 0.05

# ------------------------------------------------------------------ PENDIENTE: nada financiero se filtra
def _fugas(o, ruta=""):
    out = []
    if isinstance(o, dict):
        for k, v in o.items():
            r = f"{ruta}.{k}"
            if PROHIBIDAS.search(k) and v is not None and not (isinstance(v, (list, dict)) and not v):
                out.append(r)
            out += _fugas(v, r)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            out += _fugas(v, f"{ruta}[{i}]")
    return out


def test_supuestos_pendientes_y_sin_fugas(index, docs):
    import kpis as K

    sup = K.cargar_supuestos()
    assert sup["estado"] == "PENDIENTE"
    assert index["supuestos"]["estado"] == "PENDIENTE"
    assert _fugas(index) == []
    for n, d in docs.items():
        assert _fugas(d) == [], n
        for c in ("fixed", "tracker"):
            f = d["kpis"][c]["financiero"]
            assert f["estado"] == "PENDIENTE" and "estado" in f["pendientes"]
            assert all(f[k] is None for k in ("tir", "van_mxn_por_mwp", "lcoe_mxn_mwh", "break_even_ppa_mxn_mwh",
                                              "break_even_pml_base_mxn_mwh", "veredicto"))


def test_funciones_financieras_se_niegan():
    import kpis as K

    sup = K.cargar_supuestos()
    for llamada in (lambda: K.financiero(sup, 1e6, 2000, 0.9), lambda: K.a_usd(sup, 100.0),
                    lambda: K.veredicto(sup, 0.1), lambda: K.escenario(sup, "base", 1e6, 2000, 0.9),
                    lambda: K.tir_n_de_m(sup, [{"ingreso_mxn_por_mwp": 1e6, "produccion_mwh_por_mwp": 2000, "vf": 0.9}])):
        with pytest.raises(K.SupuestoPendiente):
            llamada()
    # aunque los valores estén llenos, con estado PENDIENTE tampoco se calcula
    lleno = _sup_lleno()
    lleno["estado"] = "PENDIENTE"
    with pytest.raises(K.SupuestoPendiente):
        K.financiero(lleno, 1e6, 2000, 0.9)
    b = K.bloque_financiero(sup, {"ingreso_anual": {"mediana": {"ingreso_mxn_por_mwp": 1, "produccion_mwh_por_mwp": 1, "vf": 1}}})
    assert b["estado"] == "PENDIENTE" and b["tir"] is None


# ------------------------------------------------------------------ fórmulas financieras a mano
def _sup_lleno():
    return {"estado": "confirmado",
            "financiero": {"tasa_descuento_real_anual": 0.10, "vida_util_anios": 2, "degradacion_anual": 0.0,
                           "capex": {"valor": 0.8, "unidad": "USD/Wp"}, "opex": {"valor": 10, "unidad": "USD/kWp-ano"},
                           "tipo_cambio_mxn_por_usd": 20.0},
            "semaforo": {"metrica": "tir_menos_tasa", "umbral_viable": 0.02, "umbral_no_viable": 0.0}}


def test_van_tir_lcoe_a_mano():
    import kpis as K

    cf = [-100.0, 60.0, 60.0]
    assert K.van(0.10, cf) == pytest.approx(-100 + 60 / 1.1 + 60 / 1.21, abs=1e-12)  # 4.132231...
    x = (-1 + math.sqrt(1 + 4 * 100 / 60)) / 2  # 60x + 60x² = 100, x = 1/(1+r)
    assert K.tir(cf) == pytest.approx(1 / x - 1, abs=1e-9)  # 0.130662...
    assert K.tir([-100.0, 230.0, -132.0]) is None  # dos cambios de signo: TIR no única (10 % y 20 %)
    assert K.lcoe(100.0, 0.0, 1.0, 2, 0.10, 0.0) == pytest.approx(100 / (1 / 1.1 + 1 / 1.21), rel=1e-12)  # 57.619
    assert K.lcoe(1000.0, 10.0, 100.0, 2, 0.0, 0.5) == pytest.approx(1020 / 150, rel=1e-12)  # 6.8
    assert K.flujos(200.0, 1000.0, 10.0, 2, 0.5) == [-1000.0, 190.0, 90.0]


def test_financiero_unidades_y_break_even():
    import kpis as K

    f = K.financiero(_sup_lleno(), ingreso_anio1=9e6, produccion_anio1=2000.0, vf=0.8)
    capex = 0.8 * 1e6 * 20  # USD/Wp -> MXN/MWp
    opex = 10 * 1e3 * 20  # USD/kWp-año -> MXN/MWp-año
    assert f["capex_mxn_por_mwp"] == pytest.approx(capex) and f["opex_mxn_por_mwp_anio"] == pytest.approx(opex)
    cf = [-capex, 9e6 - opex, 9e6 - opex]
    assert f["flujos_mxn_por_mwp"] == pytest.approx(cf)
    assert f["van_mxn_por_mwp"] == pytest.approx(cf[0] + cf[1] / 1.1 + cf[2] / 1.21)
    lc = (capex + opex / 1.1 + opex / 1.21) / (2000 / 1.1 + 2000 / 1.21)
    assert f["lcoe_mxn_mwh"] == pytest.approx(lc) and f["break_even_ppa_mxn_mwh"] == pytest.approx(lc)
    # break-even PPA: un precio plano = LCOE deja VAN 0
    assert K.van(0.10, [-capex] + [lc * 2000 - opex] * 2) == pytest.approx(0, abs=1e-3)
    assert f["break_even_pml_base_mxn_mwh"] == pytest.approx(lc / 0.8)
    # PML base = LCOE/VF: con ingreso = P x B x VF y B = LCOE/VF el VAN es 0
    assert K.van(0.10, K.flujos(2000 * (lc / 0.8) * 0.8, capex, opex, 2, 0.0)) == pytest.approx(0, abs=1e-3)
    v = K.veredicto(_sup_lleno(), 0.01)
    assert v["clase"] == "neutral"


def test_signos_y_basis(docs):
    """basis = C − C_energía = C_pérdidas + C_congestión + residuo, con |residuo| <= 0.02 MXN/MWh (redondeo
    de CENACE); pérdidas y congestión conservan su signo (pueden ser negativas)."""
    neg_perd = neg_cong = 0
    for n, d in docs.items():
        for c in ("fixed", "tracker"):
            k = d["kpis"][c]
            assert abs(k["residuo_componentes_mxn_mwh"]) <= 0.02 + 1e-6, (n, c)
            s = k["precio_capturado_perdidas"] + k["precio_capturado_congestion"] + k["residuo_componentes_mxn_mwh"]
            assert abs(k["delta_capturado_vs_energia_mxn_mwh"] - s) < 1e-5, (n, c)
            assert k["basis_congestion_mxn_mwh"] == k["precio_capturado_congestion"]
            neg_perd += k["precio_capturado_perdidas"] < 0
            neg_cong += k["precio_capturado_congestion"] < 0
    assert neg_perd > 0 and neg_cong > 0  # ambos signos presentes: no se forzó abs()
