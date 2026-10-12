# Documento técnico

Fórmulas, unidades, convenciones, fuentes y supuestos de Nodal Solar Value. Cada afirmación lleva su estado: **[verificado]** (comprobado en los datos o con una prueba), **[estimado]** (supuesto técnico razonable, sin prueba directa) o **[pendiente]** (falta un dato o una decisión).

Dueños: la sección "Reloj" es de `clock-qa` (bloque marcado abajo). El resto lo mantiene `kpis`.

**Reloj común (desde el esquema 1.1):** todo mes, día y hora del día de agregados, KPIs y contrato está en **hora CDMX estándar, UTC−6 fija, sin horario de verano**, para los tres sistemas (SIN, BCA y BCS). Ver el bloque de clock-qa ("Zonas distintas y reloj común CDMX") y la §3.

| Sección | Código | Pruebas |
|---|---|---|
| 1. Fuentes y periodos | — | — |
| 2. Reloj (clock-qa) | `pipeline/clock.py` | `tests/test_clock.py` |
| 3. Agregados aditivos | `pipeline/aggregates.py` | `tests/test_aggregates.py` |
| 4. KPIs | `pipeline/kpis.py` | `tests/test_kpis.py` |
| 5. Finanzas (bloqueadas por supuestos PENDIENTE) | `pipeline/kpis.py`, `config/supuestos.yaml` | `tests/test_kpis.py` |
| 6. Contrato de datos web (esquema 1.2.0) | `pipeline/kpis.py` (`escribir_contrato`) | `tests/test_kpis.py` |
| 7. Validación: resultados | — | — |
| 8. Supuestos declarados | — | — |
| 9. Apéndice A1-A5 (modelo FV) | `pipeline/solar.py` | `tests/test_solar.py` |
| 10. Dudas abiertas para el orquestador | — | — |
| 11. Análisis del deck "Nodal Solar Value" recalculado | `pipeline/kpis.py` (`analisis`, `--analisis`) | `tests/test_kpis.py` (sección F) |

## 1. Fuentes y periodos

| Dato | Fuente | Periodo | Estado |
|---|---|---|---|
| PML del MDA (precio, energía, pérdidas, congestión) | CENACE, CSV del portal → `data/db/pml.duckdb`, tabla `pml_hourly` (151,050,393 filas, 2,659 nodos) | 2020-01-01 a 2026-09-30 (fechas civiles publicadas) | [verificado] (ingest + validador) |
| Calidad por nodo (meses de datos, huecos, outliers) | `pipeline/quality.py` → `data/quality/` | mismo | [verificado] (calidad + validador) |
| Producción FV por MWp (fijo y seguidor) | `pipeline/solar.py` con NASA POWER horario (GHI, DNI, DHI, T2M, WS2M), celdas de 1° → `data/baselines/` (perfil en hora CDMX) | clima 2015-2025 (11 años completos) | modelo [estimado]; ver §8 y §9 |
| Ubicación del nodo | Catálogo NodosP de CENACE (v2026-07-16) + centroide INEGI del **municipio** (no la subestación). 6 códigos retirados usan la ubicación del código que los reemplazó, según la hoja "Control de Cambios" (`coord_fuente = renombre:<nuevo>`) | — | [estimado] (error de ubicación de hasta decenas de km) |
| INPC mensual (pesos reales) | `data/ref/inpc_mensual.csv` + `.meta.json`: Banxico SIE, serie SP1 (INPC general de INEGI), base 2Q jul-2018 = 100 | 2020-01 a 2026-09 (81 meses, sin huecos) | [verificado] que cubre todos los meses del periodo |

- Unidades del PML: **MXN/MWh**, pesos **nominales** de cada año. El bloque `reales` (§4) los lleva a pesos del mes base del INPC.
- Los PML traen exactamente 2 decimales: |100·pml − round(100·pml)| < 5·10⁻¹⁰ en las 151 M filas [verificado].
- `pml = energía + pérdidas + congestión` con error ≤ 0.02 MXN/MWh (redondeo de CENACE) [verificado en las 151 M filas].
- El **componente de energía es idéntico en todos los nodos de un sistema en cada hora** (SIN, BCA y BCS, 2020-2026; 0 horas con diferencia) [verificado]. Por eso sirve como precio de referencia del sistema.
- Los PML negativos son legítimos y se conservan; calidad solo los marca. Ninguna fila se excluye de los cálculos [verificado].

<!-- BEGIN clock-qa: Reloj (dueño: clock-qa; kpis integra el resto del documento fuera de este bloque) -->
## Reloj de los PML (SIN, BCA, BCS · 2020-2026)

Código: `pipeline/clock.py` · Pruebas: `tests/test_clock.py` (79 pasan; 1 se omite: BCA 2026-11-01, que cae después del último dato, 2026-09-30).
Fuente: `data/db/pml.duckdb`, tabla `pml_hourly` (151 M filas, 2020-01-01 a 2026-09-30). Fecha y hora salen de las columnas `Fecha`/`Hora` del CSV, nunca del nombre del archivo.

### Convención adoptada

`hora` es la hora que **termina**. Va de 1 a n, consecutiva desde la medianoche **civil** de `fecha`, en la hora oficial de cada sistema. El día del cambio de primavera tiene n = 23 y el de otoño n = 25. Los demás días tienen n = 24.

`ts_local_estandar(sistema, fecha, hora)` da el **inicio** de la hora en hora local **estándar**, sin horario de verano y sin zona horaria (tz-naive):

    ts = fecha 00:00 + (hora − 1) h − (1 h si la medianoche civil de `fecha` está en verano)

Como el cambio ocurre a las 02:00, la medianoche del día de primavera todavía es estándar y la del día de otoño todavía es de verano. Por eso el ajuste aplica cuando `primavera < fecha ≤ otoño`. `ts_utc = ts_local_estandar − offset estándar`. Para agregar en DuckDB sin cargar datos en memoria está `sql_ts_local_estandar()`. Calcula las reglas a partir del año de `fecha`, sin límite de años, y da lo mismo que Python día por día en 2000-2060.

| Sistema | Hora estándar | Horario de verano en el dato publicado | Confianza |
|---|---|---|---|
| SIN | UTC−6 | Regla mexicana (1er domingo de abril → último domingo de octubre) de 2020 a 2022. Desde 2022-10-30 02:00, reloj fijo UTC−6. | Fechas y conteos [verificado]; offset UTC−6 [estimado] (hora legal del Centro; el dato no lo prueba directamente) |
| BCS | UTC−7 | Mismas fechas que el SIN; reloj fijo desde 2022-10-30. | Fechas y conteos [verificado]; offset UTC−7 [estimado] |
| BCA | UTC−8 | Regla de EE.UU. (2º domingo de marzo → 1er domingo de noviembre) en **todo** 2020-2026. La Ley de los Husos Horarios (DOF 28-oct-2022) la conserva en la franja fronteriza norte. | Fechas y conteos [verificado]; offset UTC−8 [estimado] |
| Todos | — | Orden dentro del día en los días de 23/25 h: horas consecutivas, sin hueco ni "hora 25 anexada al final". | [estimado] |

### Evidencia

**1. Conteo de horas por nodo-día** (todas las filas, agregado en SQL) [verificado]. Cada nodo-día tiene horas contiguas `1..n`, con `sum(hora) = n(n+1)/2`. n vale 23 o 25 solo en estos días, y en ellos **todos** los nodos del sistema publican n horas:

| Sistema | 23 h (primavera) | 25 h (otoño) |
|---|---|---|
| SIN | 2020-04-05, 2021-04-04, 2022-04-03 | 2020-10-25, 2021-10-31, 2022-10-30 |
| BCS | 2020-04-05, 2021-04-04, 2022-04-03 | 2020-10-25, 2021-10-31, 2022-10-30 |
| BCA | 2020-03-08, 2021-03-14, 2022-03-13, 2023-03-12, 2024-03-10, 2025-03-09, 2026-03-08 | 2020-11-01, 2021-11-07, 2022-11-06, 2023-11-05, 2024-11-03, 2025-11-02 |

- SIN y BCS publican siempre 24 h desde 2023, lo que coincide con la abolición del horario de verano. Los días de 25 h de 2023-2025 son **solo de BCA**: 350 filas con `hora = 25`. Las 7,946 filas con `hora = 25` de 2020-2025 se reparten así: SIN 7,172, BCS 88 y BCA 686.
- BCA cambia en las fechas de EE.UU., no en las de México. Esto prueba que cada sistema se publica en **su propia** hora civil y no en la hora del Centro.
- Las 26 fechas coinciden con las zonas IANA America/Mexico_City (SIN), America/Mazatlan (BCS) y America/Tijuana (BCA). `test_coincide_con_zona_iana` compara además, hora por hora, todo 2020-2026 fuera de los días de cambio.

**2. Las etiquetas se recorren en verano** [verificado]. Comparé el perfil medio normalizado de los 14 días anteriores con el de los 14 días posteriores a cada cambio. Para cada desfase medí la correlación de la primera diferencia y tomé el desfase de mejor ajuste. Como placebo usé las mismas fechas de 2023-2026 en SIN/BCS, años sin cambio.
- SIN: primavera +1, +1, +1; otoño −1, −2, −2. Placebos 2023-2026: 0 en los 7 casos.
- BCA: primavera +1 en 2022-2026 (2020: 0; 2021: +2); otoño −1 en 5 de 6 casos (2023: −2; 2025: 0).
- BCS: primavera +2, +1, +2; otoño 0, 0, 0 (señal débil: el perfil de BCS es plano). Placebos: 0 en 6 de 7 casos.

Esto concuerda con un reloj civil: el pico vespertino, ligado al ocaso, aparece una etiqueta más tarde en verano. Con reloj fijo no habría salto.

**3. Valle y pico diario de BCA/BCS frente al SIN** (perfil medio de la mediana nodal; posición del pico por ajuste parabólico, en etiqueta `hora`). Uso diciembre-febrero, cuando los tres sistemas están en hora estándar:

| Periodo | Pico SIN | Pico BCA | Pico BCS | BCA − SIN | BCS − SIN | Mejor desfase del perfil vs SIN (BCA / BCS) |
|---|---|---|---|---|---|---|
| DEF 2020-22 | 20.2 | 18.6 | 19.5 | −1.6 h | −0.8 h | −1 / −1≈0 |
| DEF 2023-26 | 20.1 | 18.4 | 19.3 | −1.8 h | −0.8 h | −1 / −1≈0 |

