"""
Ingesta del histórico del portal CENACE (PML MDA) hacia Parquet.

Uso:
    python pipeline/ingest_portal.py RUTA [RUTA ...] [--out data/parquet/pml_mda]

RUTA puede ser un CSV o una carpeta (se buscan *.csv de forma recursiva, p. ej.
las carpetas por año 2020-2023 y los archivos sueltos de 2024+).

Reglas (workflow §2):
- La fecha sale SIEMPRE de la columna `Fecha`. Nunca del nombre del archivo ni de
  las líneas de cabecera: algunas cabeceras mienten (p. ej. `Ene01 v2022` dice
  "enero de 2021" pero contiene 2022-01-01 a 15).
- El sistema (SIN, BCA, BCS) sale de la línea 3 de la cabecera ("Sistema
  Interconectado Nacional" / "Baja California" / "Baja California Sur"); si no
  aparece, del token SIN/BCA/BCS del nombre del archivo. Si no identifica nada, o
  si cabecera y nombre discrepan, se lanza error (nunca se adivina).
- `hora` se guarda tal como la publica CENACE: 1..24, y 25 en los días de cambio
  de horario de otoño (hora que TERMINA). La convención de reloj la resuelve
  `clock.py`, no este módulo.
- Líneas que el parser no devuelve (p. ej. comilla sin cerrar) se cuentan en
  `rows_unparsed`; las filas incompletas se cuentan en `rows_dropped`, que
  incluye también las no devueltas. Nada se descarta en silencio.
- Idempotente: la clave es (sistema, fecha, hora, nodo). Correr dos veces, o en
  otro orden de archivos, deja el mismo Parquet.
- Dedupe por contenido, no por nombre de archivo: las copias idénticas colapsan
  y las versiones distintas de un periodo aportan sus filas propias.
- Si una misma clave llega con valores distintos, gana el archivo que va último
  en orden alfabético de ruta y se avisa (nunca en silencio).
- Memoria: se procesa archivo por archivo y cada partición se fusiona en disco;
  nunca se concatenan todos los archivos en memoria.

Salida: data/parquet/pml_mda/sistema=SIN/anio=YYYY/mes=MM/part.parquet (ignorado por git).
Columnas: sistema (str), fecha (date), hora (int, 1..25 tal como se publica), nodo, pml,
energia, perdidas, congestion.
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "parquet" / "pml_mda"

RAW_COLUMNS = ["fecha", "hora", "nodo", "pml", "energia", "perdidas", "congestion"]
COLUMNS = ["sistema"] + RAW_COLUMNS
KEY = ["sistema", "fecha", "hora", "nodo"]
VALUE_COLS = ["pml", "energia", "perdidas", "congestion"]
DATE_FORMATS = ["%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"]
ENCODINGS = ["utf-8-sig", "latin-1"]

# Cabecera (línea 3) normalizada -> sistema. "baja california sur" va antes que "baja california".
HEADER_SISTEMA = [
    ("sistema interconectado nacional", "SIN"),
    ("sistema interconectado baja california sur", "BCS"),
    ("sistema interconectado baja california", "BCA"),
]
FILENAME_SISTEMA = re.compile(r"(?<![A-Za-z])(SIN|BCA|BCS)(?![A-Za-z])")


@dataclass
class FileReport:
    path: str
    sistema: str = ""
    rows_read: int = 0
    rows_unparsed: int = 0  # líneas no vacías que el parser no devolvió (on_bad_lines=skip)
    rows_dropped: int = 0  # total descartado: no devueltas + incompletas
    fecha_min: object = None
    fecha_max: object = None


@dataclass
class RunReport:
    files: list[FileReport] = field(default_factory=list)
    conflicts: int = 0
    partitions_written: int = 0


def _norm(cell: str) -> str:
    """Minúsculas, sin comillas, espacios ni acentos."""
    text = unicodedata.normalize("NFKD", cell.strip().strip('"').strip("'"))
    return "".join(c for c in text if not unicodedata.combining(c)).strip().lower()


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ENCODINGS:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def sistema_from_header(lines: list[str]) -> str | None:
    """Sistema según la línea de metadata 'Sistema Interconectado ...' (primeras 6 líneas)."""
    for line in lines[:6]:
        norm = _norm(line)
        for prefix, sistema in HEADER_SISTEMA:
            if norm.startswith(prefix):
                return sistema
    return None


def sistema_from_filename(name: str) -> str | None:
    """Sistema según el token SIN/BCA/BCS del nombre del archivo (None si no hay o son varios)."""
    tokens = set(FILENAME_SISTEMA.findall(name))
    return tokens.pop() if len(tokens) == 1 else None


def resolve_sistema(path: Path, lines: list[str]) -> str:
    """Cabecera y nombre deben coincidir cuando ambos identifican el sistema."""
    from_header = sistema_from_header(lines)
    from_name = sistema_from_filename(path.name)
    if from_header is None and from_name is None:
        raise ValueError(f"{path.name}: no se pudo identificar el sistema (ni cabecera ni nombre)")
    if from_header and from_name and from_header != from_name:
        raise ValueError(
            f"{path.name}: el sistema de la cabecera ({from_header}) no coincide con el del nombre ({from_name})"
        )
    return from_header or from_name


def _parse_fecha(s: pd.Series) -> pd.Series:
    s = s.astype("string").str.strip().str.strip('"').str.strip()
    out = pd.Series(pd.NaT, index=s.index, dtype="datetime64[ns]")
    pending = pd.Series(True, index=s.index)
    for fmt in DATE_FORMATS:
        if not pending.any():
            break
        parsed = pd.to_datetime(s[pending], format=fmt, errors="coerce")
        out[pending] = parsed
        pending = out.isna() & s.notna()
    return out


def _to_number(s: pd.Series) -> pd.Series:
    s = s.astype("string").str.strip().str.strip('"').str.replace(",", "", regex=False)
    return pd.to_numeric(s, errors="coerce")


def parse_cenace_csv(path: str | Path) -> tuple[pd.DataFrame, FileReport]:
    """Lee un CSV del portal y devuelve un DataFrame limpio (COLUMNS) + reporte.

    El encabezado se localiza por contenido (primera línea cuya primera celda es
    `Fecha`), no por un número fijo de líneas de metadata.
    """
    path = Path(path)
    report = FileReport(path=str(path))
    lines = _read_text(path).splitlines()
    sistema = resolve_sistema(path, lines)
    report.sistema = sistema

    header_idx = next(
        (i for i, line in enumerate(lines) if _norm(line.split(",")[0]) == "fecha"),
        None,
    )
    if header_idx is None:
        raise ValueError(f"{path.name}: no se encontró la fila de encabezado 'Fecha'")

    raw = pd.read_csv(
        io.StringIO("\n".join(lines[header_idx + 1 :])),
        header=None,
        names=RAW_COLUMNS,
        usecols=range(len(RAW_COLUMNS)),
        dtype=str,
        engine="python",
        on_bad_lines="skip",
        skipinitialspace=True,
    )
    # on_bad_lines="skip" descarta en silencio: contamos las líneas no vacías que no volvieron.
    n_lines = sum(1 for line in lines[header_idx + 1 :] if line.strip())
    report.rows_read = len(raw)
    report.rows_unparsed = n_lines - len(raw)

    df = pd.DataFrame(
        {
            "fecha": _parse_fecha(raw["fecha"]),
            "hora": _to_number(raw["hora"]),
            "nodo": raw["nodo"].astype("string").str.strip().str.strip('"').str.strip(),
            **{c: _to_number(raw[c]) for c in VALUE_COLS},
        }
    )
    before = len(df)
    df = df.dropna(subset=["fecha", "hora", "nodo", "pml"])
    df = df[df["nodo"] != ""]
    report.rows_dropped = report.rows_unparsed + (before - len(df))

    df["fecha"] = df["fecha"].dt.date
    df["hora"] = df["hora"].astype("int16")
    df["nodo"] = df["nodo"].astype(str)
    df.insert(0, "sistema", sistema)
    df = df.reset_index(drop=True)

    if len(df):
        report.fecha_min, report.fecha_max = df["fecha"].min(), df["fecha"].max()
    return df, report


def _merge(old: pd.DataFrame, new: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Une `old` y `new`; ante clave repetida gana `new`. Devuelve (df, conflictos)."""
    both = pd.concat([old, new], ignore_index=True)
    both = both.drop_duplicates(keep="last")  # copias idénticas: dedupe por contenido
    dup_keys = both.duplicated(subset=KEY, keep=False)
    conflicts = int(both[dup_keys].duplicated(subset=KEY, keep="last").sum())
    both = both.drop_duplicates(subset=KEY, keep="last")
    return both.sort_values(KEY).reset_index(drop=True), conflicts


