import datetime as dt
import sys
from pathlib import Path

import duckdb
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import build_duckdb as bd  # noqa: E402


def write_parquet(root: Path, sistema: str, rows: list[tuple]) -> None:
    """rows: (fecha, hora, nodo, pml, energia, perdidas, congestion). Layout igual al de ingest_portal."""
    df = pd.DataFrame(rows, columns=["fecha", "hora", "nodo", "pml", "energia", "perdidas", "congestion"])
    df["fecha"] = pd.to_datetime(df["fecha"]).dt.date
    df["hora"] = df["hora"].astype("int16")
    df.insert(0, "sistema", sistema)
    for (anio, mes), part in df.groupby([pd.to_datetime(df["fecha"]).dt.year, pd.to_datetime(df["fecha"]).dt.month]):
        target = root / f"sistema={sistema}" / f"anio={anio}" / f"mes={mes:02d}" / "part.parquet"
        target.parent.mkdir(parents=True, exist_ok=True)
        part.reset_index(drop=True).to_parquet(target, index=False)


def test_builds_typed_sorted_table_with_same_counts(tmp_path):
    pq = tmp_path / "pml_mda"
    # Dos sistemas con las mismas fechas, horas y nodo: deben quedar separados.
    write_parquet(pq, "SIN", [("2020-01-01", 1, "N2", 10, 9, 0.5, 0.5), ("2020-01-01", 1, "N1", 11, 9, 1, 1)])
    write_parquet(pq, "BCA", [("2020-01-01", 1, "N1", 50, 40, 5, 5), ("2020-02-01", 24, "N1", 60, 50, 5, 5)])
    db = tmp_path / "db" / "pml.duckdb"

    res = bd.build(pq, db)
    assert res["rows"] == res["parquet_rows"] == 4
    assert db.exists() and not (db.parent / "pml.duckdb.tmp").exists()

    con = duckdb.connect(str(db), read_only=True)
    try:
        types = {r[0]: r[1] for r in con.execute("DESCRIBE pml_hourly").fetchall()}
        assert types["fecha"] == "DATE" and types["hora"] == "INTEGER"
        order = con.execute(
            "SELECT sistema, nodo, fecha, hora FROM pml_hourly ORDER BY rowid"
        ).fetchall()
        assert order == sorted(order, key=lambda r: (r[0], r[1], r[2], r[3]))
        assert con.execute("SELECT count(DISTINCT sistema) FROM pml_hourly").fetchone()[0] == 2
        assert con.execute("SELECT min(fecha), max(fecha) FROM pml_hourly").fetchone() == (
            dt.date(2020, 1, 1),
            dt.date(2020, 2, 1),
        )
    finally:
        con.close()


def test_rebuild_is_idempotent_and_atomic(tmp_path):
    pq = tmp_path / "pml_mda"
    write_parquet(pq, "SIN", [("2020-01-01", h, "N1", 10 + h, 9, 0.5, 0.5) for h in range(1, 25)])
    db = tmp_path / "pml.duckdb"
    first = bd.build(pq, db)
    second = bd.build(pq, db)
    assert first["rows"] == second["rows"] == 24
    assert not (tmp_path / "pml.duckdb.tmp").exists()


def test_failed_build_keeps_previous_database(tmp_path):
    pq = tmp_path / "pml_mda"
    write_parquet(pq, "SIN", [("2020-01-01", 1, "N1", 10, 9, 0.5, 0.5)])
    db = tmp_path / "pml.duckdb"
    bd.build(pq, db)
    before = db.read_bytes()

    # Parquet con clave duplicada (misma sistema/fecha/hora/nodo): la validación debe rechazarla.
    bad = tmp_path / "bad"
    write_parquet(bad, "SIN", [("2020-01-01", 1, "N1", 10, 9, 0.5, 0.5), ("2020-01-01", 1, "N1", 99, 9, 0.5, 0.5)])
    with pytest.raises(Exception):
        bd.build(bad, db)
    assert db.read_bytes() == before
    assert not (tmp_path / "pml.duckdb.tmp").exists()


def test_missing_parquet_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        bd.build(tmp_path / "vacio", tmp_path / "x.duckdb")
