#!/usr/bin/env python
"""Boundary data + spatial analysis for the PWA (read-only on data/ and docs/; writes under web/).

Usage (from the repo root):
  .venv/bin/python web/tools/boundaries.py [--alt PATH_TO_GEOJSON ...]

Outputs
  web/assets/geo/mx.json            deck geometry in compact form (pre-projected, ints = px*10), states + region outlines
  web/data/derived/geography.json   spatial checks (point in polygon, region/state consistency, missing coordinates)
The deck HTML is treated as DATA: only the `const GEO=` line is parsed.
"""
import json, re, sys, unicodedata, math, collections, argparse
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DECK = ROOT / 'docs/referencia/deck.html'
INDEX = ROOT / 'data/index.json'
OUT_GEO = ROOT / 'web/assets/geo/mx.json'
OUT_DER = ROOT / 'web/data/derived/geography.json'

# Projection recovered from the deck: equirectangular, 40 px per degree of latitude, standard parallel 24 N
# (verified: linear fit of 2,449 node xy against index lat/lon, max residual 0.06 px).
PX_LAT = 40.0
PX_LON = 40.0 * math.cos(math.radians(24.0))
LON0, LAT0 = -118.6, 32.9
def ll2xy(lon, lat): return (lon - LON0) * PX_LON, (LAT0 - lat) * PX_LAT
def xy2ll(x, y): return x / PX_LON + LON0, LAT0 - y / PX_LAT

# CENACE state name -> [deck/GeoJSON name, display name, abbreviation] (deck const STL)
STL = {'AGUASCALIENTES':['Aguascalientes','Aguascalientes','AGS'],'CAMPECHE':['Campeche','Campeche','CAM'],'CHIAPAS':['Chiapas','Chiapas','CHS'],'CHIHUAHUA':['Chihuahua','Chihuahua','CHH'],'CIUDAD DE MEXICO':['Ciudad de México','Ciudad de México','CDMX'],'COAHUILA DE ZARAGOZA':['Coahuila','Coahuila','COA'],'COLIMA':['Colima','Colima','COL'],'DURANGO':['Durango','Durango','DGO'],'GUANAJUATO':['Guanajuato','Guanajuato','GTO'],'GUERRERO':['Guerrero','Guerrero','GRO'],'HIDALGO':['Hidalgo','Hidalgo','HGO'],'JALISCO':['Jalisco','Jalisco','JAL'],'MEXICO':['México','Estado de México','MEX'],'MICHOACAN DE OCAMPO':['Michoacán','Michoacán','MICH'],'MORELOS':['Morelos','Morelos','MOR'],'NAYARIT':['Nayarit','Nayarit','NAY'],'NUEVO LEON':['Nuevo León','Nuevo León','NL'],'OAXACA':['Oaxaca','Oaxaca','OAX'],'PUEBLA':['Puebla','Puebla','PUE'],'QUERETARO':['Querétaro','Querétaro','QRO'],'QUINTANA ROO':['Quintana Roo','Quintana Roo','QROO'],'SAN LUIS POTOSI':['San Luis Potosí','San Luis Potosí','SLP'],'SINALOA':['Sinaloa','Sinaloa','SIN'],'SONORA':['Sonora','Sonora','SON'],'TABASCO':['Tabasco','Tabasco','TAB'],'TAMAULIPAS':['Tamaulipas','Tamaulipas','TAM'],'TLAXCALA':['Tlaxcala','Tlaxcala','TLAX'],'VERACRUZ DE IGNACIO DE LA LLAVE':['Veracruz','Veracruz','VER'],'YUCATAN':['Yucatán','Yucatán','YUC'],'ZACATECAS':['Zacatecas','Zacatecas','ZAC'],
       'BAJA CALIFORNIA':['Baja California','Baja California','BC'],'BAJA CALIFORNIA SUR':['Baja California Sur','Baja California Sur','BCS']}
GEO2E = {v[0]: k for k, v in STL.items()}

def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().upper()
    return re.sub(r'[^A-Z ]', '', s).strip()