def partition_path(out: Path, sistema: str, anio: int, mes: int) -> Path:
    return out / f"sistema={sistema}" / f"anio={anio}" / f"mes={mes:02d}" / "part.parquet"


def _write_partitions(df: pd.DataFrame, out: Path) -> tuple[int, int]:
    """Fusiona `df` en las particiones sistema/anio/mes de `out`. Devuelve (escritas, conflictos)."""
    fechas = pd.to_datetime(df["fecha"])
    written = conflicts = 0
    for (sistema, anio, mes), part in df.groupby(["sistema", fechas.dt.year, fechas.dt.month]):
        target = partition_path(out, sistema, int(anio), int(mes))
        if target.exists():
            old = pd.read_parquet(target)
            old["hora"] = old["hora"].astype("int16")
            merged, n_conf = _merge(old, part)
            conflicts += n_conf
        else:
            merged, n_conf = _merge(part.iloc[0:0], part)
            conflicts += n_conf
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".tmp")
        merged.to_parquet(tmp, index=False)
        tmp.replace(target)
        written += 1
    return written, conflicts


def collect_csvs(paths: list[str | Path]) -> list[Path]:
    files: list[Path] = []
    for p in map(Path, paths):
        if p.is_dir():
            files.extend(p.rglob("*.csv"))
        elif p.is_file():
            files.append(p)
        else:
            raise FileNotFoundError(p)
    return sorted(set(files), key=lambda f: str(f))


