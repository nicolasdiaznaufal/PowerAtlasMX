"""
valor_nodo.py — Valor de mercado de un proyecto FV (y FV + batería) en cada nodo del SIN.

Responde: "si pongo 1 MWp solar (y opcionalmente una batería) en este nodo, ¿cuánto vale su
energía en el MDA?" — producción HORARIA x PML HORARIO, no promedios anuales.

Uso (desde la raíz del proyecto, donde está db/pml.duckdb):
    python valor_nodo.py                         # perfil FV de cielo despejado (offline, pvlib)
    python valor_nodo.py --fuente nasa           # irradiancia horaria real de NASA POWER (requiere internet)
    python valor_nodo.py --desde 2025-08-01 --hasta 2026-07-31 --tc 17.84

    python valor_nodo.py --fuente nasa --offline # usar solo lo ya descargado (sin internet)

Salidas:
    salidas/kpis_nodo_<desde>_<hasta>_<fuente>.csv   una fila por nodo con todos los KPIs
    salidas/kpis_nodo.csv                            copia de la última corrida
    db/kpis.duckdb                                   tabla `kpi_nodo` con todas las corridas

Datos de NASA POWER (--fuente nasa):
  * Caché en salidas/cache_nasa/celdas/: un archivo por celda de 1° (la radiación de NASA es la
    misma en toda la celda), con todas las horas descargadas. Antes de usarla se revisa qué horas
    del periodo faltan y solo se descargan esos huecos (~160 celdas para todo el SIN).
  * Horas que NASA aún no publica (-999, p. ej. julio 2026 en oct-2026): el día queda SIN DATO y se
    excluye de los KPIs FV (no se cuenta como día sin sol). Ver columnas `dias_con_produccion` y
    `cobertura_produccion_pct`. Se vuelve a pedir a NASA automáticamente pasados 3 días.

Convenciones IMPORTANTES (verificadas contra los datos, sept-2026):
  * CENACE publica `hora` 1..24 como HORA QUE TERMINA (hora 1 = 00:00-01:00). Este script lee la
    vista `precios_pml` (ver conexion.py), donde hora = hora_CENACE - 1 (0..23, hora de inicio):
    "horario solar 06-18h" = hora 6..17 y "punta 18-22h" = hora 18..21.
  * Todos los nodos del SIN parecen publicarse en hora del centro (UTC-6, sin horario de verano
    desde oct-2022): el valle solar de Sonora aparece ~1.5 h más tarde que el de Occidente.
    Confírmalo con el Manual/Diccionario de datos de CENACE; se controla con --utc-offset.
  * PML en MXN/MWh. Las conversiones a USD usan --tc (Banxico FIX).

Dependencias: duckdb, pandas, numpy, pvlib, pyarrow, requests (solo para --fuente nasa)
"""
import argparse
import os
import time
import json
import numpy as np
import pandas as pd
import duckdb

from conexion import crear_vista  # vista precios_pml con horas corregidas

HCOLS = [f"h{h:02d}" for h in range(0, 24)]   # h00 = 00:00-01:00 ... h23 = 23:00-24:00


# ---------------------------------------------------------------------------
# 1. Precios: matriz diaria nodo x fecha x 24h
# ---------------------------------------------------------------------------
def cargar_precios(db_path, desde, hasta):
    con = crear_vista(duckdb.connect(db_path, read_only=True))
    con.execute("SET memory_limit='2GB'; SET threads=2; SET preserve_insertion_order=false")
    cols = ",".join(f"MAX(pml) FILTER (WHERE hora={h}) AS h{h:02d}" for h in range(0, 24))
    partes = []
    for (a, m) in con.execute(
        "SELECT DISTINCT anio, mes FROM precios_pml WHERE fecha BETWEEN ? AND ? ORDER BY 1, 2",
        [desde, hasta]).fetchall():
        partes.append(con.execute(f"""
            SELECT nodo, fecha, COUNT(*) AS nh, {cols}
            FROM precios_pml WHERE anio={a} AND mes={m} AND fecha BETWEEN ? AND ?
            GROUP BY nodo, fecha""", [desde, hasta]).df())
    ubic = con.execute("""SELECT nodo, nombre, centro_control_regional AS ccr,
                                 entidad_federativa AS entidad, municipio, lat, lon
                          FROM nodos_ubicacion""").df().drop_duplicates("nodo")
    con.close()
    d = pd.concat(partes, ignore_index=True)
    d = d[d["nh"] == 24].copy()                     # solo días completos
    d["fecha"] = pd.to_datetime(d["fecha"])
    return d, ubic