ALIAS = {'DISTRITO FEDERAL': 'CIUDAD DE MEXICO', 'MEXICO': 'MEXICO', 'ESTADO DE MEXICO': 'MEXICO', 'COAHUILA': 'COAHUILA DE ZARAGOZA',
         'MICHOACAN': 'MICHOACAN DE OCAMPO', 'VERACRUZ': 'VERACRUZ DE IGNACIO DE LA LLAVE', 'VERACRUZ LLAVE': 'VERACRUZ DE IGNACIO DE LA LLAVE',
         'COAHUILA DE ZARAGOZA': 'COAHUILA DE ZARAGOZA', 'VERACRUZ DE IGNACIO DE LA LLAVE': 'VERACRUZ DE IGNACIO DE LA LLAVE'}
def cenace_key(name):
    n = norm(name)
    if n in ALIAS: return ALIAS[n]
    for k in STL:
        if norm(k) == n or norm(STL[k][0]) == n: return k
    return None

def parse_rings(d):
    rings = []
    for sub in re.split(r'M', d):
        pts = re.findall(r'(-?\d+\.?\d*),(-?\d+\.?\d*)', sub)
        if len(pts) >= 3: rings.append(np.array([[float(a), float(b)] for a, b in pts]))
    return rings

def pip(rings, lon, lat):
    """even-odd ray casting over all rings (handles holes and multipolygons); rings in lon/lat. lon, lat arrays."""
    inside = np.zeros(len(lon), bool)
    for r in rings:
        x0, y0 = r[:, 0], r[:, 1]
        x1, y1 = np.roll(x0, -1), np.roll(y0, -1)
        for a, b, c, d in zip(x0, y0, x1, y1):
            if b == d: continue
            cond = ((b > lat) != (d > lat))
            xi = a + (lat - b) * (c - a) / (d - b)
            inside ^= cond & (lon < xi)
    return inside

def dist_km(rings, lon, lat):
    """min distance (km) from one point to the boundary of the rings (planar approximation)."""
    kx, ky = 111.19 * math.cos(math.radians(lat)), 111.19
    best = 1e9
    for r in rings:
        a = r; b = np.roll(r, -1, axis=0)
        ax, ay = (a[:, 0] - lon) * kx, (a[:, 1] - lat) * ky
        bx, by = (b[:, 0] - lon) * kx, (b[:, 1] - lat) * ky
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        t = np.clip(np.where(L > 0, -(ax * dx + ay * dy) / np.where(L > 0, L, 1), 0), 0, 1)
        px, py = ax + t * dx, ay + t * dy
        best = min(best, float(np.sqrt(px * px + py * py).min()))
    return best

def load_deck():
    for ln in DECK.read_text(encoding='utf8').split('\n'):
        if ln.startswith('const GEO='): return json.loads(ln[len('const GEO='):].rstrip(';'))
    raise SystemExit('const GEO= not found in deck')

def load_alt(path):
    g = json.load(open(path)); out = {}
    for f in g['features']:
        p = f['properties']; name = p.get('name') or p.get('state_name')
        k = cenace_key(name)
        geom = f['geometry']; polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
        rings = [np.array(r)[:, :2] for poly in polys for r in poly]
        out.setdefault(k or name, []).extend(rings)
    return out