- Convertido a UTC con los offsets adoptados, el pico queda en ≈02.2 (SIN), ≈02.5 (BCA) y ≈02.4 (BCS) UTC (hora que termina). Los tres coinciden en ±0.3 h, y BCA/BCS un poco después, como corresponde a su ocaso más tardío en UTC.
- Si BCA y BCS se publicaran en hora del Centro, su pico caería en ≈00.5 y ≈01.4 UTC, **antes** que el del SIN, aunque el sol se pone más tarde en el oeste. Por eso las tomo como hora local: BCA en UTC−8 y BCS en UTC−7 [estimado].
- El valle solar de BCA, acoplado a la curva de pato de California, queda en la etiqueta ≈13.3 en invierno: centro ≈12:50 PST, cerca del mediodía solar de Mexicali (≈12:00 PST). En hora del Centro equivaldría a 10:50 PST, demasiado temprano.
- Comparación día por día (argmin/argmax diario): mediana BCA − SIN = −1 a −2 h en el pico. Es ruidosa; la comparación de perfiles medios es la que cuenta. El valle diario del SIN es poco profundo y no sirve como ancla.

### Dudas no resueltas (para el orquestador)

1. [pendiente] **Orden dentro del día en los días de 23/25 h** (hoy se usa como [estimado]). Los datos son compatibles con dos lecturas: (a) horas consecutivas desde la medianoche civil (la que adopté) y (b) día de otoño con 1..24 civil más la hora repetida 01-02 como "25". Las pruebas de continuidad de precios en esos días no distinguen entre ambas: el ruido es mayor que la señal. Los manuales SW-PML/PEND/PSC no lo aclaran. Si fuera (b), cambian 23 horas de 1 día al año por sistema que cambia de horario, un efecto menor. La confirmación tendría que venir de CENACE.
2. [pendiente] **Offsets estándar UTC−6 (SIN), UTC−7 (BCS) y UTC−8 (BCA)** (hoy se usan como [estimado]). Los días de cambio solo prueban la regla de verano, no el offset base. El offset depende de la evidencia física del punto 3 y de la zona legal de cada estado. Hace falta una confirmación documental de CENACE.
3. BCA 2026-11-01 está fuera de los datos; la regla lo da como día de 25 h.

### Zonas distintas y reloj común CDMX

BCA y BCS **no** comparten zona horaria con el SIN (CDMX):

| Sistema | Hora estándar | Horario de verano en el dato | Hora CDMX − hora local estándar | Confianza |
|---|---|---|---|---|
| SIN (CDMX) | UTC−6 | Regla mexicana hasta 2022-10-30; después, fijo | 0 h | Regla [verificado]; offset [estimado] |
| BCS | UTC−7 | Regla mexicana hasta 2022-10-30; después, fijo | +1 h | Regla [verificado]; offset [estimado] |
| BCA | UTC−8 | Regla de EE.UU. en todos los años | +2 h | Regla [verificado]; offset [estimado] |

- La regla de verano distinta de BCA está probada por los conteos de horas (evidencia 1).
- Que los offsets base sean distintos (BCA −2 h y BCS −1 h frente al SIN) se apoya en el pico y el valle (evidencia 3) y en la zona legal de cada estado. Es [estimado]; ver dudas 1 y 2.

**Reloj común = hora estándar de CDMX: UTC−6 fijo, sin horario de verano en ningún año ni sistema.**
- `ts_cdmx(sistema, fecha, hora) = ts_utc − 6 h`, que es igual a `ts_local_estandar + desfase_a_cdmx_horas(sistema)` (SIN 0, BCS +1, BCA +2). Da el inicio de la hora, tz-naive.
- Versión SQL: `sql_ts_cdmx()`, sin límite de años. Convertir de UTC a CDMX: `utc_a_cdmx()`.
- `ts_local_estandar` no cambia.

Consecuencias:
- **Hora del día.** En hora CDMX, las series de BCA se recorren +2 h y las de BCS +1 h respecto a su hora local estándar. Ejemplo: la hora 1 de BCA en invierno (00:00 PST) es 02:00 CDMX. El pico vespertino de BCA (≈18.5 local) aparece en ≈20.5 CDMX.
- **Horario de verano.** En los periodos de verano, la etiqueta `hora` va 1 h adelante de la hora estándar: SIN/BCS de 2020 a 2022 y BCA todos los años. `ts_utc` y `ts_cdmx` ya lo corrigen. En reloj CDMX, la hora 1 de BCA en julio cae a la 01:00.
- **Día y mes.** Se toman en hora CDMX. Las últimas 2 h (BCA) o la última hora (BCS) de cada día local estándar caen en el día siguiente, y en el último día del mes, en el mes siguiente.
  - En los bordes de los datos: enero de 2020 en CDMX le faltan las 2 primeras horas a BCA y la primera a BCS.
  - El último dato de BCA y BCS (2026-09-30, hora 24) cae en 2026-10-01 00:00 CDMX. Eso deja un octubre de 2026 de 1 h, que hay que recortar o marcar como incompleto.
- Los días de 23/25 h se convierten sin huecos ni duplicados (pruebas `test_cambio_en_reloj_cdmx`). En reloj CDMX todo mes completo tiene días × 24 horas.
- Comprobación contra la base completa: por (sistema, nodo), los instantes CDMX son únicos y el paso es exactamente de 1 h en todo el histórico (`test_datos_por_nodo_continuos_en_cdmx`, ≈9 s).

### Qué cambia aguas abajo
- `calidad`: los días de 23 y 25 h son legítimos. No hay que imputarlos ni descartarlos, y "día completo" significa `horas_en_dia(sistema, fecha)`, no 24. Se cuenta por `fecha` civil publicada, sin cambios.
- `solar` / `kpis`: el cruce PML × producción se hace por instante (`ts_cdmx`, o `ts_utc`) y **no** por `(fecha, hora − 1)`. Con el reloj común, las llaves de mes y hora del día son `month(ts_cdmx)` y `hour(ts_cdmx)` para los tres sistemas. El perfil solar y(mes, hora) tiene que construirse en el **mismo** reloj (ver el reporte de clock-qa al orquestador).
<!-- END clock-qa -->

## 3. Agregados aditivos (`pipeline/aggregates.py`)

**Idea.** Por nodo, mes, hora del día y configuración se guardan **sumas, no promedios**. Las sumas se pueden juntar para cualquier rango de meses sin perder nada, así que el navegador calcula el periodo que elija el usuario de forma **exacta**, sin volver al dato horario.

### Definiciones

- **ts** = `clock.ts_cdmx(sistema, fecha, hora)`: **inicio** de la hora publicada en el **reloj común CDMX** (UTC−6 fijo, sin horario de verano). Equivale a `ts_local_estandar` + 0 h (SIN), +1 h (BCS) o +2 h (BCA). En SQL se usa `clock.sql_ts_cdmx()`. Nunca se usa `(fecha, hora − 1)`.
- **Celda** = (sistema, nodo, `anio = year(ts)`, `mes = month(ts)`, `hora = hour(ts)` ∈ 0..23) × configuración (`fixed` | `tracker`). Año, mes y hora del día son **CDMX** para los tres sistemas.
- **y** = producción FV de esa hora por MWp DC instalado, en **MWh/MWp**. Es el baseline de `solar.py` en (mes, hora) CDMX para esa configuración: la media de esa hora CDMX en los días válidos del mes, 2015-2025, con el perfil calculado **en la ubicación del nodo** y reetiquetado al reloj CDMX (`clock = "CDMX estandar UTC-6 fijo"`; el código exige ese valor). Es **un perfil de año típico mes × hora aplicado a cada hora real de PML** [estimado: no usa el clima real de cada año; ver §8].
- **Sol y precio se cruzan por instante.** El perfil viene de UTC (`clock.utc_a_cdmx`) y el PML de `ts_cdmx` (que pasa por `ts_utc`), así que el corrimiento de reloj **no** cambia qué hora solar se paga con qué precio. Solo cambia a qué **mes o día** se asignan las horas de frontera.
  - Comprobado en 07CFP-400 (BCA): el precio capturado de ene-2025 y jul-2025 es **idéntico** al del reloj local (740.0852 y 903.2194 MXN/MWh). El precio base cambia poco porque 2 h por mes se recorren de mes [verificado: `tests/test_kpis.py::REALES`].
- **Etiquetas de CENACE en verano.** La `hora` publicada es la hora civil que termina. En verano va 1 h adelante de la hora estándar: SIN y BCS de 2020 a 2022, BCA todos los años de marzo a noviembre. `ts_utc`/`ts_cdmx` lo corrigen, así que en BCA en verano la hora publicada h cae a las h:00 CDMX (−1 por inicio de hora, −1 por verano y +2 por zona) [verificado: prueba H2].
- **Días de 23 y 25 horas.** Cada hora publicada se convierte a su propio instante CDMX y entra **una sola vez** en su celda. El día de 25 h aporta 25 horas y el de 23 h, 23. En reloj CDMX no hay huecos ni duplicados por nodo: un mes completo tiene `días × 24` horas [verificado: `test_dia_25h_bca_en_reloj_cdmx`, `test_dia_23h_sin_*`, `test_frontera_de_mes_en_verano`, y clock-qa sobre la base completa].
- **Frontera de mes y año.** Las últimas 2 h (BCA) o la última (BCS) de cada día local caen en el día siguiente CDMX, y en fin de mes, en el mes siguiente. Ejemplo: BCA 2021-12-31, horas 23 y 24, caen en 2022-01-01 00:00 y 01:00 CDMX [verificado: `test_bca_y_bcs_cruzan_ano_y_mes_en_cdmx`]. En el SIN, las horas de verano 2020-2022 de la hora 1 del día 1 caen el último día del mes anterior.

### Meses de borde (bordes del periodo de datos)

Los datos civiles van de 2020-01-01 hora 1 a 2026-09-30 hora 24. En reloj CDMX:

