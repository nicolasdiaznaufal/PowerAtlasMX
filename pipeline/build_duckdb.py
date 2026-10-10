"""
Construye data/db/pml.duckdb a partir del Parquet escrito por ingest_portal.py.

Uso:
    python pipeline/build_duckdb.py [--parquet data/parquet/pml_mda] [--db data/db/pml.duckdb]

Tabla `pml_hourly`:
    sistema (str), fecha (DATE), hora (INTEGER, tal como la publica CENACE: 1..24, y 25 en
    los días de cambio de horario de otoño), nodo (str), pml, energia, perdidas, congestion (DOUBLE).
    Filas ordenadas por sistema, nodo, fecha, hora. No se declara PRIMARY KEY: la unicidad de
    (sistema, fecha, hora, nodo) se verifica con una consulta GROUP BY antes de publicar.

Idempotente: construye en un archivo temporal, valida el conteo contra el Parquet y
solo entonces reemplaza atómicamente el archivo final (os.replace). Si algo falla,
la base anterior no se toca. No aplica convención de reloj (eso es clock.py).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PARQUET = ROOT / "data" / "parquet" / "pml_mda"
DEFAULT_DB = ROOT / "data" / "db" / "pml.duckdb"

TABLE = "pml_hourly"
MEMORY_LIMIT = "10GB"  # máquina de 16 GB; el default de DuckDB (80% de RAM) falló en la carga
SELECT_SQL = """
SELECT
    CAST(sistema AS VARCHAR)   AS sistema,
    CAST(fecha AS DATE)        AS fecha,
    CAST(hora AS INTEGER)      AS hora,
    CAST(nodo AS VARCHAR)      AS nodo,
    CAST(pml AS DOUBLE)        AS pml,
    CAST(energia AS DOUBLE)    AS energia,
    CAST(perdidas AS DOUBLE)   AS perdidas,
    CAST(congestion AS DOUBLE) AS congestion
FROM read_parquet(?, hive_partitioning = false, union_by_name = true)
"""
CREATE_SQL = f"""
CREATE TABLE {TABLE} (
    sistema VARCHAR NOT NULL,
    fecha DATE NOT NULL,
    hora INTEGER NOT NULL,
    nodo VARCHAR NOT NULL,
    pml DOUBLE,
    energia DOUBLE,
    perdidas DOUBLE,
    congestion DOUBLE
)
"""
# La PK no se declara: con 151M filas el índice ART agota la RAM (fallo con 10 GB y con 12 GB
# al confirmar la transacción). La unicidad se valida con DUP_SQL antes de publicar.
DUP_SQL = f"""
SELECT count(*) FROM (
    SELECT 1 FROM {TABLE} GROUP BY sistema, fecha, hora, nodo HAVING count(*) > 1
)
"""


def parquet_glob(parquet_root: Path) -> str:
    files = sorted(parquet_root.rglob("part.parquet"))
    if not files:
        raise FileNotFoundError(f"no hay part.parquet bajo {parquet_root}")
    return str(parquet_root / "**" / "part.parquet")


def build(parquet_root: Path, db_path: Path) -> dict:
    """Devuelve un resumen {'rows': n, 'parquet_rows': n, 'bytes': n}. Lanza error si no cuadra."""
    glob = parquet_glob(parquet_root)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = db_path.with_name(db_path.name + ".tmp")
    for stale in (tmp, Path(str(tmp) + ".wal")):
        if stale.exists():
            stale.unlink()

    spill = db_path.parent / ".duckdb_tmp"  # spill de DuckDB dentro de data/ (git-ignored)
    spill.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(
        str(tmp),
        config={"memory_limit": MEMORY_LIMIT, "temp_directory": str(spill)},
    )
    try:
        con.execute(CREATE_SQL)
        con.execute(
            f"INSERT INTO {TABLE} SELECT * FROM ({SELECT_SQL}) ORDER BY sistema, nodo, fecha, hora",
            [glob],
        )
        rows = con.execute(f"SELECT count(*) FROM {TABLE}").fetchone()[0]
        parquet_rows = con.execute(f"SELECT count(*) FROM ({SELECT_SQL})", [glob]).fetchone()[0]
        if rows != parquet_rows:
            raise RuntimeError(f"conteo no cuadra: duckdb={rows} parquet={parquet_rows}")
        dups = con.execute(DUP_SQL).fetchone()[0]
        if dups:
            raise RuntimeError(f"{dups} claves (sistema, fecha, hora, nodo) duplicadas; no se publica")
        con.execute("CHECKPOINT")
    except Exception:
        con.close()
        for stale in (tmp, Path(str(tmp) + ".wal")):
            if stale.exists():
                stale.unlink()
        raise
    con.close()

    if Path(str(tmp) + ".wal").exists():
        Path(str(tmp) + ".wal").unlink()
    os.replace(tmp, db_path)
    try:
        spill.rmdir()  # solo si quedó vacío
    except OSError:
        pass
    return {"rows": rows, "parquet_rows": parquet_rows, "bytes": db_path.stat().st_size}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parquet", default=str(DEFAULT_PARQUET))
    ap.add_argument("--db", default=str(DEFAULT_DB))
    args = ap.parse_args(argv)
    res = build(Path(args.parquet), Path(args.db))
    print(f"{args.db}: {res['rows']:,} filas (parquet {res['parquet_rows']:,}), {res['bytes'] / 1e9:.2f} GB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
