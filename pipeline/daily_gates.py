"""
daily_gates.py - Puertas de conciliacion de la serie diaria (docs/TECNICO.md §13). El build falla si alguna no pasa.

(a) por ventana (completo, Y1, Y2): media ponderada por horas de pml_avg diario = pml_medio publicado (1e-6 rel) y
    congestion_media; las 4 sumas en centavos = agregados_comunes (identidad exacta, entera).
(b) suma de n_horas diario por ventana = n_horas publicado (exacto).
(c) por nodo, config y mes de `win` (2024-08..2026-07): sum de y24 (dia completo) sobre los dias de clima valido del mes
    = sum_h(tabla win[mes, h]) x nd(mes) (nd = dias validos de la tabla; = dias del mes salvo 2026-07) y el conteo de
    dias validos = nd; ademas y_day = y24 en todo dia con 24 horas de PML.
(d) exacta: con y = dia promedio de `win` en cada hora con PML, sum(y*pml) y sum(y) por ventana Y1/Y2 = ingreso y y_f
    publicados de `win` (variant_scalars, 4 decimales); informativa con cota: sum de ingreso_dia (clima del dia) vs
    ingreso `win` publicado, |rel| <= TOL_D (distribucion en el reporte).
(e) areas = media de los nodos miembros (5 areas, desde los archivos decodificados) y pml anual ALL = series_areas.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

import daily_series as S
import solar_variants as SV

WINDOWS = {"completo": (202001, 202609), "Y1": (202408, 202507), "Y2": (202508, 202607)}
PUB = {"completo": "completo", "Y1": "deck_2024_25", "Y2": "deck_2025_26"}
TOL_REL, TOL_ROUND = 1e-6, 5e-5      # 1e-6 relativo + redondeo a 4 decimales del publicado
TOL_D = 0.10                          # cota de la puerta (d) informativa (emparejamiento diario vs dia promedio)


def window_pml(pm: dict, ym: np.ndarray) -> dict:
    out = {}
    for w, (a, b) in WINDOWS.items():
        m = (ym >= a) & (ym <= b) & np.isfinite(pm["n_horas"])
        n = pm["n_horas"][m]
        out[w] = {"n": float(n.sum()), "cent": {c: float(pm["_cent_" + c][m].sum()) for c in S.COMP},
                  "hw": {f: float((n * pm[f][m]).sum()) for f in S.PML_FIELDS[1:5]}}
    return out


def window_cfg(cf: dict, pm: dict, ym: np.ndarray, h, pml, grid, wtab) -> dict:
    out = {"win": {}}
    for w, (a, b) in WINDOWS.items():
        m = (ym >= a) & (ym <= b)
        out["win"][w] = {"ingreso": float(np.nansum(cf["ingreso_dia"][m])), "y": float(np.nansum(cf["y_day"][m])),
                         "dias_sin_clima": int((np.isfinite(pm["n_horas"]) & np.isnan(cf["y_day"]) & m).sum())}
    ok = np.isfinite(cf["p_cap_dia"])
    ing = cf["ingreso_dia"][ok]
    out["id_ingreso"] = float(np.max(np.abs(ing - cf["y_day"][ok] * cf["p_cap_dia"][ok]) / np.maximum(np.abs(ing), 1e-9),
                                     initial=0))
    v = np.isfinite(cf["vf_dia"])
    out["id_vf"] = float(np.max(np.abs(cf["vf_dia"][v] - cf["p_cap_dia"][v] / pm["pml_avg"][v]), initial=0))
    y24 = S.y24_day(grid)
    full = pm["n_horas"] == 24
    both = full & np.isfinite(cf["y_day"])
    out["y_vs_y24"] = float(np.max(np.abs(cf["y_day"][both] - y24[both]), initial=0))
    out["y24_nan_on_valid"] = int((full & np.isfinite(cf["y_day"]) & np.isnan(y24)).sum())
    if wtab is None:
        out["c"] = None
        return out
    keys, ytab, ndt = wtab
    errs, ndbad, nfull = [], 0, 0
    for i, k in enumerate(keys):
        v = y24[ym == k]
        val = np.isfinite(v)
        ref = float(ytab[i].sum() * ndt[i])
        errs.append(abs(float(v[val].sum()) - ref) / max(abs(ref), 1e-12))
        ndbad += int(val.sum() != ndt[i])
        nfull += int(ndt[i] == SV.ym_days(int(k)))
    out["c"] = {"max_rel": max(errs), "nd_mismatch": ndbad, "months": len(keys), "months_all_days": nfull}
    day = h // 24
    keep = (h >= 0) & (day < len(ym))
    hk, pk = h[keep], np.asarray(pml, float)[keep]
    yh = ym[hk // 24]
    pos = {int(k): i for i, k in enumerate(keys)}
    out["d_exact"] = {}
    for w in ("Y1", "Y2"):
        a, b = WINDOWS[w]
        m = (yh >= a) & (yh <= b)
        idx = np.array([pos.get(int(x), -1) for x in yh[m]], dtype=np.int64)
        if (idx < 0).any():
            out["d_exact"][w] = None
            continue
        ymd = ytab[idx, hk[m] % 24]
        out["d_exact"][w] = {"ingreso": float((ymd * pk[m]).sum()), "y": float(ymd.sum())}
    return out


def _rel(a, b, tol=TOL_REL, atol=TOL_ROUND):
    e = abs(a - b)
    return e / max(abs(b), 1e-12), e <= atol + tol * abs(b)


def _pub(root: Path):
    an = json.loads((root / "data/analysis/analysis_nodos.json").read_text())
    pos = {n: i for i, n in enumerate(an["ids"])}
    com = pd.read_parquet(root / "data/aggregates/agregados_comunes.parquet")
    com["ym"] = com["anio"] * 100 + com["mes"]
    sums = {}
    for w, (a, b) in WINDOWS.items():
        sums[w] = com[(com["ym"] >= a) & (com["ym"] <= b)].groupby("nodo")[
            ["n_horas"] + [f"sum_{c}_cent" for c in S.COMP]].sum()
    vs = {k: json.loads((root / f"data/solar_v2/web/variant_scalars_{k}.json").read_text()) for k in S.CONFIGS}
    return an, pos, sums, vs


def check_all(root: Path, res: list, ids, missing, errors) -> dict:
    an, pos, sums, vs = _pub(root)
    a_rel = {"pml_medio": 0.0, "congestion_media": 0.0}
    a_abs = dict(a_rel)
    bad = {"a": 0, "a_cent": 0, "b": 0, "c": 0, "d_exact": 0, "d": 0, "id": 0}
    c_max, ndm, dex, yv24, ids_err = 0.0, 0, 0.0, 0.0, 0.0
    drel = {k: {w: [] for w in ("Y1", "Y2")} for k in S.CONFIGS}
    for r in res:
        n, i, g = r["nodo"], pos[r["nodo"]], r["gates"]
        for w in WINDOWS:
            pw, s = g["pml"][w], sums[w]
            if n in s.index:
                ref = s.loc[n]
                bad["a_cent"] += int(any(pw["cent"][c] != float(ref[f"sum_{c}_cent"]) for c in S.COMP)
                                     or pw["n"] != float(ref["n_horas"]))
            pv = an["ventanas"][PUB[w]]
            if pv["n_horas"][i] is None:
                continue
            bad["b"] += int(pw["n"] != pv["n_horas"][i])
            for f, hwf in (("pml_medio", "pml_avg"), ("congestion_media", "congestion_avg")):
                e, ok = _rel(pw["hw"][hwf] / pw["n"], pv[f][i])
                a_rel[f] = max(a_rel[f], e)
                a_abs[f] = max(a_abs[f], abs(pw["hw"][hwf] / pw["n"] - pv[f][i]))
                bad["a"] += int(not ok)
        for k in S.CONFIGS:
            gk = g[k]
            ids_err = max(ids_err, gk["id_ingreso"], gk["id_vf"])
            bad["id"] += int(gk["id_ingreso"] > 1e-9 or gk["id_vf"] > 1e-9 or gk["y24_nan_on_valid"] > 0)
            yv24 = max(yv24, gk["y_vs_y24"])
            if gk["c"] is None:
                bad["c"] += 1
                continue
            c_max = max(c_max, gk["c"]["max_rel"])
            ndm += gk["c"]["nd_mismatch"]
            bad["c"] += int(gk["c"]["max_rel"] > 1e-9 or gk["c"]["nd_mismatch"] > 0)
            for w in ("Y1", "Y2"):
                pubd = vs[k]["data"]["win"][w]
                pi, py = pubd["ingreso"][i], pubd["y_f"][i]
                if pi is None:
                    continue
                de = gk["d_exact"][w]
                if de is None:
                    bad["d_exact"] += 1
                    continue
                e1, ok1 = _rel(de["ingreso"], pi)
                e2, ok2 = _rel(de["y"], py)
                dex = max(dex, e1, e2)
                bad["d_exact"] += int(not (ok1 and ok2))
                rel = (gk["win"][w]["ingreso"] - pi) / pi
                drel[k][w].append(rel)
                bad["d"] += int(abs(rel) > TOL_D)
    bad["y_vs_y24"] = int(yv24 > 1e-9)
    dist = {k: {w: _dist(v) for w, v in d.items()} for k, d in drel.items()}
    miss_w = {k: {w: _dist([r["gates"][k]["win"][w]["dias_sin_clima"] for r in res]) for w in WINDOWS} for k in S.CONFIGS}
    summary = {"nodes": len(res), "missing": len(missing), "errors": [e["nodo"] for e in errors],
               "a_max_rel": a_rel, "a_max_abs": a_abs, "c_max_rel": c_max, "c_nd_mismatch": ndm, "d_exact_max_rel": dex,
               "y_day_vs_y24_max_abs": yv24, "identity_max": ids_err, "d_daily_vs_win_rel": dist,
               "days_priced_without_weather": miss_w, "violations": bad}
    return {"summary": summary, "ok": not any(bad.values()) and not missing and not errors}


def _dist(v):
    v = np.asarray(v, float)
    if not len(v):
        return None
    q = np.percentile(v, [0, 1, 5, 50, 95, 99, 100])
    return {"n": int(len(v)), **{k: float(x) for k, x in zip(("min", "p1", "p5", "p50", "p95", "p99", "max"), q)}}


def _decode_fields(doc, part, fields):
    return {f: S.decode(doc[part][f], doc["scale"][f]) for f in fields}


def check_areas(root: Path, tmp: Path, areas: list, an: dict, ids: list, full: bool = True) -> dict:
    """Recalcula 5 areas desde los archivos de nodo DECODIFICADOS y las compara con el archivo de area decodificado
    (tolerancia: una unidad de escala; vf solo donde pml_avg medio > 50). Con `full`, pml anual ALL vs series_areas."""
    reg, ent = dict(zip(an["ids"], an["region"])), dict(zip(an["ids"], an["entidad"]))
    states = sorted({a["key"] for a in areas if a["kind"] == "state"})[:3]
    regs = sorted({a["key"] for a in areas if a["kind"] == "region"})[:1]
    pick = ["ALL"] + regs + states
    member = {"ALL": lambda n: True}
    for k in pick[1:]:
        kind, name = k.split(":", 1)
        member[k] = (lambda nm: (lambda n: reg[n] == nm))(name) if kind == "region" else \
            (lambda nm: (lambda n: ent[n] == nm))(name)
    nodes = {}
    for n in ids:
        p = tmp / "nodes" / f"{n}.json"
        if p.exists():
            nodes[n] = json.loads(p.read_text())
    out, ok = {}, True
    byfile = {a["key"]: a["file"] for a in areas}
    for k in pick:
        ad = json.loads((tmp / byfile[k]).read_text())
        mem = [nodes[n] for n in nodes if member[k](n)]
        P = [_decode_fields(d, "pml", S.PML_FIELDS) for d in mem]
        pa = np.array([p["pml_avg"] for p in P])
        m = np.isfinite(pa)
        err = {"n_nodos": float(np.nanmax(np.abs(m.sum(0) - S.decode(ad["pml"]["n_nodos"], 1))))}
        for f in S.PML_FIELDS[1:]:
            v = np.array([p[f] for p in P])
            mean = np.where(m.sum(0) > 0, np.nansum(v, 0) / np.maximum(m.sum(0), 1), np.nan)
            err[f] = float(np.nanmax(np.abs(mean - S.decode(ad["pml"][f], ad["scale"][f]))) / ad["scale"][f])
        for c in S.CONFIGS:
            C = [_decode_fields(d, c, S.CFG_FIELDS) for d in mem]
            pc = np.array([x["p_cap_dia"] for x in C])
            mc = m & np.isfinite(pc)
            nn = mc.sum(0)
            mp = np.where(nn > 0, np.where(mc, pa, 0).sum(0) / np.maximum(nn, 1), np.nan)
            mpc = np.where(nn > 0, np.where(mc, pc, 0).sum(0) / np.maximum(nn, 1), np.nan)
            vf_ref = S.decode(ad[c]["vf_dia"], ad["scale"]["vf_dia"])
            sel = mp > 50                                   # tolerancia de cuantizacion del cociente
            tolv = 1e-4 + 0.05 * (1 + np.abs(vf_ref[sel])) / mp[sel]
            err[f"{c}.p_cap_dia"] = float(np.nanmax(np.abs(mpc - S.decode(ad[c]["p_cap_dia"], 0.1)))) / 0.1
            err[f"{c}.vf_dia_tolunits"] = float(np.nanmax(np.abs(mpc[sel] / mp[sel] - vf_ref[sel]) / tolv))
            err[f"{c}.n_nodos"] = float(np.nanmax(np.abs(nn - S.decode(ad[c]["n_nodos"], 1))))
        good = all(v <= 1.0 + 1e-9 for f, v in err.items() if not f.endswith("n_nodos")) and \
            all(v == 0 for f, v in err.items() if f.endswith("n_nodos"))
        ok &= good
        out[k] = {"members": len(mem), "max_err_in_scale_units": err, "ok": good}
    out["series_areas_ALL_yearly_pml"] = _series_areas(root, nodes) if full else "skipped (--limit)"
    if full and isinstance(out["series_areas_ALL_yearly_pml"], dict):
        ok &= out["series_areas_ALL_yearly_pml"]["ok"]
    out["ok"] = bool(ok)
    return out


def _series_areas(root: Path, nodes: dict):
    p = root / "web/data/derived/series_areas.json"
    if not p.exists():
        return "not comparable: web/data/derived/series_areas.json missing"
    ref = json.loads(p.read_text())["areas"]["ALL"]["y"]
    ym = S.month_of_days(next(iter(nodes.values()))["n"])
    acc, err, nerr = {}, 0.0, 0
    for d in nodes.values():
        n = S.decode(d["pml"]["n_horas"], 1)
        pa = S.decode(d["pml"]["pml_avg"], d["scale"]["pml_avg"])
        f = np.isfinite(n)
        t = pd.DataFrame({"ym": ym[f], "n": n[f], "s": (n * pa)[f]}).groupby("ym").sum()
        t["full"] = t["n"] >= [SV.ym_days(int(k)) * 24 for k in t.index]
        for y in range(2020, 2026):
            ty = t[(t.index // 100) == y]
            if len(ty) == 12 and ty["full"].all():
                acc.setdefault(y, []).append(ty["s"].sum() / ty["n"].sum())
    rows = {}
    for y, v in acc.items():
        r = ref[str(y)]
        e = abs(float(np.mean(v)) - r[0])
        err, nerr = max(err, e), nerr + int(len(v) != r[4])
        rows[str(y)] = {"daily": float(np.mean(v)), "published": r[0], "n_daily": len(v), "n_published": r[4]}
    return {"max_abs_mxn": err, "n_mismatch": nerr, "years": rows, "ok": err <= 0.06 and nerr == 0}


def fail_if(rep: dict) -> None:
    bad = {k: v for k, v in rep["summary"]["violations"].items() if v}
    if not rep["ok"] or not rep["e_areas"]["ok"]:
        raise SystemExit(f"puertas fallidas: {bad} areas_ok={rep['e_areas']['ok']} "
                         f"{json.dumps(rep['summary'], default=float)[:3000]}")