| Sistema | Primer instante CDMX | Último instante CDMX | Meses de borde |
|---|---|---|---|
| SIN | 2020-01-01 00:00 | 2026-09-30 23:00 | ninguno |
| BCS | 2020-01-01 01:00 (falta 1 h de ene-2020) | 2026-10-01 00:00 | 2020-01 (743 de 744 h), 2026-10 (1 h) |
| BCA | 2020-01-01 02:00 (faltan 2 h de ene-2020) | 2026-10-01 00:00 | 2020-01 (742 de 744 h), 2026-10 (1 h) |

- Las celdas de borde **se conservan** en los agregados y en el JSON, así que la suma total de horas sigue igual a las filas de la base. Pero:
  - un mes de borde **nunca** cuenta como mes completo (VF mínimo mensual);
  - un año que contiene un mes de borde **nunca** es año completo (peor, mediana y mejor; tendencia de VF);
  - el periodo por defecto es **2020-01 a 2026-09** (`periodo_datos`), así que octubre de 2026 queda fuera;
  - las horas esperadas de un periodo (cobertura) son las horas **posibles** dentro de la ventana de datos del sistema (`aggregates.horas_posibles_mes`). Ejemplo: ene-2020 en BCA = 742.
- Se publican en `agregados_meta.json`, en `index.json.periodo_datos.meses_borde` y en cada ficha (`agregados.meses_borde`) [verificado: `test_meses_borde_y_horas_posibles`, `test_meta_y_bordes_reales`].

### Columnas (la suma recorre las horas con PML de la celda)

| Columna | Definición | Unidad |
|---|---|---|
| `n_horas` | número de horas | h |
| `n_pml_le0` | horas con PML ≤ 0 | h |
| `sum_pml_cent` | Σ round(100·PML) | centavos·h (entero exacto) |
| `sum_energia_cent`, `sum_perdidas_cent`, `sum_congestion_cent` | ídem con cada componente | centavos·h |
| `y_mwh_por_mwp` | y de la celda (constante dentro de la celda) | MWh/MWp |
| `sum_y` | Σ y | MWh/MWp |
| `sum_y_pml` | Σ y·PML | MXN/MWp |
| `sum_y_le0` | Σ y (solo horas con PML ≤ 0) | MWh/MWp |
| `sum_y_energia`, `sum_y_perdidas`, `sum_y_congestion` | Σ y·componente | MXN/MWp |

- Las sumas de precio se guardan en **centavos enteros**. Como el PML tiene 2 decimales exactos, se combinan sin error de redondeo (enteros < 2⁵³).
- Archivos (`data/aggregates/`):
  - `agregados_comunes.parquet`: lo que no depende de la configuración, para **todos** los nodos con PML (2,659).
  - `agregados_config.parquet`: lo ponderado por y, solo para nodos con baseline (2,456).
  - `agregados_nodos.parquet`: un renglón por nodo con calidad, `coord_source`, `coord_precision`, `tiene_baseline` y `motivo_sin_baseline`.
  - `agregados_meta.json`: reloj, periodo civil y ventana y meses de borde por sistema.
- Invariantes que el código revisa en cada corrida:
  - claves únicas;
  - 1 ≤ `n_horas` ≤ días del mes;
  - `sum_y = y·n_horas`;
  - config cubre todas las celdas de sus nodos;
  - ninguna celda fuera de la ventana CDMX de su sistema;
  - **Σ n_horas = 151,050,393 = filas de `pml_hourly`** [verificado].
- Ejecución: `.venv/bin/python pipeline/aggregates.py` (≈35 s).

## 4. KPIs (`pipeline/kpis.py`)

Notación: sobre el conjunto de celdas del periodo elegido (meses CDMX [desde, hasta]), para una configuración:

| Símbolo | Fórmula | Unidad |
|---|---|---|
| n | Σ n_horas | h |
| P (producción) | Σ sum_y | MWh/MWp |
| I (ingreso MDA de referencia) | Σ sum_y_pml | MXN/MWp |
| **B (precio base)** | Σ sum_pml_cent / 100 / n | MXN/MWh |
| **C (precio capturado)** | I / P | MXN/MWh |
| **VF (value factor)** | C / B (solo si B > 0) | — |
| E₀ (energía en riesgo) | Σ sum_y_le0 | MWh/MWp |
| %E₀ | 100 · E₀ / P | % |
| %horas PML ≤ 0 | 100 · Σ n_pml_le0 / n | % |
| B_k, C_k (k = energía, pérdidas, congestión) | Σ sum_k_cent/100/n ; Σ sum_y_k / P | MXN/MWh |
| basis vs. referencia | C − C_energía (= C_pérdidas + C_congestión + residuo ≤ 0.02) | MXN/MWh |
| basis de congestión | C_congestión | MXN/MWh |

- **Convención del VF: "todas las horas"** [decisión técnica declarada]. B es la media simple de **todas** las horas con PML del periodo (día y noche). Con B ≤ 0 el VF queda en `null`. El VF **puede ser negativo** si el precio capturado lo es (prueba H3).
- **Identidad exacta:** I = P × B × VF. La prueba usa 200 casos aleatorios con error relativo ≤ 10⁻¹³, y cada año publica `producto` junto a `ingreso`.
- **Basis de congestión vs. referencia (mismo perfil FV):** la referencia es el componente de energía, idéntico en todo el sistema [verificado], ponderado con el **mismo** perfil y del nodo.
- **Rótulo obligatorio:** "precio capturado MDA (referencia)". El PML del MDA no es el ingreso real: no incluye desbalances a MTR, potencia, CEL, conexos, transmisión ni contratos.

### Años y meses completos (umbral)

- **Mes completo**: `n_horas ≥ ⌈UMBRAL_MES_COMPLETO · días · 24⌉` y no es mes de borde.
- **Año completo**: `n_horas ≥ ⌈UMBRAL_ANIO_COMPLETO · horas del año⌉`, ningún mes de borde en ese año, y sus 12 meses dentro del rango elegido.
- `UMBRAL_ANIO_COMPLETO = UMBRAL_MES_COMPLETO = 1.0` (100 %). Son constantes con nombre en `kpis.py` y se publican en `index.json`.
- **Ningún año ni mes parcial se anualiza**: el ingreso de un año es la suma de sus horas disponibles. Un año parcial aparece en `anual` con su `cobertura_pct` y `completo = false`, pero no entra en el peor, la mediana, el mejor ni la tendencia.

**Experimento: 95 % en lugar de 100 %.** Recalculé todos los KPIs de los 2,456 nodos × 2 configuraciones con las dos constantes:
- La bandera de año completo cambia en **7 nodos**: 02LHA-115 (2021, 97.5 %), 02NXM-230 (2021, 97.0 %), 03PCL-115 (2022, 95.9 %), 03SFM-115 (2022, 95.9 %), 04MPP-115 (2023, 96.2 %), 05TRE-115 (2020, 95.4 %) y 06PGI-115 (2025, 97.3 %). 03EGM-230 no cambia: su hueco deja 2023 en 51.5 %.
- **Cambian KPIs publicados en 13 nodos** (40 combinaciones nodo × configuración × KPI):
  - año mediano: 02NXM-230 pasa de 2024 a 2025 (1.32 → 1.37 M MXN/MWp, fijo); 05TRE-115 de 2023 a 2024 (0.95 → 0.81 M);
  - mejor año: 03PCL-115 pasa de 2024 (1.36 M) a 2022 (2.10 M), aunque 2022 es un año al 95.9 % sin anualizar;
  - tendencia de VF: en 03PCL-115 y 03SFM-115 cambia de signo (≈0 → −0.04/año); 04MPP-115 pasa de no tener tendencia a tenerla;
  - conteo de meses completos usado para el VF mínimo mensual: 12 combinaciones; el mes mínimo no cambia.
- Además, un año al 95 % se compararía con su ingreso **sin anualizar**, sesgado a la baja (o a la alza si el hueco cae en meses baratos).
- **Decisión técnica:** se mantiene el 100 %, porque el 95 % cambia KPIs. Si el negocio lo quiere, basta cambiar la constante, pero ver §10.

### Otros KPIs

- **Ingreso por MWp-año: peor, mediana y mejor año.** Se calcula por año CDMX, solo con años completos.
  - La **mediana es la mediana baja**: el año observado en la posición ⌊(M−1)/2⌋ del orden ascendente, así que su descomposición P × B × VF es la de un año real.
  - Con M años se muestra "M años completos"; no hay probabilidades.
  - Como y es climatológico, la variación del ingreso entre años es la del precio. La variación por clima real va aparte, en `clima.{config}.anual_por_anio_*`.
- **VF con tendencia anual:** pendiente por MCO de VF contra año sobre años completos; requiere al menos 3.
- **VF mínimo mensual:** el mínimo entre los meses completos.
- **% energía a PML ≤ 0 y MWh/MWp en riesgo:** %E₀ y E₀ del periodo y por año.
- **Calidad y cobertura:**
  - horas y horas posibles del periodo, con % de faltantes (incluye el tiempo antes de que el nodo entrara al catálogo);
  - meses con datos y meses de borde en el periodo;
  - de calidad: `meses_de_datos`, `confianza`, `estado`, `pct_hueco_vida` y la cobertura por mes **civil**.
- **Aviso de baja confianza:** menos de 12 meses con datos en el periodo elegido (regla de calidad).

### Pesos reales (INPC): bloque `reales`

Los montos nominales son los principales; `reales` es un bloque adicional.
- **Deflactor por mes**: `f(mes) = INPC(base) / INPC(mes)`. La base es el **último mes de la tabla** (hoy 2026-09, "pesos de hoy").
- **Conversión:** celda por celda, `suma_real = suma_nominal × f(mes CDMX)` en las sumas de precio (`sum_*_cent` y `sum_y_pml/energia/perdidas/congestion`). Horas y producción no cambian. Después se aplican las **mismas** fórmulas de B, C, VF e ingreso.
  - Como B es un promedio de precios deflactados mes por mes, el VF real puede diferir un poco del nominal.
