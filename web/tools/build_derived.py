#!/usr/bin/env python
"""Frontend-owned derived series for the explorer (read-only on data/; writes web/data/derived/).

  .venv/bin/python web/tools/build_derived.py

Why: analysis.json carries area VF only for the deck windows. The explorer also shows the last 12 months (monthly) and calendar
years 2020-2025, for ANY node, state or region, and the hourly profiles of every node for the two deck 12-month windows.
Definitions are the ones of analysis.json (tracker; VF of an area = ratio of node averages; universe = analysis_nodos.json ids).
Outputs
  node_profiles.json  per node, windows Y1 (2024-08..2025-07) and Y2 (2025-08..2026-07): hourly PML, losses, congestion, y (tracker)
  series_nodes.json   per node: monthly VF (81 months) and yearly {vf, pcap, pml} nominal + today's pesos for complete years
  series_areas.json   same for ALL, regions and states (ratio of averages over nodes with a complete month / year)
"""
import json, math
from pathlib import Path
import numpy as np, pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'web/data/derived'
OUT.mkdir(parents=True, exist_ok=True)
WIN = {'Y1': (202408, 202507), 'Y2': (202508, 202607)}

nn = json.load(open(ROOT / 'data/analysis/analysis_nodos.json'))
ids = nn['ids']; reg = dict(zip(ids, nn['region'])); ent = dict(zip(ids, nn['entidad']))
idx = json.load(open(ROOT / 'data/index.json'))
node_defl = json.load(open(ROOT / 'web/data/nodes/01AAN-85.json'))['agregados']
months = node_defl['meses']; defl = dict(zip(months, node_defl['deflactor_inpc']))
assert idx['pesos_reales']['base_mes'] == '2026-09' and defl['2026-09'] == 1.0

c = pd.read_parquet(ROOT / 'data/aggregates/agregados_comunes.parquet')
g = pd.read_parquet(ROOT / 'data/aggregates/agregados_config.parquet')
g = g[g.config == 'tracker']
c = c[c.nodo.isin(set(ids))]
m = c.merge(g[['nodo', 'anio', 'mes', 'hora', 'sum_y', 'sum_y_pml']], on=['nodo', 'anio', 'mes', 'hora'], how='inner')
m['ym'] = m.anio * 100 + m.mes
m['ymk'] = m.anio.astype(str) + '-' + m.mes.astype(str).str.zfill(2)
m['f'] = m.ymk.map(defl)
m['sum_pml'] = m.sum_pml_cent / 100.0
m['sum_pml_real'] = m.sum_pml * m.f
m['sum_y_pml_real'] = m.sum_y_pml * m.f

# ---- hourly profiles of the two windows
prof = {}
for w, (a, b) in WIN.items():
    s = m[(m.ym >= a) & (m.ym <= b)].groupby(['nodo', 'hora']).agg(n=('n_horas', 'sum'), pml=('sum_pml', 'sum'), per=('sum_perdidas_cent', 'sum'),
                                                                   cg=('sum_congestion_cent', 'sum'), y=('sum_y', 'sum'), le0=('n_pml_le0', 'sum')).reset_index()
    for nodo, d in s.groupby('nodo'):
        d = d.sort_values('hora')
        if len(d) != 24: continue
        n = d.n.values.astype(float)
        if n.min() <= 0: continue
        prof.setdefault(nodo, {})[w] = [
            [round(float(v), 1) for v in d.pml.values / n], [round(float(v), 2) for v in d.per.values / 100 / n],
            [round(float(v), 2) for v in d.cg.values / 100 / n], [round(float(v), 4) for v in d.y.values / n]]
json.dump({'windows': {k: {'desde': f'{a // 100}-{a % 100:02d}', 'hasta': f'{b // 100}-{b % 100:02d}'} for k, (a, b) in WIN.items()},
           'rows': ['pml', 'perdidas', 'congestion', 'y'], 'nodes': prof}, open(OUT / 'node_profiles.json', 'w'), separators=(',', ':'))

