"""Construye y escribe los JSON web de KPIs por config x variante de clima (ver kpis_variants.py y docs/TECNICO.md).

  NODAL_DATA_ROOT=/ruta/al/checkout .venv/bin/python pipeline/kpis_variants_out.py

Escribe SOLO archivos nuevos en $NODAL_DATA_ROOT/data/solar_v2/web/ y falla (sin escribir nada) si alguna puerta
de conciliacion no se cumple:
  analysis_nodos_tracker.json  copia byte a byte del analysis_nodos.json publicado (verificado contra el recalculo)
  analysis_nodos_fijo.json     mismo esquema, config fijo, variante mean, todas las ventanas
  variant_scalars_{tracker,fijo}.json  columnar: variante x Y1/Y2 x campos sobre ids (mismo orden que analysis_nodos)
  node_profiles_fijo.json      mismo esquema que web/data/derived/node_profiles.json, config fijo, variante mean
  reconciliation.json          resultado de las puertas, tamanos gz y estadisticas vf_fijo vs vf_tracker"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kpis as K  # noqa: E402
import kpis_variants as KV  # noqa: E402

SCHEMA_VS = "variant_scalars/1"
PRESUPUESTO_GZ = 2_000_000          # bytes gz por config para guardar los 9 campos exactos
PERFIL_WIN = {"Y1": (202408, 202507), "Y2": (202508, 202607)}
UMBRAL_VF = 0.15


def _gz(b: bytes) -> int:
    return len(gzip.compress(b, 9))


def _dump(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def _col(s: pd.Series, nd: int = 4) -> list:
    return [None if pd.isna(x) else round(float(x), nd) for x in s]


def variant_scalars(var: dict, ids: list, config_web: str, campos: list, gen: str) -> dict:
    vent = {w: dict(zip(("desde", "hasta"), K.VENTANAS_ANALISIS[v])) for w, v in KV.VENT_WEB.items()}
    base = var["mean"]
    shared = {w: {c: ([None if pd.isna(x) else int(x) for x in base[w].reindex(ids)[c]] if c == "n_horas"
                      else _col(base[w].reindex(ids)[c])) for c in KV.COMPARTIDOS} for w in KV.VENT_WEB}
    data = {v: {w: {c: _col(t.reindex(ids)[c]) for c in campos} for w, t in wins.items()} for v, wins in var.items()}
    return {"generated_at": gen, "schema_version": SCHEMA_VS, "config": config_web, "ids": ids, "windows": vent,
            "variants": list(var), "labels": KV.ETIQUETAS, "default_variant": "mean", "note_2015": KV.NOTA_2015,
            "fields": campos, "lazy_fields": [c for c in KV.CAMPOS9 if c not in campos],
            "shared_fields": KV.COMPARTIDOS, "shared": shared, "data": data,
            "units": {"p_cap": "MXN/MWh", "p_cap_real": "MXN/MWh (pesos of base month)", "vf": "-",
                      "pct_e0": "% of energy at PML <= 0", "y_f": "MWh/MWp over the window hours (not annualised)",
                      "yf_annual_equiv": "MWh/MWp, 12-month equivalent of the variant (information only)",
                      "ingreso": "MXN/MWp over the window (not annualised)", "ingreso_atajo": "MXN/MWp",
                      "ingreso_real": "MXN/MWp (pesos of base month)", "vf_dia_promedio": "-",
                      "pml_medio": "MXN/MWh", "congestion_media": "MXN/MWh", "spread_punta_solar": "MXN/MWh"},
            "rounding": "4 decimals (as analysis_nodos.json); None = node outside the window universe"}


def perfiles_fijo(com_y: pd.DataFrame, tablas: pd.DataFrame, ids: list) -> dict:
    """Mismo calculo que web/tools/build_derived.py (node_profiles.json) con y = solar_v2 mean, config fixed."""
    ag = KV.combinar_variante(com_y, KV.tabla_larga(tablas, "fixed", "mean"), "mean")
    ag["ym"] = ag["anio"] * 100 + ag["mes"]
    prof: dict = {}
    for w, (a, b) in PERFIL_WIN.items():
        s = ag[(ag.ym >= a) & (ag.ym <= b)].groupby(["nodo", "hora"]).agg(
            n=("n_horas", "sum"), pml=("sum_pml_cent", "sum"), per=("sum_perdidas_cent", "sum"),
            cg=("sum_congestion_cent", "sum"), y=("sum_y", "sum")).reset_index()
        for nodo, d in s.groupby("nodo"):
            d = d.sort_values("hora")
            n = d.n.to_numpy(float)
            if len(d) != 24 or n.min() <= 0:
                continue
            prof.setdefault(nodo, {})[w] = [
                [round(float(v), 1) for v in d.pml.to_numpy() / 100 / n], [round(float(v), 2) for v in d.per.to_numpy() / 100 / n],
                [round(float(v), 2) for v in d.cg.to_numpy() / 100 / n], [round(float(v), 4) for v in d.y.to_numpy() / n]]
    return {"windows": {k: {"desde": f"{a // 100}-{a % 100:02d}", "hasta": f"{b // 100}-{b % 100:02d}"}
                        for k, (a, b) in PERFIL_WIN.items()},
            "rows": ["pml", "perdidas", "congestion", "y"], "config": "fijo", "variant": "mean",
            "nodes": {k: prof[k] for k in ids if k in prof}}


def gate_perfiles(prof: dict, root: Path) -> dict:
    """pml/perdidas/congestion = node_profiles.json publicado; y = solar variants/mean.json fijo (4 decimales)."""
    res = {}
    p = root / "web/data/derived/node_profiles.json"
    if p.exists():
        pub = json.loads(p.read_text())["nodes"]
        if set(pub) != set(prof["nodes"]):
            raise AssertionError("node_profiles_fijo: nodos distintos a node_profiles.json")
        for nodo, ws in prof["nodes"].items():
            for w, rows in ws.items():
                if rows[:3] != pub[nodo][w][:3]:
                    raise AssertionError(f"node_profiles_fijo {nodo}/{w}: filas de precio distintas")
        res["precio_igual_a_publicado"] = True
    vm = root / "data/solar_v2/variants/mean.json"
    if vm.exists():
        sv = json.loads(vm.read_text())["nodes"]
        e = max(abs(a - b) for nodo, ws in prof["nodes"].items() for w, rows in ws.items()
                for a, b in zip(rows[3], sv[nodo]["fijo"]["y"][w]))
        if e > 1.0001e-4:
            raise AssertionError(f"node_profiles_fijo: y difiere de variants/mean.json ({e})")
        res["y_max_abs_vs_solar_mean"] = e
    return res


def vf_stats(var: dict) -> dict:
    out = {}
    for v in KV.VARIANTES:
        for w in KV.VENT_WEB:
            a, b = var["fixed"][v][w]["vf"], var["tracker"][v][w]["vf"].reindex(var["fixed"][v][w].index)
            d = (a - b).dropna()
            if (var["fixed"][v][w]["y_f"] >= var["tracker"][v][w]["y_f"].reindex(a.index)).any():
                raise AssertionError(f"{v}/{w}: y_f fijo >= tracker en algun nodo")
            fuera = d[d.abs() > UMBRAL_VF]
            out[f"{v}.{w}"] = {"n": int(len(d)), "mediana": float(d.median()), "p5": float(d.quantile(.05)),
                               "p95": float(d.quantile(.95)), "max_abs": float(d.abs().max()),
                               "fuera_0.15": {k: round(float(x), 4) for k, x in fuera.items()}}
    return out


def construir(root: Path = KV.DATA_ROOT) -> dict:
    r = KV.rutas(root)
    pub_bytes = r["publicado"].read_bytes()
    pub = json.loads(pub_bytes)
    ids, region, entidad = pub["ids"], pub["region"], pub["entidad"]
    inpc = K.cargar_inpc(r["inpc"])
    tablas = pd.read_parquet(r["tablas"])
    tablas = tablas[tablas["nodo"].isin(set(ids))]
    sc = pd.read_parquet(r["scalars"])
    com_full = KV.cargar_comunes(r["comunes"], ids)
    com_y = com_full[com_full["anio"] * 100 + com_full["mes"] >= 202408].reset_index(drop=True)
    rep: dict = {"gates": {}, "files": {}}
    nod, var = {}, {}
    for cfg in ("tracker", "fixed"):
        mean_t = KV.kpis_mean(com_full, tablas, inpc, ids, cfg)
        ref_t = KV.kpis_publicado(com_full, r["config"], inpc, ids, cfg)
        rep["gates"][f"mean_vs_ruta_publicada_{cfg}"] = {
            v: KV.comparar(mean_t[v], ref_t[v], [c for c in K.COLS_NODOS if c in mean_t[v]]) for v in mean_t}
        nod[cfg] = K.nodos_json(mean_t, ids, region, entidad, KV.CFG_WEB[cfg])
        var[cfg] = KV.kpis_variantes(com_y, tablas, inpc, ids, cfg)
        for w, v in KV.VENT_WEB.items():                       # mismas cifras por las dos rutas internas
            KV.comparar(var[cfg]["mean"][w], mean_t[v], KV.CAMPOS9, tol=1e-12)
        rep["gates"][f"y_f_vs_solar_scalars_{cfg}"] = KV.comparar_scalars(var[cfg], sc, cfg)
    errs = KV.comparar_json(nod["tracker"], pub)
    rep["gates"]["tracker_json_vs_publicado_max_abs"] = max(errs.values())
    KV.n_horas_identico(var)
    rep["gates"]["n_horas_identico"] = True
    rep["vf_fijo_menos_tracker"] = vf_stats(var)
    prof = perfiles_fijo(com_y, tablas, ids)
    rep["gates"]["node_profiles_fijo"] = gate_perfiles(prof, root)
    gen = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    campos = KV.CAMPOS9 + ["yf_annual_equiv"]
    vs = {c: _dump(variant_scalars(var[c], ids, KV.CFG_WEB[c], campos, gen)) for c in var}
    if max(_gz(b) for b in vs.values()) > PRESUPUESTO_GZ:
        vs = {c: _dump(variant_scalars(var[c], ids, KV.CFG_WEB[c], KV.CORE, gen)) for c in var}
        rep["layout"] = "core: 5 campos exactos; resto perezoso por variante seleccionada"
    else:
        rep["layout"] = "all: 9 campos + yf_annual_equiv exactos"
    fijo = {"generated_at": gen, **nod["fixed"]}
    files = {"analysis_nodos_tracker.json": pub_bytes, "analysis_nodos_fijo.json": _dump(fijo),
             "variant_scalars_tracker.json": vs["tracker"], "variant_scalars_fijo.json": vs["fixed"],
             "node_profiles_fijo.json": _dump(prof)}
    for k, b in files.items():
        rep["files"][k] = {"bytes": len(b), "gz": _gz(b)}
    rep["generated_at"] = gen
    return {"files": files, "report": rep}


def escribir(res: dict, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for k, b in res["files"].items():
        (out / k).write_bytes(b)
    (out / "reconciliation.json").write_bytes(_dump(res["report"]))


if __name__ == "__main__":
    res = construir()
    out = KV.rutas()["out"]
    escribir(res, out)
    print(json.dumps({k: v for k, v in res["report"].items() if k != "vf_fijo_menos_tracker"}, indent=1)[:3000])