- Las sumas reales son de punto flotante; **no se afirma exactitud de centavos** en real. Los centavos nominales no se tocan: siguen siendo enteros exactos.
- El INPC es mensual civil y se aplica al mes CDMX. En BCA y BCS, 1-2 h de frontera por mes reciben el deflactor del mes vecino; la diferencia mensual del INPC es ≤ 1.2 %, así que el efecto es despreciable [estimado].
- Si falta la tabla, o algún mes **con datos** dentro del periodo no está en la tabla, `reales.estado = "no_disponible"` con motivo; **no se extrapola**. Hoy cubre 2020-01 a 2026-09, así que el periodo por defecto está cubierto. Octubre de 2026 (borde) no tiene INPC y su deflactor es `null`.
- El navegador lo reconstruye con `agregados.deflactor_inpc[i]` (uno por mes de `meses`).

## 5. Finanzas (TIR, VAN, LCOE, break-even, veredicto, escenarios, USD)

**Estado: BLOQUEADO.** Los supuestos de negocio están en espera. `config/supuestos.yaml` es una plantilla con todos sus valores en `PENDIENTE`, incluida la clave raíz `estado`. Mientras sea así:
- no hay veredicto ni semáforo, TIR, VAN, LCOE, break-even, USD ni escenarios;
- toda función dependiente lanza `SupuestoPendiente`;
- el contrato publica `financiero.estado = "PENDIENTE"`, todos los valores en `null` y la lista `pendientes`.

Fórmulas implementadas y probadas con insumos sintéticos explícitos (convención propuesta: por MWp, MXN constantes, antes de impuestos y sin deuda):
- CF₀ = −capex; CF_t = I₁·(1−d)^(t−1) − opex, para t = 1..T. I₁ = ingreso del año mediano.
- VAN(r) = Σ CF_t/(1+r)^t. TIR por bisección; es `null` si no hay exactamente un cambio de signo.
- LCOE = [capex + Σ opex/(1+r)^t] / Σ E₁(1−d)^(t−1)/(1+r)^t, en MXN/MWh.
- **`break_even_ppa_mxn_mwh` = LCOE**: el precio plano por MWh producido con VAN = 0.
- **`break_even_pml_base_mxn_mwh` = LCOE / VF**: el PML base del nodo (media de todas las horas) que, con el VF del nodo, da VAN = 0. Lo pidió el usuario.
- Unidades de capex y opex: MXN o USD por MWp, Wp o kWp. USD exige `tipo_cambio_mxn_por_usd`.
- "N de M años": TIR ≥ tasa si cada año completo se repitiera toda la vida del proyecto.
- Semáforo: `viable` / `neutral` / `no_viable` según dos umbrales.
- Escenarios: multiplicadores sobre precio, producción, capex y opex. Estructura propuesta; todos los valores PENDIENTE.

## 6. Contrato de datos (esquema 1.2.0)

`schema_version = "1.2.0"`, con `generated_at` en ISO-8601 UTC. Cambios: **1.1** = reloj CDMX, sumas ponderadas y energía reconstruidas en el navegador, `perfil_y`, `reloj`, bloque `reales`; **1.2** = el índice añade KPIs en pesos de hoy por nodo (abajo). Las fichas no cambian de forma entre 1.1 y 1.2, solo de número de versión. Se generan con `.venv/bin/python pipeline/aggregates.py` y luego `.venv/bin/python pipeline/kpis.py`.

### `index.json`

Un renglón por **cada** nodo con PML (2,659); ninguno se omite.
- Encabezado:
  - `config_defecto = "tracker"`: configuración por defecto del mapa, decisión del usuario; es una constante, `CONFIG_DEFECTO`.
  - `reloj`: bloque legible por máquina. Contiene la referencia ("CDMX estandar UTC-6 fijo (hora del SIN)", offset −6) y, por sistema, el offset estándar a UTC, el desfase a CDMX (SIN 0, BCS +1, BCA +2), la hora civil que publica CENACE y una nota al pie lista, `nota_es` y `nota_en`.
  - `periodo_datos`: 2020-01 a 2026-09, reloj y meses de borde por sistema.
  - `umbral_anio_completo`, `umbral_mes_completo`, `pesos_reales` (mes base y fuente del INPC), `rotulo`, `alcance`, `supuestos`, `conteo`.
- Por nodo:
  - `id, nombre, entidad, municipio, sistema, region, lat, lon, meses_de_datos, confianza, valido, estado_calidad`;
  - `coord_fuente`: `municipio_catalogo` o `renombre:<código nuevo>`;
  - `coord_precision`: "centroide municipal" o "centroide municipal (del nodo renombrado)";
  - `renombrado_a`, en el código retirado, y `renombre_de`, en el código nuevo;
  - `ficha` (ruta) o `null` con `motivo_sin_ficha`;
  - `kpis`: {fixed, tracker} × {capturado, base, VF, % a PML ≤ 0} del periodo completo, nominales, y **desde 1.2** `precio_capturado_real_mxn_mwh`, `precio_base_real_mxn_mwh` y `vf_real` en pesos del mes base de `pesos_reales` (2026-09). Son los mismos valores que `kpis.<config>.reales` de la ficha (redondeados a 4 decimales), o `null` si no hay INPC para algún mes con datos. Sirven para colorear el mapa en pesos de hoy.

### `nodes/{id}.json`

Un archivo por nodo con baseline. Lleva los metadatos del nodo (incluidos `coord_fuente`, `coord_precision` y los campos de renombre), además de:
- `nota_reloj`: `true` en BCA y BCS.
- `mediodia_solar_cdmx`: hora CDMX decimal del **mediodía solar medio** = 12 − lon/15 − 6. Es un promedio anual; ignora la ecuación del tiempo (±16 min) [método declarado].
- `centroide_energia_cdmx` por configuración: centroide de la energía del perfil, que sirve de verificación. Ejemplos:
  - 07CFP-400 (BCA, −113.54°): mediodía 13.57 CDMX, centroide 13.56-13.58;
  - 01AAN-85 (−98.94°): mediodía 12.60.
  - El sol queda bien ubicado pese al corrimiento de reloj [verificado: `test_index_reloj_config_defecto_renombres`].
- `agregados`: arreglos columnares.
  - `reloj`: el bloque de su sistema.
  - `layout`: el elemento `i·24 + hora` corresponde al mes CDMX `meses[i]` (del primer al último mes con datos) y a la hora CDMX `hora`, que es el **inicio** de la hora en "CDMX estandar UTC-6 fijo".
  - `meses_borde`.
  - Comunes, en enteros exactos: `n_horas, n_pml_le0, sum_pml_cent, sum_perdidas_cent, sum_congestion_cent` y `sum_residuo_cent` (= pml − energía − pérdidas − congestión: el redondeo de CENACE, de pocos centavos). `sum_energia_cent` no se publica: se reconstruye **exacta** como `sum_pml_cent − sum_perdidas_cent − sum_congestion_cent − sum_residuo_cent` (enteros). Esto ahorra unos 5.6 KB gz por ficha.
  - `perfil_y.{fixed,tracker}`: 288 valores sin redondear, en la representación JSON más corta que se relee igual bit a bit.
  - `deflactor_inpc`: uno por mes; `null` si no hay dato.
- `kpis.{fixed,tracker}`: resumen del periodo completo (§4), con `financiero` (PENDIENTE) y `reales`.
- `calidad` (con cobertura por mes **civil** del módulo de calidad), `clima` y `supuestos`.

### Reconstrucción en el navegador (lo que el esquema 1.1 deja de publicar)

Las seis sumas ponderadas por y y `sum_energia_cent` ya no se publican. Como y es constante dentro de cada celda, Σ y·x = y·Σx. Para la configuración c, la celda k = i·24 + h y el mes calendario m = mes de `meses[i]`, con y = `perfil_y[c][(m−1)·24 + h]`:

    sum_energia_cent[k] = sum_pml_cent[k] − sum_perdidas_cent[k] − sum_congestion_cent[k] − sum_residuo_cent[k]   (entero, exacto)
    sum_y[k]            = y · n_horas[k]
    sum_y_le0[k]        = y · n_pml_le0[k]
    sum_y_pml[k]        = y · sum_pml_cent[k] / 100
    sum_y_<comp>[k]     = y · sum_<comp>_cent[k] / 100        (comp = energia, perdidas, congestion)
    real: cualquier suma de precio de la celda k × deflactor_inpc[i]

Fragmento de referencia (JS):

```js
function kpis(doc, cfg, desde, hasta) {          // desde/hasta: "YYYY-MM"
  const a = doc.agregados, y = a.perfil_y[cfg];
  let n = 0, cent = 0, P = 0, I = 0, E0 = 0;
  a.meses.forEach((mes, i) => {
    if (mes < desde || mes > hasta) return;
    const m = +mes.slice(5, 7);
    for (let h = 0; h < 24; h++) {
      const k = i * 24 + h, yy = y[(m - 1) * 24 + h];
      n += a.n_horas[k]; cent += a.sum_pml_cent[k];          // enteros exactos
      P += yy * a.n_horas[k]; I += yy * a.sum_pml_cent[k] / 100; E0 += yy * a.n_pml_le0[k];
    }
  });
  const B = cent / 100 / n, C = I / P;
  return { B, C, VF: B > 0 ? C / B : null, ingreso: I, produccion: P, pctE0: 100 * E0 / P };
}
```

La versión Python equivalente es `kpis.reconstruir()` y `kpis.kpis_desde_doc()`.

**Prueba** (`test_esquema_11_reconstruccion_exacta`, `test_nodos_json_coherentes`):
- los enteros publicados (horas, centavos, horas con PML ≤ 0) y la energía reconstruida son **idénticos** a los del parquet completo;
- `perfil_y` es idéntico **bit a bit** al `y` del parquet;
- las sumas ponderadas reconstruidas coinciden con las sumas horarias Σ y·x del parquet con error relativo ≤ 10⁻¹², que es solo el orden de suma del punto flotante;
- los KPIs reconstruidos en el navegador para el periodo completo coinciden con los de los agregados con rel ≤ 10⁻¹².

**Tamaños** (2,456 fichas): mediana **31.6 KB gz** (85 KB sin comprimir), máximo 34.5 KB gz. `index.json`: 2.20 MB, 225 KB gz (230,251 bytes, gzip nivel 9; con los KPIs reales de 1.2).

**Diferencias con la web.** `web/` está vacío: no hay esquema simulado con el que comparar. Se siguió §8 del WORKFLOW con las decisiones de arriba. Cambiar el esquema obliga a subir `schema_version`.

## 7. Validación: resultados

