#!/usr/bin/env python
"""Copy the DAILY series (kpis, docs/TECNICO.md §13) into web/data/solar_v2/daily/ (git-ignored) for the frontend.

  # 1) compute + reconcile (kpis; fails without writing if a gate is violated)
  NODAL_DATA_ROOT=$PWD .venv/bin/python pipeline/daily_build.py
  # 2) copy into the web tree
  .venv/bin/python web/tools/build_daily_web.py [--root DIR] [--out DIR] [--dry-run]

Read-only on data/. Writes only under <out> (default <root>/web/data/solar_v2/daily/). Byte-for-byte copy, nothing derived.
Layout under web/data/solar_v2/daily/
  manifest.json             start, n days, ids (analysis_nodos order), fields, scales, null rule, areas index, sizes, gates
  nodes/{id}.json           per node: pml{n_horas,pml_avg,energia_avg,perdidas_avg,congestion_avg,spread},
                            tracker/fijo{y_day,horas_solares,p_cap_dia,vf_dia,ingreso_dia}; value = int x scale[field]
  areas/ALL.json, areas/region-<NAME>.json, areas/state-<NAME>.json   same layout + n_nodos (members with data that day)
  deflator_mensual.json     month -> factor to today's pesos (INPC base 2026-09); multiply MXN values of that month
Day i of every array is start + i days (CDMX calendar day). JSON null = no value that day. The 7-day moving averages
are computed in the browser from these daily values.
"""
import argparse
import gzip
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def plan(root: Path) -> list[tuple[Path, str]]:
    src = root / 'data/solar_v2/daily'
    man = json.loads((src / 'manifest.json').read_text())
    rec = man['reconciliation']
    if not (rec['ok'] and rec['e_areas']['ok']) or any(rec['summary']['violations'].values()):
        raise SystemExit('manifest.json: gates not satisfied; run pipeline/daily_build.py first')
    files = [(src / 'manifest.json', 'manifest.json'), (src / 'deflator_mensual.json', 'deflator_mensual.json')]
    files += [(src / a['file'], a['file']) for a in man['areas']]
    files += [(src / 'nodes' / f'{n}.json', f'nodes/{n}.json') for n in man['ids']]
    return files


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--root', type=Path, default=ROOT, help='checkout holding data/ (default: this repo)')
    ap.add_argument('--out', type=Path, default=None, help='default <root>/web/data/solar_v2/daily')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    out = a.out or a.root / 'web/data/solar_v2/daily'
    tot = totgz = nf = 0
    for src, rel in plan(a.root):
        raw = src.read_bytes()
        tot, totgz, nf = tot + len(raw), totgz + len(gzip.compress(raw, 6)), nf + 1
        if not a.dry_run:
            (out / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, out / rel)
    print(f'{nf} files, {tot} B, {totgz} B gz -> {out}{" (dry run)" if a.dry_run else ""}')


if __name__ == '__main__':
    main()
