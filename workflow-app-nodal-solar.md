# WORKFLOW v2 — Nodal Solar Value (REPSA)

Documento maestro para Claude Code. Léelo completo antes de escribir código. Si algo contradice una suposición tuya, gana este documento. Si falta información, pregunta a Nico; no inventes. Interfaz: seguir `DESIGN.md` (en la raíz del repo).

## 1. Objetivo y decisiones cerradas

Herramienta **interna de REPSA** (posible venta futura) que, dada una ubicación en México, explica la rentabilidad de un proyecto solar con PML de CENACE + recurso solar. Mayoristas primero; minoristas después.

| Tema | Decisión |
|---|---|
| Periodo | **2020-01-01 a hoy**. El usuario elige su propio periodo con un selector de rango (por mes). |
| Sistemas | SIN, BCA, BCS. Mercado MDA. MTR queda para después. |
| Nodo válido | Mínimo **12 meses** de datos en 2020-2026. Si el periodo elegido trae menos de 12 meses para ese nodo, mostrar aviso de baja confianza. |
| Tasa, capex, opex | **Por definir con el equipo.** Viven en `config/supuestos.yaml` marcados `PENDIENTE`; la UI los muestra como "provisional" y no emite veredicto verde/rojo hasta que se confirmen. |
| Datos | DuckDB/Parquet local (no va a git). Solo los datos **tratados** (JSON por nodo) se publican en la nube. |
| Nube | Cloudflare Pages + R2 (estático). Sin Supabase hasta la fase de venta (usuarios/proyectos guardados). |
| Acceso | Contraseña compartida. Debe proteger **también** los JSON de datos, no solo el HTML. |
| Actualización | Job diario (GitHub Actions); si CENACE bloquea sus IPs, tarea programada en el Mac de Nico. |
| Fuera de alcance ahora | PDF, cuentas de usuario, app en tiendas, emular HelioScope, Streamlit. |
| Almacenamiento (regla 30 %/3 h) | Solo escenario hasta tener texto oficial verificado. |

## 2. Estado de los datos (verificado el 9-oct-2026)

Carpeta `CSV/` del Mac de Nico (`Analysis_PML/CSV`): **MDA de SIN, BCA y BCS, cobertura continua 2020-01-01 a 2026-09-30, cero días faltantes** (comprobado por la columna `Fecha`).
- Limpieza ya hecha: se borraron 16 CSV idénticos (copias dentro de carpetas `...Ene01 v2026...` y `...Ene01 v2023...`). Quedan 486 archivos únicos.
- **Trampa del origen**: la cabecera de algunos archivos miente. `Ene01 v2022` (BCA/BCS/SIN) dice "enero de 2021" pero contiene 2022-01-01 a 15. **Nunca** inferir el mes del nombre ni de la cabecera: usar siempre la columna `Fecha`. Esos archivos son versiones distintas, no duplicados.
- Formato: 6 líneas de cabecera + encabezado; columnas `Fecha, Hora, Clave del nodo, PML, Energía, Pérdidas, Congestión`. Mezcla de comillas y fechas entre años; el lector debe tolerarlo. Archivos en carpetas por año (2020-2023) y sueltos (2024+).
- La base antigua `db/pml.duckdb` (SIN MDA dic-2023 a jul-2026) se descarta; se reconstruye desde los CSV.

**Reloj** (`hora` = hora que termina; inicio = `hora − 1`)
- Verificado: SIN 2024-2026 siempre 24 filas por nodo-día (reloj fijo del Centro, UTC−6). Los manuales SW-PML/PEND/PSC no mencionan zona horaria.
- **Pendiente (primera tarea de `clock-qa`)**: SIN, BCA y BCS en 2020-2022 (con horario de verano: 5-abr y 25-oct-2020; 4-abr y 31-oct-2021; 3-abr y 30-oct-2022, fechas calculadas, verificar), y la frontera norte tras 2022. Criterio: 23/25 filas o hora duplicada = reloj civil; siempre 24 = fijo. Para BCA/BCS comparar la hora del valle/pico diario contra SIN. Salida: `clock.py` con `ts_local_estandar` y pruebas por fecha.