| Prueba | Resultado |
|---|---|
| Σ n_horas de los agregados = filas de `pml_hourly` | 151,050,393 = 151,050,393 [verificado] |
| Exactitud aditiva en **10 nodos**, reloj CDMX: 01AAN-85, **03DEA-230** (código retirado, renombrado a 03DEC-230), 02AAA-115, **03EGM-230** (hueco de 177 días), 03MNO-115 (entra en 2026-07, < 12 meses), 04MPP-115, 05CJM-115, 06AAT-115, **07CFP-400** (BCA, +2 h, mes de borde 2026-10) y 08AKD-115. Ambas configuraciones; rangos: completo, cada año, varios intermedios y el primer mes | Camino independiente: `clock.ts_cdmx` en Python, baseline leído del parquet, `math.fsum` hora por hora. Enteros **idénticos**. Flotantes: error relativo máximo **1.3·10⁻¹⁵ en 192 combinaciones nodo × configuración × rango** (tolerancia 10⁻¹¹) [verificado] |
| 3 nodos sintéticos calculados a mano: H1 (SIN, enero, PML negativo), H2 (BCA, día de 25 h en reloj CDMX) y H3 (SIN, frontera mayo/junio en verano, VF negativo) | Iguales a las fracciones a mano (rel ≤ 10⁻¹⁴). En H2, C = 120 en reloj CDMX; con el reloj local saldría 140 y con `(fecha, hora−1)`, 130 [verificado] |
| Nodos reales con SQL plano y reloj CDMX escrito a mano: 01AAN-85, 03EGM-230, 07CFP-400 y 03DEA-230 | Contra los agregados: rel ≤ 10⁻¹². Contra la reconstrucción desde el JSON 1.1: rel ≤ 10⁻¹² [verificado] |
| Contrato | Los 2,659 nodos están en el índice y las 2,456 fichas son exactamente los nodos con baseline. Los 6 renombrados tienen ficha y bandera de precisión. Las finanzas están en PENDIENTE y no hay campos USD ni de veredicto con valor [verificado] |

**Efecto del cambio a reloj CDMX** (en el SIN el reloj CDMX coincide con la hora estándar del SIN). Periodo completo, nodos válidos del SIN; los valores del esquema 1.0 van entre paréntesis:
- precio base, mediana: 827.2 (827.2) MXN/MWh;
- precio capturado, mediana: fijo 732.1 (732.2), seguidor 739.9 (740.1);
- VF, mediana: 0.885 (0.885) y 0.896 (0.896);
- ingreso por MWp-año (peor / mediana / mejor año): fijo 1.06 / 1.23 / 2.02 M (igual), seguidor 1.26 / 1.48 / 2.45 M (igual).
- Las diferencias mínimas vienen de los 6 nodos renombrados que ahora entran (2,433 nodos válidos del SIN con ficha frente a 2,427).

En BCA (07CFP-400, seguidor), el precio capturado del periodo no cambia (800.69) y el VF pasa de 0.94554 a 0.94557. La única diferencia es que 2 h por frontera de mes se corren de mes.

**Comparación con el legado** (esquema 1.0, SIN, sin cambios por el reloj): precio base idéntico; VF con mediana de diferencia +0.004 a +0.007 (p5/p95 entre −0.02 y +0.06); ingreso 2024-08 a 2025-07 −1.8 %.

**Cifras del SIN** (nodos válidos, periodo completo 2020-01 a 2026-09):

| | fijo | seguidor |
|---|---|---|
| Precio base, mediana (p5 a p95) | 827 (517 a 1,087) MXN/MWh | igual |
| Precio capturado, mediana (p5 a p95) | 732 (380 a 929) | 740 (399 a 935) |
| VF, mediana (p5 a p95) | 0.885 (0.718 a 0.920) | 0.896 (0.763 a 0.927) |
| % energía a PML ≤ 0, mediana (p95) | 0.41 % (3.4 %) | 0.37 % (2.9 %) |
| Ingreso por MWp-año (años completos 2020-2025), mediana entre nodos de peor / mediana / mejor año; "mediana" = año observado de la mediana baja (el menor de los dos años centrales), como lo publica el contrato | 1.06 / 1.23 / 2.02 M MXN | 1.26 / 1.48 / 2.45 M MXN |

Mejor año: casi siempre 2022 (precios altos). Peor año: casi siempre 2020, o 2025.

## 8. Supuestos declarados

| Supuesto | Valor | Estado |
|---|---|---|
| Reloj común de agregados y contrato: CDMX estándar UTC−6 fijo para los 3 sistemas | — | decisión del usuario; offsets estándar [estimado] (ver §2) |
| Precio base = media de **todas** las horas (VF "todas las horas") | — | convención declarada |
| Producción = perfil climatológico mes × hora (2015-2025) aplicado a cada hora real de PML | — | [estimado]. Ignora que el clima real de cada año se correlaciona con el precio |
| Ubicación = centroide del municipio; 6 códigos retirados usan el municipio del código nuevo | — | [estimado] |
| Modelo FV | ver §9 | [estimado] |
| DC/AC = 1 | 1.0 | [pendiente] (`solar.py`) |
| Año y mes completos al 100 % de las horas; meses de borde nunca completos; nada se anualiza | `UMBRAL_* = 1.0` | convención declarada; con 95 % cambian KPIs (§4) |
| Mediana baja; tendencia con ≥ 3 años | — | convención declarada |
| Pesos reales: INPC por mes civil aplicado al mes CDMX; base = último mes de la tabla | 2026-09 | INPC [verificado: tabla Banxico]; aplicación al mes CDMX [estimado, efecto despreciable] |
| Mediodía solar = 12 − lon/15 − 6 (promedio anual) | — | [estimado] (±16 min por la ecuación del tiempo) |
| Tasa, capex, opex, tipo de cambio, vida útil, degradación, semáforo, escenarios | PENDIENTE | [pendiente] (negocio, en espera) |

## 9. Apéndice A1-A5: del sol a MWh por MWp (explicado desde `pipeline/solar.py`)

**A1. pvlib y NASA POWER.**
- NASA POWER entrega, por celda de 1° × 1°, datos horarios en UTC con marca al inicio de la hora: GHI, DNI y DHI (W/m²), T2M (°C) y WS2M (m/s).
- El valor −999 significa faltante y se vuelve `NaN`; nunca se usa como número.
- Cada nodo usa la celda de su centroide de municipio.
- El baseline usa los años completos 2015-2025.
- pvlib calcula la posición del sol y la física.
- El perfil se calcula en UTC y luego se etiqueta en hora CDMX (`clock.utc_a_cdmx`).

**A2. Luz sobre el panel (POA).**
- Posición del sol (NREL SPA) en el punto medio de la hora.
- DNI y DHI de NASA cuando son válidas; si no, modelo de Erbs.
- **Fijo**: mira al sur con inclinación 0.76·|lat| + 3.1°.
- **Seguidor**: un eje N-S, ±60°, con *backtracking* (GCR 0.35).
- Transposición de Perez (1990) con albedo 0.20; pérdida por ángulo de incidencia ASHRAE (b = 0.05) sobre la directa.

**A3. Temperatura de celda.**
- Modelo SAPM *open rack glass-glass*: T_celda = T_aire + E·exp(−3.47 − 0.0594·v) + (E/1000)·3, con v = WS2M·5^(1/7).
- Coeficiente de potencia: −0.35 %/°C sobre 25 °C.

**A4. Una hora paso a paso.**

Nodo 01AAN-85 (Actopan, Hgo.; 20.269 N, −98.943 E; celda +20, −99). Hora: 21-mar-2024, 12:00-13:00 CDMX, que en el SIN coincide con la hora estándar (18:00 UTC).
1. NASA: GHI = 1,006.9 W/m², DNI = 950.5, DHI = 116.3, T2M = 31.45 °C, WS2M = 2.46 m/s. Viento a 10 m: 3.10 m/s.
2. Sol a las 12:30: cenit 19.87°, azimut 170.6°.
3. Fijo (18.5°, sur): POA = 1,077.5 W/m², T_celda = 62.6 °C.
4. Potencia = 10⁶ × (POA_ef/1000) × [1 − 0.0035·(62.6 − 25)] × 0.9038 = **845.7 kW/MWp**, es decir 0.8457 MWh/MWp en esa hora. El 0.9038 son las pérdidas de sistema.
5. Seguidor (3.4°): POA = 1,012.9 W/m², **0.7989 MWh/MWp**.
6. Baseline marzo, 12:00 CDMX: y = **0.7371** (fijo) y 0.6893 (seguidor).
7. PML del 21-mar-2024, `hora` 13: ts_cdmx = 12:00, 1,085.44 MXN/MWh. Aporta a (2024-03, hora 12, fijo): `n_horas` += 1, `sum_pml_cent` += 108,544, y en el navegador y·Σ = 0.7371 × 1,085.44 = 800.1 MXN/MWp.

En BCA, la misma hora solar tiene otra etiqueta, pero el cruce es por instante. Ejemplo: a las 12:00 CDMX de julio, BCA publica la `hora` 12 (en verano su hora civil va 1 h detrás de CDMX).

**A5. "Atajo REPSA".** [pendiente] El deck de referencia no está en el repo. Lo más cercano en el código es el atajo de este pipeline: un perfil de año típico mes × hora multiplicado por los PML horarios reales, con sumas aditivas.

## 10. Dudas abiertas para el orquestador

1. **Supuestos de negocio** (en espera): tasa real o nominal, vida útil, capex y opex con su unidad, degradación, tipo de cambio, semáforo, escenarios, impuestos.
2. **Umbral de año completo:** el 95 % cambia KPIs publicados en 13 nodos (§4); se mantiene el 100 %. Si se quiere el 95 %, ¿se aceptan esos cambios? Y en ese caso, ¿se anualiza el ingreso de esos años? Hoy no se anualiza nada.
3. **Códigos renombrados:** el historial queda en dos series, la del código viejo (con ficha y bandera `renombre`) y la del nuevo. ¿Se unen en una sola serie continua por nodo físico?
4. **Pesos reales:** ¿la base debe ser el último mes de la tabla (hoy 2026-09) o un mes fijo? ¿Se muestran en la UI como alternativa o como principal?
5. **BCA/BCS**: 149 nodos esperan sus celdas NASA. 54 nodos no tienen coordenadas: 44 bajas del catálogo sin renombre declarado y 10 en el catálogo sin municipio con centroide.
6. **Deck vs. proyecto** [resuelto]: el escenario del deck va en un bloque aparte y rotulado ("escenario del deck (supuestos del deck de REPSA)"), junto a los KPIs del proyecto pero sin mezclarse.
7. **LCOE fijo frente a varios años** [resuelto]: la comparación principal usa precios en pesos de hoy (`_real`) y la nominal se conserva (`_nominal`). Ver §11.

