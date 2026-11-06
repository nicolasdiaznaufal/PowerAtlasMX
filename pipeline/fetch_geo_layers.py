"""Inventario y descarga de capas geoespaciales para el scoring BESS (sitio).

Uso (desde la raíz del repo, con internet):
    python pipeline/fetch_geo_layers.py --check            # qué capas hay y cuáles faltan (solo lectura)
    python pipeline/fetch_geo_layers.py --fetch            # baja las capas automáticas que falten
    python pipeline/fetch_geo_layers.py --fetch --only arq_osm,temp_worldclim

Estados:
  have   ya está en data/ref (no se toca)
  auto   el script intenta descargarla (las URL marcadas "sin verificar" pueden haber cambiado: si
         falla, el script imprime la página de descarga para bajarla a mano)
  manual descarga a mano desde la página indicada y copia los archivos a la carpeta esperada

Todo se guarda en data/ref/ (gitignored). Detalle de uso en el scoring: docs/referencia/capas_geo_bess.md
Solo biblioteca estándar.
"""
import argparse
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "data/ref"
UA = {"User-Agent": "bess-geo-fetch/1.0 (estudio de viabilidad; uso interno)"}

# key: (estado, rol en el score, rutas esperadas relativas a data/ref, fuente / página)
LAYERS = {
    # ---- ya en el repo ----
    "anp": ("have", "puerta/penalización", ["geo/protected/shp_anp_20260924/shp_anp_20260924.shp"], "CONANP"),
    "relieve": ("have", "puerta (pendiente)", ["geo/dem/conjunto_de_datos/modelo_relieve_mexico_2025.tif"], "INEGI"),
    "uso_suelo": ("have", "puerta (cobertura)", ["geo/landcover/serie7_cdv/cdv_usuev250sVII_cnal.shp"], "INEGI Serie VII"),
    "caminos_rnc": ("have", "acceso (SIN CONECTAR AL SCORE)", ["geo/roads/conjunto_de_datos/rnc2025.gpkg"], "INEGI RNC 2025"),
    "red_osm": ("have", "interconexión", ["geo/grid/atlas-sen/data/derived/osm_lines.json",
                                          "geo/grid/atlas-sen/data/derived/osm_substations.json"], "OSM vía atlas-sen"),
    "subestaciones_batu": ("have", "interconexión/saturación", ["batu_open/subestaciones.csv"], "batu_open"),
    # ---- automáticas ----
    "arq_inah_csv": ("auto", "alerta arqueológica (sin coordenadas)", ["geo/arqueologia/INAH_zonas_arqueologicas.csv"],
                     "https://datos.inah.gob.mx/sites/default/files/conjuntos/datos/INAH_zonas_arqueologicas.csv (verificada)"),
    "arq_osm": ("auto", "alerta arqueológica (puntos)", ["geo/arqueologia/osm_archaeological_sites.geojson"],
                "OpenStreetMap vía Overpass, historic=archaeological_site (ODbL)"),
    "temp_worldclim": ("auto", "temperatura (derating / HVAC)", ["geo/clima/wc2.1_2.5m_bio/wc2.1_2.5m_bio_5.tif"],
                       "https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_2.5m_bio.zip (patrón WorldClim 2.1, sin verificar)"),
    "indigena_iter": ("auto", "riesgo social: % población indígena por localidad", ["geo/indigena/iter_00_cpv2020/"],
                      "https://www.inegi.org.mx/contenidos/programas/ccpv/2020/datosabiertos/iter/iter_00_cpv2020_csv.zip (sin verificar)"),
    # ---- manuales ----
    "hidro_inegi": ("manual", "puerta (cauces, cuerpos de agua) + buffer", ["geo/hidrografia/"],
                    "INEGI > Hidrografía > Red hidrográfica 1:50 000 (descargar por subcuenca/nacional) o SIATL: https://antares.inegi.org.mx/analisis/red_hidro/siatl/"),
    "marco_geoestadistico": ("manual", "retiro a poblados (seguridad contra incendio)", ["geo/marco/"],
                             "INEGI > Marco Geoestadístico (localidades urbanas y rurales amanzanadas, edición vigente)"),
    "edafologia": ("manual", "suelo: tipo, profundidad, fase física (pedregosidad, salinidad)", ["geo/suelo/"],
                   "INEGI > Edafología, vectorial 1:250 000 (Serie II o III, continuo nacional)"),
    "indigena_inpi": ("manual", "riesgo social: regiones/municipios indígenas", ["geo/indigena/inpi/"],
                      "INPI (gob.mx/inpi) > regiones indígenas / localidades de población indígena"),
    "nucleos_agrarios": ("manual", "tenencia de la tierra (ejido/comunidad)", ["geo/tenencia/"],
                         "RAN/PHINA (núcleos agrarios, polígonos) o capas por estado en IDEGEO CentroGeo (ran_nucleosagrarios_*)"),
    "conservacion_extra": ("manual", "puerta/penalización: ADVC, Ramsar, RTP", ["geo/conservacion/"],
                           "CONANP (ADVC, Ramsar) y CONABIO (RTP, AICA, sitios prioritarios)"),
    "peligros": ("manual", "riesgo físico: inundación, sismo, laderas, ciclones", ["geo/peligros/"],
                 "CENAPRED > Atlas Nacional de Riesgos (capas de peligro) y SGM (fallas)"),
}


