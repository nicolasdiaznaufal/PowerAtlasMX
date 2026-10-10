import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import ingest_portal as ip  # noqa: E402

HEADER_COLS = "Fecha,Hora,Clave del nodo,PML,Energía,Pérdidas,Congestión"
SISTEMA_LINES = {
    "SIN": "Sistema Interconectado Nacional",
    "BCA": "Sistema Interconectado Baja California",
    "BCS": "Sistema Interconectado Baja California Sur",
}


def make_csv(
    path: Path,
    rows: list[str],
    meta: str = "Enero de 2021",
    n_meta: int = 6,
    sistema: str | None = "SIN",
) -> Path:
    """CSV con la forma real del portal: 6 líneas de metadata (la 3 es el sistema) + encabezado.

    sistema=None omite la línea de sistema (para probar el fallback por nombre).
    """
    meta_lines = [
        f"Precios Marginales Locales {meta}",
        "Centro Nacional de Control de Energia",
        f'"{SISTEMA_LINES[sistema]}"' if sistema else '"Reporte"',
    ]
    meta_lines += ['"Reporte Mensual"'] * (n_meta - len(meta_lines))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(meta_lines + [HEADER_COLS] + rows) + "\n", encoding="utf-8")
    return path


def read_out(out: Path) -> pd.DataFrame:
    parts = sorted(out.rglob("part.parquet"))
    df = pd.concat([pd.read_parquet(p) for p in parts], ignore_index=True)
    return df.sort_values(ip.KEY).reset_index(drop=True)


def test_fecha_comes_from_column_not_header_or_filename(tmp_path):
    # Cabecera dice enero de 2021 y el nombre dice 2021, pero Fecha es 2022.
    f = make_csv(
        tmp_path / "PreciosMargLocales SIN MDA Ene01 v2021.csv",
        ["2022-01-01,1,NODO-A,100.5,90,5,5.5", "2022-01-02,24,NODO-A,80,75,2,3"],
        meta="Enero de 2021",
    )
    df, rep = ip.parse_cenace_csv(f)
    assert sorted(df["fecha"].astype(str)) == ["2022-01-01", "2022-01-02"]
    assert str(rep.fecha_min) == "2022-01-01" and str(rep.fecha_max) == "2022-01-02"

    out = tmp_path / "out"
    ip.ingest([f], out, verbose=False)
    assert (out / "sistema=SIN" / "anio=2022" / "mes=01" / "part.parquet").exists()
    assert not (out / "sistema=SIN" / "anio=2021").exists()


def test_header_row_found_by_content_not_fixed_line_count(tmp_path):
    f6 = make_csv(tmp_path / "a.csv", ["2020-01-01,1,N1,10,9,0.5,0.5"], n_meta=6)
    f8 = make_csv(tmp_path / "b.csv", ["2020-01-01,1,N2,11,9,1,1"], n_meta=8)
    assert len(ip.parse_cenace_csv(f6)[0]) == 1
    assert len(ip.parse_cenace_csv(f8)[0]) == 1


def test_mixed_quotes_and_date_formats(tmp_path):
    f = make_csv(
        tmp_path / "mix.csv",
        [
            '"2020-03-01","1","N1","1,234.50","1000","200","34.5"',
            "01/03/2021,2,N1,50,45,3,2",
            "2022/03/01,3,N1,60,55,3,2",
        ],
    )
    df, rep = ip.parse_cenace_csv(f)
    assert sorted(df["fecha"].astype(str)) == ["2020-03-01", "2021-03-01", "2022-03-01"]
    assert df.loc[df["fecha"].astype(str) == "2020-03-01", "pml"].iloc[0] == pytest.approx(1234.5)
    assert rep.rows_dropped == 0


def test_incomplete_rows_are_dropped_and_reported(tmp_path):
    f = make_csv(tmp_path / "bad.csv", ["2020-01-01,1,N1,10,9,0.5,0.5", "no-es-fecha,1,N1,10,9,0.5,0.5", "2020-01-01,2,N1,,9,0.5,0.5"])
    df, rep = ip.parse_cenace_csv(f)
    assert len(df) == 1 and rep.rows_dropped == 2


def test_identical_duplicate_file_collapses(tmp_path):
    rows = ["2020-01-01,1,N1,10,9,0.5,0.5", "2020-01-01,2,N1,11,9,1,1"]
    a = make_csv(tmp_path / "carpeta" / "x.csv", rows)
    b = make_csv(tmp_path / "carpeta" / "copia v2026" / "x.csv", rows)
    out = tmp_path / "out"
    run = ip.ingest([tmp_path / "carpeta"], out, verbose=False)
    assert len(read_out(out)) == 2
    assert run.conflicts == 0
    assert a.exists() and b.exists()


def test_different_version_of_same_period_adds_its_own_rows(tmp_path):
    v_a = make_csv(tmp_path / "Ene01.csv", ["2022-01-01,1,N1,10,9,0.5,0.5"], meta="Enero de 2021")
    v_b = make_csv(tmp_path / "Ene01 v2022.csv", ["2022-01-02,1,N1,12,10,1,1"], meta="Enero de 2021")
    out = tmp_path / "out"
    ip.ingest([v_a, v_b], out, verbose=False)
    assert sorted(read_out(out)["fecha"].astype(str)) == ["2022-01-01", "2022-01-02"]


