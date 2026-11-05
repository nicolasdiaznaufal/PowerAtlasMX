"""Access layer from the INEGI Red Nacional de Caminos 2025 (rnc2025.gpkg): distance to heavy-vehicle roads + route checks.

Heavy-vehicle road = in operation, (paved Asfalto/Concreto, or an avenue-class road: urban avenues carry no coating value), width >= min_width_m, not calle/andador/cerrada/privada [estimated, config].
The filtered lines are densified to points every ~200 m and cached (data/cache/roads_pts.npz, not in git) for a KD-tree.
Bridges and structures (no load capacity in the data) are only listed by route_checks(), never scored.
Run: .venv/bin/python pipeline/roads_layer.py   (builds the cache, prints a summary)
"""
import re
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
GPKG = ROOT / "data/ref/geo/roads/conjunto_de_datos/rnc2025.gpkg"
CACHE = ROOT / "data/cache/roads_pts.npz"
STEP_M = 200.0
NUM = re.compile(r"-?\d+\.\d+")
MAJOR = ("Avenida", "Boulevard", "Periférico", "Eje vial", "Viaducto", "Calzada", "Circunvalación", "Diagonal", "Prolongación", "Circuito", "Enlace")
BAD_TYPES = ("Calle", "Andador", "Cerrada", "Privada", "Retorno U", "Callejón", "Peatonal")


def km_xy(lat, lon):
    """equirectangular km coordinates (error under 0.5 % inside Mexico for distances of a few tens of km)."""
    lat, lon = np.asarray(lat, float), np.asarray(lon, float)
    return np.column_stack([lat * 110.574, lon * 111.320 * np.cos(np.radians(lat))])


def densify(coords, step_km=STEP_M / 1000):
    pts = np.array(coords).reshape(-1, 2)            # lon, lat pairs
    out = [pts[0]]
    for a, b in zip(pts[:-1], pts[1:]):
        n = int(max(1, np.ceil(np.hypot((b[0] - a[0]) * 111.32 * np.cos(np.radians(a[1])), (b[1] - a[1]) * 110.574) / step_km)))
        out.extend(a + (b - a) * (k / n) for k in range(1, n + 1))
    return np.array(out)


def build(cfg=None):
    import duckdb
    cfg = cfg or {"min_width_m": 6}
    c = duckdb.connect()
    c.execute("INSTALL spatial; LOAD spatial;")
    bad = ",".join("'" + t + "'" for t in BAD_TYPES)
    maj = ",".join("'" + t + "'" for t in MAJOR)
    rows = c.execute(f"select ST_AsText(geom), ADMINISTRA from st_read('{GPKG}', layer='red_vial') where CONDICION='En operación' "
                     f"and (RECUBRI in ('Asfalto','Concreto') or TIPO_VIAL in ({maj})) and ANCHO >= {cfg['min_width_m']} and TIPO_VIAL not in ({bad})").fetchall()
    lat, lon, hw = [], [], []
    for wkt, adm in rows:
        v = np.array(NUM.findall(wkt), float)
        if len(v) < 4:
            continue
        d = densify(v)
        lon.extend(d[:, 0]); lat.extend(d[:, 1]); hw.extend([adm in ("Federal", "Estatal")] * len(d))
    br = c.execute(f"select 'puente', TIPO, MATERIAL, NULL, NULL, NOMBRE, ST_Y(geom), ST_X(geom) from st_read('{GPKG}', layer='puente') union all "
                   f"select 'estructura', TIPO, NULL, ALTURA, ANCHO, NOMBRE, ST_Y(geom), ST_X(geom) from st_read('{GPKG}', layer='estructura')").fetchall()
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(CACHE, lat=np.array(lat, np.float32), lon=np.array(lon, np.float32), hw=np.array(hw, bool), br=np.array(br, dtype=object))
    return len(rows), len(lat), len(br)


class RoadIndex:
    def __init__(self):
        z = np.load(CACHE, allow_pickle=True)
        self.xy = km_xy(z["lat"], z["lon"])
        self.tree, self.hw = cKDTree(self.xy), z["hw"]
        self.tree_hw = cKDTree(self.xy[self.hw])
        self.br = z["br"]
        self._brtree = cKDTree(km_xy(np.array([b[6] for b in self.br], float), np.array([b[7] for b in self.br], float)))

    def dist_km(self, lat, lon):
        p = km_xy(lat, lon)
        return self.tree.query(p)[0], self.tree_hw.query(p)[0]

    def route_checks(self, lat, lon, radius_km=1.0):
        """bridges and structures within radius_km of the point, with the attributes the data has (height/width as text)."""
        idx = self._brtree.query_ball_point(km_xy([lat], [lon])[0], radius_km)
        keys = ("kind", "tipo", "material", "altura", "ancho", "nombre", "lat", "lon")
        return [dict(zip(keys, self.br[i])) for i in idx]


if __name__ == "__main__":
    print("segments, points, bridges+structures:", build())