def area_km2(rings):
    """signed-sum shoelace over rings on an equal-area-ish local projection (even-odd handled by abs of outer minus holes ~ sum of signed)."""
    tot = 0.0
    for r in rings:
        lat = r[:, 1].mean(); kx, ky = 111.19 * math.cos(math.radians(lat)), 111.19
        x, y = r[:, 0] * kx, r[:, 1] * ky
        tot += 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))
    return abs(tot)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--alt', nargs='*', default=[]); a = ap.parse_args()
    G = load_deck()
    nodes = json.load(open(INDEX))['nodos']
    # ---- deck states in lon/lat
    deck = {}
    for s in G['states']:
        k = GEO2E[s['n']]
        rings = [np.column_stack(xy2ll(r[:, 0], r[:, 1])) for r in parse_rings(s['d'])]
        deck.setdefault(k, {'name': s['n'], 'region': s['c'], 'rings': []})['rings'].extend(rings)
    geoms = {'deck': {k: v['rings'] for k, v in deck.items()}}
    alts = {}
    for p in a.alt:
        nm = Path(p).stem; geoms[nm] = load_alt(p)
    # ---- stats per geometry
    stats = {}
    for gname, gs in geoms.items():
        nv = sum(len(r) for rs in gs.values() for r in rs)
        stats[gname] = {'states': len(gs), 'rings': sum(len(rs) for rs in gs.values()), 'vertices': int(nv)}
    # ---- area ratio of deck vs alts
    area = {gname: {k: area_km2(rs) for k, rs in gs.items()} for gname, gs in geoms.items()}
    # ---- point in polygon
    coords = [n for n in nodes if n.get('lat') is not None and n.get('lon') is not None]
    nocoord = [n for n in nodes if n.get('lat') is None or n.get('lon') is None]
    lon = np.array([n['lon'] for n in coords]); lat = np.array([n['lat'] for n in coords])
    pipres = {}
    for gname, gs in geoms.items():
        inside = {k: pip(rs, lon, lat) for k, rs in gs.items()}
        names = list(inside); M = np.vstack([inside[k] for k in names])  # states x nodes
        which = [[names[i] for i in np.where(M[:, j])[0]] for j in range(len(coords))]
        mism = []
        n_in = n_out = n_none = n_unk = 0
        per_state = collections.defaultdict(lambda: [0, 0])
        for j, n in enumerate(coords):
            decl = n.get('entidad'); dk = cenace_key(decl) if decl and decl != 'No Aplica' else None
            if dk is None: n_unk += 1; continue
            per_state[dk][0] += 1
            if dk in which[j]: n_in += 1; continue
            per_state[dk][1] += 1
            actual = which[j][0] if which[j] else None
            if actual is None: n_none += 1
            else: n_out += 1
            mism.append({'id': n['id'], 'declared': dk, 'municipio': n.get('municipio'), 'in_polygon_of': actual,
                         'dist_to_declared_km': round(dist_km(gs[dk], n['lon'], n['lat']), 1), 'region': n.get('region'), 'sistema': n.get('sistema'),
                         'lat': n['lat'], 'lon': n['lon']})
        mism.sort(key=lambda m: -m['dist_to_declared_km'])
        pipres[gname] = {'checked': len(coords) - n_unk, 'inside_declared': n_in, 'in_other_state': n_out, 'in_no_polygon': n_none,
                         'declared_unknown': n_unk, 'mismatch_n': len(mism), 'mismatch_pct': round(100 * len(mism) / max(1, len(coords) - n_unk), 2),
                         'within_5km': sum(1 for m in mism if m['dist_to_declared_km'] <= 5), 'within_20km': sum(1 for m in mism if m['dist_to_declared_km'] <= 20),
                         'over_20km': sum(1 for m in mism if m['dist_to_declared_km'] > 20),
                         'mismatches': mism if gname == 'deck' else [{'id': m['id'], 'dist_to_declared_km': m['dist_to_declared_km']} for m in mism],
                         'by_state': {k: {'checked': v[0], 'mismatch': v[1]} for k, v in sorted(per_state.items())}}
    # ids mismatching in deck and in every alt (robust mismatches)
    allm = [set(m['id'] for m in pipres[g]['mismatches']) for g in geoms]
    robust = sorted(set.intersection(*allm)) if allm else []
    # ---- region vs state consistency (declared region in the index) + deck state->region mapping
    ct = collections.defaultdict(collections.Counter)
    for n in nodes:
        e = n.get('entidad'); r = n.get('region')
        if e and e != 'No Aplica': ct[cenace_key(e) or e][r or 'null'] += 1
    deck_region = {k: v['region'] for k, v in deck.items()}
    REG_FIX = {'BAJA': 'BAJA CALIFORNIA'}
    span = {}
    n_disagree = 0; n_with_both = 0
    for k, cnt in ct.items():
        tot = sum(cnt.values()); dom, domn = cnt.most_common(1)[0]
        dr = deck_region.get(k)
        dis = sum(v for r, v in cnt.items() if dr and dr != 'BAJA' and r != dr and r not in ('null', 'No Aplica'))
        span[k] = {'n': tot, 'regions': dict(cnt), 'dominant': dom, 'dominant_share': round(domn / tot, 4), 'deck_region': dr, 'nodes_outside_deck_region': dis}
    sin_nodes = [n for n in nodes if n.get('sistema') == 'SIN' and n.get('region') not in (None, 'No Aplica')]
    out_of_deck = sum(v['nodes_outside_deck_region'] for k, v in span.items() if k not in ('BAJA CALIFORNIA', 'BAJA CALIFORNIA SUR'))
    multi = {k: v for k, v in span.items() if len([r for r in v['regions'] if r not in ('null', 'No Aplica')]) > 1}
    no_region = [n['id'] for n in nodes if n.get('region') in (None, 'No Aplica')]
    nocoord_ids = [{'id': n['id'], 'entidad': n.get('entidad'), 'region': n.get('region'), 'sistema': n.get('sistema'), 'has_sheet': bool(n.get('ficha')),
                    'reason': (n.get('motivo_sin_ficha') or '')[:90]} for n in nocoord]
    out = {
        'generated_by': 'web/tools/boundaries.py',
        'projection': {'type': 'equirectangular (plate carree), standard parallel 24 N', 'px_per_deg_lat': PX_LAT, 'px_per_deg_lon': round(PX_LON, 4),
                       'lon0': LON0, 'lat0': LAT0, 'viewbox': G['vb']},
        'geometries': stats,
        'area_km2': {g: {k: round(v) for k, v in d.items()} for g, d in area.items()},
        'point_in_polygon': pipres, 'mismatch_in_every_geometry': robust,
        'nodes_total': len(nodes), 'nodes_with_coordinates': len(coords), 'nodes_without_coordinates': nocoord_ids,
        'coord_precision': dict(collections.Counter(n.get('coord_precision') for n in nodes)),
        'state_region_table': span, 'states_spanning_regions': {k: v for k, v in multi.items()},
        'sin_nodes_outside_deck_state_region': out_of_deck, 'sin_nodes_total': len(sin_nodes),
        'nodes_without_region': len(no_region),
    }
    OUT_DER.parent.mkdir(parents=True, exist_ok=True)
    json.dump(out, open(OUT_DER, 'w'), ensure_ascii=False, separators=(',', ':'))
    # ---- compact geometry asset (ints = px*10, delta coded per ring)
    def enc(ring):
        pts = [(round(x * 10), round(y * 10)) for x, y in ring]
        flat = []; px = py = 0
        for x, y in pts: flat += [x - px, y - py]; px, py = x, y
        return flat
    states = []
    for s in G['states']:
        k = GEO2E[s['n']]
        states.append({'k': k, 'n': STL[k][1], 'ab': STL[k][2], 'c': s['c'], 'r': [enc(r) for r in parse_rings(s['d'])]})
    regions = {c: [enc(r) for r in parse_rings(d)] for c, d in G['regions'].items()}
    asset = {'vb': G['vb'], 'scale': 10, 'states': states, 'regions': regions, 'labels': G['labels'],
             'proj': {'x0': 0, 'sx': round(PX_LON, 6), 'lon0': LON0, 'sy': PX_LAT, 'lat0': LAT0}}
    OUT_GEO.parent.mkdir(parents=True, exist_ok=True)
    json.dump(asset, open(OUT_GEO, 'w'), ensure_ascii=False, separators=(',', ':'))
    print('geometries', json.dumps(stats))
    for g, r in pipres.items():
        print(g, {k: v for k, v in r.items() if k not in ('mismatches', 'by_state')})
    print('robust mismatches', len(robust), robust[:20])
    print('no coords', len(nocoord_ids), 'states spanning regions', list(multi))
    print('sin nodes outside deck state->region', out_of_deck, 'of', len(sin_nodes))
    print('wrote', OUT_DER.stat().st_size, OUT_GEO.stat().st_size)

if __name__ == '__main__':
    main()
