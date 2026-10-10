"""Fixtures del validador (independiente). Solo lectura sobre data/.

- `db`: conexión DuckDB EN MEMORIA con data/db/pml.duckdb adjunta READ_ONLY como `db`
  (así las tablas temporales no tocan el archivo y el límite de memoria aplica).
- Las pruebas marcadas `pesado` leen los 151 M de filas o los 8.4 GB de CSV crudos; se omiten
  limpiamente si los datos no están. Para saltarlas a propósito: `-m "not pesado"`.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "data" / "db" / "pml.duckdb"
PARQUET_ROOT = ROOT / "data" / "parquet" / "pml_mda"
RAW_ROOT = ROOT / "data" / "raw" / "cenace"


def pytest_configure(config):
    config.addinivalue_line("markers", "pesado: lee la base completa o los CSV crudos (minutos, GB de RAM)")


@pytest.fixture(scope="session")
def db():
    if not DB_PATH.exists():
        pytest.skip("sin data/db/pml.duckdb")
    import duckdb

    con = duckdb.connect()
    spill = tempfile.mkdtemp(prefix="validador_duckdb_")
    con.execute(f"SET memory_limit='{os.environ.get('VALIDADOR_MEM', '5GB')}'")
    con.execute("SET threads=4; SET preserve_insertion_order=false")
    con.execute(f"SET temp_directory='{spill}'")
    con.execute(f"ATTACH '{DB_PATH}' AS db (READ_ONLY)")
    yield con
    con.close()
