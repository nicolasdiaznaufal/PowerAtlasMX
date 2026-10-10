import sys, os, json, time
PROJ = os.path.expanduser("~/mnt/REPSA/Analysis/Analysis_PML"); sys.path.insert(0, PROJ); os.chdir(PROJ)
import numpy as np, pandas as pd, pvlib, duckdb
from valor_nodo import cargar_precios, HCOLS, _timestamps, _poa_tracker, _nasa_power
from conexion import crear_vista
W = {"Y1": ("2024-08-01", "2025-07-31"), "Y2": ("2025-08-01", "2026-07-31")}
t0 = time.time()
out = {"nodes": {}, "loc": {}, "energy": {}}
con = crear_vista(duckdb.connect("db/pml.duckdb", read_only=True))
comp = {}
for yk, (a, b) in W.items():
    e = con.execute("select hora, avg(energia) from (select distinct fecha, hora, energia from precios_pml where fecha between ? and ?) group by 1 order by 1", [a, b]).fetchall()
    out["energy"][yk] = [round(v, 1) for _, v in e]
    comp[yk] = con.execute("select nodo, hora, avg(perdidas) l, avg(congestion) c from precios_pml where fecha between ? and ? group by 1,2", [a, b]).df()
con.close()
print("components", round(time.time() - t0), flush=True)
data = {yk: cargar_precios("db/pml.duckdb", a, b) for yk, (a, b) in W.items()}
ubic = data["Y2"][1].dropna(subset=["lat", "lon"]).copy()
ubic["k"] = list(zip(ubic.lat.round(3), ubic.lon.round(3)))
locs = sorted(set(ubic.k))
lid = {k: i for i, k in enumerate(locs)}
prof = {}
import pickle
STAGE = sys.argv[1] if len(sys.argv) > 1 else "all"   # Y1 | Y2 | out
for yk, (a, b) in W.items():
    pk = os.path.expanduser(f"~/deck/prof_{yk}.pkl")
    if os.path.exists(pk):
        prof.update(pickle.load(open(pk, "rb"))); continue
    if STAGE != yk: continue
    dates = pd.date_range(a, b, freq="D"); ts = _timestamps(dates, -6)
    for i, (la, lo) in enumerate(locs):
        loc = pvlib.location.Location(la, lo, tz="UTC")
        prof[(yk, "cs", la, lo)] = (_poa_tracker(loc, ts).values.reshape(len(dates), 24) / 1000).astype("float32")
        if True:
            try:
                s = _nasa_power(la, lo, dates, "salidas/cache_nasa", offline=True).reindex(ts, method="nearest", tolerance=pd.Timedelta(minutes=31))
                arr = (_poa_tracker(loc, ts, ghi=s["ALLSKY_SFC_SW_DWN"], temp=s["T2M"]).values.reshape(len(dates), 24) / 1000).astype("float32")
                arr[np.isnan(arr).any(axis=1)] = np.nan
                prof[(yk, "nasa", la, lo)] = arr
            except Exception as ex:
                print("ERR", la, lo, ex, flush=True)
        if i % 200 == 0: print(yk, i, len(locs), round(time.time() - t0), flush=True)
    pickle.dump({k: v for k, v in prof.items() if k[0] == yk}, open(pk, "wb")); print("saved", yk, flush=True); sys.exit(0)
for (la, lo) in locs:
    L = {}
    for p in ["cs", "nasa"]:
        if ("Y2", p, la, lo) in prof:
            L[p] = [round(float(x), 3) for x in np.nanmean(prof[("Y2", p, la, lo)], 0)]
        if ("Y1", "nasa", la, lo) in prof: L["nasa1"] = [round(float(x), 3) for x in np.nanmean(prof[("Y1", "nasa", la, lo)], 0)]
    out["loc"][lid[(la, lo)]] = L
for yk, (d, _) in data.items():
    start = pd.Timestamp(W[yk][0]); cy = comp[yk].set_index(["nodo", "hora"])
    for nodo, g in d.groupby("nodo"):
        u = ubic[ubic.nodo == nodo]
        if u.empty: continue
        u = u.iloc[0]; la, lo = u.k
        idx = (g["fecha"] - start).dt.days.values; ok = (idx >= 0) & (idx < 365)
        P = g[HCOLS].values.astype(float)[ok]; mon = pd.to_datetime(g["fecha"].values[ok]).month
        n = out["nodes"].setdefault(nodo, {"n": u["nombre"], "r": u["ccr"], "e": u["entidad"], "m": u["municipio"], "l": lid[(la, lo)]})
        rec = {"d": int(ok.sum()), "b": round(P.mean(), 1), "p": [round(x) for x in P.mean(0)],
               "ls": [round(float(cy.loc[(nodo, h), "l"]), 1) if (nodo, h) in cy.index else 0 for h in range(24)],
               "cg": [round(float(cy.loc[(nodo, h), "c"]), 1) if (nodo, h) in cy.index else 0 for h in range(24)],
               "mb": [round(P[mon == m].mean()) if (mon == m).any() else None for m in range(1, 13)],
               "so": round(P[:, 6:18].mean(), 1), "pk": round(P[:, 18:22].mean(), 1)}
        for p in ["cs", "nasa"]:
            key = (yk, p, la, lo)
            if key not in prof: continue
            E = prof[key][idx[ok]]
            v = ~np.isnan(E).any(1)
            Ev, Pv, mv = E[v], P[v], mon[v]
            if Ev.sum() <= 0: continue
            rec[p] = {"c": round(float((Ev * Pv).sum() / Ev.sum()), 1), "z": round(float(100 * (Ev * (Pv <= 0)).sum() / Ev.sum()), 2),
                      "y": round(float(Ev.sum() * 365 / v.sum())), "d": int(v.sum()), "b": round(float(Pv.mean()), 1),
                      "mc": [round(float((Ev[mv == m] * Pv[mv == m]).sum() / Ev[mv == m].sum())) if (mv == m).any() and Ev[mv == m].sum() > 0 else None for m in range(1, 13)]}
            if p == "nasa" and yk == "Y1" and ("Y2", "nasa", la, lo) in prof:
                v2 = ~np.isnan(prof[("Y2", "nasa", la, lo)]).any(1)
                vv = v & v2[idx[ok]]
                if vv.sum() > 0:
                    Ew, Pw = E[vv], P[vv]
                    rec[p]["sw"] = {"c": round(float((Ew * Pw).sum() / Ew.sum()), 1), "b": round(float(Pw.mean()), 1),
                                    "z": round(float(100 * (Ew * (Pw <= 0)).sum() / Ew.sum()), 2),
                                    "y": round(float(Ew.sum() * 365 / vv.sum())), "d": int(vv.sum())}
            if p == "nasa":
                Ec = prof[(yk, "cs", la, lo)][idx[ok]][v]
                rec[p]["cc"] = round(float((Ec * Pv).sum() / Ec.sum()), 1)
        n[yk] = rec
print("nodes", len(out["nodes"]), round(time.time() - t0), flush=True)
json.dump(out, open("salidas/deck_explorer.json", "w"), separators=(",", ":"))
print("done", os.path.getsize("salidas/deck_explorer.json"), round(time.time() - t0), flush=True)