# ---------------------------------------------------------------------------
# 2. Perfil de producción FV por ubicación (kWh por kWp por hora, alineado a hora CENACE)
# ---------------------------------------------------------------------------
def _timestamps(dates, utc_offset):
    # columna i (0..23) = intervalo [i, i+1) en hora local; usamos el punto medio (i + 0.5)
    local = (pd.DatetimeIndex(np.repeat(dates.values, 24))
             + pd.to_timedelta(np.tile(np.arange(24) + 0.5, len(dates)), unit="h"))
    return (local - pd.Timedelta(hours=utc_offset)).tz_localize("UTC")


def _poa_tracker(loc, ts, ghi=None, temp=None):
    """Tracker de 1 eje N-S con backtracking (típico en utility-scale en México).
    Si `ghi` trae NaN (hora sin dato de NASA), la producción de esa hora queda NaN — NO cero."""
    import pvlib
    sp = loc.get_solarposition(ts, method="ephemeris")
    if ghi is None:   # cielo despejado (Ineichen + turbidez climatológica de Linke)
        cs = loc.get_clearsky(ts, model="ineichen", solar_position=sp)
        ghi, dni, dhi = cs["ghi"], cs["dni"], cs["dhi"]
        sin_dato = None
    else:             # GHI medido -> separar en directa/difusa (Erbs)
        sin_dato = ghi.isna()
        ghi = ghi.fillna(0)                      # solo para que pvlib calcule; se vuelve NaN abajo
        sep = pvlib.irradiance.erbs(ghi, sp["zenith"], ts)
        dni, dhi = sep["dni"], sep["dhi"]
    tr = pvlib.tracking.singleaxis(sp["apparent_zenith"], sp["azimuth"], axis_tilt=0,
                                   axis_azimuth=180, max_angle=60, backtrack=True, gcr=0.35)
    poa = pvlib.irradiance.get_total_irradiance(
        tr["surface_tilt"].fillna(0), tr["surface_azimuth"].fillna(180),
        sp["apparent_zenith"], sp["azimuth"], dni, ghi, dhi)["poa_global"].fillna(0).clip(lower=0)
    if temp is not None:  # pérdida térmica simple: -0.35 %/°C sobre 25 °C de celda
        tcell = temp + poa / 800 * 25
        poa = poa * (1 - 0.0035 * (tcell - 25)).fillna(1.0)   # sin temperatura -> sin corrección
    if sin_dato is not None:
        poa = poa.where(~sin_dato)
    return poa


# ---------------------------------------------------------------------------
# NASA POWER: caché por celda de 1° (la radiación solar de NASA viene en una cuadrícula de 1°x1°,
# así que todos los puntos dentro de una celda reciben exactamente la misma serie).
# ---------------------------------------------------------------------------
_REINTENTO_DIAS = 3          # no volver a pedir a NASA un hueco que ya se pidió hace < 3 días
_SIN_RED = {"activo": False}  # si una descarga falla por red, no seguir intentando en esta corrida
_MEM = {}                    # celdas ya leídas en esta corrida


def _celda(lat, lon):
    """Celda de 1° que contiene el punto (verificado: la GHI de NASA es idéntica dentro de cada
    celda floor(lat) x floor(lon) en los 805 archivos descargados en oct-2026)."""
    import math
    return math.floor(lat), math.floor(lon)


def _ruta_celda(cache_dir, la0, lo0):
    return os.path.join(cache_dir, "celdas", f"celda_{la0:+03d}_{lo0:+04d}.json")