## 3. Arquitectura

```
CSV del portal (histórico) ─┐
API SW-PML/PEND/PSC (incr.) ┼─► Parquet + DuckDB (local, NO en git)
NASA POWER / NSRDB (clima)  ─┘            │
                                          ▼
                   limpieza → reloj → calidad → producción FV → agregados mensuales aditivos
                                          │
                                 JSON por nodo (≈50 KB gz)
                                          │
                    Cloudflare Pages/R2 (contraseña) ─► PWA: mapa, sliders, nodo, rentabilidad
```

**Agregado mensual aditivo (clave para "cada quien escoge su timeframe")**: por nodo, por mes y por hora del día (y por configuración fija/seguidor) se guardan sumas, no promedios: `Σ(y·PML)`, `Σy`, `Σ PML`, `n`, `Σ(y donde PML≤0)`, más componentes energía/pérdidas/congestión. Como las sumas son aditivas, cualquier rango de meses se combina **exacto** en el navegador, sin recalcular en servidor. Esto elimina el error de agregación mes×hora para la configuración de referencia (validar contra horario completo en 10 nodos). Cambiar de configuración de planta distinta a las precalculadas queda como aproximación declarada.

## 4. Repositorio (carpeta nueva)

```
nodal-solar/
  README.md  WORKFLOW.md  CLAUDE.md  DESIGN.md
  config/supuestos.yaml        # tasa, capex, opex (PENDIENTE)
  pipeline/ ingest_portal.py ingest_api.py clock.py quality.py solar.py aggregates.py kpis.py publish.py
  web/      # PWA estática: index.html, sw.js, manifest, assets/, data/
  tests/    # pytest
  docs/     CORRECCIONES.md  TECNICO.md (fórmulas y apéndice)
  data/     # .gitignore
  .claude/agents/*.md
  .github/workflows/  # CI + job diario
```

**Git**: `main` protegida; ramas `fase-N/tema`; commits pequeños y frecuentes, push continuo; mensaje = qué y por qué. Nunca subir datos crudos, `.duckdb`, `.parquet`, claves. Cada corrección de datos → `docs/CORRECCIONES.md` (fecha, qué, efecto). Todo KPI nuevo o cambiado lleva su prueba.

## 5. Agents (reparto del trabajo)

Cada agent es un archivo `.claude/agents/<nombre>.md` con su `model`. Regla: **modelo grande donde hay juicio o riesgo de error silencioso; pequeño donde el trabajo es mecánico y verificable por pruebas.** Cada agent es dueño de sus carpetas (evita conflictos de merge) y trabaja en su propia rama o worktree.

| Agent | Modelo | Es dueño de | Tarea |
|---|---|---|---|
| `orquestador` | opus | WORKFLOW, CLAUDE.md, PRs | Reparte fases, fusiona ramas, resuelve dudas con Nico, no escribe código de módulos |
| `ingest` | haiku | `pipeline/ingest_*` | CSV → Parquet idempotente (usa `Fecha`, no cabecera), dedupe por contenido, incrementos por API con reintentos |
| `devops` | haiku | `.github/`, hosting | Repo, CI, `.gitignore`, job diario, Cloudflare, contraseña que cubra los JSON |
| `clock-qa` | opus | `pipeline/clock.py` | Pruebas de reloj SIN/BCA/BCS 2020-2026; decide la convención; es bloqueante para los demás |
| `calidad` | sonnet | `pipeline/quality.py` | Cobertura por nodo, regla de ≥12 meses, nodos que entran/salen, outliers, reporte |
| `solar` | sonnet | `pipeline/solar.py` | pvlib, climatología larga NASA POWER (−999 = faltante), comparación con NSRDB, perfil físico vs. seno en 5-10 nodos |
| `kpis` | opus | `pipeline/aggregates.py`, `kpis.py` | Agregados aditivos y KPIs; pruebas contra 3 nodos calculados a mano; escribe `docs/TECNICO.md` |
| `frontend` | sonnet | `web/` | PWA según §7 y `DESIGN.md`; arranca con datos simulados que respetan el contrato |
| `validador` | opus | `tests/validacion/` | Revisa de forma independiente cifras, unidades y cada PR de `kpis`/`clock-qa`; no ve el razonamiento del autor, solo el código y los datos |

