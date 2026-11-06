# Instructivo para Claude Code: capa de riesgo de sitio (site risk) para el scoring BESS

Dueño: Nico (REPSA). Fecha: 2026-11-05. Estado de las capas: ver `docs/referencia/capas_geo_bess.md` y `python pipeline/fetch_geo_layers.py --check`.

## 0. Objetivo y reglas de juego

Hoy el score de sitio (`pipeline/geo_score.py` para solar, `pipeline/battery_score.py` para batería) mide terreno, pendiente, cobertura, ANP y distancia a red, pero ignora tres cosas que en México mandan el cronograma y el costo de un proyecto: los permisos arqueológicos, la consulta a pueblos indígenas y el acceso físico al predio. Este trabajo agrega esas capas como un módulo único, `pipeline/site_risk.py`, que calcula métricas por punto y las entrega a ambos scores. Las decisiones de Nico, que son ley para este trabajo, son: entre más cerca de un sitio arqueológico o de una zona indígena, peor; la arqueología pesa más que lo indígena porque sus permisos son más difíciles de tramitar; y la zona indígena penaliza dentro de 5 km.

Además de las capas de territorio, Nico entregó tres documentos de CENACE que ya son parte del proyecto y deben usarse: el Catálogo de NodosP v2026-09-23, los niveles de cortocircuito de la RNT 2028 (noviembre de 2025) y los diagramas unifilares 2020-2025. La sección 10 explica cómo entran al scoring y al resto del proyecto, y la sección 11 explica cómo aprovechar a fondo los datos de mercado en tiempo real (MTR) que hoy se usan solo en dos componentes de la batería. Orden de ejecución recomendado: A (indígenas), B (arqueología), C (acceso), F (red: catálogo, cortocircuito, unifilares), G (MTR), H (mapa de capas para el equipo, sección 13; la entrega en GeoPackage puede hacerse apenas existan A, B y C) y al final D y E cuando haya datos descargados.

Respeta `CLAUDE.md` sin excepciones. En particular: no leas ni listes `data/` (inspecciona con `python3 -c`, `duckdb` o `head -c 600`), archivos nuevos de menos de 300 líneas con una sola responsabilidad, diffs pequeños, tests de lo que toques antes de cada commit y suite completa antes de cada hito, commit y push por incremento con mensaje `v2: <qué>`, nunca commitear `data/`, y al cerrar cada hito actualizar `PROJECT_CONTEXT.md`, correr `python3 tools/sync_context.py` y `--check`. Trabaja en una rama nueva desde la actual (`v2/site-risk`); no hagas merge a `main` sin aprobación de Nico. Reporta cada hito en 10 líneas o menos: qué cambió, hash del commit, problemas abiertos.

Marca todo supuesto numérico como `[estimado]` en el config, igual que ya hace el repo. Nada de veredicto verde/rojo: el score sigue en estado PROVISIONAL.

## 1. Reconocimiento (no escribas código todavía)

Lee `CLAUDE.md`, `workflow.solar.md`, `config/solar_score.json`, `config/battery_score.json` y las funciones `analyse`, `load_grid`, `point_dist_m` de `pipeline/geo_pilot.py` y `score` de `pipeline/geo_score.py`. Corre `python pipeline/fetch_geo_layers.py --check` y confirma qué capas hay. Revisa con `.venv/bin/pip list` si están `scipy`, `rasterio`, `duckdb` y `numpy`; usa solo lo que ya hay y no agregues dependencias sin preguntar. El patrón de caché espacial de `geo_pilot.duck()` (tablas en `data/cache/geo_layers.duckdb` con columnas de bounding box porque `ST_Read` no filtra espacialmente) es el que debes reutilizar para toda capa vectorial grande.

Entiende una limitación antes de diseñar: las coordenadas de los nodos son centroides municipales (campo `coord_precision`), no subestaciones. Una distancia de 5 km medida desde un centroide es aproximada. Por eso el módulo debe aceptar cualquier punto arbitrario, no solo los nodos del índice (ver 2.4).

## 2. Hito A: zona indígena (empezar aquí)

### 2.1 Datos