## 11. Análisis del deck "Nodal Solar Value" recalculado (`data/analysis/`)

Se genera con `.venv/bin/python pipeline/kpis.py --analisis` (≈15 s; `schema_version` 1.1.0 de analysis.json; se lee de `data/aggregates/` y, para el rango de λᴱ, de la base en solo lectura). Los campos están en `data/analysis/README.md`.

**Mapa de diapositivas** (numeración del usuario: portada = 1; el deck tiene dos diapositivas "Prices" y dos "Value factor"). Cada sección e insight de `analysis.json` lleva una clave `slide` con esta numeración, y `diapositivas` indexa campos, insights y comparaciones por número.

| # | Diapositiva | Campos |
|---|---|---|
| 1 | Portada | — |
| 2 | 01 Notation | — (solo símbolos) |
| 3 | 02 Prices | `perfil_horario_nacional` (slide 3), `nacional.{pml_medio, p_cap, vf, pct_e0}` |
| 4 | 02 Prices explorer (cualquier nodo, estado o región) | `regiones`, `estados` y `perfil_horario_regiones`. En el seguidor, `explorador`: `perfil_horario_estados`, `vf_mensual_regiones`, `vf_mensual_estados`. Para un nodo: `analysis_nodos.json` y su ficha |
| 5 | 03 Revenue | `ingreso_*`, `sobreestimacion_atajo_pct`, barras `ingreso_*_h` |
| 6 | 04 Value factor (canibalización) | `vf_distribucion`, `tendencia_vf_entre_ventanas`, `tendencia_vf_anual_tracker`, `vf_mensual_nacional` |
| 7 | 04 Value factor por región de control | `tabla_vf_regiones`: las 7 regiones con VF (y su mediana entre nodos), PML medio, P_cap nominal y real, %E₀, congestión, spread, VF_req, cobertura real y nominal, ΔVF y % de nodos con VF a la baja entre ventanas, y `deck_impreso` (cifras que el deck imprime por región) |
| 8 | 05 Profitability (escenario del deck) | `escenario_deck`, `*_real`/`*_nominal`, `sensibilidad_lcoe`, `cobertura_lcoe_real_vs_nominal` |
| 9 | 06 Node P&L (escenario del deck) | `pyg_deck` (nacional y `por_region`) |
| 10 | 07 Conclusions | `comparacion_deck`, `insights`, `ranking_atajo_vs_real` (A5) |
| — | Assumptions and sources; apéndice A1-A5 | `escenario_deck.citas`, `diferencias_metodo_vs_deck`, `no_reproducible` |

**LCOE contra precios en pesos de hoy** (decisión del usuario).
- El LCOE del deck está en pesos de 2026 (40 USD × 17.84). Por eso la prueba principal P_cap ≥ LCOE, el VF requerido, el margen, el P&L y la sensibilidad se calculan con precios **reales**: base INPC 2026-09, deflactados mes por mes como en §4.
- Esos campos llevan el sufijo `_real`. Los mismos campos con precios nominales llevan `_nominal` y son los que se comparan contra el deck, que usó precios nominales.
- **Cuánto cambia** el % de nodos que cubren 714 (real − nominal):

| Ventana | Pesos de hoy | Nominal | Cambio |
|---|---|---|---|
| Periodo completo | 80.6 % | 62.2 % | **+18.4 pp** (la inflación de 2020-2023 pesa) |
| Ago-2024 a jul-2025 | 34.5 % | 31.6 % | +2.9 pp |
| Ago-2025 a jul-2026 | 5.2 % | 4.9 % | +0.2 pp |
| Ago-jun 2024-25 | 35.0 % | 33.2 % | +1.8 pp |
| Ago-jun 2025-26 | 5.8 % | 4.9 % | +0.9 pp |

- Margen promedio por MWp (12 meses, pesos de hoy):
  - 2024-25: −0.16 M MXN (nominal −0.23);
  - 2025-26: −0.46 M MXN (nominal −0.48).

**Definiciones** (iguales a las del deck):
- Para cada nodo: PML medio = media simple de todas sus horas; P_cap = Σy·PML/Σy; VF = P_cap/PML medio; %E₀; Y_f = Σy (MWh/MWp en la ventana); R = Y_f·P_cap; R_atajo = Y_f·PML medio.
- **Áreas** (nacional, región, estado): promedio simple entre nodos, con **VF = cociente de promedios** (como el deck). El área también reporta la mediana del VF de sus nodos.
- **Universo:** SIN, con baseline, ≥ 300 días (7,200 h) de PML en la ventana, sin los 3 nodos de Cozumel.
- **Perfil horario:** para cada nodo, el promedio de cada hora CDMX en el rango; después, el promedio simple entre nodos.
- **Spread punta − solar:** media de PML en las horas 18-21 menos la media en las horas 6-17 (inicio de hora).
- **VF del día promedio** = Σ_h ȳ_h·PML̄_h / (PML̄·Σ_h ȳ_h).
- **Ventanas:**
  - `deck_2024_25` y `deck_2025_26` son ago-jul, 12 meses: llevan ingreso y P&L, sin anualizar.
  - `*_ago_jun` son los días que el deck usó en sus KPIs solares: 11 meses, sin ingreso ni P&L (no se anualiza).
  - `completo` = 2020-01 a 2026-09.

**Escenario del deck (no son supuestos del proyecto):**
- Del deck: LCOE de 40 USD/MWh = 714 MXN/MWh (y 20 USD = 357), TC 17.84 MXN/USD, seguidor, 1 MWp.
- **Umbrales en MXN, iguales en todos los bloques (incluida la sensibilidad):** para 20 y 40 USD se usan los valores que imprime el deck, 357 y 714 MXN/MWh (40 × 17.84 = 713.6 se redondea a 714, como en el deck). Para los demás umbrales de la sensibilidad (25, 30, 35, 45-60 USD), que el deck no imprime, se usa USD × 17.84 sin redondear (`kpis.lcoe_mxn`).
- Π = Y_f·(P_cap − LCOE) por MWp; VF_req = LCOE / PML medio.
- El deck **no** imprime capex, O&M, tasa ni vida útil, así que TIR, VAN y un LCOE propio quedan en `null`.
- El −14 % de pérdidas del deck **no** se aplica: nuestro y ya incluye las pérdidas de sistema.
- `config/supuestos.yaml` sigue PENDIENTE.

**Diferencias de método con el deck:**
- Producción:
  - año típico mes × hora (2015-2025) en lugar del clima real de cada ventana;
  - transposición de Perez con DNI/DHI de NASA en lugar de cielo isotrópico con Erbs;
  - temperatura SAPM con viento en lugar de T_c simplificada;
  - pérdidas de sistema en el modelo en lugar del −14 % posterior.
- Días: todas las horas con PML del rango; el deck usaba solo días completos con NASA.
- Universo: hay 6 nodos renombrados más; el umbral de 300 días es de PML, no de NASA.
- En el SIN 2024-2026 el reloj CDMX coincide con el del deck.

**Deck vs. nuestro** (seguidor; ventana ago-jun cuando el deck usa KPIs solares). "Reproducido" = dentro de máx(2 %, media unidad del último dígito impreso).

| Cifra | Deck | Nuestra | ¿Reproducido? |
|---|---|---|---|
| λᴱ SIN media / mín / máx, ago25-jul26 | 586 / 0 / 3,643 | 585.8 / −0.01 / 3,643.25 | sí |
| Congestión media Peninsular / Noroeste | +836 / −217 | +836.0 / −216.5 | sí |
| VF nacional 2024-25 → 2025-26 | 0.86 → 0.79 | 0.860 → 0.799 | sí |
| Sobreestimación del atajo nacional 2025-26 | +26 % | +25.2 % (ago-jun); +26.1 % (ago-jul) | **no** por 0.8 pp (VF 0.799 frente a 0.79) |
| % de nodos con VF a la baja | 97 % | 98.5 % | sí |
| VF Peninsular 2024-25 → 2025-26 | 0.95 → 0.65 | 0.919 → 0.662 | 2024-25 **no** |
| PML medio Noroeste / VF_req a 714 | 260 / 2.75 | 260.4 / 2.74 | sí |
| PML medio Peninsular "por encima de 1,500" | > 1,500 | 1,530 | sí |
| % de energía FV a PML ≤ 0, Noroeste / Norte | 5.9 / 5.8 | 5.55 / 5.37 | **no** (≈ −0.4 pp) |
| % de nodos con P_cap ≥ 714 (nominal; en pesos de hoy 35.0 → 5.8) | 33 → 5 | 33.2 → 4.9 | sí |
| Nodos que cubren 714 (nominal; en pesos de hoy 844 → 140) | 795 de 2,407 → 127 de 2,420 | 800 de 2,410 → 118 de 2,420 | 2025-26 **no** (−9) |
| % de nodos de Peninsular que cubren 714 (2025-26) | 98 % | 98.1 % | sí |
| P_cap Noroeste / Norte 2025-26 | 150 / 213 | 156.0 / 221.9 | **no** (+4 %) |
| Spearman atajo vs. real: nacional / Oriental | 0.98 / 0.87 | 0.983 / 0.837 | Oriental **no** |
| Top-20 comunes en Oriental | 0 de 20 | 0 de 20 | sí |
| VF de Peninsular, Norte y Noroeste (rango) | 0.58-0.65 | 0.599-0.662 | **no** (extremo inferior) |

- Todas las diferencias "no" vienen del lado solar (año típico frente a clima real) o del universo de nodos. Las cifras que solo dependen de precios (λᴱ, congestión, PML medio) coinciden.
- Los hallazgos que **no** se reproducen salen en `insights` con `bandera: true` y ambos números.