def present(paths):
    out = []
    for p in paths:
        f = REF / p
        out.append(f.exists() and (f.is_file() or any(f.iterdir())))
    return all(out)


def get(url, dest, tries=3):
    dest.parent.mkdir(parents=True, exist_ok=True)
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as fh:
                while chunk := r.read(1 << 20):
                    fh.write(chunk)
            return True
        except Exception as e:  # noqa: BLE001
            print(f"   intento {i + 1}/{tries} falló: {e}")
            time.sleep(3 * (i + 1))
    return False


def f_arq_inah_csv():
    url = "https://datos.inah.gob.mx/sites/default/files/conjuntos/datos/INAH_zonas_arqueologicas.csv"
    return get(url, REF / "geo/arqueologia/INAH_zonas_arqueologicas.csv")


def f_arq_osm():
    q = ('[out:json][timeout:300];area["ISO3166-1"="MX"][admin_level=2]->.a;'
         '(nwr["historic"="archaeological_site"](area.a););out center tags;')
    for host in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
        try:
            req = urllib.request.Request(host, data=("data=" + urllib.parse.quote(q)).encode(), headers=UA)
            with urllib.request.urlopen(req, timeout=400) as r:
                els = json.load(r)["elements"]
            break
        except Exception as e:  # noqa: BLE001
            print(f"   {host} falló: {e}")
    else:
        return False
    feats = []
    for e in els:
        lat, lon = (e.get("lat"), e.get("lon")) if e["type"] == "node" else (e.get("center", {}).get("lat"), e.get("center", {}).get("lon"))
        if lat is None:
            continue
        t = e.get("tags", {})
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                      "properties": {"osm": f"{e['type']}/{e['id']}", "name": t.get("name"), "site_type": t.get("site_type"),
                                     "wikidata": t.get("wikidata")}})
    out = REF / "geo/arqueologia/osm_archaeological_sites.geojson"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"type": "FeatureCollection", "attribution": "© OpenStreetMap contributors (ODbL)",
                               "features": feats}, ensure_ascii=False))
    print(f"   {len(feats)} sitios guardados")
    return len(feats) > 0


def _zip(url, folder):
    z = REF / "geo" / (folder + ".zip")
    if not get(url, z):
        return False
    with zipfile.ZipFile(z) as zf:
        zf.extractall(REF / "geo" / folder)
    return True


def f_temp_worldclim():
    # bio_1 = T media anual, bio_5 = T máx del mes más cálido, bio_6 = T mín del mes más frío (°C, 2.5 min ≈ 4.5 km)
    return _zip("https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_2.5m_bio.zip", "clima/wc2.1_2.5m_bio")


def f_indigena_iter():
    ok = _zip("https://www.inegi.org.mx/contenidos/programas/ccpv/2020/datosabiertos/iter/iter_00_cpv2020_csv.zip",
              "indigena/iter_00_cpv2020")
    return ok


FETCH = {"arq_inah_csv": f_arq_inah_csv, "arq_osm": f_arq_osm, "temp_worldclim": f_temp_worldclim, "indigena_iter": f_indigena_iter}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    only = {k for k in a.only.split(",") if k}
    if not (a.check or a.fetch):
        a.check = True
    if a.fetch:
        for k, fn in FETCH.items():
            if only and k not in only:
                continue
            if present(LAYERS[k][2]):
                print(f"[{k}] ya existe, se omite")
                continue
            print(f"[{k}] descargando…")
            print("   OK" if fn() else f"   FALLÓ -> descarga a mano: {LAYERS[k][3]}")
    print(f"\n{'capa':22} {'estado':7} {'en disco':9} rol en el score")
    for k, (st, role, paths, src) in LAYERS.items():
        print(f"{k:22} {st:7} {'sí' if present(paths) else 'FALTA':9} {role}")
        if not present(paths) and st == "manual":
            print(f"{'':22} -> {src}\n{'':22} -> copiar a data/ref/{paths[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