Descarga con `python pipeline/fetch_geo_layers.py --fetch --only indigena_iter`. Si la URL falla, el script imprime la página; baja el ITER nacional (`iter_00_cpv2020`) del Censo 2020 de INEGI y colócalo en `data/ref/geo/indigena/iter_00_cpv2020/`. Antes de escribir el parser, abre el descriptor oficial (https://en.www.inegi.org.mx/app/scitel/doc/descriptor/fd_iter_cpv2020.pdf) y verifica los nombres reales de las columnas con `head -c 600` sobre el CSV. No asumas nombres: se espera `LONGITUD`, `LATITUD`, `POBTOT` y alguna medida de población indígena (`P3YM_HLI` para hablantes de lengua indígena de 3 años y más, `PHOG_IND` para población en hogares con jefe o cónyuge indígena); confirma cuál existe y documenta cuál eliges y por qué. Las coordenadas del ITER suelen venir en grados, minutos y segundos como texto; conviértelas a decimal y prueba la conversión contra al menos tres localidades conocidas. Los valores `*` o `N/D` son datos suprimidos por confidencialidad en localidades pequeñas: trátalos como faltantes, nunca como cero, y reporta qué porcentaje de localidades queda sin dato.

### 2.2 Métrica

Para cada punto calcula sobre las localidades con coordenada y dato válido:

1. `indig_share` de cada localidad = población indígena / `POBTOT`.
2. Una localidad es "indígena" si `indig_share >= 0.40` `[estimado]`, criterio análogo al que se usa para clasificar municipios indígenas; hazlo parámetro del config.
3. `dist_indig_km`: distancia a la localidad indígena más cercana.
4. `indig_pop_5km` e `indig_n_5km`: población indígena y número de localidades indígenas dentro de 5 km.

Usa `scipy.spatial.cKDTree` sobre coordenadas proyectadas (o la aproximación equirectangular de `point_dist_m`); son unos 2,500 nodos contra unas 190 mil localidades, no necesitas nada pesado.

### 2.3 Penalización

La penalización es continua y decrece con la distancia: `risk_indig = max(0, 1 - dist_indig_km / 5)` multiplicado por un factor de intensidad que suba con la población indígena afectada (por ejemplo, `min(1, 0.5 + indig_pop_5km / 2000)` `[estimado]`, para que una ranchería de 30 personas no pese igual que un pueblo de 5,000). El componente del score es `1 - risk_indig`. Fuera de 5 km el componente vale 1.0 y no penaliza. Agrega la bandera de texto `"indigenous locality within 5 km: consulta/EIS probable"` cuando `risk_indig > 0.3`.

Si Nico descarga después los datos de INPI (`data/ref/geo/indigena/inpi/`), úsalos solo como refuerzo a nivel municipio (campo `indig_muni_class`), sin sustituir la capa por localidad.

### 2.4 Interfaz del módulo

`pipeline/site_risk.py` expone `risk_for_points(points) -> dict` y un CLI con tres modos: `--nodes` (todos los nodos válidos del índice, escribe `data/analysis/site_risk.json`, gitignored), `--point lat,lon` (un punto) y `--csv archivo.csv` (columnas `nombre,lat,lon`, para evaluar coordenadas exactas de plantas existentes de REPSA; este modo es clave para el caso híbrido sobre plantas solares ya construidas). Cada resultado lleva `coord` (precisión de la coordenada) para que se vea cuándo la métrica es solo municipal. Parámetros en `config/site_risk.json`.

## 3. Hito B: zonas arqueológicas (mayor peso)

### 3.1 Datos y su límite

No existen polígonos arqueológicos públicos del INAH. Lo construible hoy es una capa de puntos que une tres fuentes: sitios de OpenStreetMap (`fetch_geo_layers.py --fetch --only arq_osm`), el CSV de zonas abiertas del INAH (`arq_inah_csv`, unas 195 zonas, sin coordenadas) y, opcionalmente, la capa de sitios del GITS-UNAM (2012). Procedimiento: geocodifica el CSV del INAH contra los nombres de OSM por estado con coincidencia aproximada de nombres (normaliza acentos y mayúsculas); lo que no empate, escríbelo en `data/ref/geo/arqueologia/pendientes_geocodificar.csv` con las columnas `consecutivo,estado,nombre,lat,lon` vacías en lat/lon para que Nico las complete a mano, y vuelve a leer ese archivo cuando exista. Deduplica puntos a menos de 300 m. Reporta cuántos sitios quedaron, cuántos del INAH se pudieron ubicar y la distribución por estado.

Documenta en el código y en `PROJECT_CONTEXT.md` esta advertencia: la ausencia de un sitio mapeado cerca no significa ausencia de patrimonio. México tiene muchos sitios no registrados y el INAH exige trámite de todos modos. Por eso la métrica combina cercanía con densidad regional.

### 3.2 Métrica y penalización

Calcula `dist_arch_km` (al sitio más cercano) y `arch_n_15km` (sitios en 15 km, como indicador de densidad y de probabilidad de hallazgos no registrados). El riesgo es la suma acotada de dos términos: cercanía, que vale 1.0 a menos de 2 km, decae linealmente a 0 en 10 km, y densidad, `min(1, arch_n_15km / 10) * 0.3` `[estimado]`. Entonces `risk_arch = min(1, near + dens)` y el componente es `1 - risk_arch`. Agrega bandera `"archaeological site < 2 km: INAH critical path"` y una bandera de grado menor entre 2 y 5 km. Si `dist_arch_km < 1`, fija el componente en 0.05, de modo que la media geométrica estricta lo hunda de forma visible.

## 4. Hito C: acceso con la Red Nacional de Caminos (datos que ya están y no se usan)

`data/ref/geo/roads/conjunto_de_datos/rnc2025.gpkg` tiene `red_vial` (4.35 millones de tramos con `TIPO_VIAL`, `RECUBRI`, `CARRILES`, `ANCHO`, `CONDICION`, `PEAJE`, `ADMINISTRA`), `puente` (13,395, con `TIPO` y `MATERIAL`) y `estructura` (18,451, con `ALTURA` y `ANCHO`). Primero inspecciona los valores distintos de `RECUBRI` y `TIPO_VIAL` (no asumas qué significa pavimentado). Luego construye en la caché duckdb una tabla filtrada con bounding boxes que contenga solo tramos transitables por transporte pesado: `CONDICION = 'En operación'`, recubrimiento pavimentado según lo que encuentres, `ANCHO >= 6` `[estimado]`, y excluye calle, andador, cerrada y privada. Ese filtro reduce la capa en uno o dos órdenes de magnitud y la hace consultable.

Métricas: `dist_road_km` al tramo apto más cercano y `dist_highway_km` a una vía federal o estatal (`ADMINISTRA`). Componente: `access = 1 - unit(dist_road_km, 0.5, 15)` con escalas en el config. Los puentes y estructuras no entran al score nacional porque no traen capacidad de carga; déjalos para una función `route_checks(point)` que, solo para sitios preseleccionados, liste puentes y estructuras a menos de 1 km del acceso con su `ALTURA` y `ANCHO`, como insumo para el estudio de ruta de transformadores y contenedores.

## 5. Hito D: hidrografía, temperatura y suelo (cuando Nico baje los datos)

Verifica con `--check` que existan las carpetas `hidrografia`, `clima` y `suelo`. Cada una sigue el mismo patrón: inspecciona atributos reales primero y propón el mapeo antes de aplicarlo.

Hidrografía (INEGI, red hidrográfica 1:50 000 o SIATL): agrega en `geo_pilot.analyse` una máscara de exclusión por cauces con buffer (100 m para corrientes perennes y 50 m para intermitentes, `[estimado]`) que se resta a `viable`, de modo que afecte `net_viable_ha` y `max_patch_ha`. Expón `dist_river_km` como métrica. Los cuerpos de agua ya se excluyen por cobertura de suelo.

Temperatura (WorldClim, `bio_5` = máxima del mes más cálido en °C, y `bio_6`): muestrea el raster en el punto y define el componente `thermal = 1 - unit(bio5, 32, 40)` `[estimado]`, que representa derating y carga de aire acondicionado de la batería. Comprueba contra el raster de relieve que los valores de la costa y del altiplano tengan sentido.

Suelo (INEGI edafología 1:250 000): define en el config una tabla `soil_risk` por unidad de suelo (por ejemplo, vertisoles por expansividad, solonchaks por salinidad, leptosoles por poca profundidad) y úsala como componente `soil`. No inventes la tabla: lista las unidades presentes en el país, propón valores y deja que Nico las ajuste.

## 6. Hito E: sugerencias adicionales (implementar cuando haya datos)

Núcleos agrarios (RAN/PHINA, `data/ref/geo/tenencia/`): calcula el porcentaje del parche viable máximo que cae dentro de ejido o comunidad. Es un riesgo de adquisición del predio y se suma a la presión indígena, porque las comunidades agrarias suelen coincidir con pueblos originarios. Componente `tenure`.

CENAPRED y SGM (`data/ref/geo/peligros/`): inundación, sismicidad, laderas y ciclones por punto. Si la capa viene por municipio, úsala como clase; si es raster, muestréala. Componente `hazard`. Esto cambia el costo de seguros y de obra civil.

Retiro a poblados (Marco Geoestadístico): distancia del parche a la localidad urbana más cercana, con retiro mínimo de 500 m `[estimado]` para seguridad contra incendio de baterías de litio; el valor definitivo debe confirmarlo un ingeniero de protección contra incendios. Actúa como puerta (resta del parche viable) y no como puntaje.

ADVC, Ramsar y RTP (`data/ref/geo/conservacion/`): extienden la máscara de exclusión de ANP. Aplica además una zona de influencia de 2 km alrededor de ANP en el componente de riesgo, que hoy no existe.

Mejora estructural a evaluar con prueba A/B, no como cambio por defecto: hoy todas las distancias salen del centroide del nodo, pero el sitio real estaría en el mayor parche viable que ya calcula `analyse`. Agrega la opción `--anchor patch|node` que mida red, acceso, arqueología e indígenas desde el centroide del parche mayor, compara rankings y reporta cuántos nodos cambian de posición antes de proponer el cambio.

## 7. Integración al score

Agrega los componentes `arch`, `indig` y `access` (y después `thermal`, `soil`, `hazard`, `tenure` conforme existan) al diccionario `components` de `geo_score.py` y de `battery_score.py`, usando la misma función `unit` y el mismo modo estricto (media geométrica, con el piso de 0.02 que ya existe). Pesos iniciales `[estimado]`, a sumar a los actuales sin tocar los existentes, porque `score()` normaliza por la suma: `arch: 0.10`, `indig: 0.06`, `access: 0.05` y, desde la sección 10, `strength: 0.08` (fortaleza de red por cortocircuito). Con los cuatro la suma pasa de 1.00 a 1.29, de modo que arqueología queda cerca de 8 %, indígenas 5 %, acceso 4 % y fortaleza de red 6 % del score final, con arqueología como la capa de mayor peso entre las de territorio, como pidió Nico. Reporta siempre los pesos efectivos tras normalizar. Los componentes de 5.x y 6 entran después con pesos de 0.02 a 0.04 cada uno.

Los pesos se leen de `config/solar_score.json` y `config/battery_score.json`; los parámetros de distancias y umbrales, de `config/site_risk.json`. Los nodos sin dato (por ejemplo, sin coordenada) reciben el valor neutro 0.5 más una bandera, como ya se hace con MTR en Baja California, nunca un 1.0 silencioso. Extiende `pipeline/export_scores.py` para incluir los nuevos componentes y banderas en el `scores.json` que consume la web v2; no rediseñes la interfaz, y corre las pruebas de integridad de `web/tests` para confirmar que no se rompe nada.

## 8. Validación (obligatoria antes de cada commit de hito)

Escribe `tests/test_site_risk.py` con puntos sintéticos y casos conocidos: Teotihuacán (19.6925, -98.8438) debe dar `dist_arch_km` cercano a cero, un punto en el desierto de Sonora debe dar componentes cercanos a 1.0, una localidad indígena sintética a 3 km debe penalizar y a 6 km no, y el parser de coordenadas del ITER debe reproducir tres localidades verificadas a mano. Después de recalcular reporta: correlación de Spearman entre el ranking viejo y el nuevo (si cae por debajo de 0.9, explica por qué), los 20 nodos que más suben y los 20 que más bajan con la causa de cada movimiento, el número de nodos con bandera arqueológica crítica, y cobertura de datos (porcentaje de nodos con componente neutro por falta de dato). Si el ranking cambia mucho solo por los nuevos componentes, es esperable; si cambia por un error de CRS o de unidades, es un bug.

## 9. Datos que Nico debe aportar para mejorar el análisis

Coordenadas exactas de las plantas solares existentes de REPSA candidatas al híbrido (para `--csv`), los archivos manuales de la sección 5 y 6 en las carpetas indicadas, las coordenadas faltantes de `pendientes_geocodificar.csv`, y cualquier lista interna de sitios con trámite INAH previo o consultas indígenas realizadas por REPSA, que servirían para calibrar los radios y pesos con experiencia real en lugar de supuestos.

Datos adicionales que Nico puede aportar para las secciones 10 y 11: la lista de plantas solares de REPSA con su nodo de interconexión (clave `NodoP`) y capacidad en MW, el tamaño de batería que se quiere evaluar (MW y horas) y, si existen, las curvas de generación reales de esas plantas, que sustituirían al perfil climatológico en el análisis híbrido.

## 10. Hito F: la red eléctrica con los documentos de CENACE

### 10.1 Catálogo de NodosP v2026-09-23

El archivo ya está en la raíz del repo y en `data/ref/catalog_nodosp`; antes de reemplazar nada compara su hash con el que entregó Nico y usa el más reciente. La hoja principal tiene 2,610 nodos (SIN 2,458, Baja California 121, Baja California Sur 31), 109 zonas de carga, 38 zonas de operación de transmisión y 152 zonas de distribución, además de claves INEGI de entidad y municipio, la región de transmisión de PRODESEN y dos marcas que dicen si el nodo modela generación o carga de forma directa (373 y 406 nodos respectivamente). La hoja "Control de Cambios" registra 164 cambios con fecha, el último del 23 de septiembre de 2026 (alta del nodo `03TLJ-230`). Hoy el proyecto usa del catálogo la tensión, la región, la entidad y el municipio de cada nodo; el resto de sus campos no se explota (revisa `pipeline/catalog_nodes.py` para confirmarlo). Aprovéchalo así:

1. **Ciclo de vida de nodos.** Extrae de la descripción de cada cambio las claves con formato `\d\d[A-Z0-9]{3}-\d+` y construye `data/analysis/node_lifecycle.json` con fecha de alta y de baja. Reemplaza con eso la bandera actual "node not in current CENACE catalog": un nodo dado de alta hace menos de 12 meses tiene poca historia de precios (explica faltantes, no los castiga como si fueran malos) y uno dado de baja debe salir de los rankings.
2. **Claves INEGI para unir sin nombres.** La clave de entidad y de municipio del catálogo permite unir exactamente con el ITER (porcentaje indígena municipal), el Marco Geoestadístico, INPI y CENAPRED, y completar coordenadas de los nodos que hoy no tienen (hay 54 sin coordenada; resuelve cuántos se recuperan).
3. **Zonas como unidad de análisis.** Agrupa por zona de carga y por zona de operación de transmisión para dos cosas: priorizar sitios sin concentrar el portafolio (por ejemplo, máximo dos o tres sitios candidatos por zona de carga al armar la lista corta para estudios CENACE) y explicar congestión compartida. El estudio de interconexión lo atiende la gerencia regional que aparece en el catálogo, así que expón ese dato en la lista corta.
4. **Tipo de nodo.** Crea la característica `node_type` ∈ {gen, carga, ambos, ninguno} con las marcas de modelación directa y revisa con datos si explica diferencias de congestión y de spread. No supongas el resultado: preséntalo con números. Para el caso híbrido, cada planta solar de REPSA debe asociarse a su nodo; el modo `--csv` de `site_risk.py` debe aceptar una columna `nodo` y, si falta, proponer candidatos entre los nodos con generación modelada del mismo municipio.

### 10.2 Niveles de cortocircuito RNT 2028

Es el documento "Niveles de cortocircuito de la Red Nacional de Transmisión 2028" (CENACE, noviembre de 2025, 107 páginas, método IEC 60909 con PSS®E v36.2). Reporta 3,431 niveles por subestación y tensión. Cada fila trae, para el escenario de mínima capacidad (red completa sin contingencia, invierno 2028, factor C = 1.0) y el de máxima (todos los elementos en servicio, C = 1.1), la corriente trifásica y monofásica en kA y las impedancias de Thévenin de secuencia positiva y cero en ohms. Incluye proyectos del programa vinculante de centrales (PVIRCE) hasta 2028, así que es una foto hacia adelante, razonable para un proyecto que entraría en operación en 2028 o 2029.

**Extracción.** Usa `pdftotext -layout` y una expresión regular por fila; yo probé una versión que leyó 3,361 de las 3,431 filas (98 %). El formato de cada fila es: nombre de subestación, acrónimo con tensión (por ejemplo `ACO-230`), tensión en kV, cuatro columnas del escenario mínimo (3F, 1F, `ZTH(+)`, `ZTH(0)`) y cuatro del máximo; las impedancias vienen como `0.856+j4.711` y deben convertirse a complejos. El encabezado de cada tabla indica la Gerencia de Control Regional. Cierra la diferencia validando contra el conteo por gerencia que da el propio documento (Peninsular 160, Baja California 199, Noroeste 299, Norte 339, Central 365, Noreste 599, Oriental 709, Occidental 761) y revisa a mano las filas que no se hayan leído. Guarda el resultado en `data/ref/cenace/cortocircuito_2028.csv`.

**Unión con el catálogo.** La clave de nodo del catálogo es el código de dos dígitos de zona seguido del acrónimo (`07RIN-161` = `07` + `RIN-161`), así que la unión directa por `clave[2:]` empata 2,305 de 2,610 nodos (88.3 %): 115 kV 1,730 de 1,944, 230 kV 236 de 258, 400 kV 47 de 54, 138 kV 57 de 62, 161 kV 21 de 23, 85 kV 104 de 108, 69 kV 110 de 158 y 34.5 kV 0 de 3. Hay 233 acrónimos repetidos en el documento; desempata con la gerencia regional del catálogo y con el nombre normalizado. Parte de los 305 nodos sin empate son altas posteriores al estudio; revisa el resto uno por uno y reporta cuántos quedan sin dato (esos reciben el valor neutro 0.5 con bandera, nunca 1.0).

**Métricas y uso en el score.** La potencia de cortocircuito mínima es `Ssc_min = √3 · V(kV) · Icc3F_min(kA)` en MVA. La razón de cortocircuito de una batería de `P` MW es `SCR = Ssc_min / P`. Por ejemplo, Aculco 115 kV tiene 2.83 kA de mínimo trifásico, es decir unos 564 MVA: una batería de 100 MW vería un SCR de 5.6 y una de 200 MW, de 2.8. Calcula tres métricas por nodo: `ssc_min_mva`, `scr_ref` para el tamaño de referencia del config (100 MW por omisión) y `max_mw_scr3 = Ssc_min / 3`, que sirve como aproximación del tamaño máximo razonable en ese punto. El componente `strength = unit(scr_ref, 2, 10)` `[estimado]`; los umbrales de SCR (menor a 3 se considera red débil para inversores seguidores de red) son criterio de ingeniería aproximado que debe confirmar un especialista, y esta métrica es un filtro de priorización, no sustituye el estudio de interconexión de CENACE. Agrega además una bandera `"Icc3F max > 40 kA"` `[estimado]` para nodos donde la corriente máxima se acerca a las capacidades típicas de interruptores, porque una batería aporta corriente de falla y puede forzar reemplazo de equipo. Combina `strength` con la distancia y la saturación existentes dentro del componente `grid`, sin duplicar el puntaje de tensión que ya cubre `kv_score`.

Usos fuera del score: la lista corta para solicitar estudios a CENACE debe mostrar `max_mw_scr3` junto al tamaño propuesto, y el análisis híbrido debe comparar la capacidad de la planta solar existente contra el SCR de su nodo, porque una red débil limita la inyección y puede explicar recortes de generación.

### 10.3 Diagramas unifilares 2020-2025

Son 143 páginas de CENACE (abril de 2021, programa de ampliación 2020-2034) con un mapa del SEN 2025, un mapa por gerencia y un diagrama unifilar por zona: barras con su tensión, transformadores con su capacidad en MVA, números de línea, generación conectada (por ejemplo, una central de 2 por 15 MW) y obras clasificadas como legadas, instruidas, por aportaciones o a cargo del solicitante. Son dibujos vectoriales, no tablas; extraer su contenido automáticamente para los 2,610 nodos es frágil y no lo hagas. Su valor está en validar a mano los sitios de la lista corta, y tienen un límite: son de 2021, anteriores al cortocircuito 2028, así que sirven para la topología de la subestación y no para su estado futuro.

Haz esto: construye con `pdftotext -layout` por página el índice `data/ref/cenace/unifilares_index.csv` (página, gerencia, zona si se detecta, texto normalizado de nombres). Probé que los nombres de subestaciones aparecen en el texto de la página (por ejemplo, Arcelia Nueva en las páginas 6 y 8), aunque el título de la zona solo se detecta bien en unas 43 páginas, así que busca por nombre y no por zona. Implementa `unifilar_pages(nombre_subestacion)` que devuelva las páginas. Para cada sitio de la lista corta (los 20 a 30 mejores), abre esas páginas con `Read` (máximo 20 por solicitud) y llena una ficha en `data/analysis/unifilar_cards.csv` con: número de líneas que llegan a la barra (anillo o radial, como indicio de seguridad N-1), capacidad de los transformadores, generación conectada cercana, obras pendientes y la página fuente. No inventes valores que no se lean con claridad en el diagrama; marca `ilegible` si es el caso. Normaliza nombres con una sola función compartida (`norm_name`) para el catálogo, el cortocircuito y los unifilares, porque los tres escriben distinto los nombres y las abreviaturas.

## 11. Hito G: uso completo de los datos MTR en todo el proyecto

### 11.1 Qué hay y qué se usa hoy

Los archivos de `~/Downloads/MTR` son siete zips anuales (2020 a 2026) de "Precios Marginales Locales del MTR (cálculo ex post)", Sistema Interconectado Nacional, con dos CSV por mes de unos 55 MB cada uno. Cada fila trae fecha, hora (1 a 24), clave de nodo, precio marginal local y sus tres componentes (energía, pérdidas y congestión), es decir, la misma estructura que el mercado del día en adelanto (MDA), y son horarios. Según `PROJECT_CONTEXT.md`, el MTR ya está ingestado a `data/parquet/pml_mtr` de enero de 2020 a septiembre de 2026 y los crudos están en `data/raw/cenace`, de modo que estos zips son probablemente una copia: antes de reingestar compara conteos de filas y fecha máxima contra el parquet y, si coinciden, no hagas nada; si el parquet termina antes, ingesta solo lo faltante con `ingest_portal.py`.

Hoy el MTR se usa únicamente en `pipeline/mtr_metrics.py` con el año de prueba 2025 y alimenta dos componentes del score de batería: valor en tiempo real (el calendario de carga y descarga elegido con MDA de 2023 y 2024, liquidado con precios MTR de 2025) y riesgo de desbalance (percentil 95 de |MTR − MDA|). No interviene en el score solar, no usa 2026, no usa el componente de congestión del MTR y no aparece en el caso híbrido. Esa es la oportunidad.

### 11.2 Mejoras, en orden de valor

1. **Validación hacia adelante con 2026.** Parametriza `battery_metrics.py` y `mtr_metrics.py` por (años de entrenamiento, año de prueba, meses) en lugar de constantes. Corre dos pruebas: entrenar 2023 y 2024 con prueba en 2025 (la actual) y entrenar 2024 y 2025 con prueba en enero a septiembre de 2026, comparando solo los mismos meses para no mezclar estacionalidad. Reporta la correlación de rangos entre ambas y marca como inestables los nodos cuyo puesto cambie mucho: un sitio que solo gana en un año no es un buen sitio.
2. **Tres escenarios de despacho en lugar de uno.** Conserva el actual (calendario aprendido con MDA y liquidado a MTR, que es un piso) y agrega el calendario aprendido con datos MTR de entrenamiento y liquidado a MTR (más realista para quien opera en tiempo real), junto con el techo de previsión perfecta. La distancia entre piso, caso realista y techo es una medida honesta de cuánto vale la información. Sin mirar hacia adelante: el calendario siempre se aprende solo con años de entrenamiento.
3. **Caso híbrido con MTR.** Para cada planta solar de REPSA, multiplica el perfil de generación por precios MDA y por precios MTR, y reporta el precio capturado en cada mercado y la base MDA a MTR ponderada por generación solar. Una desviación de pronóstico se liquida a MTR; modela su costo como `(MTR − MDA) × error de pronóstico` con un error `[estimado]` configurable (por ejemplo, entre 10 % y 15 % de la producción) hasta tener datos reales de las plantas. Luego añade la batería: carga con el sobrante de mediodía cuando el precio es bajo o negativo y descarga en la punta de la noche, y reporta el valor adicional por MW y por duración (2, 3 y 4 horas) para ver el valor marginal de cada hora extra, dato central para el dimensionamiento.
4. **Riesgo de cola y concentración.** Con el MTR calcula la frecuencia de horas con precio extremo, el percentil 99, las horas con precio menor o igual a cero y qué porcentaje del valor anual del spread viene del 1 % de las horas más caras. Una batería cuyo valor depende de pocas horas es más riesgosa aunque su promedio sea alto; alimenta con eso el componente de previsibilidad. Usa también el componente de congestión del MTR (hoy solo se usa el del MDA) para distinguir congestión estructural, que dura todo el año, de congestión de eventos.
5. **Distribución anual para el financiamiento.** El esquema de Project Finance 80 % deuda y 20 % capital exige casos de riesgo. Con todos los años de MDA y MTR (2020 a 2026) y calendarios aprendidos solo con datos previos, calcula el valor anual de la batería por nodo en cada año y resume mínimo, mediana y peor caso. Entrega un caso base y un caso de estrés por nodo preseleccionado para el análisis de cobertura de deuda. Advierte en el reporte que son pocos años y que hubo cambios de regulación y de mercado, así que no son una distribución estadística robusta. Marca el evento de febrero de 2021 como estrés extremo, no como año típico.
6. **Cobertura.** El MTR existe solo para el SIN, de modo que Baja California y Baja California Sur siguen con valor neutro y bandera; no intentes rellenar esos nodos con datos de otro sistema.

Para cada mejora entrega el código, las pruebas y un reporte corto con los números, siguiendo las reglas de la sección 0. Si algo de esta sección choca con una restricción de `workflow.solar.md` o `PROJECT_CONTEXT.md` (por ejemplo, la regla de que la regulación de almacenamiento 30 %/3 h es solo escenario), respeta el documento del repo y avisa.

## 12. Cierre: estabilidad del ranking

Antes del último commit de cada hito, mide qué tan estable es el ranking frente a los pesos, que son todos supuestos. Perturba los pesos con una distribución de Dirichlet centrada en los valores del config (por ejemplo, 500 réplicas), cuenta con qué frecuencia cada nodo queda entre los 50 primeros y reporta los que lo hacen en más del 80 % de las réplicas, que son los candidatos robustos para solicitar estudios a CENACE, y los que dependen demasiado de un peso concreto. Guarda el resultado en `data/analysis/ranking_stability.json` y súmalo a `export_scores.py`.

## 13. Hito H: mapa de capas para ubicar zonas con el equipo

### 13.1 Dónde construirlo

La web v2 ya tiene una página de red (`web/v2/assets/js/network-view.js`, 173 líneas) con su propia instancia de deck.gl (`web/v2/assets/vendor/deckgl/deck.min.js`): dibuja polígonos de estados, líneas OSM, plantas y nodos puntuados, con selector de métrica (`network-core.js`). Extiéndela con un panel de capas en lugar de crear otra pila de mapas, y respeta lo que dice `CLAUDE.md`: interfaz en inglés, archivos de menos de 300 líneas, tests de `web/tests`, y no precachear datos pesados en el service worker. Primero comprueba si el bundle de deck.gl incluye `TileLayer` y `MVTLayer`; si no, usa `GeoJsonLayer` con datos simplificados y avisa antes de agregar dependencias. Hoy el mapa no tiene mapa base; el instructivo no decide cuál usar (las teselas públicas de OpenStreetMap tienen política de uso limitado y la atribución es obligatoria): pregunta a Nico entre un proveedor con llave, un mapa base propio en PMTiles o dejarlo sin base.

### 13.2 Entrega rápida sin desarrollo web: un GeoPackage para QGIS

Antes que la interfaz, genera con `pipeline/export_site_layers.py` el archivo `data/analysis/site_layers.gpkg` (gitignored) con una capa por tema, en EPSG:4326: nodos con score, componentes y banderas; subestaciones con SCR y `max_mw_scr3`; ANP; sitios arqueológicos con anillos de 2 y 5 km como capa aparte; localidades indígenas (40 % o más) con anillo de 5 km; caminos aptos filtrados (sección 4); puentes y estructuras; y, cuando existan, hidrografía, núcleos agrarios y peligros. Es lo más rápido para que cualquiera del equipo con QGIS (o Google Earth Pro, si exportas también KML) navegue las capas desde ya. Si el entorno no tiene GDAL, pregunta a Nico antes de instalar algo; `duckdb` con la extensión espacial puede escribir GeoPackage.

### 13.3 Capas del mapa web

| Capa | Geometría | Preparación | Notas |
|---|---|---|---|
| Sitios arqueológicos | puntos con nombre y fuente | OSM + INAH geocodificado | Anillos de 2 y 5 km dibujados en metros por deck.gl, activables |
| Localidades indígenas | puntos por población indígena | ITER 2020, 40 % o más | Anillo de 5 km; después, coropleta municipal con INPI |
| ANP y conservación | polígonos simplificados | `shp_anp_20260924` con tolerancia de unos 0.002° | Color por categoría; apunta el tamaño final del archivo |
| Red eléctrica | líneas y subestaciones | Ya existe | Colorear subestaciones por SCR |
| Caminos | líneas | RNC filtrada y teselada | A escala nacional solo carreteras federales y estatales; el resto con zoom |
| Puentes y estructuras | puntos | `puente` y `estructura` de RNC | Solo visibles desde zoom 9 aproximadamente |
| Hidrografía, núcleos agrarios, peligros | líneas y polígonos | Cuando haya datos | Teselado; no cargarlos completos al navegador |
| Mancha viable | polígono | Mayor parche viable de `analyse()` vectorizado con `rasterio.features.shapes` | Solo para los 20 a 30 nodos de la lista corta; es la capa más útil para decidir en terreno |

La RNC tiene 4.35 millones de tramos: no se puede enviar completa al navegador. Genera teselas vectoriales (PMTiles con `tippecanoe` si está instalado) o archivos por región ya filtrados y simplificados, y pregunta a Nico dónde alojarlos: el repo despliega con `wrangler.toml` (Cloudflare) y no debe commitear archivos grandes; cada archivo servido debe ser razonable (unos pocos MB comprimidos) y los pesados irían a almacenamiento estático aparte.

### 13.4 Interacción para trabajar en equipo

Panel de capas con interruptores, opacidad y leyenda; al hacer clic en un nodo, ficha con score, componentes, banderas, distancias a sitio arqueológico, localidad indígena, camino y subestación, SCR y `max_mw_scr3`; regla de medición; estado del mapa (vista y capas activas) guardado en el hash de la URL para compartir una ubicación exacta; botón para exportar la lista corta en GeoJSON y KML para equipos de campo y para Google Earth. Un clic en un punto cualquiera del mapa que calcule las métricas en vivo requiere un servicio (la carpeta `functions/` sugiere Cloudflare Functions) y queda como segunda fase, solo si Nico lo aprueba.

### 13.5 Pruebas

Tests en `web/tests` para la configuración de capas (ids únicos, orden, leyendas), para que ninguna capa pesada entre al precaché, y para el formato del hash de URL. Verifica visualmente en el navegador con una captura por capa (Teotihuacán para arqueología, la Huasteca o la Sierra Norte de Puebla para indígenas, una ANP grande, una carretera federal conocida) y reporta la captura en el hito.