**Cifras nuestras** (seguidor, nacional, promedio entre nodos):
- Periodo completo 2020-01 a 2026-09 (2,431 nodos): PML medio 837, P_cap 738 MXN/MWh, VF 0.882.
- 12 meses ago-2025 a jul-2026 (2,424 nodos):
  - Y_f = 2,145 MWh/MWp;
  - R = 1.05 M MXN/MWp;
  - el atajo sobreestima el ingreso en 26.1 %;
  - en el escenario del deck, Π = −0.46 M MXN/MWp por año en pesos de hoy (−0.48 nominal) y solo 5.2 % de los nodos cubren 714 MXN/MWh en pesos de hoy (4.9 % nominal).
- Sensibilidad (% de nodos que cubren el LCOE en 2025-26, pesos de hoy; umbrales 357 / 714 para 20 / 40 USD): 20 USD → 82 %; 30 → 38 %; 40 → 5 %; 50 → 4 % (los valores nominales también se publican).
- Dato nuevo, que el deck no tiene: con años completos 2020-2025, la pendiente de VF es negativa en el 99 % de 2,380 nodos (mediana −0.028 por año).

**No se reproduce** (`no_reproducible`):
- VF con cielo despejado frente a clima real (A1);
- PR y H_POA/H_GHI del atajo (A5): los baselines no guardan irradiación en el plano del panel;
- el ejemplo TG = 2,220 × 40.73 / 1000 (no hay precios de 2022 en USD);
- TIR, VAN y LCOE propio del deck;
- la diapositiva 3 sintética (sliders).

**Pruebas** (`tests/test_kpis.py`, sección F):
- identidades por nodo: R = Y_f·P_cap, R_atajo = Y_f·PML medio, VF = P_cap/PML medio;
- identidades de área: VF = cociente de promedios, sobreestimación, VF_req, costo = E·LCOE;
- el perfil nacional se recompone desde las **fichas publicadas** (tolerancia 2·10⁻⁶);
- determinismo: dos corridas dan el mismo resultado;
- cuentas a mano de `_area` y de la tolerancia;
- `supuestos.yaml` sigue PENDIENTE.

## 12. Configuración (seguidor / fijo) × variante de clima (solar v2)

Código: `pipeline/kpis_variants.py` (cálculo y puertas) y `pipeline/kpis_variants_out.py` (JSON web). Pruebas:
`tests/test_kpis_variants.py`. Plan de solar: `docs/SOLAR_V2_PLAN.md` (§2 variantes, §4 archivos, §5 entrega).

**Fórmulas: sin cambios.** Se reutilizan `kpis._metricas_nodo`, `kpis.a_reales` y `kpis.nodos_json` (extraída de
`analisis()` sin cambiar su salida). Lo único que cambia es el `y` de cada celda: en vez del baseline
`y(mes, hora)` se usa la tabla de la variante de `data/solar_v2/tables_month_hour.parquet` [MWh/MWp por hora], con
clave mes 1..12 (`mean`, `y2015`..`y2025`) o año·100+mes (`win`). Como `y` es constante en cada celda
(nodo, año, mes, hora) de `agregados_comunes`, las sumas ponderadas son exactas:
`Σy = y·n_horas`, `Σ(y·PML) = y·sum_pml_cent/100` (error medido contra el Σ horario del pipeline: 4·10⁻¹³ relativo),
`Σ(y | PML≤0) = y·n_pml_le0`. De ahí, como en §11: `p_cap = Σ(y·PML)/Σy` [MXN/MWh], `vf = p_cap/pml_medio`,
`pct_e0 = 100·Σ(y|PML≤0)/Σy` [%], `y_f = Σy` [MWh/MWp], `ingreso = Σ(y·PML)` [MXN/MWp], `ingreso_atajo = y_f·pml_medio`,
`vf_dia_promedio` (día promedio), `p_cap_real`, `ingreso_real` (mismo deflactor INPC por mes CDMX, base = último mes).
Independientes de config y variante: `n_horas`, `pml_medio`, `pml_medio_real`, `congestion_media`, `spread_punta_solar`.
Universo por ventana: ids de `analysis_nodos.json` con `n_horas ≥ 7 200` (igual que §11; si no, `null`).
**No se anualiza** `y_f` ni `ingreso` (nodos con huecos quedan con sus horas); `yf_annual_equiv` (de
`solar_v2/scalars.parquet`: rendimiento de 12 meses de la variante) viaja aparte, solo informativo.

Dimensiones: config `tracker` / `fijo` (parquet: `fixed`); variantes `mean` = "Yearly mean 2015-2025" (por defecto,
= publicado), `y2015`..`y2025`, `win` = clima real de cada mes de la ventana. `clear` (cielo despejado) queda solo como
referencia de irradiancia/producción en `variants/clear.json`, sin KPIs. Ventanas: Y1 = 2024-08..2025-07, Y2 =
2025-08..2026-07 para todas las variantes; `completo` y las ventanas ago-jun solo para `mean` (en `analysis_nodos_*`).
**Nota 2015** (mediana entre nodos de `yf_annual_equiv` de `y2015` sobre la referencia, seguidor): en los 2 431 nodos
del universo KPI, −6.1 % frente a `mean` 2015-2025 (que incluye 2015) y −6.7 % frente al promedio de los otros diez
años (2016-2025); en los 2 605 nodos de solar, −5.9 % frente a `mean`. Probablemente un cambio de insumos
MERRA-2/CERES [sin verificar]. Se mantiene dentro de `mean` (decisión de Nico) y la UI lo rotula
(`note_2015` en `variant_scalars_*.json`).

**Archivos** (`data/solar_v2/web/`, ignorado por git; `web/tools/build_solar_web.py` los copia a `web/data/solar_v2/`
junto con `variants/{v}.json` y `scalars.json` de solar). Tamaños medidos (gz nivel 9):

| Archivo | Contenido | bytes / gz |
|---|---|---|
| `analysis_nodos_tracker.json` | copia byte a byte del `analysis_nodos.json` publicado (verificada) | 1.28 MB / 474 KB |
| `analysis_nodos_fijo.json` | mismo esquema, config fijo, `mean`, 5 ventanas | 1.28 MB / 473 KB |
| `variant_scalars_{tracker,fijo}.json` | columnar sobre `ids` (orden de analysis_nodos): `shared[Y1/Y2]` (5 campos comunes) y `data[variante][Y1/Y2]` con `p_cap, vf, y_f, ingreso, yf_annual_equiv` | 3.27 MB / 1.21 MB c/u |
| `variant_extra/{tracker,fijo}/{variante}.json` | `pct_e0, ingreso_atajo, vf_dia_promedio, p_cap_real, ingreso_real` de una variante (Y1/Y2), exactos | 0.23 MB / 100 KB c/u (26) |
| `node_profiles_fijo.json` | esquema de `node_profiles.json` (pml, pérdidas, congestión, y; Y1/Y2), config fijo, `mean` | 2.94 MB / 926 KB |
| `reconciliation.json` | resultado de las puertas, tamaños, estadísticas vf_fijo − vf_tracker | 11 KB |

Decisión de tamaño: con los 9 campos + `yf_annual_equiv` en un archivo por config serían ≈2.4 MB gz (> 2 MB de
presupuesto), así que `variant_scalars` lleva el núcleo de 5 campos y el resto va **exacto** (no aproximado) en
`variant_extra`, que la web carga al elegir variante. Redondeo: 4 decimales, como `analysis_nodos.json`.

**Puertas de conciliación** (el build falla sin escribir nada si alguna no se cumple; resultados en `reconciliation.json`):
1. `mean` por la ruta solar_v2 contra la ruta publicada (`agregados_config`), **ambas configs**, las 5 ventanas,
   los 14 campos: error relativo máximo 2.3·10⁻⁹ (tolerancia 10⁻⁶).
2. `analysis_nodos` seguidor recalculado contra el publicado (4 decimales): mismos ids, campos y `null`; error
   relativo máximo 2.1·10⁻⁹ (tolerancia: 5·10⁻⁵ de redondeo + 10⁻⁶ relativo).
3. `y_f` y `n_horas` de cada variante × Y1/Y2 × config contra `solar_v2/scalars.parquet`: 2.4·10⁻¹⁶ relativo.
4. `n_horas` idéntico entre configs y variantes; `y_f` fijo < seguidor en todo nodo y variante.
5. `node_profiles_fijo`: filas de precio idénticas a `node_profiles.json`; `y` = `variants/mean.json` (fijo).

vf_fijo − vf_tracker (13 variantes × Y1/Y2): mediana −0.016..−0.011 en Y1 y −0.002..0.000 en Y2, |Δ| máximo 0.089;
ningún nodo fuera de ±0.15. Pruebas: ejemplo a mano (1 nodo, 24 h), deflactor, `win` con clave año-mes, identidades
(`vf = p_cap/pml_medio`, `ingreso = y_f·p_cap`, `ingreso_real = y_f·p_cap_real`, `ingreso_atajo = y_f·pml_medio`),
recálculo independiente en numpy de 3 nodos × 3 combinaciones (incluye `win` y `y2020`), sin NaN/−999, presupuestos gz.

Comandos: `NODAL_DATA_ROOT=$PWD .venv/bin/python pipeline/kpis_variants_out.py` (≈1.5 min) y luego
`.venv/bin/python web/tools/build_solar_web.py`.

## 13. Serie diaria (PML + producción con el clima real del día)

Código: `pipeline/daily_series.py` (fórmulas puras, codificación, áreas), `pipeline/daily_gates.py` (puertas),
`pipeline/daily_build.py` (orquestación). Copia web: `web/tools/build_daily_web.py`. Pruebas: `tests/test_daily_series.py`.
Propósito: que la web calcule medias móviles de 7 días **en el navegador** a partir de valores diarios; aquí no se
calcula ninguna media móvil ni se anualiza nada.

**Eje y cobertura.** Día = día calendario en hora estándar de CDMX (UTC−6 fijo, `clock.ts_cdmx`, la misma de los
agregados). Primer y último día con 24 horas de PML en algún nodo, derivados de los datos: 2020-01-01 .. 2026-09-30
(`n` = 2 465 días; el día `i` es `start + i`). Las horas de BCA/BCS que caen el 2026-10-01 CDMX quedan fuera (también
fuera de toda ventana publicada). Universo: los 2 431 ids de `analysis_nodos.json`, en su orden.

