# Legacy (referencia, no es parte del nuevo pipeline)

Copiado de `REPSA/Analysis/Analysis_PML` el 2026-10-09.

- `pipeline/legacy/conexion.py`    vista `precios_pml` con hora = hora_CENACE - 1 (corrección ya validada)
- `pipeline/legacy/ingest.py`      carga CSV -> DuckDB (esquema `pml_hourly`); base para `pipeline/ingest_portal.py`
- `pipeline/legacy/valor_nodo.py`  version mas reciente (8-oct-2026): KPIs por nodo, pvlib/NASA POWER
- `pipeline/legacy/analysis.py`, `geolocalizar_nodos.py`
- `legacy/outputs/kpis_nodo_*_nasa.csv`  resultados de referencia para validar los KPIs nuevos
- `legacy/outputs/deck_*`          prototipo del explorador/deck
- `legacy/notebooks/Analisis_Nodos.ipynb`

NO copiado: `app.py`/`pages/` (Streamlit descartado), `generar_informe.py` (PDF pospuesto),
`db/pml.duckdb` (3.6 GB, solo SIN MDA dic-2023..jul-2026: se reconstruye desde los CSV), `.venv`, `files.zip`.