def _leer_celda(ruta, la0, lo0):
    if os.path.exists(ruta):
        return json.load(open(ruta))
    return {"celda": [la0, lo0], "consulta": [la0 + 0.5, lo0 + 0.5],
            "GHI": {}, "T2M": {}, "T2M_ubic": {}, "intentos": {}}


def _guardar_celda(ruta, c):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    tmp = ruta + ".tmp"
    json.dump(c, open(tmp, "w"))
    os.replace(tmp, ruta)


def _limpio(v):
    return None if v is None or v == -999 else v


def migrar_cache_por_ubicacion(cache_dir):
    """Convierte los archivos antiguos nasa_<lat>_<lon>.json (uno por ubicación, sin fechas en el
    nombre) a archivos por celda con todas sus horas. Los antiguos se mueven a cache_nasa/legado/
    (no se borran). La temperatura de cada ubicación se conserva en T2M_ubic."""
    import glob
    viejos = sorted(glob.glob(os.path.join(cache_dir, "nasa_*.json")))
    if not viejos:
        return 0
    celdas = {}
    for f in viejos:
        la, lo = map(float, os.path.basename(f)[5:-5].split("_"))
        la0, lo0 = _celda(la, lo)
        ruta = _ruta_celda(cache_dir, la0, lo0)
        c = celdas.get(ruta) or _leer_celda(ruta, la0, lo0)
        d = json.load(open(f))
        for k, v in d["ALLSKY_SFC_SW_DWN"].items():
            if _limpio(v) is not None or k not in c["GHI"]:
                c["GHI"][k] = _limpio(v)
        c["T2M_ubic"][f"{la:.3f}_{lo:.3f}"] = {k: _limpio(v) for k, v in d["T2M"].items()}
        celdas[ruta] = c
    for ruta, c in celdas.items():
        # temperatura de la celda = promedio de las ubicaciones conocidas (para ubicaciones nuevas)
        t = pd.DataFrame(c["T2M_ubic"]).mean(axis=1)
        c["T2M"].update({k: (None if pd.isna(v) else float(v)) for k, v in t.items() if k not in c["T2M"]})
        _guardar_celda(ruta, c)
    leg = os.path.join(cache_dir, "legado")
    os.makedirs(leg, exist_ok=True)
    for f in viejos:
        os.replace(f, os.path.join(leg, os.path.basename(f)))
    print(f"  caché NASA migrada: {len(viejos)} archivos por ubicación -> {len(celdas)} celdas "
          f"(originales en {leg})", flush=True)
    return len(celdas)


def _huecos(c, ini, fin):
    """Rangos de días (ini, fin) dentro de [ini, fin] sin GHI válida en la celda."""
    horas = pd.date_range(ini, fin + pd.Timedelta(hours=23), freq="h")
    falta = np.array([c["GHI"].get(h.strftime("%Y%m%d%H")) is None for h in horas])
    if not falta.any():
        return []
    dias = pd.Series(falta, index=horas).groupby(horas.normalize()).any()
    dias = dias[dias].index
    rangos, a, b = [], dias[0], dias[0]
    for d in dias[1:]:
        if d - b > pd.Timedelta(days=1):
            rangos.append((a, b)); a = d
        b = d
    rangos.append((a, b))
    return rangos


def _descargar(c, ini, fin):
    import requests
    la, lo = c["consulta"]
    for y in range(ini.year, fin.year + 1):
        a, b = max(ini, pd.Timestamp(f"{y}-01-01")), min(fin, pd.Timestamp(f"{y}-12-31"))
        url = ("https://power.larc.nasa.gov/api/temporal/hourly/point"
               f"?parameters=ALLSKY_SFC_SW_DWN,T2M&community=RE&latitude={la}&longitude={lo}"
               f"&start={a:%Y%m%d}&end={b:%Y%m%d}&format=JSON&time-standard=UTC")
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        p = r.json()["properties"]["parameter"]
        for k, v in p["ALLSKY_SFC_SW_DWN"].items():
            if _limpio(v) is not None or k not in c["GHI"]:
                c["GHI"][k] = _limpio(v)
        for k, v in p["T2M"].items():
            if _limpio(v) is not None or k not in c["T2M"]:
                c["T2M"][k] = _limpio(v)
        time.sleep(1)  # cortesía con la API