def ingest(paths: list[str | Path], out: str | Path = DEFAULT_OUT, verbose: bool = True) -> RunReport:
    out = Path(out)
    run = RunReport()
    for f in collect_csvs(paths):
        df, rep = parse_cenace_csv(f)
        run.files.append(rep)
        if verbose:
            rango = f"{rep.fecha_min} a {rep.fecha_max}" if rep.rows_read else "vacío"
            drop = f", {rep.rows_dropped} descartadas" if rep.rows_dropped else ""
            print(f"[{rep.sistema}] {f.name}: {len(df):,} filas ({rango}){drop}", flush=True)
        if df.empty:
            continue
        written, conflicts = _write_partitions(df, out)
        run.partitions_written += written
        run.conflicts += conflicts
        if conflicts and verbose:
            print(f"  [!] {conflicts} claves con valores distintos: gana {f.name}", file=sys.stderr)
    return run


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", help="CSV o carpetas con CSV")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="carpeta de salida Parquet")
    args = ap.parse_args(argv)

    run = ingest(args.paths, args.out)
    mins = [r.fecha_min for r in run.files if r.fecha_min]
    maxs = [r.fecha_max for r in run.files if r.fecha_max]
    print(f"\n{len(run.files)} archivos, {run.partitions_written} particiones escritas, "
          f"{run.conflicts} conflictos. Rango: {min(mins) if mins else '-'} a {max(maxs) if maxs else '-'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