**Olas (paralelo dentro de cada ola)**
1. `devops` + `ingest` + `frontend` (con datos simulados) + `clock-qa`.
2. `calidad` + `solar` (cuando `clock-qa` fije la convención).
3. `kpis`, y `validador` en cuanto haya primera salida.
4. `frontend` conecta datos reales de ~20 nodos → Nico aprueba layout.
5. `devops` publica y activa el job diario; luego los 2,469 nodos.

Un agent que descubra una duda de negocio la devuelve al `orquestador`; no la decide.

## 6. KPIs

**Mostrar siempre**
1. Veredicto con rango y semáforo (sin veredicto mientras `supuestos.yaml` esté `PENDIENTE`).
2. Ingreso/MWp-año (peor año, mediana, mejor año) y su descomposición producción × precio base × VF.
3. Precio capturado y precio base del nodo (MXN y USD/MWh), con delta vs. componente de energía.
4. VF con tendencia anual y mínimo mensual (convención "todas las horas" declarada).
5. % de energía FV a PML ≤ 0 y MWh/MWp en riesgo.
6. TIR de proyecto desapalancada y VAN, con la tasa visible.
7. LCOE vs. precio capturado y precio break-even equivalente a PPA.
8. Basis de congestión vs. referencia (mismo perfil FV).
9. Escenarios base / conservador / crisis / optimista, una línea de supuestos cada uno.
10. Calidad y cobertura: meses de PML en el periodo elegido, % horas faltantes, fuente y periodo del clima, confianza.

**Bajo demanda**: mapa de calor hora×mes; VF mensual; P50/P75/P90, FC, PR, degradación; TIR de capital y DSCR (solo con deuda); tornado; concentración de ingreso (% en el 5 % de horas más caras); payback; horas congestionadas por mes; detalle de batería.

**No mostrar**: datos horarios crudos; "Total Generation Priority" como ranking; spread % para baterías; batería con previsión perfecta como caso base; perfil seno sin aviso; probabilidades de TIR con pocos años (usar "N de M años"); volatilidad horaria como KPI de proyecto.

**Después (fuente nueva)**: VF vs. penetración (generación CENACE); MDA vs. MTR; basis por zona de carga (SW-PEND); servicios conexos (SW-PSC); gas.

Alcance honesto, visible en la UI: el PML MDA no es el ingreso real (desbalances a MTR); no incluye potencia, CEL, conexos, transmisión ni contratos bilaterales. Rótulo: "precio capturado MDA (referencia)".

## 7. Interfaz web

**Base de contenido**: el deck "Nodal Solar Value" (claude.ai/artifact/AkYDk7Q7Luy563gu4ArAef; HTML guardado como referencia en `docs/referencia/deck.html`). **Base visual**: `DESIGN.md` (Runway: papel crema, tinta espresso, ámbar como único color de acción). Del deck se toma la historia y las interacciones; su paleta verde oscuro se **descarta**.

**Recorrido (una sola página fluida, secciones con scroll suave y transiciones animadas)**
1. **Introducción** = la lámina 3 del deck ("Prices": *un proyecto cobra el precio capturado, no el promedio*). Sliders: caída de mediodía, pico de la tarde, montaje (fijo/seguidor). Cuatro cifras que se animan al mover: promedio, capturado, VF, % a PML ≤ 0. **Sin fórmulas** en pantalla; solo la idea y la gráfica.
2. **Mapa interactivo** de México: nodos coloreados por VF o precio capturado (escala ámbar→espresso). Zoom, filtro por sistema/estado, búsqueda, clic abre la ficha.
3. **Ficha del nodo**: veredicto, KPIs "mostrar siempre", gráfica de día típico, descomposición del ingreso.
4. **Selector de periodo**: slider de rango (mes inicial–final, 2020-2026) que recalcula todo con animación suave; aviso si hay <12 meses.
5. **Rentabilidad**: sliders de MWp, capex, opex, tasa, degradación; TIR/VAN/LCOE se mueven en vivo.
6. **Comparar** nodos (2-4).
7. **Técnico y apéndice**: aquí viven todas las fórmulas (renderizadas con KaTeX local), supuestos, fuentes, calidad de datos y el apéndice A1-A5 del deck (pvlib/NASA POWER, luz sobre el panel, temperatura, una hora paso a paso, atajo REPSA).