def _nasa_power(lat, lon, dates, cache_dir, offline=False):
    """GHI (W/m2) y temperatura (°C) horarias de NASA POWER para la ubicación, con caché por celda.

    - Revisa qué horas del periodo faltan en la caché (o vienen como -999 = NASA aún no publica)
      y solo descarga esos huecos. Si NASA sigue sin publicarlos, se reintenta tras 3 días.
    - Devuelve NaN en las horas sin dato (nunca cero): quien llama decide qué hacer con ellas.
    - Marca de tiempo de NASA = INICIO de la hora en UTC (verificado contra el modelo de cielo
      despejado: la mejor correlación es con +30 min). Se devuelve en el punto medio de la hora.
    Firma compatible con la versión anterior (la usa también salidas/deck_explorer.py)."""
    migrar_cache_por_ubicacion(cache_dir)
    la0, lo0 = _celda(lat, lon)
    ruta = _ruta_celda(cache_dir, la0, lo0)
    c = _MEM.get(ruta) or _leer_celda(ruta, la0, lo0)
    _MEM[ruta] = c
    ini, fin = dates.min() - pd.Timedelta(days=1), dates.max() + pd.Timedelta(days=1)
    clave_h = (ruta, ini, fin)
    if clave_h not in _MEM:                     # los huecos son de la celda: se calculan una vez
        _MEM[clave_h] = _huecos(c, ini, fin)
    huecos = _MEM[clave_h]
    if huecos and not offline and not _SIN_RED["activo"]:
        ahora = pd.Timestamp.now()
        cambio = False
        for a, b in huecos:
            clave = f"{a:%Y%m%d}-{b:%Y%m%d}"
            ultimo = c["intentos"].get(clave)
            if ultimo and ahora - pd.Timestamp(ultimo) < pd.Timedelta(days=_REINTENTO_DIAS):
                continue
            try:
                _descargar(c, a, b)
            except Exception as e:  # sin red o NASA caído: seguimos con lo que haya en caché
                print(f"  [!] NASA POWER no disponible ({type(e).__name__}); se usa solo la caché.", flush=True)
                _SIN_RED["activo"] = True
                break
            c["intentos"][clave] = ahora.isoformat(timespec="minutes")
            cambio = True
        if cambio:
            _guardar_celda(ruta, c)
            _MEM[clave_h] = _huecos(c, ini, fin)
    t_ubic = c["T2M_ubic"].get(f"{lat:.3f}_{lon:.3f}", {})
    t = {k: (t_ubic.get(k) if t_ubic.get(k) is not None else v) for k, v in c["T2M"].items()}
    s = pd.DataFrame({"ALLSKY_SFC_SW_DWN": pd.Series(c["GHI"], dtype="float64"),
                      "T2M": pd.Series(t, dtype="float64")})
    s.index = pd.to_datetime(s.index, format="%Y%m%d%H").tz_localize("UTC") + pd.Timedelta(minutes=30)
    return s.sort_index()


def perfiles(ubic, dates, utc_offset, fuente, cache_dir, offline=False):
    """kWh por kWp en cada hora (matriz días x 24) para cada ubicación.
    Con NASA, un día con alguna hora sin dato de radiación queda COMPLETO en NaN, para que los KPIs
    lo excluyan (en vez de contarlo como un día sin sol)."""
    import pvlib
    ts = _timestamps(dates, utc_offset)
    locs = ubic[["lat", "lon"]].dropna().round(3).drop_duplicates()
    prof = {}
    for i, (la, lo) in enumerate(zip(locs["lat"], locs["lon"])):
        loc = pvlib.location.Location(la, lo, tz="UTC")
        if fuente == "nasa":
            s = _nasa_power(la, lo, dates, cache_dir, offline=offline).reindex(
                ts, method="nearest", tolerance=pd.Timedelta(minutes=31))
            poa = _poa_tracker(loc, ts, ghi=s["ALLSKY_SFC_SW_DWN"], temp=s["T2M"])
        else:
            poa = _poa_tracker(loc, ts)
        E = (poa.values.reshape(len(dates), 24) / 1000.0).astype("float32")
        E[np.isnan(E).any(axis=1)] = np.nan
        prof[(la, lo)] = E
        if i % 100 == 0:
            print(f"  perfil {i}/{len(locs)}", flush=True)
    if fuente == "nasa":
        sin = np.mean([np.isnan(E[:, 0]).mean() for E in prof.values()]) * 100
        dias_sin = pd.DatetimeIndex(dates[np.isnan(next(iter(prof.values()))[:, 0])])
        meses = sorted({f"{d:%Y-%m}" for d in dias_sin})
        print(f"  NASA: {sin:.1f} % de los días sin dato de radiación (se excluyen de los KPIs FV)"
              + (f"; meses afectados: {', '.join(meses)}" if meses else ""), flush=True)
    return prof