# ---- monthly per node (+ completeness), yearly per node
hrs_in_month = {k: pd.Period(k).days_in_month * 24 for k in months}
mo = m.groupby(['nodo', 'ymk']).agg(n=('n_horas', 'sum'), pml=('sum_pml', 'sum'), pmlr=('sum_pml_real', 'sum'), sy=('sum_y', 'sum'),
                                     syp=('sum_y_pml', 'sum'), sypr=('sum_y_pml_real', 'sum')).reset_index()
mo['full'] = mo.apply(lambda r: r.n >= hrs_in_month[r.ymk], axis=1) if len(mo) < 0 else (mo.n >= mo.ymk.map(hrs_in_month))
mo['base'] = mo.pml / mo.n; mo['cap'] = mo.syp / mo.sy
mo.loc[~mo.full | (mo.sy <= 0), ['base', 'cap']] = np.nan
mo['vf'] = mo.cap / mo.base
mo['year'] = mo.ymk.str[:4].astype(int)
YEARS = list(range(2020, 2026))
mi = {k: i for i, k in enumerate(months)}

def yearly(df, key):
    """df rows per (key, month). complete year = all 12 months full."""
    out = {}
    for (k, y), d in df.groupby([key, 'year']):
        if y not in YEARS: continue
        full = d.full.sum() == 12
        if not full: continue
        n = d.n.sum(); sy = d.sy.sum()
        out.setdefault(k, {})[y] = {'pml': d.pml.sum() / n, 'cap': d.syp.sum() / sy, 'pmlr': d.pmlr.sum() / n, 'capr': d.sypr.sum() / sy}
    return out
ny = yearly(mo, 'nodo')

series_nodes = {}
for nodo, d in mo.groupby('nodo'):
    arr = [None] * len(months)
    for r in d.itertuples():
        if not math.isnan(r.vf): arr[mi[r.ymk]] = round(float(r.vf), 3)
    yr = ny.get(nodo, {})
    series_nodes[nodo] = {'m': arr, 'y': {str(y): [round(v['pml'], 1), round(v['cap'], 1), round(v['pmlr'], 1), round(v['capr'], 1)] for y, v in yr.items()}}
json.dump({'months': months, 'years': YEARS, 'y_cols': ['pml', 'p_cap', 'pml_real', 'p_cap_real'], 'nodes': series_nodes},
          open(OUT / 'series_nodes.json', 'w'), separators=(',', ':'))

# ---- areas: ratio of averages across nodes with a full month / full year
mo['region'] = mo.nodo.map(reg); mo['entidad'] = mo.nodo.map(ent)
def area_series(df, label):
    res = {}
    for key, d in df.groupby(label):
        mv = [None] * len(months); mn = [0] * len(months)
        for ym, e in d[d.full & (d.sy > 0)].groupby('ymk'):
            mv[mi[ym]] = round(float(e.cap.mean() / e.base.mean()), 3); mn[mi[ym]] = int(len(e))
        yv = {}
        for y in YEARS:
            rows = []
            for nodo in d.nodo.unique():
                r = ny.get(nodo, {}).get(y)
                if r: rows.append(r)
            if rows:
                A = lambda k: float(np.mean([r[k] for r in rows]))
                yv[str(y)] = [round(A('pml'), 1), round(A('cap'), 1), round(A('pmlr'), 1), round(A('capr'), 1), len(rows)]
        res[key] = {'m': mv, 'mn': mn, 'y': yv}
    return res
mo['ALL'] = 'ALL'
areas = {'ALL': area_series(mo, 'ALL')['ALL'], 'region': area_series(mo, 'region'), 'state': area_series(mo, 'entidad')}
json.dump({'months': months, 'years': YEARS, 'y_cols': ['pml', 'p_cap', 'pml_real', 'p_cap_real', 'n_nodes'],
           'definition': 'tracker; VF = ratio of node averages (mean captured / mean average price) over nodes whose month (year) is complete; universe = analysis_nodos ids',
           'areas': areas}, open(OUT / 'series_areas.json', 'w'), separators=(',', ':'))
for f in ['node_profiles', 'series_nodes', 'series_areas']:
    print(f, (OUT / f'{f}.json').stat().st_size)