**Clima.** Serie horaria NASA POWER de la celda de 1° del nodo, cargada con `solar_full.load_cell` (cache vieja
2015-2026-06 + `solar_cache/refresh2026`; BCA/BCS desde `solar_cache/climatologia`), GHI válido hasta
2026-07-31 23:00 UTC. Día válido = 24 horas con GHI (`solar.valid_day_mask`, la regla de `win`); el último día válido
es 2026-07-30 CDMX (al 31 le faltan 6 horas UTC). Producción: exactamente `solar.hourly_pv_power(..., geom,
dni_dhi_source="nasa")` + `solar.to_cdmx`, como `solar_scenarios.run_scenarios` (seguidor y fijo con inclinación
0.76·|lat|+3.1, derate 0.904, DC/AC 1.0). **Se corre sobre la serie completa de la celda** (no recortada): el modelo
rellena huecos de T2M/viento con la media por clave de toda la serie, así que recortarla cambia ≈10⁻⁶ algunos meses
(se detectó con la puerta c). Solo el clima cambia respecto a lo publicado: real del día en vez del día promedio.

**Fórmulas por nodo y día `d`** (H_d = horas del día con PML; `y_h` en MWh/MWp por hora):

| Campo | Fórmula | Unidad | Nulo cuando |
|---|---|---|---|
| `n_horas` | \|H_d\| | h | sin PML ese día |
| `pml_avg` | Σ round(100·PML)/100 / n_horas (centavos, igual que `pml_medio`) | MXN/MWh | sin PML |
| `energia_avg`, `perdidas_avg`, `congestion_avg` | ídem con cada componente (energía = PML − pérdidas − congestión, nombres de `node_profiles`) | MXN/MWh | sin PML |
| `spread` | max(PML) − min(PML) sobre H_d | MXN/MWh | sin PML |
| `y_day` | Σ_{H_d} y_h (mismas horas que `y_f` publicado) | MWh/MWp | sin PML o día sin clima válido |
| `horas_solares` | #{h ∈ H_d : y_h > 0} | h | ídem |
| `ingreso_dia` | Σ_{H_d} y_h·PML_h (PML crudo, como `sum_y_pml`) | MXN/MWp | ídem |
| `p_cap_dia` | ingreso_dia / y_day | MXN/MWh | ídem o y_day = 0 |
| `vf_dia` | p_cap_dia / pml_avg | — | ídem o pml_avg ≤ 0 |

Identidades exactas (antes de cuantizar): `ingreso_dia = y_day·p_cap_dia`, `vf_dia = p_cap_dia/pml_avg`. Con 24 horas
de PML, `y_day` = producción física del día. Pesos nominales; pesos de hoy = valor × `deflator_mensual.factor` del mes
CDMX del día (INPC(2026-09)/INPC(mes), mismo `kpis.deflactor` y base 2026-09 que lo publicado; `vf`, MWh y horas no
cambian).

**Áreas** (ALL, 7 regiones de `analysis_nodos`, 30 entidades): por día, media simple entre nodos miembros **con dato
ese día** (como `kpis._area`). Lado PML: miembros con `n_horas > 0`; medias de `pml_avg`, componentes y `spread`.
Lado config: miembros con `p_cap_dia` no nulo; medias de `y_day`, `horas_solares`, `p_cap_dia`, `ingreso_dia` y
`pml_avg` sobre **ese** conjunto, y `vf_dia` = media(p_cap_dia) / media(pml_avg) (cociente de promedios). `n_nodos`
viaja por día y lado.

**Archivos** (`data/solar_v2/daily/`, ignorado por git; se escribe en un temporal y solo se publica si pasan todas
las puertas; un `daily/` existente solo se reemplaza con `--replace` si lo escribió este módulo):
`nodes/{id}.json` = `{schema_version:"daily/1", id, start, n, scale, pml:{6 campos}, tracker:{5}, fijo:{5}}`;
`areas/{ALL|region-<NOMBRE>|state-<NOMBRE>}.json` (mismo esquema + `n_nodos`, índice en `manifest.areas`);
`deflator_mensual.json` (`months`, `factor`, `base`); `manifest.json` (días, ids, campos, escalas, nulos, áreas,
tamaños, versiones, resultado de las puertas). Codificación: listas JSON de enteros, valor = entero × `scale[campo]`,
`null` = sin valor. Escalas: n_horas, horas_solares, n_nodos 1; pml_avg, energia_avg, spread, p_cap_dia, ingreso_dia
0.1; perdidas_avg, congestion_avg 0.01; y_day 10⁻⁴; vf_dia 10⁻⁴. Error de ida y vuelta ≤ escala/2 (probado).
Tamaños medidos (gz nivel 9): nodo mediana 79.6 KB, máximo 84.9 KB (presupuesto 120 KB), total nodos 190 MB gz
(477 MB crudo; la web carga solo los nodos elegidos); cada área ≈91-97 KB gz (38 áreas, 3.5 MB).

**Puertas de conciliación** (`daily_gates.py`; el build falla sin publicar nada; resultado en `manifest.reconciliation`).
Ventanas: completo 2020-01..2026-09, Y1 2024-08..2025-07, Y2 2025-08..2026-07 (meses CDMX).
- (a) Media ponderada por horas de `pml_avg` diario = `pml_medio` publicado (`analysis_nodos`, 4 decimales):
  máx. 2.3·10⁻⁷ rel / 5.0·10⁻⁵ abs (= redondeo); `congestion_media` 5.0·10⁻⁵ abs (el relativo, 2.6·10⁻³, viene del
  redondeo de valores ≈0). Las 4 sumas en centavos (pml, energía, pérdidas, congestión) y `n_horas` = `agregados_comunes`
  **exactas** (enteros) en todo nodo y ventana.
- (b) Σ `n_horas` diario por ventana = `n_horas` publicado: 0 diferencias.
- (c) Para cada nodo × config × mes de `win` (24 meses): Σ de la producción de día completo (24 h, solo clima) sobre los
  días de clima válido del mes = Σ_h win[mes,h] × nd(mes) de `tables_month_hour.parquet`, y #días válidos = nd:
  máx. 7·10⁻¹⁶ rel, 0 discrepancias de nd (nd = días del mes en 23 meses; 2026-07 tiene 30). Además `y_day` = día
  completo en todo día con 24 h de PML (5·10⁻¹⁵ abs).
- (d) Exacta: usando en cada hora con PML el `y` del día promedio de `win`, Σ y·PML y Σ y por Y1/Y2 = `ingreso` e `y_f`
  publicados de `win` (`variant_scalars_*`): máx. 3.6·10⁻⁸ rel (redondeo), ambas configs. Informativa: Σ `ingreso_dia`
  (clima del día) vs `ingreso` `win` publicado, cota |rel| ≤ 10 %. Distribución (rel): seguidor Y1 p5 −1.9 %,
  mediana −0.4 %, p95 +1.3 %, extremos −2.8/+2.7 %; Y2 p5 −2.5 %, mediana −0.4 %, p95 +1.7 %, extremos −5.2/+3.2 %;
  fijo muy parecido (Y2 −4.8/+2.8 %). Causas: emparejamiento diario clima×precio (lo que se quiere medir) y, en Y2, el
  2026-07-31 sin clima válido (1 día con PML sin `y_day`; en `completo` son 62 días: 2026-07-31..2026-09-30).
- (e) 5 áreas (ALL, CENTRAL, 3 entidades) recalculadas desde los archivos de nodo **decodificados** = archivo de área
  decodificado dentro de una unidad de escala (máx. 1.0 en `energia_avg` por dos redondeos de ½), `n_nodos` exacto,
  `vf_dia` dentro de la tolerancia de cuantización. PML anual ALL (años completos 2020-2025, nodos con 12 meses
  completos) = `series_areas.json`: máx. 0.032 MXN/MWh (publicado a 0.1), mismo número de nodos cada año.
- Identidades sobre valores sin cuantizar: máx. 2.2·10⁻¹⁶.

Corrida completa: 353 s con 8 procesos (2 431 nodos, 0 errores, 0 faltantes). Comandos:
`NODAL_DATA_ROOT=$PWD .venv/bin/python pipeline/daily_build.py [--replace]` y luego
`.venv/bin/python web/tools/build_daily_web.py` (copia byte a byte a `web/data/solar_v2/daily/`).

**Medias móviles de 7 días (contrato para la web; referencia `daily_series.ma7` / `ma7_ratio`, probadas).**
Los valores diarios no cambian. `vf_dia` diverge cuando `pml_avg` está apenas sobre 0 (rango medido −1 296..+382;
1 067 nodo-config-días con |vf| > 5; ej. 04MAP-115 el 2024-04-03), así que **nunca se promedia `vf_dia` ni
`p_cap_dia`**. Ventana = los 7 días que terminan en el día i; se saltan los días nulos y se exige **≥ 4 días válidos**
(si no, nulo). Precio capturado 7d = Σ ingreso_dia / Σ y_day; VF 7d = ese cociente / (Σ n_horas·pml_avg / Σ n_horas)
(día válido: ingreso, y, pml_avg y n_horas no nulos; nulo si Σ y ≤ 0 o el PML ponderado ≤ 0). PML, energía,
pérdidas, congestión y spread: media ponderada por `n_horas`; `y_day`, `ingreso_dia`, `horas_solares`: misma media
ponderada por `n_horas` (con 24 h por día equivale a la media simple). Áreas: igual, con sus campos de área.
**Días con pocas horas:** 39 nodo-días tienen `n_horas` = 1: el primer día de nodos que empiezan en verano con horario
de verano (2020-22); su hora 1 cae a las 23:00 CDMX del día anterior, correcto con el reloj fijo. La ponderación por
`n_horas` los vuelve despreciables en PML; recomendación: excluir de la serie de `spread` los días con `n_horas` < 12
(un max−min de pocas horas no es comparable).
**Puerta (d) mediana** (`daily_gates.median_gate`): |mediana entre nodos| de (Σ ingreso_dia − ingreso `win`)/ingreso
`win` ≤ 1.5 % por config y ventana (un desfase de 1 h del reloj la mueve +2..+12 % / −1..−7 %). Medido: seguidor Y1
−0.44 %, Y2 −0.45 %; fijo Y1 −0.42 %, Y2 −0.45 %.