# ---------------------------------------------------------------------------
# 3. Batería: arbitraje diario con previsión perfecta, 1 ciclo/día, bloques contiguos
# ---------------------------------------------------------------------------
def arbitraje(P, k, eta, carga_desde=None, carga_hasta=None):
    """MXN por MW de carga por día. Carga k horas seguidas (1 MW) y descarga k horas seguidas
    después (eta x energía). carga_desde/hasta = índices 0-based de inicio permitido del bloque
    de carga (p. ej. 8..15 => carga dentro de 08:00-18:00, cuando hay sol)."""
    c = np.concatenate([np.zeros((P.shape[0], 1)), np.cumsum(P, 1)], 1)
    Sk = c[:, k:] - c[:, :-k]                        # suma de k horas desde cada inicio
    ch = Sk.copy()
    if carga_desde is not None:
        mask = np.ones(Sk.shape[1], bool)
        mask[carga_desde:carga_hasta + 1] = False
        ch[:, mask] = np.inf
    mejor = np.zeros(P.shape[0])
    for j in range(k, Sk.shape[1]):
        mejor = np.maximum(mejor, eta * Sk[:, j] - ch[:, :j - k + 1].min(1))
    return mejor


# ---------------------------------------------------------------------------
# 4. KPIs por nodo
# ---------------------------------------------------------------------------
def kpis(d, ubic, prof, dates, tc, eta):
    di = {t: i for i, t in enumerate(dates)}
    filas = []
    for nodo, g in d.groupby("nodo"):
        u = ubic[ubic["nodo"] == nodo]
        if u.empty or pd.isna(u.iloc[0]["lat"]):
            continue
        u = u.iloc[0]
        E_all = prof.get((round(u["lat"], 3), round(u["lon"], 3)))
        if E_all is None:
            continue
        idx = g["fecha"].map(di).values
        P_todo, E_todo = g[HCOLS].values.astype(float), E_all[idx]
        nd = len(g)
        ok = ~np.isnan(E_todo).any(axis=1)        # días con producción conocida (NASA puede no tener)
        n_fv = int(ok.sum())
        P, E = P_todo[ok], E_todo[ok]
        fila = {
            "nodo": nodo, "nombre": u["nombre"], "ccr": u["ccr"], "entidad": u["entidad"],
            "municipio": u["municipio"], "lat": u["lat"], "lon": u["lon"], "dias": nd,
            "dias_con_produccion": n_fv, "cobertura_produccion_pct": 100.0 * n_fv / nd,
            # --- precios: todos los días con precio ---
            "pml_promedio": P_todo.mean(),                        # MXN/MWh, 24h
            "pml_solar_06_18": P_todo[:, 6:18].mean(),            # hora 6..17 = 06:00-18:00
            "pml_punta_18_22": P_todo[:, 18:22].mean(),           # hora 18..21 = 18:00-22:00
            "spread_punta_solar": P_todo[:, 18:22].mean() - P_todo[:, 6:18].mean(),
            # --- baterías: solo dependen del precio ---
            "bess4h_usd_kw_anio": arbitraje(P_todo, 4, eta).sum() * 365.0 / nd / tc / 1000,
            "bess2h_usd_kw_anio": arbitraje(P_todo, 2, eta).sum() * 365.0 / nd / tc / 1000,
            "bess3h_carga_solar_usd_kw_anio": arbitraje(P_todo, 3, eta, 8, 15).sum() * 365.0 / nd / tc / 1000,
        }
        # --- FV: solo los días con producción conocida, y el promedio de PML de ESOS mismos días ---
        if n_fv > 0 and E.sum() > 0:
            base, cap, f = P.mean(), (E * P).sum() / E.sum(), 365.0 / n_fv
            fila.update({
                "pml_promedio_dias_fv": base,
                "precio_captura_fv": cap,                         # MXN/MWh
                "value_factor": cap / base,                       # definición estándar (Hirth)
                "pct_energia_fv_pml_le0": 100 * (E * (P <= 0)).sum() / E.sum(),
                "yield_modelo_kwh_kwp": E.sum() * f,              # anualizado con los días usados
                "ingreso_fv_mxn_por_kwp": (E * P).sum() * f / 1000,
            })
        filas.append(fila)
    return pd.DataFrame(filas)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join("db", "pml.duckdb"))
    ap.add_argument("--desde", default="2025-08-01")
    ap.add_argument("--hasta", default="2026-07-31")
    ap.add_argument("--tc", type=float, default=17.84, help="MXN por USD (Banxico FIX)")
    ap.add_argument("--eta", type=float, default=0.87, help="eficiencia ida y vuelta de la batería")
    ap.add_argument("--utc-offset", type=float, default=-6, help="huso de las horas de CENACE")
    ap.add_argument("--fuente", choices=["cielo_despejado", "nasa"], default="cielo_despejado")
    ap.add_argument("--salida", default="salidas")
    ap.add_argument("--offline", action="store_true",
                    help="no intentar descargar de NASA; usar solo la caché")
    a = ap.parse_args()

    t0 = time.time()
    d, ubic = cargar_precios(a.db, a.desde, a.hasta)
    dates = pd.date_range(d["fecha"].min(), d["fecha"].max(), freq="D")
    print(f"{d['nodo'].nunique():,} nodos, {len(dates)} días ({time.time()-t0:.0f}s)")
    prof = perfiles(ubic[ubic["nodo"].isin(d["nodo"].unique())], dates, a.utc_offset, a.fuente,
                    os.path.join(a.salida, "cache_nasa"), offline=a.offline)
    df = kpis(d, ubic, prof, dates, a.tc, a.eta)
    df["pml_promedio_usd"] = df["pml_promedio"] / a.tc
    df["precio_captura_fv_usd"] = df["precio_captura_fv"] / a.tc
    df["fuente_perfil"], df["periodo"] = a.fuente, f"{a.desde}..{a.hasta}"
    os.makedirs(a.salida, exist_ok=True)
    nombre = f"kpis_nodo_{a.desde}_{a.hasta}_{a.fuente}.csv"     # un archivo por periodo y fuente
    df.to_csv(os.path.join(a.salida, nombre), index=False)
    df.to_csv(os.path.join(a.salida, "kpis_nodo.csv"), index=False)   # copia de la última corrida
    con = duckdb.connect(os.path.join(os.path.dirname(a.db) or ".", "kpis.duckdb"))
    patron = os.path.join(a.salida, "kpis_nodo_*_*_*.csv").replace("\\", "/")
    con.execute(f"CREATE OR REPLACE TABLE kpi_nodo AS SELECT * FROM read_csv_auto('{patron}', union_by_name=true)")
    con.close()
    if a.fuente == "nasa":
        cob = df["cobertura_produccion_pct"]
        print(f"Cobertura de producción NASA: media {cob.mean():.1f} %, mínima {cob.min():.1f} % "
              f"({(cob < 100).sum():,} nodos con días excluidos)")
    print(f"Listo: {len(df):,} nodos -> {a.salida}/{nombre} (+ kpis_nodo.csv) y kpis.duckdb ({time.time()-t0:.0f}s)")


if __name__ == "__main__":
    main()
