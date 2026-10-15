#!/usr/bin/env python
"""Copy the solar v2 config x weather-variant files into web/data/solar_v2/ (git-ignored) for the frontend.

  # 1) compute + reconcile (kpis; fails without writing if a gate is violated)
  NODAL_DATA_ROOT=$PWD .venv/bin/python pipeline/kpis_variants_out.py
  # 2) copy into the web tree
  .venv/bin/python web/tools/build_solar_web.py [--root DIR] [--out DIR] [--dry-run]

Read-only on data/. Writes only under <out> (default <root>/web/data/solar_v2/). Nothing is derived here: the numbers
come from data/solar_v2/web/ (kpis) and data/solar_v2/variants/ (solar), copied byte for byte.
Layout under web/data/solar_v2/
  analysis_nodos_tracker.json, analysis_nodos_fijo.json   per node x window, config, Yearly mean (published schema)
  variant_scalars_{tracker,fijo}.json                     core fields per variant x Y1/Y2 (load per config)
  variant_extra/{tracker,fijo}/{variant}.json             remaining fields, load when a variant is selected
  node_profiles_fijo.json                                 hourly profiles, config fijo (node_profiles.json schema)
  variants/{variant}.json                                 solar: y 24 h per window + irradiance (incl. clear)
  scalars.json                                            solar: y_f per window incl. Y1aj/Y2aj + annual equiv
  reconciliation.json                                     gate results, gz sizes, vf_fijo - vf_tracker stats
"""
import argparse
import gzip
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def plan(root: Path) -> list[tuple[Path, str]]:
    kp, sv = root / 'data/solar_v2/web', root / 'data/solar_v2'
    rec = json.loads((kp / 'reconciliation.json').read_text())
    g = rec['gates']
    if not (g.get('n_horas_identico') and g['tracker_json_vs_publicado']['max_rel'] <= 1e-6):
        raise SystemExit('reconciliation.json: gates not satisfied; run pipeline/kpis_variants_out.py first')
    files = [(p, str(p.relative_to(kp))) for p in sorted(kp.rglob('*.json'))]
    files += [(p, f'variants/{p.name}') for p in sorted((sv / 'variants').glob('*.json'))]
    files.append((sv / 'scalars.json', 'scalars.json'))
    return files


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--root', type=Path, default=ROOT, help='checkout holding data/ (default: this repo)')
    ap.add_argument('--out', type=Path, default=None, help='default <root>/web/data/solar_v2')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    out = a.out or a.root / 'web/data/solar_v2'
    tot = totgz = 0
    for src, rel in plan(a.root):
        raw = src.read_bytes()
        gz = len(gzip.compress(raw, 6))
        tot, totgz = tot + len(raw), totgz + gz
        print(f'{rel:45s} {len(raw):>9d} B {gz:>8d} B gz')
        if not a.dry_run:
            (out / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, out / rel)
    print(f'total {tot} B, {totgz} B gz -> {out}{" (dry run)" if a.dry_run else ""}')


if __name__ == '__main__':
    main()