def test_idempotent_and_order_independent(tmp_path):
    f1 = make_csv(tmp_path / "a.csv", ["2020-01-01,1,N1,10,9,0.5,0.5", "2020-02-01,1,N1,20,18,1,1"])
    f2 = make_csv(tmp_path / "b.csv", ["2020-01-01,2,N1,11,9,1,1"])
    out1, out2 = tmp_path / "o1", tmp_path / "o2"
    ip.ingest([f1, f2], out1, verbose=False)
    ip.ingest([f1, f2], out1, verbose=False)  # segunda corrida
    ip.ingest([f2, f1], out2, verbose=False)  # otro orden de entrada
    pd.testing.assert_frame_equal(read_out(out1), read_out(out2))
    assert len(read_out(out1)) == 3


def test_conflicting_values_last_file_wins_and_is_reported(tmp_path):
    a = make_csv(tmp_path / "a.csv", ["2020-01-01,1,N1,10,9,0.5,0.5"])
    b = make_csv(tmp_path / "b.csv", ["2020-01-01,1,N1,99,90,5,4"])
    out = tmp_path / "out"
    run = ip.ingest([a, b], out, verbose=False)
    df = read_out(out)
    assert len(df) == 1 and df["pml"].iloc[0] == 99
    assert run.conflicts == 1


def test_hora_is_kept_as_published(tmp_path):
    f = make_csv(tmp_path / "h.csv", ["2020-01-01,1,N1,10,9,0.5,0.5", "2020-01-01,24,N1,10,9,0.5,0.5"])
    df, _ = ip.parse_cenace_csv(f)
    assert sorted(df["hora"]) == [1, 24]


def test_missing_header_raises(tmp_path):
    f = tmp_path / "SIN_nohdr.csv"
    f.write_text("solo,basura\n1,2\n", encoding="utf-8")
    with pytest.raises(ValueError, match="encabezado"):
        ip.parse_cenace_csv(f)


# --- sistema (SIN / BCA / BCS) ---------------------------------------------

@pytest.mark.parametrize("sistema", ["SIN", "BCA", "BCS"])
def test_sistema_read_from_header_line_3(tmp_path, sistema):
    # El nombre no lleva token de sistema: el valor sale solo de la cabecera.
    f = make_csv(tmp_path / "sin_token.csv", ["2020-01-01,1,N1,10,9,0.5,0.5"], sistema=sistema)
    df, rep = ip.parse_cenace_csv(f)
    assert rep.sistema == sistema
    assert set(df["sistema"]) == {sistema}


def test_sistema_falls_back_to_filename_token(tmp_path):
    f = make_csv(
        tmp_path / "PreciosMargLocales BCA MDA Mes Ene01 v2020 02 03_06 00 07.csv",
        ["2020-01-01,1,N1,10,9,0.5,0.5"],
        sistema=None,
    )
    df, rep = ip.parse_cenace_csv(f)
    assert rep.sistema == "BCA" and set(df["sistema"]) == {"BCA"}


def test_sistema_header_and_filename_disagree_raises(tmp_path):
    f = make_csv(tmp_path / "PreciosMargLocales SIN MDA Mes Ene01.csv", ["2020-01-01,1,N1,10,9,0.5,0.5"], sistema="BCA")
    with pytest.raises(ValueError, match="no coincide"):
        ip.parse_cenace_csv(f)


def test_sistema_unidentified_raises(tmp_path):
    f = make_csv(tmp_path / "reporte.csv", ["2020-01-01,1,N1,10,9,0.5,0.5"], sistema=None)
    with pytest.raises(ValueError, match="no se pudo identificar"):
        ip.parse_cenace_csv(f)


def test_two_systems_same_dates_stay_separate(tmp_path):
    rows_sin = ["2020-01-01,1,N1,10,9,0.5,0.5", "2020-01-01,2,N1,11,9,1,1"]
    rows_bca = ["2020-01-01,1,N1,50,40,5,5"]  # mismas fechas, horas y nodo que SIN
    a = make_csv(tmp_path / "SIN" / "PreciosMargLocales SIN MDA Mes Ene01.csv", rows_sin, sistema="SIN")
    b = make_csv(tmp_path / "BCA" / "PreciosMargLocales BCA MDA Mes Ene01.csv", rows_bca, sistema="BCA")
    out = tmp_path / "out"
    run = ip.ingest([a, b], out, verbose=False)

    assert run.conflicts == 0  # claves distintas: no son conflicto
    assert (out / "sistema=SIN" / "anio=2020" / "mes=01" / "part.parquet").exists()
    assert (out / "sistema=BCA" / "anio=2020" / "mes=01" / "part.parquet").exists()
    df = read_out(out)
    assert len(df) == 3
    assert df.groupby("sistema").size().to_dict() == {"BCA": 1, "SIN": 2}
    assert df.loc[df["sistema"] == "BCA", "pml"].iloc[0] == 50
    assert df.loc[(df["sistema"] == "SIN") & (df["hora"] == 1), "pml"].iloc[0] == 10


def test_unparsed_lines_are_counted_not_silently_skipped(tmp_path):
    # Una comilla sin cerrar hace que el parser pierda la línea y las siguientes:
    # deben contarse como no devueltas, no desaparecer en silencio.
    f = make_csv(
        tmp_path / "comilla.csv",
        [
            "2020-01-01,1,N1,10,9,0.5,0.5",
            '2020-01-01,2,"N1,11,9,1,1',
            "2020-01-01,3,N1,12,9,1,1",
        ],
    )
    df, rep = ip.parse_cenace_csv(f)
    assert sorted(df["hora"]) == [1]
    assert rep.rows_unparsed == 2
    assert rep.rows_dropped == 2