**Requisitos técnicos**
- Fluidez: transiciones a 60 fps, solo `transform`/`opacity`; respetar `prefers-reduced-motion`; cálculos pesados en Web Worker; datos de un nodo bajo demanda (≈50 KB), nunca todo el país.
- Mapa: MapLibre GL con teselas propias (Protomaps/PMTiles de México en R2) para que funcione sin servicios de pago y sin conexión; estilo claro cálido acorde a `DESIGN.md`.
- PWA: instalable, service worker con caché de la app y de los nodos visitados.
- Gráficas: SVG/canvas propio o librería ligera; sin dependencias CDN en producción (todo empaquetado).

**Reglas de `DESIGN.md` que hay que respetar (y dónde chocan con el producto)**
- Tipografía Inter Variable (sustituto declarado de Interphases Pro); pesos 400/492/584; interlineado ≤1.25; radios 8 px (4 px en etiquetas); sombras cálidas; colores solo de la paleta.
- **Choque 1: semáforo y series de gráficas.** `DESIGN.md` prohíbe azul, verde y rojo. El semáforo se resuelve con ámbar (viable), terracota (no viable) y espresso/driftwood (neutral) **más icono y texto**, nunca solo color. Series de gráficas con ámbar, terracota, espresso, bark, wisteria y honey. Propuesta, confirmar con Nico.
- **Choque 2: botón primario.** Ámbar es el único relleno de acción: un solo botón primario por vista.
- Accesibilidad: contraste suficiente de texto sobre ámbar y crema; verificar con prueba automática.

## 8. Contrato de datos (web ⇄ pipeline)

- `data/index.json`: nodos (id, nombre, estado, sistema, región, lat/lon, meses de datos, confianza).
- `data/nodes/{id}.json`: por mes y hora los agregados aditivos (§3), para configuración fija y seguidor; metadatos de clima; `schema_version`, `generated_at`.
- Cambiar el esquema obliga a subir `schema_version` y actualizar web + pruebas en el mismo PR.
- Protección: mismo mecanismo de contraseña para HTML y JSON.

## 9. Fases y criterios de "listo"

| Fase | Entregable | Listo cuando |
|---|---|---|
| 0 | Repo, CI, `.gitignore`, agents, esta doc | CI verde |
| 1 | Reloj resuelto; 2020-2026 en Parquet; reporte de calidad | `clock.py` con una prueba por cada cambio de horario; 0 días faltantes; lista de nodos con ≥12 meses |
| 2 | Validaciones: agregación aditiva vs. horario completo (10 nodos), climatología larga, perfil físico vs. seno | Cifras documentadas |
| 3 | Agregados + KPIs + contrato | Pruebas contra 3 nodos a mano; `validador` aprueba |
| 4 | PWA con ~20 nodos reales | Nico aprueba layout, orden de KPIs y paleta del semáforo |
| 5 | Nube, contraseña y job diario | 7 días seguidos de actualización sin intervención |
| 6 | Todos los nodos, MTR, BESS, SW-PEND/PSC | — |
| 7 | PDF, cuentas (Supabase), app en tiendas (Capacitor) | Fuera de alcance por ahora |

## 10. Pendiente de Nico

1. Tasa objetivo, capex y opex por defecto (tras hablar con el equipo).
2. Confirmar paleta del semáforo (§7, choque 1).
3. Nombre y visibilidad del repo (recomendado: privado) y dominio.
4. ¿La API de CENACE responde desde GitHub Actions? Se prueba en la Fase 5; si no, job en el Mac.

## 11. Estilo de trabajo

Español, conciso, ordenado. Nico no es experto en mercados eléctricos: explicar paso a paso lo no obvio. Tras cada solución, preguntarse si se puede mejorar u optimizar. Marcar afirmaciones como [verificado] / [estimado] / [pendiente]; nada sin fuente.
