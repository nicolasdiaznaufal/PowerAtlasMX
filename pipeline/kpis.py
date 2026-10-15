"""KPIs de valor solar por nodo a partir de los agregados aditivos, y contrato JSON web (agent kpis).

Formulas, unidades y convenciones: docs/TECNICO.md (secciones "KPIs" y "Contrato de datos").
Rotulo obligatorio: "precio capturado MDA (referencia)". El PML del MDA NO es el ingreso real
(desbalances a MTR, potencia, CEL, conexos, transmision y contratos quedan fuera).

Notacion (sobre un conjunto de celdas mes x hora; todo son sumas de agregados.py)
    n      = sum n_horas                         [h]            horas con PML
    P      = sum sum_y                           [MWh/MWp]      produccion FV en esas horas
    I      = sum sum_y_pml                       [MXN/MWp]      ingreso MDA de referencia
    B      = sum_pml / n                         [MXN/MWh]      precio base: media simple de TODAS las horas
    C      = I / P                               [MXN/MWh]      precio capturado (media ponderada por y)
    VF     = C / B                               [-]            value factor, convencion "todas las horas"
    I      = P x B x VF                          identidad exacta (si B != 0 y P > 0)
    E0     = sum sum_y_le0                       [MWh/MWp]      energia FV en horas con PML <= 0 ("en riesgo")
    %E0    = 100 x E0 / P                        [%]
    C_k    = sum sum_y_k / P, B_k = sum_k / n    componentes k = energia, perdidas, congestion
    basis  = C - C_energia = C_perdidas + C_congestion (+ residuo de redondeo de CENACE, |.| <= 0.02)
             El componente de energia es identico en todos los nodos de un sistema en cada hora
             [verificado], asi que C_energia es el precio de referencia del sistema con el MISMO perfil FV.

Lo financiero (TIR, VAN, LCOE, break-even PPA, veredicto/semaforo, escenarios, USD) depende de
config/supuestos.yaml. Mientras un valor necesario este PENDIENTE las funciones lanzan
SupuestoPendiente y el contrato publica null + la lista de pendientes. Nada se inventa aqui.
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import math
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import aggregates as AG  # noqa: E402
import clock  # noqa: E402

SCHEMA_VERSION = "1.2.0"   # 1.2: index.json lleva KPIs en pesos reales por nodo (kpis.<config>.*_real_*)
RELOJ = AG.RELOJ                       # "CDMX estandar UTC-6 fijo" (tres sistemas)
CONFIG_DEFECTO = "tracker"             # configuracion por defecto del mapa (decision de usuario; una constante)
UMBRAL_ANIO_COMPLETO = 1.0             # fraccion de horas para "ano completo" (hoy 100 %; el usuario podria pasar a 0.95)
UMBRAL_MES_COMPLETO = 1.0              # idem para "mes completo"
ROTULO = "precio capturado MDA (referencia)"
ALCANCE = ("El PML del MDA no es el ingreso real: no incluye desbalances liquidados a MTR, potencia, CEL, "
           "servicios conexos, transmision ni contratos bilaterales. Produccion FV = perfil climatologico "
           "(ano tipico NASA POWER 2015-2025) aplicado a cada hora real de PML. Montos en MXN nominales de cada ano.")
PENDIENTE = "PENDIENTE"
SUPUESTOS = ROOT / "config" / "supuestos.yaml"
AGG_DIR = ROOT / "data" / "aggregates"
MIN_ANIOS_TENDENCIA = 3
CAMPOS = AG.COMUNES + AG.PONDERADAS
COMUNES_JSON = ["n_horas", "n_pml_le0", "sum_pml_cent", "sum_perdidas_cent", "sum_congestion_cent", "sum_residuo_cent"]


# =============================================================================================
# 1. Supuestos (config/supuestos.yaml)
# =============================================================================================
class SupuestoPendiente(RuntimeError):
    """Se pidio un calculo que depende de un supuesto de negocio aun PENDIENTE (o ausente)."""

    def __init__(self, claves: Iterable[str]):
        self.claves = sorted(set(claves))
        super().__init__("supuestos PENDIENTE: " + ", ".join(self.claves))


def _escalar(v: str):
    v = v.strip()
    if v == "" or v in ("~", "null", "None"):
        return None
    if (v[0] == v[-1]) and v[0] in "'\"" and len(v) >= 2:
        return v[1:-1]
    if v.lower() in ("true", "false"):
        return v.lower() == "true"
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        return v


def parse_yaml_simple(texto: str) -> dict:
    """YAML minimo: mapas anidados por sangria (espacios) con valores escalares. Comentarios con '#'
    (fuera de comillas). Listas, anclas y multilinea NO se soportan (error explicito)."""
    raiz: dict = {}
    pila: list[tuple[int, dict]] = [(-1, raiz)]
    for num, linea in enumerate(texto.splitlines(), 1):
        sin = linea
        if "#" in sin:
            q, out = None, []
            for ch in sin:
                if ch in "'\"":
                    q = None if q == ch else (ch if q is None else q)
                if ch == "#" and q is None:
                    break
                out.append(ch)
            sin = "".join(out)
        if not sin.strip():
            continue
        if "\t" in sin[: len(sin) - len(sin.lstrip())]:
            raise ValueError(f"linea {num}: tabulador en la sangria")
        ind = len(sin) - len(sin.lstrip(" "))
        cuerpo = sin.strip()
        if cuerpo.startswith("- ") or cuerpo == "-":
            raise ValueError(f"linea {num}: listas no soportadas")
        if ":" not in cuerpo:
            raise ValueError(f"linea {num}: se esperaba 'clave: valor'")
        clave, valor = cuerpo.split(":", 1)
        clave = clave.strip()
        while pila and ind <= pila[-1][0]:
            pila.pop()
        padre = pila[-1][1]
        if clave in padre:
            raise ValueError(f"linea {num}: clave duplicada {clave}")
        if valor.strip() == "":
            padre[clave] = {}
            pila.append((ind, padre[clave]))
        else:
            padre[clave] = _escalar(valor)
    return raiz


def cargar_supuestos(path: Path | str = SUPUESTOS) -> dict:
    """Lee supuestos.yaml (PyYAML si esta instalado; si no, parser minimo). Si el archivo no existe,
    devuelve {} (todo cuenta como pendiente)."""
    path = Path(path)
    if not path.exists():
        return {}
    texto = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore
        return yaml.safe_load(texto) or {}
    except ImportError:
        return parse_yaml_simple(texto)


def es_pendiente(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip().upper() == PENDIENTE) or v == {}


def _get(sup: dict, clave: str):
    cur = sup
    for k in clave.split("."):
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


def pendientes(sup: dict, prefijo: str = "") -> list[str]:
    """Claves (con puntos) cuyo valor es PENDIENTE / vacio."""
    out = []
    for k, v in (sup or {}).items():
        c = f"{prefijo}{k}"
        if isinstance(v, dict) and v:
            out += pendientes(v, c + ".")
        elif es_pendiente(v):
            out.append(c)
    return out


def requerir(sup: dict, *claves: str) -> list:
    """Valores de `claves`; lanza SupuestoPendiente con TODAS las que falten o sigan PENDIENTE.
    Ademas exige `estado` != PENDIENTE: el archivo entero debe estar confirmado por el equipo
    (aunque los valores esten llenos, con estado PENDIENTE no se calcula nada)."""
    vals = [_get(sup, c) for c in claves]
    falt = [c for c, v in zip(claves, vals) if es_pendiente(v)]
    if es_pendiente((sup or {}).get("estado")):
        falt.append("estado")
    if falt:
        raise SupuestoPendiente(falt)
    return vals


# =============================================================================================
# 2. KPIs desde sumas
# =============================================================================================
def _ym(anio: int, mes: int) -> int:
    return int(anio) * 100 + int(mes)


def filtrar(df: pd.DataFrame, desde: str | None = None, hasta: str | None = None) -> pd.DataFrame:
    """Celdas con mes estandar en [desde, hasta] ('YYYY-MM', ambos incluidos)."""
    ym = df["anio"].astype("int64") * 100 + df["mes"].astype("int64")
    m = pd.Series(True, index=df.index)
    if desde:
        m &= ym >= int(desde.replace("-", "")[:6])
    if hasta:
        m &= ym <= int(hasta.replace("-", "")[:6])
    return df[m]


def sumar(df: pd.DataFrame) -> dict:
    """Sumas de todas las columnas aditivas presentes. Enteros (horas, centavos) como int exacto."""
    s = {}
    for c in CAMPOS:
        if c in df:
            s[c] = int(df[c].sum()) if pd.api.types.is_integer_dtype(df[c]) else float(df[c].sum())
    return s


def _div(a, b):
    return None if (b is None or a is None or b == 0) else a / b


def kpis_de_sumas(s: dict) -> dict:
    """KPIs de un conjunto de celdas a partir de sus sumas (ver notacion del modulo).
    Devuelve None donde el KPI no esta definido (sin horas, sin produccion o B <= 0 para el VF)."""
    n = s.get("n_horas", 0)
    P = s.get("sum_y")
    I = s.get("sum_y_pml")
    B = _div(s.get("sum_pml_cent", 0) / 100.0, n) if n else None
    C = _div(I, P) if P else None
    vf = (C / B) if (C is not None and B is not None and B > 0) else None
    comp = {}
    for k in ("energia", "perdidas", "congestion"):
        comp[f"precio_base_{k}"] = _div(s.get(f"sum_{k}_cent", 0) / 100.0, n) if n else None
        comp[f"precio_capturado_{k}"] = _div(s.get(f"sum_y_{k}"), P) if P else None
    ce = comp["precio_capturado_energia"]
    out = {
        "n_horas": n,
        "produccion_mwh_por_mwp": P,
        "ingreso_mxn_por_mwp": I,
        "precio_base_mxn_mwh": B,
        "precio_capturado_mxn_mwh": C,
        "vf": vf,
        "pct_horas_pml_le0": _div(100.0 * s.get("n_pml_le0", 0), n) if n else None,
        "pct_energia_pml_le0": _div(100.0 * s.get("sum_y_le0", 0.0), P) if P else None,
        "mwh_por_mwp_en_riesgo": s.get("sum_y_le0"),
        **comp,
        "delta_capturado_vs_energia_mxn_mwh": (C - ce) if (C is not None and ce is not None) else None,
        "delta_base_vs_energia_mxn_mwh": (B - comp["precio_base_energia"]) if B is not None else None,
        "basis_congestion_mxn_mwh": comp["precio_capturado_congestion"],
        "basis_perdidas_mxn_mwh": comp["precio_capturado_perdidas"],
    }
    if C is not None and ce is not None:
        out["residuo_componentes_mxn_mwh"] = C - (ce + comp["precio_capturado_perdidas"] + comp["precio_capturado_congestion"])
    else:
        out["residuo_componentes_mxn_mwh"] = None
    return out


def descomposicion(k: dict) -> dict | None:
    """Ingreso = produccion x precio base x VF (exacto). None si VF no esta definido."""
    if k.get("vf") is None:
        return None
    prod, base, vf = k["produccion_mwh_por_mwp"], k["precio_base_mxn_mwh"], k["vf"]
    return {"produccion_mwh_por_mwp": prod, "precio_base_mxn_mwh": base, "vf": vf,
            "ingreso_mxn_por_mwp": k["ingreso_mxn_por_mwp"], "producto": prod * base * vf}


def horas_esperadas_mes(anio: int, mes: int) -> int:
    """Horas de un mes en hora CDMX (UTC-6 fijo): dias x 24 (no hay dias de 23/25 h en ese reloj)."""
    return pd.Timestamp(year=anio, month=mes, day=1).days_in_month * 24


def _meses(desde: str, hasta: str) -> list[tuple[int, int]]:
    p = pd.period_range(desde, hasta, freq="M")
    return [(x.year, x.month) for x in p]


def _sumas_fila(r) -> dict:
    s = {c: getattr(r, c) for c in CAMPOS if hasattr(r, c)}
    return {c: (int(v) if isinstance(v, (int, np.integer)) else float(v)) for c, v in s.items()}


def mes_completo(n_horas: int, anio: int, mes: int, borde: set[str] = frozenset()) -> bool:
    """Mes completo: n_horas >= UMBRAL_MES_COMPLETO x dias x 24 y NO es mes de borde de los datos."""
    if f"{int(anio):04d}-{int(mes):02d}" in borde:
        return False
    return n_horas >= math.ceil(UMBRAL_MES_COMPLETO * horas_esperadas_mes(anio, mes))


def serie_mensual(df: pd.DataFrame, borde: set[str] = frozenset()) -> pd.DataFrame:
    """Una fila por mes CDMX con sumas, KPIs y `completo` (ver mes_completo)."""
    g = df.groupby(["anio", "mes"], sort=True)[[c for c in CAMPOS if c in df]].sum().reset_index()
    rows = []
    for r in g.itertuples(index=False):
        s = _sumas_fila(r)
        rows.append({"anio": int(r.anio), "mes": int(r.mes), "horas_esperadas": horas_esperadas_mes(r.anio, r.mes),
                     "completo": mes_completo(s["n_horas"], r.anio, r.mes, borde), **kpis_de_sumas(s)})
    return pd.DataFrame(rows)


def serie_anual(df: pd.DataFrame, borde: set[str] = frozenset()) -> pd.DataFrame:
    """Una fila por ano CDMX con sumas, KPIs y `completo`: n_horas >= UMBRAL_ANIO_COMPLETO x horas del
    ano y ningun mes de borde de los datos en ese ano."""
    g = df.groupby(["anio"], sort=True)[[c for c in CAMPOS if c in df]].sum().reset_index()
    rows = []
    for r in g.itertuples(index=False):
        s = _sumas_fila(r)
        esp = (366 if pd.Timestamp(year=int(r.anio), month=1, day=1).is_leap_year else 365) * 24
        sin_borde = not any(b.startswith(f"{int(r.anio):04d}-") for b in borde)
        rows.append({"anio": int(r.anio), "horas_esperadas": esp,
                     "completo": bool(sin_borde and s["n_horas"] >= math.ceil(UMBRAL_ANIO_COMPLETO * esp)),
                     "cobertura_pct": 100.0 * s["n_horas"] / esp, **kpis_de_sumas(s)})
    return pd.DataFrame(rows)


def peor_mediana_mejor(anual: pd.DataFrame) -> dict:
    """Peor / mediana / mejor ano por ingreso MXN/MWp-ano, SOLO entre anos completos (100 % de horas).
    Mediana = mediana BAJA (el ano real en la posicion (M-1)//2 del orden ascendente) para que su
    descomposicion produccion x base x VF sea la de un ano observado. Con M = 0 todo es None."""
    c = anual[anual["completo"] & anual["vf"].notna()].sort_values(["ingreso_mxn_por_mwp", "anio"])
    m = len(c)
    res = {"anios_completos": [int(a) for a in sorted(c["anio"])], "m": m,
           "texto": f"{m} {'ano completo' if m == 1 else 'anos completos'}"}
    if m == 0:
        return {**res, "peor": None, "mediana": None, "mejor": None}

    def fila(r):
        return {"anio": int(r["anio"]), **descomposicion(r.to_dict())}
    return {**res, "peor": fila(c.iloc[0]), "mediana": fila(c.iloc[(m - 1) // 2]), "mejor": fila(c.iloc[-1])}


def tendencia(x: Iterable[float], y: Iterable[float]) -> float | None:
    """Pendiente MCO dy/dx; None con menos de MIN_ANIOS_TENDENCIA puntos."""
    x, y = np.asarray(list(x), float), np.asarray(list(y), float)
    if len(x) < MIN_ANIOS_TENDENCIA:
        return None
    xm = x - x.mean()
    den = float((xm ** 2).sum())
    return None if den == 0 else float((xm * (y - y.mean())).sum() / den)


def vf_tendencia(anual: pd.DataFrame) -> dict:
    c = anual[anual["completo"] & anual["vf"].notna()]
    return {"pendiente_vf_por_anio": tendencia(c["anio"], c["vf"]), "m": int(len(c)),
            "anios": [int(a) for a in c["anio"]], "vf": [float(v) for v in c["vf"]],
            "nota": f"MCO sobre anos completos; requiere >= {MIN_ANIOS_TENDENCIA}"}


def vf_minimo_mensual(mensual: pd.DataFrame) -> dict | None:
    """Minimo VF entre meses COMPLETOS con VF definido."""
    c = mensual[mensual["completo"] & mensual["vf"].notna()]
    if c.empty:
        return None
    r = c.loc[c["vf"].idxmin()]
    return {"mes": f"{int(r['anio']):04d}-{int(r['mes']):02d}", "vf": float(r["vf"]), "m_meses": int(len(c))}


def resumen(df: pd.DataFrame, desde: str, hasta: str, sistema: str | None = None, meta: dict | None = None) -> dict:
    """KPIs 'mostrar siempre' calculables sin supuestos de negocio, para un nodo y una config.
    `df` = agregados.combinar(...) filtrado a un nodo. `meta` = data/aggregates/agregados_meta.json:
    con `sistema` da los meses de borde (nunca completos) y las horas posibles por mes (cobertura)."""
    d = filtrar(df, desde, hasta)
    k = kpis_de_sumas(sumar(d))
    borde: set[str] = set()
    if meta and sistema:
        borde = set(meta["sistemas"][sistema]["meses_borde"])
        fi, ff = meta["fecha_ini_civil"], meta["fecha_fin_civil"]
        esp = sum(AG.horas_posibles_mes(sistema, a, m, fi, ff) for a, m in _meses(desde, hasta))
    else:
        esp = sum(horas_esperadas_mes(a, m) for a, m in _meses(desde, hasta))
    anual = serie_anual(d, borde)
    mensual = serie_mensual(d, borde)
    # un ano solo cuenta como completo si sus 12 meses estan dentro del rango
    if len(anual):
        dentro = [all(int(desde.replace("-", "")) <= _ym(a, m) <= int(hasta.replace("-", "")) for m in range(1, 13))
                  for a in anual["anio"]]
        anual["completo"] = anual["completo"] & pd.Series(dentro, index=anual.index)
    return {
        "periodo": {"desde": desde, "hasta": hasta},
        "rotulo": ROTULO,
        "convencion_vf": "todas las horas: precio base = media simple de todas las horas con PML del periodo (dia y noche)",
        **k,
        "descomposicion": descomposicion(k),
        "cobertura": {"horas": k["n_horas"], "horas_esperadas": esp, "meses_borde_en_periodo": sorted(
                          b for b in borde if int(desde.replace("-", "")) <= int(b.replace("-", "")) <= int(hasta.replace("-", ""))),
                      "pct_horas_faltantes": 100.0 * (1 - k["n_horas"] / esp) if esp else None,
                      "meses_con_datos": int((mensual["n_horas"] > 0).sum()) if len(mensual) else 0,
                      "meses_en_periodo": len(_meses(desde, hasta))},
        "ingreso_anual": peor_mediana_mejor(anual) if len(anual) else peor_mediana_mejor(
            pd.DataFrame(columns=["anio", "completo", "vf", "ingreso_mxn_por_mwp"])),
        "vf_tendencia": vf_tendencia(anual) if len(anual) else None,
        "vf_minimo_mensual": vf_minimo_mensual(mensual) if len(mensual) else None,
        "anual": [{c: (None if (isinstance(v, float) and math.isnan(v)) else v) for c, v in r.items()}
                  for r in anual[["anio", "completo", "cobertura_pct", "n_horas", "produccion_mwh_por_mwp",
                                  "precio_base_mxn_mwh", "precio_capturado_mxn_mwh", "vf",
                                  "ingreso_mxn_por_mwp", "pct_energia_pml_le0", "mwh_por_mwp_en_riesgo",
                                  "basis_congestion_mxn_mwh"]].to_dict("records")] if len(anual) else [],
    }


# =============================================================================================
# 3. Finanzas (bloqueadas mientras los supuestos esten PENDIENTE)
# =============================================================================================
def flujos(ingreso_anio1: float, capex: float, opex_anual: float, vida: int, degradacion: float) -> list[float]:
    """Flujos de proyecto por MWp (MXN constantes, antes de impuestos, sin deuda):
    CF_0 = -capex; CF_t = ingreso_anio1 x (1-d)^(t-1) - opex_anual, t = 1..vida."""
    if vida < 1 or int(vida) != vida:
        raise ValueError("vida >= 1 entero")
    if not 0 <= degradacion < 1:
        raise ValueError("degradacion en [0, 1)")
    return [-float(capex)] + [ingreso_anio1 * (1 - degradacion) ** (t - 1) - opex_anual for t in range(1, int(vida) + 1)]


def van(tasa: float, cf: list[float]) -> float:
    """VAN = sum_t CF_t / (1 + tasa)^t, t = 0..T (CF_0 sin descontar)."""
    if tasa <= -1:
        raise ValueError("tasa > -1")
    return float(sum(c / (1 + tasa) ** t for t, c in enumerate(cf)))


def tir(cf: list[float], lo: float = -0.99, hi: float = 10.0, tol: float = 1e-12) -> float | None:
    """TIR por biseccion: tasa con VAN = 0. None si los flujos no cambian de signo exactamente una vez
    (TIR no unica o inexistente) o si no hay cambio de signo del VAN en [lo, hi]."""
    signos = [np.sign(c) for c in cf if c != 0]
    cambios = sum(1 for a, b in zip(signos, signos[1:]) if a != b)
    if cambios != 1:
        return None
    flo, fhi = van(lo, cf), van(hi, cf)
    if flo == 0:
        return lo
    if fhi == 0:
        return hi
    if np.sign(flo) == np.sign(fhi):
        return None
    for _ in range(300):
        mid = (lo + hi) / 2
        fm = van(mid, cf)
        if fm == 0 or (hi - lo) / 2 < tol:
            return mid
        if np.sign(fm) == np.sign(flo):
            lo, flo = mid, fm
        else:
            hi = mid
    return (lo + hi) / 2


def lcoe(capex: float, opex_anual: float, energia_anio1: float, vida: int, tasa: float, degradacion: float) -> float:
    """LCOE [MXN/MWh] = (capex + sum_t opex/(1+r)^t) / sum_t E_1 (1-d)^(t-1) / (1+r)^t."""
    num = capex + sum(opex_anual / (1 + tasa) ** t for t in range(1, vida + 1))
    den = sum(energia_anio1 * (1 - degradacion) ** (t - 1) / (1 + tasa) ** t for t in range(1, vida + 1))
    if den <= 0:
        raise ValueError("energia descontada <= 0")
    return num / den


_CAPEX_A_MXN_MWP = {"MXN/MWp": (1.0, False), "USD/MWp": (1.0, True), "USD/Wp": (1e6, True)}
_OPEX_A_MXN_MWP = {"MXN/MWp-ano": (1.0, False), "USD/MWp-ano": (1.0, True), "USD/kWp-ano": (1e3, True)}


def _a_mxn(sup: dict, rama: str, tabla: dict) -> float:
    valor, unidad = requerir(sup, f"financiero.{rama}.valor", f"financiero.{rama}.unidad")
    if unidad not in tabla:
        raise ValueError(f"unidad de {rama} no soportada: {unidad} (use {list(tabla)})")
    f, usd = tabla[unidad]
    fx = requerir(sup, "financiero.tipo_cambio_mxn_por_usd")[0] if usd else 1.0
    return float(valor) * f * fx


def financiero(sup: dict, ingreso_anio1: float, produccion_anio1: float, vf: float | None) -> dict:
    """TIR, VAN, LCOE y break-even por MWp. Lanza SupuestoPendiente si falta cualquier insumo.
    break_even_ppa = precio plano por MWh producido con VAN = 0 (= LCOE por construccion);
    break_even_pml_base = LCOE / VF (PML base del nodo -media de todas las horas- que con este VF da VAN = 0)."""
    tasa, vida, deg = requerir(sup, "financiero.tasa_descuento_real_anual", "financiero.vida_util_anios",
                               "financiero.degradacion_anual")
    capex = _a_mxn(sup, "capex", _CAPEX_A_MXN_MWP)
    opex = _a_mxn(sup, "opex", _OPEX_A_MXN_MWP)
    cf = flujos(ingreso_anio1, capex, opex, int(vida), float(deg))
    lc = lcoe(capex, opex, produccion_anio1, int(vida), float(tasa), float(deg))
    return {"tasa_descuento_real_anual": float(tasa), "capex_mxn_por_mwp": capex, "opex_mxn_por_mwp_anio": opex,
            "vida_util_anios": int(vida), "degradacion_anual": float(deg), "flujos_mxn_por_mwp": cf,
            "tir": tir(cf), "van_mxn_por_mwp": van(float(tasa), cf), "lcoe_mxn_mwh": lc,
            "break_even_ppa_mxn_mwh": lc, "break_even_pml_base_mxn_mwh": (lc / vf) if vf else None}


def a_usd(sup: dict, mxn: float) -> float:
    """MXN -> USD con el tipo de cambio de supuestos (SupuestoPendiente si falta)."""
    fx = requerir(sup, "financiero.tipo_cambio_mxn_por_usd")[0]
    return float(mxn) / float(fx)


def veredicto(sup: dict, valor_metrica: float) -> dict:
    """Semaforo: 'viable' si metrica >= umbral_viable, 'no_viable' si < umbral_no_viable, si no
    'neutral'. Requiere semaforo.* definido (SupuestoPendiente si no)."""
    metrica, uv, unv = requerir(sup, "semaforo.metrica", "semaforo.umbral_viable", "semaforo.umbral_no_viable")
    if float(unv) > float(uv):
        raise ValueError("umbral_no_viable debe ser <= umbral_viable")
    clase = "viable" if valor_metrica >= float(uv) else ("no_viable" if valor_metrica < float(unv) else "neutral")
    return {"metrica": metrica, "valor": float(valor_metrica), "clase": clase}


def escenario(sup: dict, nombre: str, ingreso_anio1: float, produccion_anio1: float, vf: float | None) -> dict:
    """Aplica los multiplicadores del escenario y recalcula `financiero` (SupuestoPendiente si falta)."""
    fp, fprod, fcap, fop = requerir(sup, *(f"escenarios.{nombre}.{k}" for k in
                                         ("factor_precio_capturado", "factor_produccion", "factor_capex", "factor_opex")))
    s2 = json.loads(json.dumps(sup))
    s2["financiero"]["capex"]["valor"] = float(s2["financiero"]["capex"]["valor"]) * float(fcap)
    s2["financiero"]["opex"]["valor"] = float(s2["financiero"]["opex"]["valor"]) * float(fop)
    return {"escenario": nombre, "descripcion": _get(sup, f"escenarios.{nombre}.descripcion"),
            **financiero(s2, ingreso_anio1 * float(fp) * float(fprod), produccion_anio1 * float(fprod), vf)}


def n_de_m(valores: Iterable[float], umbral: float) -> dict:
    """'N de M anos' con valor >= umbral (en lugar de probabilidades con pocos anos)."""
    v = [x for x in valores if x is not None and not (isinstance(x, float) and math.isnan(x))]
    n = sum(1 for x in v if x >= umbral)
    return {"n": n, "m": len(v), "texto": f"{n} de {len(v)} anos"}


def tir_n_de_m(sup: dict, anios: list[dict]) -> dict:
    """Para cada ano completo: TIR si ese ano se repitiera toda la vida; cuenta los que superan la tasa."""
    tasa = requerir(sup, "financiero.tasa_descuento_real_anual")[0]
    tirs = [financiero(sup, a["ingreso_mxn_por_mwp"], a["produccion_mwh_por_mwp"], a.get("vf"))["tir"] for a in anios]
    return {"tir_por_anio": tirs, **n_de_m(tirs, float(tasa))}


_CLAVES_FIN = ("financiero.tasa_descuento_real_anual", "financiero.vida_util_anios", "financiero.degradacion_anual",
               "financiero.capex.valor", "financiero.capex.unidad", "financiero.opex.valor", "financiero.opex.unidad")


def bloque_financiero(sup: dict, res: dict) -> dict:
    """Bloque del contrato: calcula lo financiero con el ano mediano o devuelve null + pendientes."""
    med = (res.get("ingreso_anual") or {}).get("mediana")
    try:
        requerir(sup, *[c for c in _CLAVES_FIN])          # primero: supuestos (PENDIENTE manda)
        if med is None:
            raise ValueError("sin anos completos para el caso base")
        fin = financiero(sup, med["ingreso_mxn_por_mwp"], med["produccion_mwh_por_mwp"], med["vf"])
        return {"estado": "calculado", "base": "ano mediano", **fin}
    except SupuestoPendiente as e:
        todos = sorted(set(e.claves) | {c for c in pendientes(sup) if c.split(".")[0] in ("estado", "financiero", "semaforo")})
        return {"estado": PENDIENTE, "pendientes": todos, "tir": None, "van_mxn_por_mwp": None,
                "lcoe_mxn_mwh": None, "break_even_ppa_mxn_mwh": None, "break_even_pml_base_mxn_mwh": None,
                "veredicto": None,
                "motivo": "supuestos de negocio PENDIENTE en config/supuestos.yaml: sin veredicto, TIR, VAN, LCOE ni USD"}
    except ValueError as e:
        return {"estado": "no_calculable", "motivo": str(e)}


# =============================================================================================
# 4. Contrato web (data/index.json, data/nodes/{id}.json)
# =============================================================================================
def cargar_catalogo(root: Path = ROOT) -> pd.DataFrame:
    """nodo, nombre, region (Centro de Control Regional), zona_carga, entidad, municipio, kv, lat, lon,
    coord_fuente, coord_precision, renombrado_a. Para un codigo RETIRADO con renombre declarado
    (coord_source 'renombre:<nuevo>' de solar.load_node_coords) los datos descriptivos son los del
    codigo nuevo y `renombrado_a` = codigo nuevo."""
    import openpyxl
    sys.path.insert(0, str(root / "pipeline"))
    import solar
    xl = next((root / "data" / "ref").glob("Cat*NodosP*.xlsx"))
    ws = openpyxl.load_workbook(xl, read_only=True, data_only=True).worksheets[0]
    rows = [r for r in ws.iter_rows(min_row=3, values_only=True) if r and r[3]]
    cat = pd.DataFrame([(str(r[3]), r[4], r[1], r[2], r[15], r[17], r[5]) for r in rows],
                       columns=["nodo", "nombre", "region", "zona_carga", "entidad", "municipio", "kv"])
    cat = cat.drop_duplicates("nodo").set_index("nodo")
    co = solar.load_node_coords(root)
    co["nodo"] = co["nodo"].astype(str)
    co["renombrado_a"] = co["coord_source"].astype(str).str.extract(r"^renombre:(.+)$")[0]
    filas = []
    for r in co.itertuples(index=False):
        src = r.renombrado_a if isinstance(r.renombrado_a, str) else r.nodo
        d = cat.loc[src].to_dict() if src in cat.index else {}
        filas.append({"nodo": r.nodo, **d, "lat": r.lat, "lon": r.lon, "coord_fuente": r.coord_source,
                      "coord_precision": r.coord_precision,
                      "renombrado_a": r.renombrado_a if isinstance(r.renombrado_a, str) else None})
    out = pd.DataFrame(filas)
    resto = cat[~cat.index.isin(out["nodo"])].reset_index()          # en catalogo pero sin coordenadas
    return pd.concat([out, resto], ignore_index=True)


def _r(x, nd):
    if x is None:
        return None
    if isinstance(x, (float, np.floating)):
        if not math.isfinite(x):
            return None
        return round(float(x), nd)
    return x


def _redondear(obj, nd=6):
    """Redondeo para el JSON de KPIs (no afecta a los agregados, que se escriben aparte)."""
    if isinstance(obj, dict):
        return {k: _redondear(v, nd) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_redondear(v, nd) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    return _r(obj, nd)


def _ints(v):
    return [int(x) for x in v]


def _floats_exactos(v):
    """Flotantes sin redondear: json escribe la representacion mas corta que se relee IGUAL (bit a bit)."""
    return [0 if float(x) == 0.0 else float(x) for x in v]


# ---------------------------------------------------------------------------------------------
# Esquema 1.1: el JSON publica SOLO sumas enteras comunes y el perfil y (12 x 24) por config.
#   sum_energia_cent no se publica: = sum_pml_cent - sum_perdidas_cent - sum_congestion_cent - sum_residuo_cent
#   (sum_residuo_cent = redondeo de CENACE, |.| <= 2 centavos por hora; enteros -> exacto).
# Las sumas ponderadas se reconstruyen en el navegador. Para la celda k = i*24 + h del mes meses[i]
# (mes calendario m = int(meses[i][5:7])) y la config c, con y = perfil_y[c][(m-1)*24 + h]:
#     sum_y[k]            = y * n_horas[k]
#     sum_y_le0[k]        = y * n_pml_le0[k]
#     sum_y_pml[k]        = y * sum_pml_cent[k] / 100
#     sum_y_energia[k]    = y * sum_energia_cent[k] / 100      (igual perdidas, congestion)
# Exacto porque y es constante dentro de la celda: sum(y*x) = y*sum(x). Implementacion de referencia:
# reconstruir() (abajo) y el fragmento JS de docs/TECNICO.md.
# ---------------------------------------------------------------------------------------------
def energia_cent(doc: dict) -> list[int]:
    """sum_energia_cent exacto (enteros): pml - perdidas - congestion - residuo."""
    a = doc["agregados"]
    return [p - l - c - r for p, l, c, r in zip(a["sum_pml_cent"], a["sum_perdidas_cent"], a["sum_congestion_cent"],
                                                a["sum_residuo_cent"])]


def reconstruir(doc: dict, cfg: str) -> dict[str, list[float]]:
    """Sumas ponderadas por y de un documento de nodo esquema 1.1 (referencia para la web)."""
    a = dict(doc["agregados"])
    a["sum_energia_cent"] = energia_cent(doc)
    y = a["perfil_y"][cfg]
    out = {k: [] for k in AG.PONDERADAS}
    for i, mes in enumerate(a["meses"]):
        m = int(mes[5:7])
        for h in range(24):
            k, yy = i * 24 + h, y[(m - 1) * 24 + h]
            out["sum_y"].append(yy * a["n_horas"][k])
            out["sum_y_le0"].append(yy * a["n_pml_le0"][k])
            out["sum_y_pml"].append(yy * a["sum_pml_cent"][k] / 100)
            for c in ("energia", "perdidas", "congestion"):
                out[f"sum_y_{c}"].append(yy * a[f"sum_{c}_cent"][k] / 100)
    return out


def kpis_desde_doc(doc: dict, cfg: str, desde: str | None = None, hasta: str | None = None) -> dict:
    """KPIs de un rango de meses a partir SOLO del JSON 1.1 (lo que hara el navegador)."""
    a = dict(doc["agregados"])
    a["sum_energia_cent"] = energia_cent(doc)
    w = reconstruir(doc, cfg)
    lo = int(desde.replace("-", "")) if desde else 0
    hi = int(hasta.replace("-", "")) if hasta else 999999
    idx = [i * 24 + h for i, mes in enumerate(a["meses"]) if lo <= int(mes.replace("-", "")) <= hi for h in range(24)]
    s = {c: sum(a[c][k] for k in idx) for c in AG.COMUNES}
    s.update({c: math.fsum(w[c][k] for k in idx) for c in AG.PONDERADAS})
    return kpis_de_sumas(s)


# ---------------------------------------------------------------------------------------------
# Reloj: bloque legible por maquina para notas al pie (se construye desde clock.py, no se copia a mano)
# ---------------------------------------------------------------------------------------------
_CIVIL = {
    "SIN": ("UTC-6; horario de verano mexicano hasta 2022-10-30 (UTC-5 en verano 2020-2022); desde entonces UTC-6 fijo, igual a CDMX",
            "UTC-6; Mexican DST until 2022-10-30 (UTC-5 in summer 2020-2022); since then fixed UTC-6, same as CDMX"),
    "BCS": ("UTC-7 (CDMX-1 h); horario de verano mexicano hasta 2022-10-30 (UTC-6 en verano 2020-2022, igual a CDMX); desde entonces UTC-7 fijo",
            "UTC-7 (CDMX-1 h); Mexican DST until 2022-10-30 (UTC-6 in summer 2020-2022, same as CDMX); since then fixed UTC-7"),
    "BCA": ("horario de verano de EE.UU. todos los anos: UTC-8 en invierno (CDMX-2 h) y UTC-7 en verano (CDMX-1 h)",
            "US DST every year: UTC-8 in winter (CDMX-2 h) and UTC-7 in summer (CDMX-1 h)"),
}


def bloque_reloj(sistema: str | None = None) -> dict:
    """Bloque `reloj` del contrato. Con `sistema`, solo ese sistema."""
    sis = {}
    for s_ in clock.SISTEMAS:
        d = clock.desfase_a_cdmx_horas(s_)
        civ_es, civ_en = _CIVIL[s_]
        sis[s_] = {
            "offset_estandar_utc_horas": clock.STD_UTC_OFFSET_HOURS[s_],
            "desfase_a_cdmx_horas": d,
            "hora_civil_publicada": civ_es,
            "nota_es": ("Horas en reloj CDMX (UTC-6 fijo, hora del SIN). " +
                        ("El SIN publica en esa misma hora." if d == 0 else
                         f"{s_} publica en su hora civil ({civ_es}); aqui se recorre +{d} h a hora CDMX. "
                         "El sol y los precios se cruzan por instante (UTC), no por etiqueta.")),
            "nota_en": ("Hours shown on the CDMX clock (fixed UTC-6, SIN time). " +
                        ("SIN publishes on that same clock." if d == 0 else
                         f"{s_} publishes on its civil clock ({civ_en}); shifted +{d} h to CDMX time here. "
                         "Sun and prices are matched by instant (UTC), not by label.")),
        }
    out = {"referencia": "CDMX estandar UTC-6 fijo (hora del SIN)", "utc_offset_referencia_horas": clock.CDMX_UTC_OFFSET_HOURS,
           "etiqueta_hora": "hora = 0..23, INICIO de la hora en reloj CDMX",
           "precios": ("la etiqueta `hora` de CENACE es la hora civil que termina; en verano va 1 h adelante de la hora "
                       "estandar (SIN/BCS 2020-2022, BCA todos los anos); clock.ts_utc/ts_cdmx ya lo corrigen")}
    if sistema:
        out["sistema"] = sistema
        out.update(sis[sistema])
    else:
        out["sistemas"] = sis
    return out


def mediodia_solar_cdmx(lon: float) -> float:
    """Hora CDMX (decimal) del mediodia solar MEDIO en la longitud `lon` (grados, este positivo):
    12 - lon/15 h en UTC, menos 6 h. Promedio anual: ignora la ecuacion del tiempo (+-16 min)."""
    return 12.0 - float(lon) / 15.0 + clock.CDMX_UTC_OFFSET_HOURS


def centroide_energia_cdmx(perfil: list[float]) -> float | None:
    """Hora CDMX del centroide de la energia del perfil 12 x 24 (punto medio de cada hora): verificacion."""
    y = np.asarray(perfil, float).reshape(12, 24).sum(axis=0)
    return None if y.sum() <= 0 else float((y * (np.arange(24) + 0.5)).sum() / y.sum())


# ---------------------------------------------------------------------------------------------
# Pesos reales (INPC): bloque adicional; el nominal sigue siendo el principal
# ---------------------------------------------------------------------------------------------
INPC = ROOT / "data" / "ref" / "inpc_mensual.csv"
_PRECIO_CENT = ["sum_pml_cent", "sum_energia_cent", "sum_perdidas_cent", "sum_congestion_cent"]
_PRECIO_Y = ["sum_y_pml", "sum_y_energia", "sum_y_perdidas", "sum_y_congestion"]


def cargar_inpc(path: Path = INPC) -> dict | None:
    """{'base': 'YYYY-MM', 'inpc': {mes: valor}, 'fuente': ...} o None si no hay tabla.
    Base = ultimo mes con dato en la tabla ('pesos de hoy')."""
    path = Path(path)
    if not path.exists():
        return None
    t = pd.read_csv(path, dtype={"mes": str})
    t = t.dropna(subset=["inpc"])
    if t.empty or (t["inpc"] <= 0).any() or t["mes"].duplicated().any():
        raise ValueError("tabla INPC invalida (vacia, <= 0 o meses duplicados)")
    inpc = dict(zip(t["mes"], t["inpc"].astype(float)))
    base = max(inpc)
    fuente = None
    mp = path.with_name(path.stem + ".meta.json")
    if mp.exists():
        m = json.loads(mp.read_text())
        fuente = {k: m.get(k) for k in ("series_id", "series_name", "base_period", "source_url", "downloaded_utc")}
    return {"base": base, "inpc": inpc, "fuente": fuente}


def deflactor(inpc: dict, mes: str) -> float | None:
    """INPC(base) / INPC(mes); None si el mes no esta en la tabla (no se extrapola)."""
    v = inpc["inpc"].get(mes)
    return None if v is None else inpc["inpc"][inpc["base"]] / v


def a_reales(df: pd.DataFrame, inpc: dict) -> tuple[pd.DataFrame, list[str]]:
    """Copia de las celdas con las sumas de PRECIO multiplicadas por el deflactor de su mes (CDMX).
    Horas y produccion (n_*, sum_y, sum_y_le0) no cambian. Devuelve (df_real, meses_sin_inpc)."""
    d = df.copy()
    mes = d["anio"].astype(int).map("{:04d}".format) + "-" + d["mes"].astype(int).map("{:02d}".format)
    f = mes.map(lambda m: deflactor(inpc, m))
    faltan = sorted(set(mes[f.isna()]))
    for c in _PRECIO_CENT + _PRECIO_Y:
        if c in d:
            d[c] = d[c].astype(float) * f.astype(float)
    return d, faltan


def bloque_reales(df: pd.DataFrame, desde: str, hasta: str, inpc: dict | None, sistema: str | None = None,
                  meta: dict | None = None) -> dict:
    """KPIs en pesos constantes del mes base. null + motivo si falta la tabla o algun mes con datos."""
    if inpc is None:
        return {"estado": "no_disponible", "motivo": f"falta {INPC.relative_to(ROOT)}"}
    d = filtrar(df, desde, hasta)
    dr, faltan = a_reales(d, inpc)
    if faltan:
        return {"estado": "no_disponible", "motivo": f"meses con datos sin INPC (no se extrapola): {faltan}"}
    r = resumen(dr, desde, hasta, sistema=sistema, meta=meta)
    return {"estado": "calculado", "base_mes": inpc["base"], "fuente": inpc["fuente"],
            "metodo": "por mes CDMX: suma_real = suma_nominal x INPC(base)/INPC(mes); despues las mismas formulas",
            **{k: r[k] for k in ("precio_base_mxn_mwh", "precio_capturado_mxn_mwh", "vf", "ingreso_mxn_por_mwp",
                                  "precio_capturado_energia", "basis_congestion_mxn_mwh", "ingreso_anual")},
            "anual": [{k: a[k] for k in ("anio", "completo", "precio_base_mxn_mwh", "precio_capturado_mxn_mwh", "vf",
                                         "ingreso_mxn_por_mwp")} for a in r["anual"]]}


def json_nodo(nodo: str, com: pd.DataFrame, cfg: pd.DataFrame, info: dict, calidad_mes: pd.DataFrame,
              clima: dict, sup: dict, periodo: tuple[str, str], generado: str, base: pd.DataFrame,
              meta_ag: dict, inpc: dict | None = None) -> dict:
    """Documento de un nodo (esquema 1.1). com/cfg: agregados de ESE nodo; base: su perfil y 12 x 24."""
    com = com.sort_values(["anio", "mes", "hora"])
    meses = pd.period_range(f"{com['anio'].iloc[0]}-{com['mes'].iloc[0]:02d}",
                            f"{com['anio'].iloc[-1]}-{com['mes'].iloc[-1]:02d}", freq="M")
    grid = pd.DataFrame([(p.year, p.month, h) for p in meses for h in range(24)], columns=["anio", "mes", "hora"])
    g = grid.merge(com, on=["anio", "mes", "hora"], how="left")
    ag = {c: _ints(g[c].fillna(0).astype("int64")) for c in COMUNES_JSON if c != "sum_residuo_cent"}
    # energia NO se publica: se reconstruye EXACTA (enteros) con el residuo de redondeo de CENACE
    ag["sum_residuo_cent"] = _ints((g["sum_pml_cent"] - g["sum_energia_cent"] - g["sum_perdidas_cent"]
                                    - g["sum_congestion_cent"]).fillna(0).astype("int64"))
    perfil_y, kp = {}, {}
    sistema = info["sistema"]
    for c in AG.CONFIGS:
        perfil = base[base["config"] == c].set_index(["mes", "hora"])["y_mwh_por_mwp"]
        perfil_y[c] = _floats_exactos([perfil.loc[(m, h)] for m in range(1, 13) for h in range(24)])
        comb = AG.combinar(com, cfg, c)
        res = resumen(comb, *periodo, sistema=sistema, meta=meta_ag)
        res["financiero"] = bloque_financiero(sup, res)
        res["reales"] = bloque_reales(comb, *periodo, inpc, sistema=sistema, meta=meta_ag)
        kp[c] = res
    cm = calidad_mes.sort_values("mes")
    borde = meta_ag["sistemas"][sistema]["meses_borde"]
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generado,
        "id": nodo,
        **{k: info.get(k) for k in ("nombre", "sistema", "region", "zona_carga", "entidad", "municipio", "lat", "lon",
                                    "coord_fuente", "coord_precision", "renombrado_a", "renombre_de")},
        "nota_reloj": sistema != "SIN",
        "mediodia_solar_cdmx": _r(mediodia_solar_cdmx(info["lon"]), 3) if info.get("lon") is not None else None,
        "mediodia_solar_metodo": "mediodia solar medio = 12 - lon/15 h (UTC) - 6 h; promedio anual, sin ecuacion del tiempo (+-16 min)",
        "centroide_energia_cdmx": {c: _r(centroide_energia_cdmx(perfil_y[c]), 3) for c in AG.CONFIGS},
        "rotulo": ROTULO,
        "alcance": ALCANCE,
        "unidades": {
            "n_horas": "h", "n_pml_le0": "h", "sum_*_cent": "centavos de MXN/MWh sumados sobre horas (entero exacto)",
            "sum_residuo_cent": "pml - energia - perdidas - congestion (centavos); energia = pml - perdidas - congestion - residuo",
            "perfil_y": "MWh/MWp en la hora (12 meses x 24 h, indice (mes-1)*24 + hora, reloj CDMX)",
            "precios": "MXN/MWh", "ingreso": "MXN/MWp en el periodo (o en el ano)", "vf": "adimensional",
        },
        "agregados": {
            "reloj": bloque_reloj(sistema),
            "layout": ("arreglo[i*24 + hora]; i = indice en 'meses' (mes CDMX); hora = 0..23, inicio de hora en "
                       "CDMX estandar UTC-6 fijo (mismo reloj para SIN, BCA y BCS)"),
            "reconstruccion": ("sum_energia_cent = sum_pml_cent - sum_perdidas_cent - sum_congestion_cent - sum_residuo_cent; "
                               "para la config c y la celda k = i*24 + h, con m = mes de meses[i] e "
                               "y = perfil_y[c][(m-1)*24 + h]: sum_y = y*n_horas; sum_y_le0 = y*n_pml_le0; "
                               "sum_y_pml = y*sum_pml_cent/100; sum_y_<comp> = y*sum_<comp>_cent/100"),
            "meses": [f"{p.year:04d}-{p.month:02d}" for p in meses],
            "meses_borde": [b for b in borde if f"{meses[0].year:04d}-{meses[0].month:02d}" <= b
                            <= f"{meses[-1].year:04d}-{meses[-1].month:02d}"],
            **ag,
            "perfil_y": perfil_y,
            "deflactor_inpc": ([deflactor(inpc, f"{p.year:04d}-{p.month:02d}") for p in meses] if inpc else None),
            "deflactor_nota": (f"INPC({inpc['base']})/INPC(mes) por mes de 'meses' (null = sin dato, no se extrapola); "
                               "real = nominal x deflactor, celda por celda" if inpc else "sin tabla INPC"),
        },
        "kpis": {"periodo": {"desde": periodo[0], "hasta": periodo[1]}, "config_defecto": CONFIG_DEFECTO, **kp},
        "calidad": {
            **{k: info.get(k) for k in ("meses_de_datos", "confianza", "valido", "estado_calidad", "primera_fecha",
                                        "ultima_fecha", "horas_hueco", "pct_hueco_vida", "pct_faltante_periodo")},
            "regla": "nodo valido = >= 12 meses calendario con >= 1 hora de PML (calidad); <12 en el periodo elegido -> aviso de baja confianza",
            "cobertura_mes_calendario": {"meses": [m.strftime("%Y-%m") for m in pd.to_datetime(cm["mes"])],
                                         "horas": _ints(cm["horas"]), "horas_esperadas": _ints(cm["horas_esperadas_mes"]),
                                         "nota": "meses civiles del sistema (modulo calidad), no meses CDMX"},
        },
        "clima": clima,
        "supuestos": {"estado": PENDIENTE if pendientes(sup) else "definido", "pendientes": pendientes(sup)},
    }


def _clima(nodo: str, sb: pd.DataFrame, meta: dict) -> dict:
    out = {"fuente": "NASA POWER horario (GHI, DNI, DHI, T2M, WS2M), celda de 1 grado; modelo pvlib (solar.py)",
           "anios_baseline": meta.get("climate", {}).get("baseline_years"),
           "perfil": f"dia promedio por mes x hora (ano tipico), {RELOJ}",
           "estado_supuestos_planta": meta.get("assumption_status")}
    r = sb[sb["loc_id"] == nodo]
    for row in r.itertuples():
        out[row.config] = {"celda": [int(row.cell_lat), int(row.cell_lon)],
                           "anual_mwh_por_mwp": _r(row.annual_mwh_per_mwp, 3), "fc": _r(row.cf, 5),
                           "anual_por_anio_min": _r(row.annual_year_min, 3), "anual_por_anio_p10": _r(row.annual_year_p10, 3),
                           "anual_por_anio_mediana": _r(row.annual_year_median, 3),
                           "anual_por_anio_max": _r(row.annual_year_max, 3), "anios_usados": int(row.years_used)}
    return out


def _txt(v):
    return None if (v is None or (isinstance(v, float) and math.isnan(v))) else v


def escribir_contrato(out_dir: Path = ROOT / "data", agg_dir: Path = AGG_DIR, nodos: list[str] | None = None,
                      sup_path: Path = SUPUESTOS) -> dict:
    """Escribe data/index.json y data/nodes/{id}.json (esquema 1.1) para los nodos con baseline (o `nodos`)."""
    generado = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    sup = cargar_supuestos(sup_path)
    com = pd.read_parquet(agg_dir / "agregados_comunes.parquet")
    cfg = pd.read_parquet(agg_dir / "agregados_config.parquet")
    tn = pd.read_parquet(agg_dir / "agregados_nodos.parquet")
    meta_ag = json.loads((agg_dir / "agregados_meta.json").read_text())
    if meta_ag.get("reloj") != RELOJ:
        raise ValueError(f"agregados en otro reloj: {meta_ag.get('reloj')}")
    cat = cargar_catalogo().drop(columns=["lat", "lon"])
    calm = pd.read_parquet(ROOT / "data" / "quality" / "cobertura_mes.parquet")
    calm["nodo"] = calm["nodo"].astype(str)
    sb = pd.read_parquet(ROOT / "data" / "baselines" / "solar_baselines.parquet")
    sb["loc_id"] = sb["loc_id"].astype(str)
    meta = json.loads((ROOT / "data" / "baselines" / "solar_baselines_metadata.json").read_text())
    inpc = cargar_inpc()
    periodo = tuple(meta_ag["periodo_meses"])            # meses civiles publicados (2020-01 .. 2026-09)
    tn = tn.drop(columns=[c for c in ("coord_source", "coord_precision") if c in tn]).merge(cat, on="nodo", how="left")
    renombre_de = {v: k for k, v in zip(tn["nodo"], tn["renombrado_a"]) if isinstance(v, str)}
    (out_dir / "nodes").mkdir(parents=True, exist_ok=True)
    objetivo = list(tn.loc[tn["tiene_baseline"], "nodo"]) if nodos is None else list(nodos)
    com_g = dict(tuple(com[com["nodo"].isin(objetivo)].groupby("nodo")))
    cfg_g = dict(tuple(cfg[cfg["nodo"].isin(objetivo)].groupby("nodo")))
    calm_g = dict(tuple(calm[calm["nodo"].isin(objetivo)].groupby("nodo")))
    base = AG.cargar_baseline()
    base_g = dict(tuple(base[base["nodo"].isin(objetivo)].groupby("nodo")))
    entradas, tam = [], {}
    for r in tn.itertuples(index=False):
        info = {"nombre": _txt(r.nombre), "sistema": r.sistema, "region": _txt(r.region), "zona_carga": _txt(r.zona_carga),
                "entidad": _txt(r.entidad), "municipio": _txt(r.municipio),
                "lat": _r(r.lat, 6) if pd.notna(r.lat) else None, "lon": _r(r.lon, 6) if pd.notna(r.lon) else None,
                "coord_fuente": _txt(r.coord_fuente), "coord_precision": _txt(r.coord_precision),
                "renombrado_a": _txt(r.renombrado_a), "renombre_de": renombre_de.get(r.nodo),
                "meses_de_datos": int(r.meses_de_datos), "confianza": r.confianza, "valido": bool(r.valido),
                "estado_calidad": r.estado, "primera_fecha": str(r.primera_fecha), "ultima_fecha": str(r.ultima_fecha),
                "horas_hueco": int(r.horas_hueco), "pct_hueco_vida": _r(r.pct_hueco_vida, 4),
                "pct_faltante_periodo": _r(r.pct_faltante_periodo, 4)}
        e = {"id": r.nodo, **{k: info[k] for k in ("nombre", "entidad", "municipio", "sistema", "region", "lat", "lon",
                                                     "coord_fuente", "coord_precision", "renombrado_a", "renombre_de",
                                                     "meses_de_datos", "confianza", "valido", "estado_calidad")}}
        if r.nodo in objetivo and r.nodo in cfg_g:
            doc = json_nodo(r.nodo, com_g[r.nodo], cfg_g[r.nodo], info, calm_g.get(r.nodo, calm.iloc[:0]),
                            _clima(r.nodo, sb, meta), sup, periodo, generado, base_g[r.nodo], meta_ag, inpc)
            doc = _redondear_doc(doc)
            raw = json.dumps(doc, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
            (out_dir / "nodes" / f"{r.nodo}.json").write_bytes(raw)
            tam[r.nodo] = (len(raw), len(gzip.compress(raw, 9)))
            e["ficha"] = f"nodes/{r.nodo}.json"
            e["motivo_sin_ficha"] = None
            e["kpis"] = {}
            for c in AG.CONFIGS:
                kc = doc["kpis"][c]
                e["kpis"][c] = {k: _r(kc[k], 4) for k in ("precio_capturado_mxn_mwh", "precio_base_mxn_mwh",
                                                           "vf", "pct_energia_pml_le0")}
                re_ = kc.get("reales") or {}
                ok = re_.get("estado") == "calculado"
                e["kpis"][c].update({
                    "precio_capturado_real_mxn_mwh": _r(re_.get("precio_capturado_mxn_mwh"), 4) if ok else None,
                    "precio_base_real_mxn_mwh": _r(re_.get("precio_base_mxn_mwh"), 4) if ok else None,
                    "vf_real": _r(re_.get("vf"), 4) if ok else None})
        else:
            e["ficha"] = None
            e["motivo_sin_ficha"] = r.motivo_sin_baseline or "no solicitado en esta corrida"
            e["kpis"] = None
        entradas.append(e)
    # fichas viejas que ya no corresponden (p. ej. de una corrida anterior) se borran: nada huerfano
    vigentes = {f"{e['id']}.json" for e in entradas if e["ficha"]}
    if nodos is None:
        for f in (out_dir / "nodes").glob("*.json"):
            if f.name not in vigentes:
                f.unlink()
    idx = {"schema_version": SCHEMA_VERSION, "generated_at": generado, "rotulo": ROTULO, "alcance": ALCANCE,
           "config_defecto": CONFIG_DEFECTO,
           "reloj": bloque_reloj(),
           "umbral_anio_completo": UMBRAL_ANIO_COMPLETO, "umbral_mes_completo": UMBRAL_MES_COMPLETO,
           "pesos_reales": ({"base_mes": inpc["base"], "fuente": inpc["fuente"],
                             "nota": "bloque kpis.<config>.reales en cada ficha; el nominal es el principal"}
                            if inpc else {"estado": "no_disponible", "motivo": "sin data/ref/inpc_mensual.csv"}),
           "periodo_datos": {"desde": periodo[0], "hasta": periodo[1], "reloj": RELOJ,
                             "meses_borde": {k: v["meses_borde"] for k, v in meta_ag["sistemas"].items()},
                             "nota": "meses en hora CDMX; los meses de borde existen en los arreglos pero no son completos"},
           "kpis_index": ("periodo completo; configuraciones fixed y tracker; MXN/MWh nominales y *_real_* en pesos "
                          "constantes del mes base de pesos_reales (null si no hay INPC para algun mes con datos)"),
           "supuestos": {"estado": PENDIENTE if pendientes(sup) else "definido", "pendientes": pendientes(sup)},
           "conteo": {"nodos": len(entradas), "con_ficha": sum(1 for e in entradas if e["ficha"]),
                      "sin_ficha": sum(1 for e in entradas if not e["ficha"])},
           "nodos": entradas}
    raw = json.dumps(_redondear(idx, 6), ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    (out_dir / "index.json").write_bytes(raw)
    gz = np.array([v[1] for v in tam.values()]) if tam else np.array([0])
    rawsz = np.array([v[0] for v in tam.values()]) if tam else np.array([0])
    return {"index_bytes": len(raw), "index_gz": len(gzip.compress(raw, 9)), "nodos_escritos": len(tam),
            "gz_kb_mediana": float(np.median(gz) / 1024), "gz_kb_max": float(gz.max() / 1024),
            "raw_kb_mediana": float(np.median(rawsz) / 1024), "periodo": periodo}


def _redondear_doc(doc: dict) -> dict:
    """Redondea solo KPIs/calidad/clima a 6 decimales; los agregados (enteros y perfil_y exacto) no se tocan."""
    ag = doc.pop("agregados")
    d = _redondear(doc, 6)
    d["agregados"] = ag
    orden = [k for k in doc if k != "kpis"] + ["agregados", "kpis"]
    return {k: d[k] for k in orden if k in d}


# =============================================================================================
# 5. Analisis del deck "Nodal Solar Value" (REPSA, oct-2026) recalculado con ESTE pipeline
#    Salidas: data/analysis/analysis.json (agregados, perfiles, hallazgos, comparacion, insights)
#             data/analysis/analysis_nodos.json (tabla columnar por nodo y ventana, seguidor)
# =============================================================================================
ANALYSIS_SCHEMA = "1.1.0"   # 1.1: numeracion de diapositivas del usuario, LCOE en pesos reales, tabla de regiones
DECK_FUENTE = "Nodal Solar Value.md (deck REPSA, Origination analytics, octubre 2026), raiz del proyecto"

# Supuestos que el DECK imprime (no son los supuestos validados del proyecto: esos siguen PENDIENTE).
ESCENARIO_DECK = {
    "etiqueta": "escenario del deck (supuestos del deck de REPSA)",
    "advertencia": ("Supuestos tomados del deck, NO de config/supuestos.yaml (que sigue PENDIENTE). Sirven solo para "
                    "reproducir el analisis del deck; no son supuestos validados del proyecto."),
    "fuente": DECK_FUENTE,
    "lcoe_usd_mwh": 40.0,
    "lcoe_mxn_mwh": 714.0,
    "lcoe_bajo_usd_mwh": 20.0,
    "lcoe_bajo_mxn_mwh": 357.0,
    "tipo_cambio_mxn_por_usd": 17.84,
    "configuracion": "tracker",
    "potencia_mwp": 1.0,
    "citas": [
        "Share of nodes whose captured price covers an LCOE of 40 USD/MWh (714 MXN/MWh): 33 % in 2024–25, 5 % in 2025–26.",
        "Both are below even a 20 USD/MWh LCOE (357 MXN/MWh).",
        "FX 17.84 MXN/USD (Banxico FIX, 28 Sep 2026).",
        "Production y_h: pvlib single-axis tracker (±60°, backtracking, GCR 0.35) with NASA POWER GHI and air temperature.",
        "Windows: Aug 2024 – Jul 2025 and Aug 2025 – Jul 2026; complete days only.",
        "nodes with at least 300 complete days, Cozumel excluded.",
        "revenue and P&L reduce Y_f by 14 % (PVWatts default).",
    ],
    "ventanas_deck": ["2024-08..2025-07", "2025-08..2026-07 (KPIs solares del deck: dias ago-jun)"],
    "no_indicados_en_el_deck": {
        "capex": "el deck da el LCOE directo; no imprime capex",
        "o_and_m": "no lo imprime",
        "tasa_descuento_i": "no la imprime (solo la formula del LCOE)",
        "vida_util_T": "no la imprime ('A plant lives 25–30 years' es contexto, no supuesto del LCOE)",
        "tamano_planta": "slider sin valor por defecto impreso; aqui todo es por 1 MWp",
        "consecuencia": "TIR, VAN y LCOE propio NO se calculan (null); el P&L usa el LCOE impreso",
    },
    "perdidas_14pct": ("el deck reduce Y_f un 14 % porque su pvlib no tenia perdidas de sistema; nuestro y YA incluye "
                       "perdidas de sistema (derate 0.904, solar.py) y no se le aplica el 14 % adicional"),
}
VENTANAS_ANALISIS = {
    "completo": ("2020-01", "2026-09"),
    "deck_2024_25": ("2024-08", "2025-07"),
    "deck_2025_26": ("2025-08", "2026-07"),
    "deck_2024_25_ago_jun": ("2024-08", "2025-06"),
    "deck_2025_26_ago_jun": ("2025-08", "2026-06"),
}
VENTANAS_12M = ("deck_2024_25", "deck_2025_26")
MIN_DIAS_DECK = 300
HORAS_SOLAR = range(6, 18)        # 06-18 h (inicio de hora, CDMX), igual que el deck/legacy
HORAS_PUNTA = range(18, 22)       # 18-22 h
LCOE_SENSIBILIDAD_USD = (20, 25, 30, 35, 40, 45, 50, 55, 60)
LCOE_IMPRESO_MXN = {20.0: 357.0, 40.0: 714.0}      # valores que el deck IMPRIME (40 x 17.84 = 713.6 -> 714; 20 -> 357)
NOTA_LCOE_MXN = ("LCOE en MXN/MWh: para 20 y 40 USD se usa el valor que imprime el deck (357 y 714, TC 17.84); "
                 "para los demas umbrales, USD x 17.84 sin redondear (el deck no los imprime)")


def lcoe_mxn(usd: float) -> float:
    """Umbral en MXN/MWh coherente con el deck en todos los bloques."""
    return LCOE_IMPRESO_MXN.get(float(usd), float(usd) * ESCENARIO_DECK["tipo_cambio_mxn_por_usd"])


def _metricas_nodo(ag: pd.DataFrame, desde: str, hasta: str) -> pd.DataFrame:
    """Una fila por nodo con sumas y KPIs del rango (sumas exactas de agregados)."""
    d = filtrar(ag, desde, hasta)
    cols = [c for c in CAMPOS if c in d]
    s = d.groupby("nodo")[cols].sum()
    n = s["n_horas"]
    out = pd.DataFrame(index=s.index)
    out["n_horas"] = n
    out["pml_medio"] = s["sum_pml_cent"] / 100 / n
    out["p_cap"] = s["sum_y_pml"] / s["sum_y"]
    out["vf"] = out["p_cap"] / out["pml_medio"].where(out["pml_medio"] > 0)
    out["pct_e0"] = 100 * s["sum_y_le0"] / s["sum_y"]
    out["y_f"] = s["sum_y"]
    out["ingreso"] = s["sum_y_pml"]
    out["ingreso_atajo"] = s["sum_y"] * out["pml_medio"]
    out["energia_media"] = s["sum_energia_cent"] / 100 / n
    out["perdidas_media"] = s["sum_perdidas_cent"] / 100 / n
    out["congestion_media"] = s["sum_congestion_cent"] / 100 / n
    h = d.groupby(["nodo", "hora"])[["n_horas", "sum_pml_cent", "sum_y"]].sum()
    ph = (h["sum_pml_cent"] / 100 / h["n_horas"]).unstack("hora")
    yh = (h["sum_y"] / h["n_horas"]).unstack("hora")
    out["spread_punta_solar"] = ph[list(HORAS_PUNTA)].mean(axis=1) - ph[list(HORAS_SOLAR)].mean(axis=1)
    out["vf_dia_promedio"] = (yh * ph).sum(axis=1) / (out["pml_medio"] * yh.sum(axis=1))
    return out


def _perfil_horario(ag: pd.DataFrame, desde: str, hasta: str, nodos) -> dict:
    """Dia promedio (hora 0..23 CDMX) = PROMEDIO ENTRE NODOS del promedio horario de cada nodo."""
    d = filtrar(ag[ag["nodo"].isin(nodos)], desde, hasta)
    h = d.groupby(["nodo", "hora"])[["n_horas", "sum_pml_cent", "sum_energia_cent", "sum_perdidas_cent",
                                     "sum_congestion_cent", "sum_y"]].sum()
    por = pd.DataFrame({"pml": h["sum_pml_cent"] / 100 / h["n_horas"],
                        "energia": h["sum_energia_cent"] / 100 / h["n_horas"],
                        "perdidas": h["sum_perdidas_cent"] / 100 / h["n_horas"],
                        "congestion": h["sum_congestion_cent"] / 100 / h["n_horas"],
                        "y": h["sum_y"] / h["n_horas"]})
    m = por.groupby(level="hora").mean().reindex(range(24))
    pml_medio = float(m["pml"].mean())         # = media entre nodos de su media de 24 h si todas las horas pesan igual
    return {"hora": list(range(24)), "pml_h": [float(x) for x in m["pml"]],
            "energia_h": [float(x) for x in m["energia"]], "perdidas_h": [float(x) for x in m["perdidas"]],
            "congestion_h": [float(x) for x in m["congestion"]], "y_h_mwh_por_mwp": [float(x) for x in m["y"]],
            "ingreso_atajo_h": [float(y * pml_medio) for y in m["y"]],
            "ingreso_real_h": [float(y * p) for y, p in zip(m["y"], m["pml"])],
            "nota": ("dia promedio: para cada nodo, promedio de cada hora sobre los dias del rango; luego promedio "
                     "simple entre nodos. ingreso_*_h = MXN por MWp en esa hora del dia promedio")}


def _area(t: pd.DataFrame, lcoe: float | None = None) -> dict:
    """Agregado de un area al estilo del deck: promedio entre nodos; VF = cociente de promedios.
    Con `lcoe` (MXN/MWh, pesos 2026 del deck) la prueba P_cap >= LCOE se hace en pesos NOMINALES
    (sufijo _nominal, como el deck) y, si hay columnas *_real, en pesos de hoy (sufijo _real, base INPC)."""
    if t.empty:
        return {"n_nodos": 0}
    pm, pc = float(t["pml_medio"].mean()), float(t["p_cap"].mean())
    out = {"n_nodos": int(len(t)), "pml_medio": pm, "p_cap": pc, "vf": pc / pm if pm > 0 else None,
           "vf_mediana_nodos": float(t["vf"].median()), "pct_e0": float(t["pct_e0"].mean()),
           "energia_media": float(t["energia_media"].mean()), "perdidas_media": float(t["perdidas_media"].mean()),
           "congestion_media": float(t["congestion_media"].mean()),
           "spread_punta_solar": float(t["spread_punta_solar"].mean()),
           "vf_dia_promedio_media_nodos": float(t["vf_dia_promedio"].mean())}
    if "p_cap_real" in t:
        out["pml_medio_real"] = float(t["pml_medio_real"].mean())
        out["p_cap_real"] = float(t["p_cap_real"].mean())
    if "y_f" in t and t.attrs.get("doce_meses"):
        r, rs = float(t["ingreso"].mean()), float(t["ingreso_atajo"].mean())
        out.update({"y_f_mwh_por_mwp": float(t["y_f"].mean()), "ingreso_mxn_por_mwp": r,
                    "ingreso_atajo_mxn_por_mwp": rs, "sobreestimacion_atajo_pct": 100 * (rs / r - 1) if r else None})
        if "ingreso_real" in t:
            out["ingreso_real_mxn_por_mwp"] = float(t["ingreso_real"].mean())
    if lcoe is not None:
        for suf, pcc, pmc in (("nominal", "p_cap", "pml_medio"), ("real", "p_cap_real", "pml_medio_real")):
            if pcc not in t:
                continue
            pmm, pcm = float(t[pmc].mean()), float(t[pcc].mean())
            out.update({f"vf_req_{suf}": lcoe / pmm if pmm > 0 else None, f"margen_mxn_mwh_{suf}": pcm - lcoe,
                        f"pct_nodos_cubren_lcoe_{suf}": 100 * float((t[pcc] >= lcoe).mean()),
                        f"n_nodos_cubren_lcoe_{suf}": int((t[pcc] >= lcoe).sum())})
            if t.attrs.get("doce_meses"):
                out[f"margen_mxn_por_mwp_anio_{suf}"] = float((t["y_f"] * (t[pcc] - lcoe)).mean())
    return out


def _spearman(a: pd.Series, b: pd.Series) -> float | None:
    if len(a) < 3:
        return None
    return float(a.rank().corr(b.rank()))


def _ranking(t: pd.DataFrame, col: str, k: int = 20) -> dict:
    s = t[col].dropna().sort_values()
    return {"top": [[i, float(v)] for i, v in s[::-1].head(k).items()],
            "bottom": [[i, float(v)] for i, v in s.head(k).items()]}


def _hist(v: pd.Series, lo=0.0, hi=1.3, paso=0.05) -> dict:
    bordes = np.round(np.arange(lo, hi + 1e-9, paso), 4)
    c, _ = np.histogram(v.clip(lo, hi - 1e-12), bins=bordes)
    return {"bordes": [float(x) for x in bordes], "conteo": [int(x) for x in c],
            "nota": f"valores fuera de [{lo}, {hi}) se acumulan en el primer/ultimo intervalo"}


def _lambda_e_rango(desde: str, hasta: str, nodo: str = "01AAN-85") -> dict | None:
    """Media y rango horario del componente de energia del SIN (identico en todos los nodos) en el rango."""
    if not AG.DB.exists():
        return None
    con = AG.conectar(memory="2GB")
    ts = clock.sql_ts_cdmx("sistema", "fecha", "hora")
    a0 = pd.Timestamp(desde + "-01")
    a1 = pd.Timestamp(hasta + "-01") + pd.offsets.MonthBegin(1)
    r = con.execute(f"SELECT avg(energia), min(energia), max(energia), count(*) FROM (SELECT energia, {ts} AS ts "
                    f"FROM db.pml_hourly WHERE nodo = ?) WHERE ts >= ? AND ts < ?", [nodo, a0, a1]).fetchone()
    con.close()
    return {"media": r[0], "min": r[1], "max": r[2], "horas": int(r[3]), "nodo_usado": nodo}


def analisis(agg_dir: Path = AGG_DIR, out_dir: Path = ROOT / "data" / "analysis", nodos_lim: list[str] | None = None,
             con_db: bool = True) -> dict:
    """Recalcula el analisis del deck con este pipeline y escribe data/analysis/*.json. Devuelve el documento."""
    com = pd.read_parquet(agg_dir / "agregados_comunes.parquet")
    cfgp = pd.read_parquet(agg_dir / "agregados_config.parquet")
    if nodos_lim is not None:
        com, cfgp = com[com["nodo"].isin(nodos_lim)], cfgp[cfgp["nodo"].isin(nodos_lim)]
    cat = cargar_catalogo()[["nodo", "region", "entidad", "municipio"]]
    ag = {c: AG.combinar(com, cfgp, c) for c in AG.CONFIGS}
    inpc = cargar_inpc()
    ag_r = {c: a_reales(ag[c], inpc)[0] for c in AG.CONFIGS} if inpc else None
    base_nodos = cat.set_index("nodo")
    sin = set(com.loc[com["sistema"] == "SIN", "nodo"])
    cozumel = set(cat.loc[cat["municipio"].astype(str).str.upper() == "COZUMEL", "nodo"])
    L, Lb = ESCENARIO_DECK["lcoe_mxn_mwh"], ESCENARIO_DECK["lcoe_bajo_mxn_mwh"]
    doc: dict = {"schema_version": ANALYSIS_SCHEMA, "contrato_nodos": SCHEMA_VERSION, "fuente_deck": DECK_FUENTE,
                 "reloj": RELOJ, "rotulo": ROTULO, "alcance": ALCANCE,
                 "universo": {"regla": (f"SIN, con baseline solar, >= {MIN_DIAS_DECK} dias (= {MIN_DIAS_DECK * 24} h) de PML "
                                        "en la ventana, sin Cozumel (como el deck)"),
                              "cozumel_excluidos": sorted(cozumel & sin)},
                 "diferencias_metodo_vs_deck": [
                     "Produccion: perfil de ano tipico 2015-2025 (NASA POWER, pvlib) mes x hora en reloj CDMX, no el clima "
                     "real de cada ventana. Las ventanas del deck usaron clima real ago-jun (NASA terminaba el 30-jun-2026).",
                     "Perdidas: nuestro y ya trae perdidas de sistema (derate 0.904) y modelo de temperatura SAPM; el deck "
                     "usaba pvlib sin perdidas, Tc simplificada y luego -14 % en ingreso/P&L.",
                     "Transposicion Perez con DNI/DHI de NASA; el deck: cielo isotropico con Erbs.",
                     "Ubicacion: centroide municipal (igual que el deck) mas 6 codigos renombrados.",
                     "Reloj: CDMX UTC-6 fijo; en el SIN 2024-2026 coincide con el del deck (hora - 1).",
                     "Dias: el deck usaba solo dias completos con NASA; aqui todas las horas con PML del rango.",
                     "VF de areas como el deck: promedio entre nodos y VF = cociente de promedios."],
                 "escenario_deck": {**ESCENARIO_DECK, "slide": [8, 9], "nota_umbrales_mxn": NOTA_LCOE_MXN,
                                    "comparacion_lcoe": (
                                        "El LCOE del deck esta en pesos de 2026 (40 USD x 17.84). La prueba principal "
                                        "P_cap >= LCOE se hace con precios en PESOS DE HOY (reales, INPC base "
                                        f"{inpc['base'] if inpc else 'n/d'}): campos *_real. Se conservan los campos "
                                        "*_nominal (precios nominales de cada mes, como el deck) para la tabla deck vs nuestro.")},
                 "pesos_reales": ({"base_mes": inpc["base"], "fuente": inpc["fuente"],
                                   "metodo": "por mes CDMX: suma_real = suma_nominal x INPC(base)/INPC(mes)"}
                                  if inpc else None),
                 "ventanas": {}}
    tablas_nodo: dict = {}
    for v, (de, ha) in VENTANAS_ANALISIS.items():
        doce = v in VENTANAS_12M
        vent = {"desde": de, "hasta": ha, "meses": len(_meses(de, ha)),
                "ingreso_y_pyg": "si (12 meses, sin anualizar)" if doce else
                ("no: ventana de 11 meses (no se anualiza)" if v.endswith("ago_jun") else
                 "no por ventana (81 meses); ver ingreso por ano completo en las fichas"),
                "por_config": {}}
        for c in AG.CONFIGS:
            t = _metricas_nodo(ag[c], de, ha)
            t = t[t.index.isin(sin) & ~t.index.isin(cozumel) & (t["n_horas"] >= MIN_DIAS_DECK * 24)]
            t = t.join(base_nodos[["region", "entidad"]], how="left")
            if ag_r is not None:
                tr = _metricas_nodo(ag_r[c], de, ha)
                t["p_cap_real"] = tr["p_cap"].reindex(t.index)
                t["pml_medio_real"] = tr["pml_medio"].reindex(t.index)
                t["ingreso_real"] = tr["ingreso"].reindex(t.index)
            t.attrs["doce_meses"] = doce
            nac = _area(t, L)
            nac_b = _area(t, Lb)
            reg = {}
            for k, g in t.groupby("region"):
                g.attrs["doce_meses"] = doce
                reg[k] = _area(g, L)
            est = {}
            for k, g in t.groupby("entidad"):
                g.attrs["doce_meses"] = doce
                est[k] = _area(g, L)
            bloque = {
                "nacional": nac,
                "cubren_lcoe_bajo": {"slide": 10, "lcoe_mxn_mwh": Lb,
                                     **{f"{k}_{suf}": nac_b.get(f"{k2}_{suf}") for suf in ("nominal", "real")
                                        for k, k2 in (("pct_nodos", "pct_nodos_cubren_lcoe"), ("n_nodos", "n_nodos_cubren_lcoe"))}},
                "regiones": reg, "estados": est,
                "perfil_horario_nacional": {"slide": 3, **_perfil_horario(ag[c], de, ha, t.index)},
                "perfil_horario_regiones": {k: _perfil_horario(ag[c], de, ha, g.index) for k, g in t.groupby("region")},
                "vf_distribucion": {"slide": 6, "cuantiles": {str(q): float(t["vf"].quantile(q)) for q in (0.05, 0.25, 0.5, 0.75, 0.95)},
                                    "histograma": _hist(t["vf"])},
                "ranking_estados_p_cap": sorted([[k, float(x["p_cap"])] for k, x in est.items()], key=lambda z: -z[1]),
                "ranking_regiones_vf": sorted([[k, x["vf"]] for k, x in reg.items()], key=lambda z: -(z[1] or 0)),
                "nodos_top_bottom": {"p_cap": _ranking(t, "p_cap"), "vf": _ranking(t, "vf")},
                "sensibilidad_lcoe": {"slide": 8, "nota": NOTA_LCOE_MXN, "filas": [
                    {"lcoe_usd_mwh": u, "lcoe_mxn_mwh": lcoe_mxn(u),
                     "pct_nodos_cubren_nominal": 100 * float((t["p_cap"] >= lcoe_mxn(u)).mean()) if len(t) else None,
                     "pct_nodos_cubren_real": (100 * float((t["p_cap_real"] >= lcoe_mxn(u)).mean())
                                               if (len(t) and "p_cap_real" in t) else None)}
                    for u in LCOE_SENSIBILIDAD_USD]},
            }
            mens = filtrar(ag[c][ag[c]["nodo"].isin(t.index)], de, ha)
            gm = mens.groupby(["nodo", "anio", "mes"])[["n_horas", "sum_pml_cent", "sum_y", "sum_y_pml"]].sum()
            nm = pd.DataFrame({"pml": gm["sum_pml_cent"] / 100 / gm["n_horas"], "pc": gm["sum_y_pml"] / gm["sum_y"]})
            mm = nm.groupby(level=["anio", "mes"]).mean()
            bloque["vf_mensual_nacional"] = [{"mes": f"{a:04d}-{m:02d}", "vf": float(r.pc / r.pml)} for (a, m), r in mm.iterrows()]
            if c == "tracker":
                # Explorador (diapositiva 4): seleccion de region, estado o nodo. Nodo: analysis_nodos.json + su ficha.
                def _vfm(ids):
                    x = nm[nm.index.get_level_values("nodo").isin(ids)].groupby(level=["anio", "mes"]).mean()
                    return [{"mes": f"{a:04d}-{m:02d}", "vf": float(r.pc / r.pml)} for (a, m), r in x.iterrows()]
                bloque["explorador"] = {
                    "slide": 4,
                    "nota": ("region/estado: KPIs en 'regiones'/'estados'; aqui perfiles horarios y VF mensual. Nodo: "
                             "analysis_nodos.json (KPIs por ventana) y su ficha nodes/{id}.json (perfil y VF mensual "
                             "reconstruibles con kpis_desde_doc / reconstruir)"),
                    "perfil_horario_estados": {k: _perfil_horario(ag[c], de, ha, g.index) for k, g in t.groupby("entidad")},
                    "vf_mensual_regiones": {k: _vfm(g.index) for k, g in t.groupby("region")},
                    "vf_mensual_estados": {k: _vfm(g.index) for k, g in t.groupby("entidad")},
                }
            if doce:
                bloque["nodos_top_bottom"]["ingreso"] = _ranking(t, "ingreso")
                bloque["pyg_deck"] = {"slide": 9, "lcoe_mxn_mwh": L, "por_mwp": True,
                                      "energia_mwh_por_mwp": nac.get("y_f_mwh_por_mwp"),
                                      "ingreso_mxn_por_mwp_nominal": nac.get("ingreso_mxn_por_mwp"),
                                      "ingreso_mxn_por_mwp_real": nac.get("ingreso_real_mxn_por_mwp"),
                                      "costo_mxn_por_mwp": (nac.get("y_f_mwh_por_mwp") or 0) * L,
                                      "margen_mxn_por_mwp_nominal": nac.get("margen_mxn_por_mwp_anio_nominal"),
                                      "margen_mxn_por_mwp_real": nac.get("margen_mxn_por_mwp_anio_real"),
                                      "por_region": {k: {"margen_mxn_por_mwp_real": x.get("margen_mxn_por_mwp_anio_real"),
                                                         "margen_mxn_por_mwp_nominal": x.get("margen_mxn_por_mwp_anio_nominal"),
                                                         "energia_mwh_por_mwp": x.get("y_f_mwh_por_mwp")} for k, x in reg.items()},
                                      "nota": ("promedio entre nodos; Pi = E x (P_cap - LCOE) con E = Y_f x 1 MWp; _real = "
                                               "precios en pesos de hoy contra el LCOE en pesos 2026 (principal)")}
                rk = {"nacional": {"spearman_atajo_vs_real": _spearman(t["ingreso_atajo"], t["ingreso"])}}
                for k, g in t.groupby("region"):
                    a20 = set(g["ingreso_atajo"].sort_values(ascending=False).head(20).index)
                    r20 = set(g["ingreso"].sort_values(ascending=False).head(20).index)
                    rk[k] = {"spearman_atajo_vs_real": _spearman(g["ingreso_atajo"], g["ingreso"]),
                             "top20_comunes": len(a20 & r20), "n_nodos": int(len(g))}
                bloque["ranking_atajo_vs_real"] = {"slide": 10, "apendice": "A5", **rk}
            vent["por_config"][c] = bloque
            if c == "tracker":
                tablas_nodo[v] = t
        doc["ventanas"][v] = vent
    # tendencia entre ventanas del deck (mismos dias ago-jun y 12 meses)
    tend = {}
    for a_, b_ in (("deck_2024_25_ago_jun", "deck_2025_26_ago_jun"), ("deck_2024_25", "deck_2025_26")):
        ta, tb = tablas_nodo[a_], tablas_nodo[b_]
        com_n = ta.index.intersection(tb.index)
        dv = tb.loc[com_n, "vf"] - ta.loc[com_n, "vf"]
        reg = {}
        for k in sorted(set(ta["region"].dropna())):
            ia, ib = ta[ta["region"] == k], tb[tb["region"] == k]
            reg[k] = {"vf_a": ia["p_cap"].mean() / ia["pml_medio"].mean(), "vf_b": ib["p_cap"].mean() / ib["pml_medio"].mean()}
        tend[f"{a_}__{b_}"] = {"n_nodos_comunes": int(len(com_n)), "pct_nodos_vf_baja": 100 * float((dv < 0).mean()),
                               "delta_vf_mediana": float(dv.median()), "regiones": reg}
    doc["tendencia_vf_entre_ventanas"] = {"slide": 6, **tend}
    doc["tabla_vf_regiones"] = _tabla_regiones(doc, tablas_nodo)
    doc["cobertura_lcoe_real_vs_nominal"] = _cobertura_real_vs_nominal(doc)
    # tendencia por ano (periodo completo, anos completos) a partir de las fichas: pendiente MCO por nodo
    slopes = []
    for n_, g in ag["tracker"][ag["tracker"]["nodo"].isin(tablas_nodo["completo"].index)].groupby("nodo"):
        a = serie_anual(g)
        c = a[a["completo"] & a["vf"].notna()]
        sl = tendencia(c["anio"], c["vf"])
        if sl is not None:
            slopes.append(sl)
    sl = pd.Series(slopes, dtype=float)
    doc["tendencia_vf_anual_tracker"] = {"slide": 6, "n_nodos": int(len(sl)), "pct_pendiente_negativa": 100 * float((sl < 0).mean()) if len(sl) else None,
                                         "pendiente_mediana_vf_por_anio": float(sl.median()) if len(sl) else None,
                                         "nota": "MCO de VF por ano completo 2020-2025 de cada nodo (>= 3 anos)"}
    le = _lambda_e_rango("2025-08", "2026-07") if con_db else None
    doc["lambda_e_sin_2025_26"] = {"slide": 3, **le} if le else {"slide": 3, "estado": "no_disponible", "motivo": "sin base"}
    doc["comparacion_deck"] = _comparacion(doc)
    doc["insights"] = _insights(doc)
    doc["mapa_diapositivas"] = MAPA_DIAPOSITIVAS
    doc["diapositivas"] = _indice_diapositivas(doc)
    doc["no_reproducible"] = NO_REPRODUCIBLE
    # tabla por nodo (seguidor) para mapa / exploradores
    ids = sorted(set().union(*[set(t.index) for t in tablas_nodo.values()]))
    nod = nodos_json(tablas_nodo, ids, [_txt(base_nodos["region"].get(i)) for i in ids],
                     [_txt(base_nodos["entidad"].get(i)) for i in ids], "tracker")
    out_dir.mkdir(parents=True, exist_ok=True)
    gen = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    doc = {"generated_at": gen, **_redondear(doc, 6)}
    nod = {"generated_at": gen, **nod}
    (out_dir / "analysis.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
    (out_dir / "analysis_nodos.json").write_text(json.dumps(nod, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
    return doc


COLS_NODOS = ["n_horas", "pml_medio", "p_cap", "vf", "pct_e0", "y_f", "ingreso", "ingreso_atajo", "congestion_media",
              "spread_punta_solar", "vf_dia_promedio", "pml_medio_real", "p_cap_real", "ingreso_real"]
SOLO_12M = ("y_f", "ingreso", "ingreso_atajo", "ingreso_real")   # no se anualizan: solo en ventanas de 12 meses


def nodos_json(tablas_nodo: dict, ids: list, region: list, entidad: list, config: str) -> dict:
    """Tabla columnar por nodo y ventana (analysis_nodos*.json): n_horas entero, resto redondeado a 4 decimales,
    None donde el nodo no entra al universo de la ventana. Usada por analisis() y por kpis_variants."""
    nod = {"schema_version": ANALYSIS_SCHEMA, "config": config, "slide": [4, 6, 7], "ids": ids,
           "region": region, "entidad": entidad, "ventanas": {}}
    for v, t in tablas_nodo.items():
        tt = t.reindex(ids)
        nod["ventanas"][v] = {c: [None if pd.isna(x) else (int(x) if c == "n_horas" else round(float(x), 4)) for x in tt[c]]
                              for c in COLS_NODOS if c in tt and not (c in SOLO_12M and v not in VENTANAS_12M)}
    return nod


# Numeracion de diapositivas COMO LA CUENTA EL USUARIO (portada = 1; el deck tiene dos 'Prices' y dos 'Value factor').
MAPA_DIAPOSITIVAS = {
    "1": {"titulo": "Title (que vale un MWh solar en cada nodo)", "campos": []},
    "2": {"titulo": "01 Notation", "campos": [], "nota": "solo simbolos"},
    "3": {"titulo": "02 Prices: promedio simple vs precio capturado",
          "campos": ["ventanas.*.por_config.*.perfil_horario_nacional", "ventanas.*.por_config.*.nacional.{pml_medio,p_cap,vf,pct_e0}"]},
    "4": {"titulo": "02 Prices explorer: cualquier nodo, estado o region",
          "campos": ["ventanas.*.por_config.*.regiones", "ventanas.*.por_config.*.estados",
                     "ventanas.*.por_config.tracker.explorador", "ventanas.*.por_config.*.perfil_horario_regiones",
                     "analysis_nodos.json", "nodes/{id}.json"]},
    "5": {"titulo": "03 Revenue: R = Y_f x P_cap vs atajo Y_f x PML medio",
          "campos": ["ventanas.deck_*.por_config.*.nacional.{ingreso_mxn_por_mwp,ingreso_atajo_mxn_por_mwp,sobreestimacion_atajo_pct}",
                     "perfil_horario_*.ingreso_atajo_h|ingreso_real_h"]},
    "6": {"titulo": "04 Value factor: canibalizacion, tendencia y nivel de precio",
          "campos": ["ventanas.*.por_config.*.vf_distribucion", "tendencia_vf_entre_ventanas", "tendencia_vf_anual_tracker",
                     "ventanas.*.por_config.*.vf_mensual_nacional"]},
    "7": {"titulo": "04 Value factor por region de control (mapa)", "campos": ["tabla_vf_regiones", "analysis_nodos.json"]},
    "8": {"titulo": "05 Profitability (escenario del deck)",
          "campos": ["escenario_deck", "ventanas.*.por_config.*.{nacional,regiones,estados}.*_{real,nominal}",
                     "ventanas.*.por_config.*.sensibilidad_lcoe", "cobertura_lcoe_real_vs_nominal"]},
    "9": {"titulo": "06 Node P&L (escenario del deck)", "campos": ["ventanas.deck_*.por_config.*.pyg_deck"]},
    "10": {"titulo": "07 Conclusions (analisis e insights)",
           "campos": ["comparacion_deck", "insights", "ventanas.deck_*.por_config.*.ranking_atajo_vs_real"]},
    "supuestos": {"titulo": "Assumptions and sources", "campos": ["escenario_deck.citas", "diferencias_metodo_vs_deck"]},
    "A1-A5": {"titulo": "Apendice: del sol al kWh; atajo 'Total Generation'",
              "campos": ["ranking_atajo_vs_real (A5)", "no_reproducible"]},
}
NO_REPRODUCIBLE = [
    {"que": "VF con cielo despejado vs clima real (A1: 'real weather lowers VF by 0.00–0.06')",
     "motivo": "el pipeline no calcula un perfil de cielo despejado"},
    {"que": "PR y H_POA/H_GHI del atajo 'Total Generation' (A5: PR 0.80, ganancia de plano 1.25)",
     "motivo": "los baselines no guardan irradiacion en el plano del panel"},
    {"que": "TG = H_GHI x PML_2022 / 1000 (A5: 2,220 x 40.73 / 1000 = 90 USD/kWp-ano)",
     "motivo": "no hay archivo de precios 2022 en USD del deck de prospeccion; ejemplo ilustrativo"},
    {"que": "TIR / VAN / LCOE propio del deck", "motivo": "el deck no imprime capex, O&M, tasa ni vida util"},
    {"que": "diapositiva 3 (sliders: dia sintetico, precio base 600)", "motivo": "ilustrativa, no son datos"},
]

# Valores que el deck IMPRIME por region (texto de las diapositivas 6, 7 y 10). None = no impreso.
DECK_REGIONES = {
    "PENINSULAR": {"vf_2024_25": 0.95, "vf_2025_26": 0.65, "pml_medio_2025_26_cota_inferior": 1500,
                   "congestion_media_2025_26": 836, "pct_nodos_cubren_714_2025_26": 98},
    "NOROESTE": {"pml_medio_2025_26": 260, "p_cap_2025_26": 150, "pct_e0_2025_26": 5.9, "congestion_media_2025_26": -217,
                 "vf_req_714": 2.75},
    "NORTE": {"p_cap_2025_26": 213, "pct_e0_2025_26": 5.8},
    "_otras": {"pct_e0_2025_26_rango": [0.6, 0.8], "vf_peninsular_norte_noroeste_2025_26_rango": [0.58, 0.65],
               "nota": "ORIENTAL: Spearman 0.87 y 0 de 20 en top-20 (A5/conclusiones)"},
}


def _g(doc, v, *path, cfg="tracker"):
    cur = doc["ventanas"][v]["por_config"][cfg]
    for p in path:
        if cur is None or p not in cur:
            return None
        cur = cur[p]
    return cur


def _tabla_regiones(doc: dict, tablas: dict) -> dict:
    """Diapositiva 7: tabla completa de VF por region de control (seguidor), ambas ventanas del deck."""
    A, B = "deck_2024_25_ago_jun", "deck_2025_26_ago_jun"
    filas = []
    regiones = sorted(set(tablas[A]["region"].dropna()) | set(tablas[B]["region"].dropna()))
    for k in regiones:
        fila = {"region": k}
        for v, lbl in ((A, "2024_25_ago_jun"), (B, "2025_26_ago_jun"), ("deck_2024_25", "2024_25"), ("deck_2025_26", "2025_26")):
            r = _g(doc, v, "regiones", k) or {}
            fila[lbl] = {c: r.get(c) for c in ("n_nodos", "vf", "vf_mediana_nodos", "pml_medio", "p_cap", "pml_medio_real",
                                               "p_cap_real", "pct_e0", "congestion_media", "spread_punta_solar",
                                               "vf_req_real", "pct_nodos_cubren_lcoe_real", "pct_nodos_cubren_lcoe_nominal",
                                               "sobreestimacion_atajo_pct", "ingreso_mxn_por_mwp")}
        ta, tb = tablas[A][tablas[A]["region"] == k], tablas[B][tablas[B]["region"] == k]
        comun = ta.index.intersection(tb.index)
        dv = tb.loc[comun, "vf"] - ta.loc[comun, "vf"]
        va, vb = fila["2024_25_ago_jun"]["vf"], fila["2025_26_ago_jun"]["vf"]
        fila["cambio"] = {"delta_vf_ago_jun": (vb - va) if (va is not None and vb is not None) else None,
                          "pct_nodos_vf_baja": 100 * float((dv < 0).mean()) if len(dv) else None,
                          "delta_pml_medio": ((fila["2025_26_ago_jun"]["pml_medio"] or 0) - (fila["2024_25_ago_jun"]["pml_medio"] or 0))}
        fila["deck_impreso"] = DECK_REGIONES.get(k)
        filas.append(fila)
    nac = {lbl: {c: (_g(doc, v, "nacional") or {}).get(c) for c in ("n_nodos", "vf", "pml_medio", "p_cap", "pct_e0")}
           for v, lbl in ((A, "2024_25_ago_jun"), (B, "2025_26_ago_jun"))}
    return {"slide": 7, "config": "tracker",
            "nota": ("VF de region = cociente de promedios entre nodos (como el deck). delta = 2025-26 menos 2024-25 en dias "
                     "ago-jun. deck_impreso = cifras que el deck imprime en texto (el grafico del deck no trae numeros)."),
            "regiones": filas, "nacional": nac, "deck_otras": DECK_REGIONES["_otras"]}


def _cobertura_real_vs_nominal(doc: dict) -> dict:
    out = {"slide": 8, "lcoe_mxn_mwh": ESCENARIO_DECK["lcoe_mxn_mwh"],
           "nota": "puntos porcentuales: real - nominal (real = precios en pesos de hoy, base INPC)", "ventanas": {}}
    for v in doc["ventanas"]:
        n = _g(doc, v, "nacional") or {}
        r, nm = n.get("pct_nodos_cubren_lcoe_real"), n.get("pct_nodos_cubren_lcoe_nominal")
        out["ventanas"][v] = {"pct_real": r, "pct_nominal": nm, "n_real": n.get("n_nodos_cubren_lcoe_real"),
                              "n_nominal": n.get("n_nodos_cubren_lcoe_nominal"), "n_nodos": n.get("n_nodos"),
                              "delta_pp": (r - nm) if (r is not None and nm is not None) else None}
    return out


def _indice_diapositivas(doc: dict) -> dict:
    ins = {}
    for i in doc["insights"]:
        ins.setdefault(str(i["slide"]), []).append(i["id"])
    return {k: {**v, "insights": ins.get(k, []),
                "comparaciones": [c["cifra"] for c in doc["comparacion_deck"] if str(c["slide"]) == k]}
            for k, v in MAPA_DIAPOSITIVAS.items()}


def _comparacion(doc: dict) -> list[dict]:
    """Cifras impresas por el deck vs las nuestras (seguidor). Ventana ago-jun cuando el deck usa KPIs solares
    (NASA hasta 30-jun-2026); ago-jul cuando habla de precios. Coberturas en pesos NOMINALES, como el deck."""
    A, B = "deck_2024_25_ago_jun", "deck_2025_26_ago_jun"
    tend = doc["tendencia_vf_entre_ventanas"][f"{A}__{B}"]
    le = doc.get("lambda_e_sin_2025_26") or {}
    filas = [
        (3, "Energia del sistema, media ago25-jul26 (MXN/MWh)", 586, le.get("media"), "deck_2025_26"),
        (3, "Energia del sistema, maximo ago25-jul26 (MXN/MWh)", 3643, le.get("max"), "deck_2025_26"),
        (3, "Energia del sistema, minimo ago25-jul26 (MXN/MWh)", 0, le.get("min"), "deck_2025_26"),
        (3, "Congestion media Peninsular ago25-jul26 (MXN/MWh)", 836, _g(doc, "deck_2025_26", "regiones", "PENINSULAR", "congestion_media"), "deck_2025_26"),
        (3, "Congestion media Noroeste ago25-jul26 (MXN/MWh)", -217, _g(doc, "deck_2025_26", "regiones", "NOROESTE", "congestion_media"), "deck_2025_26"),
        (10, "VF nacional 2024-25", 0.86, _g(doc, A, "nacional", "vf"), A),
        (10, "VF nacional 2025-26", 0.79, _g(doc, B, "nacional", "vf"), B),
        (10, "Sobreestimacion del atajo nacional 2025-26 (%) = 1/VF - 1", 26, None, B),
        (6, "VF Peninsular 2024-25", 0.95, _g(doc, A, "regiones", "PENINSULAR", "vf"), A),
        (6, "VF Peninsular 2025-26", 0.65, _g(doc, B, "regiones", "PENINSULAR", "vf"), B),
        (6, "% nodos con VF a la baja 2024-25 -> 2025-26", 97, tend["pct_nodos_vf_baja"], f"{A}->{B}"),
        (10, "PML medio Peninsular 2025-26: el deck dice 'stayed above 1,500' (cota inferior)", 1500, _g(doc, B, "regiones", "PENINSULAR", "pml_medio"), B),
        (6, "PML medio Noroeste (MXN/MWh)", 260, _g(doc, B, "regiones", "NOROESTE", "pml_medio"), B),
        (6, "VF_req Noroeste a LCOE 714 (pesos nominales)", 2.75, _g(doc, B, "regiones", "NOROESTE", "vf_req_nominal"), B),
        (6, "% energia FV a PML<=0 Noroeste ago25-jun26", 5.9, _g(doc, B, "regiones", "NOROESTE", "pct_e0"), B),
        (6, "% energia FV a PML<=0 Norte ago25-jun26", 5.8, _g(doc, B, "regiones", "NORTE", "pct_e0"), B),
        (10, "% nodos con P_cap >= 714, 2024-25 (nominal)", 33, _g(doc, A, "nacional", "pct_nodos_cubren_lcoe_nominal"), A),
        (10, "% nodos con P_cap >= 714, 2025-26 (nominal)", 5, _g(doc, B, "nacional", "pct_nodos_cubren_lcoe_nominal"), B),
        (10, "Nodos con P_cap >= 714, 2024-25 (de 2,407; nominal)", 795, _g(doc, A, "nacional", "n_nodos_cubren_lcoe_nominal"), A),
        (10, "Nodos con P_cap >= 714, 2025-26 (de 2,420; nominal)", 127, _g(doc, B, "nacional", "n_nodos_cubren_lcoe_nominal"), B),
        (10, "Nodos analizados 2024-25", 2407, _g(doc, A, "nacional", "n_nodos"), A),
        (10, "Nodos analizados 2025-26", 2420, _g(doc, B, "nacional", "n_nodos"), B),
        (10, "% de nodos de Peninsular que cubren 714, 2025-26 (nominal)", 98, _g(doc, B, "regiones", "PENINSULAR", "pct_nodos_cubren_lcoe_nominal"), B),
        (10, "P_cap Noroeste 2025-26 (MXN/MWh)", 150, _g(doc, B, "regiones", "NOROESTE", "p_cap"), B),
        (10, "P_cap Norte 2025-26 (MXN/MWh)", 213, _g(doc, B, "regiones", "NORTE", "p_cap"), B),
        (10, "Spearman atajo vs real, nacional 2025-26", 0.98, _g(doc, "deck_2025_26", "ranking_atajo_vs_real", "nacional", "spearman_atajo_vs_real"), "deck_2025_26"),
        (10, "Spearman atajo vs real, Oriental 2025-26", 0.87, _g(doc, "deck_2025_26", "ranking_atajo_vs_real", "ORIENTAL", "spearman_atajo_vs_real"), "deck_2025_26"),
        (10, "Top-20 comunes atajo vs real, Oriental 2025-26", 0, _g(doc, "deck_2025_26", "ranking_atajo_vs_real", "ORIENTAL", "top20_comunes"), "deck_2025_26"),
    ]
    vfn = _g(doc, B, "nacional", "vf")
    out = []
    for sl, desc, deck, ours, vent in filas:
        if desc.startswith("Sobreestimacion") and vfn:
            ours = 100 * (1 / vfn - 1)
        dif = None if ours is None else ours - deck
        fila = {"slide": sl, "cifra": desc, "deck": deck, "nuestra": ours, "diferencia": dif, "ventana": vent,
                "motivo_probable": _motivo(desc)}
        if "cota inferior" in desc:
            fila["tipo"] = "cota_inferior"
            fila["reproducido"] = None if ours is None else bool(ours > deck)
        else:
            fila["tipo"] = "valor"
            tol = _tol(deck)
            fila["tolerancia"] = tol
            fila["reproducido"] = None if ours is None else bool(abs(ours - deck) <= tol)
        out.append(fila)
    vfs = {k: _g(doc, B, "regiones", k, "vf") for k in ("PENINSULAR", "NORTE", "NOROESTE")}
    if all(vfs.values()):
        out.append({"slide": 10, "cifra": "VF Peninsular/Norte/Noroeste 2025-26 (rango)", "deck": [0.58, 0.65],
                    "nuestra": [min(vfs.values()), max(vfs.values())], "diferencia": None, "ventana": B,
                    "motivo_probable": _motivo("VF")})
        out.append({"slide": 10, "cifra": "Sobreestimacion del atajo Peninsular/Norte/Noroeste 2025-26 (%)", "deck": [53, 73],
                    "nuestra": [100 * (1 / max(vfs.values()) - 1), 100 * (1 / min(vfs.values()) - 1)],
                    "diferencia": None, "ventana": B, "motivo_probable": _motivo("VF")})
    for f in out:
        if "reproducido" not in f:                   # rangos [min, max]: cada extremo dentro de tolerancia
            f["tipo"] = "rango"
            tol = [_tol(x) for x in f["deck"]]
            f["tolerancia"] = tol
            f["reproducido"] = bool(all(abs(o - d) <= t_ for o, d, t_ in zip(f["nuestra"], f["deck"], tol)))
    return out


def _tol(x) -> float:
    """Tolerancia para 'reproducido': max(2 % relativo, media unidad del ultimo digito impreso por el deck)."""
    txt = repr(x)
    dec = len(txt.split(".")[1]) if "." in txt else 0
    return max(0.02 * abs(float(x)), 0.5 * 10 ** (-dec))


def _motivo(desc: str) -> str:
    d = desc.lower()
    if "energia del sistema" in d or "congestion" in d or "pml medio" in d:
        return ("solo precios: deben coincidir salvo dias excluidos (el deck: dias completos con NASA) y el promedio "
                "entre nodos con distinto universo")
    if "nodos analizados" in d or "nodos con" in d:
        return "universo distinto: el deck exigia >= 300 dias completos CON NASA; aqui >= 300 dias de PML, mas 6 renombrados"
    return ("perfil de produccion: ano tipico 2015-2025 vs clima real de la ventana; perdidas y temperatura distintas; "
            "transposicion Perez vs isotropica")


def _insights(doc: dict) -> list[dict]:
    """Enunciados FACTUALES generados de las cifras (valor + base de comparacion), con `slide` (numeracion del usuario).
    Sin afirmaciones inventadas. Diapositivas 8 (rentabilidad), 9 (P&L) y 10 (conclusiones)."""
    A, B = "deck_2024_25_ago_jun", "deck_2025_26_ago_jun"
    ins = []
    L = ESCENARIO_DECK["lcoe_mxn_mwh"]
    # --- 8: rentabilidad (escenario del deck)
    lbl = {A: "ago-2024 a jun-2025", B: "ago-2025 a jun-2026"}
    for v in (A, B):
        n = _g(doc, v, "nacional") or {}
        if n.get("pct_nodos_cubren_lcoe_real") is not None:
            ins.append({"slide": 8, "id": f"cubren_lcoe_{v}",
                        "texto_es": (f"Escenario del deck (LCOE {L:.0f} MXN/MWh, pesos 2026): {n['n_nodos_cubren_lcoe_real']} de "
                                     f"{n['n_nodos']} nodos ({n['pct_nodos_cubren_lcoe_real']:.0f} %) tienen precio capturado "
                                     f"suficiente en {lbl[v]} con precios en pesos de hoy; con precios nominales, "
                                     f"{n['n_nodos_cubren_lcoe_nominal']} ({n['pct_nodos_cubren_lcoe_nominal']:.0f} %)."),
                        "valores": {k: n.get(k) for k in ("n_nodos", "n_nodos_cubren_lcoe_real", "pct_nodos_cubren_lcoe_real",
                                                          "n_nodos_cubren_lcoe_nominal", "pct_nodos_cubren_lcoe_nominal")},
                        "base": "P_cap >= LCOE del deck; real = INPC base 2026-09"})
    reg = _g(doc, B, "regiones") or {}
    if reg:
        pc_lo = min(reg.items(), key=lambda kv: kv[1]["p_cap_real"] if kv[1].get("p_cap_real") is not None else kv[1]["p_cap"])
        x = pc_lo[1]
        ins.append({"slide": 8, "id": "nivel_precio",
                    "texto_es": (f"El precio capturado mas bajo de ago-2025 a jun-2026 es {pc_lo[0]}: {x.get('p_cap_real', x['p_cap']):.0f} "
                                 f"MXN/MWh en pesos de hoy (VF necesario {x.get('vf_req_real') or 0:.2f}), frente al LCOE "
                                 f"del escenario del deck de {L:.0f} MXN/MWh."),
                    "valores": {"p_cap_real": x.get("p_cap_real"), "p_cap_nominal": x["p_cap"], "vf_req_real": x.get("vf_req_real"),
                                "lcoe_deck": L}, "base": "escenario del deck"})
        cubre = sorted(((k, v.get("pct_nodos_cubren_lcoe_real")) for k, v in reg.items()), key=lambda z: -(z[1] or 0))
        ins.append({"slide": 8, "id": "cubren_por_region",
                    "texto_es": (f"En ago-2025 a jun-2026 la region con mas nodos que cubren el LCOE del deck es {cubre[0][0]} "
                                 f"({cubre[0][1]:.0f} % de sus nodos, pesos de hoy)."),
                    "valores": dict(cubre), "base": "P_cap real >= 714 MXN/MWh, por region"})
    sens = _g(doc, "deck_2025_26", "sensibilidad_lcoe", "filas") or []
    if sens:
        ins.append({"slide": 8, "id": "sensibilidad",
                    "texto_es": ("Porcentaje de nodos que cubren el LCOE en ago-2025 a jul-2026 (pesos de hoy): " +
                                 ", ".join(f"{s_['lcoe_usd_mwh']} USD -> {s_['pct_nodos_cubren_real']:.0f} %" for s_ in sens
                                           if s_["lcoe_usd_mwh"] in (20, 30, 40, 50)) + "."),
                    "valores": sens, "base": "TC 17.84 del deck"})
    # --- 9: P&L por MWp (12 meses)
    for v in ("deck_2024_25", "deck_2025_26"):
        p = _g(doc, v, "pyg_deck") or {}
        if p.get("margen_mxn_por_mwp_real") is not None:
            ins.append({"slide": 9, "id": f"pyg_{v}",
                        "texto_es": (f"Planta de 1 MWp seguidor, {v.replace('deck_', '').replace('_', '-')} (ago-jul), promedio entre nodos: "
                                     f"energia {p['energia_mwh_por_mwp']:,.0f} MWh, ingreso {p['ingreso_mxn_por_mwp_real'] / 1e6:.2f} M MXN "
                                     f"(pesos de hoy), costo al LCOE del deck {p['costo_mxn_por_mwp'] / 1e6:.2f} M MXN, "
                                     f"margen {p['margen_mxn_por_mwp_real'] / 1e6:+.2f} M MXN (nominal {p['margen_mxn_por_mwp_nominal'] / 1e6:+.2f})."),
                        "valores": {k: p.get(k) for k in ("energia_mwh_por_mwp", "ingreso_mxn_por_mwp_real", "ingreso_mxn_por_mwp_nominal",
                                                          "costo_mxn_por_mwp", "margen_mxn_por_mwp_real", "margen_mxn_por_mwp_nominal")},
                        "base": "Pi = Y_f x (P_cap - LCOE), escenario del deck, sin -14 % adicional"})
            pr = p.get("por_region") or {}
            if pr:
                best = max(pr.items(), key=lambda kv: kv[1]["margen_mxn_por_mwp_real"] or -1e18)
                worst = min(pr.items(), key=lambda kv: kv[1]["margen_mxn_por_mwp_real"] or 1e18)
                ins.append({"slide": 9, "id": f"pyg_regiones_{v}",
                            "texto_es": (f"Margen por MWp en {v.replace('deck_', '').replace('_', '-')}: el mejor es {best[0]} "
                                         f"({best[1]['margen_mxn_por_mwp_real'] / 1e6:+.2f} M MXN) y el peor {worst[0]} "
                                         f"({worst[1]['margen_mxn_por_mwp_real'] / 1e6:+.2f} M MXN), pesos de hoy."),
                            "valores": {best[0]: best[1], worst[0]: worst[1]}, "base": "promedio entre nodos de la region"})
    # --- 10: conclusiones
    vA, vB = _g(doc, A, "nacional", "vf"), _g(doc, B, "nacional", "vf")
    if vA and vB:
        ins.append({"slide": 10, "id": "vf_nacional", "texto_es": f"El VF nacional (seguidor, promedio entre nodos) paso de {vA:.2f} a {vB:.2f} entre ago-jun 2024-25 y 2025-26.",
                    "valores": {"vf_2024_25": vA, "vf_2025_26": vB}, "base": "ratio de promedios entre nodos, dias ago-jun"})
        ins.append({"slide": 10, "id": "atajo", "texto_es": f"Valorar la energia al precio promedio sobreestima el ingreso en {100 * (1 / vB - 1):.0f} % a nivel nacional en 2025-26.",
                    "valores": {"sobreestimacion_pct": 100 * (1 / vB - 1)}, "base": "1/VF - 1 con el VF nacional de 2025-26"})
    t = doc["tendencia_vf_entre_ventanas"][f"{A}__{B}"]
    ins.append({"slide": 10, "id": "tendencia", "texto_es": f"El VF bajo en {t['pct_nodos_vf_baja']:.0f} % de {t['n_nodos_comunes']} nodos comparables entre 2024-25 y 2025-26.",
                "valores": t, "base": "mismos nodos, dias ago-jun"})
    if reg:
        lo = min(reg.items(), key=lambda kv: kv[1]["vf"] or 9)
        hi = max(reg.items(), key=lambda kv: kv[1]["vf"] or -9)
        ins.append({"slide": 10, "id": "region_vf", "texto_es": f"En 2025-26 el VF regional va de {lo[1]['vf']:.2f} ({lo[0]}) a {hi[1]['vf']:.2f} ({hi[0]}).",
                    "valores": {lo[0]: lo[1]["vf"], hi[0]: hi[1]["vf"]}, "base": "regiones de control, ratio de promedios"})
        e0 = sorted(((k, x["pct_e0"]) for k, x in reg.items()), key=lambda z: -z[1])
        ins.append({"slide": 10, "id": "pml_le0", "texto_es": f"La mayor proporcion de energia FV a PML <= 0 en 2025-26 esta en {e0[0][0]} ({e0[0][1]:.1f} %) y {e0[1][0]} ({e0[1][1]:.1f} %) (proporcion dentro de cada region).",
                    "valores": dict(e0), "base": "promedio entre nodos de la region, dias ago-jun"})
    rk = _g(doc, "deck_2025_26", "ranking_atajo_vs_real") or {}
    if rk:
        ins.append({"slide": 10, "id": "ranking", "texto_es": f"Ordenar nodos por ingreso del atajo o por ingreso real da casi el mismo orden nacional (Spearman {rk['nacional']['spearman_atajo_vs_real']:.2f}).",
                    "valores": {k: v for k, v in rk.items() if isinstance(v, dict)}, "base": "ago-2025 a jul-2026, 12 meses"})
    tv = doc.get("tendencia_vf_anual_tracker") or {}
    if tv.get("n_nodos"):
        ins.append({"slide": 10, "id": "tendencia_larga", "texto_es": f"Con anos completos 2020-2025, la pendiente de VF es negativa en {tv['pct_pendiente_negativa']:.0f} % de {tv['n_nodos']} nodos (mediana {tv['pendiente_mediana_vf_por_anio']:+.3f} por ano).",
                    "valores": tv, "base": "MCO por nodo; dato nuevo, el deck solo compara dos ventanas"})
    for f in doc["comparacion_deck"]:
        o = f["nuestra"]
        if o is not None and f.get("reproducido") is False:
            ov = f"{o:.4g}" if isinstance(o, (int, float)) else "[" + ", ".join(f"{x:.4g}" for x in o) + "]"
            ins.append({"slide": f["slide"], "id": "no_reproducido", "texto_es": f"No reproducido: {f['cifra']}: deck {f['deck']}, nuestro {ov}.",
                        "valores": {"deck": f["deck"], "nuestra": o}, "base": f["motivo_probable"], "bandera": True})
    return ins

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--nodos", nargs="*", default=None)
    ap.add_argument("--analisis", action="store_true", help="solo data/analysis/ (analisis del deck)")
    a = ap.parse_args()
    if a.analisis:
        d = analisis()
        print(json.dumps({"comparacion": d["comparacion_deck"]}, indent=1, ensure_ascii=False))
    else:
        print(json.dumps(escribir_contrato(nodos=a.nodos), indent=1))
