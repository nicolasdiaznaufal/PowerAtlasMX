"""
Conexión a la base de PML con la corrección de horas.

¿Por qué existe este archivo?
-----------------------------
CENACE publica la columna `hora` del 1 al 24 como la HORA EN QUE TERMINA el intervalo:

    hora CENACE 1   ->  de 00:00 a 01:00
    hora CENACE 7   ->  de 06:00 a 07:00
    hora CENACE 24  ->  de 23:00 a 24:00

La tabla `pml_hourly` guarda los datos TAL COMO los publica CENACE (no se toca).
Para analizar se usa la vista `precios_pml`, idéntica pero con:

    hora = hora_CENACE - 1        (0..23 = hora en que EMPIEZA el intervalo)

Con eso las ventanas se escriben como se leen:
    horario solar 06:00-18:00  ->  hora >= 6  AND hora < 18
    horario punta 18:00-22:00  ->  hora >= 18 AND hora < 22

La vista es TEMPORAL (vive solo mientras la conexión está abierta), así que funciona con
bases de solo lectura (Streamlit Cloud) y no hace falta volver a publicar la base.

Uso:
    from conexion import conectar
    con = conectar()                      # abre db/pml.duckdb en solo lectura + crea la vista
    con.execute("SELECT hora, AVG(pml) FROM precios_pml GROUP BY hora").df()

Si ya tienes una conexión abierta:  crear_vista(con)
"""
import os

import duckdb

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "db", "pml.duckdb")

VISTA = "precios_pml"

_SQL_VISTA = f"""
CREATE OR REPLACE TEMP VIEW {VISTA} AS
SELECT fecha,
       hora - 1 AS hora,          -- corrección: hora de inicio del intervalo (0..23)
       nodo, pml, energia, perdidas, congestion, archivo_origen, anio, mes
FROM pml_hourly
"""


def crear_vista(con):
    """Crea (o reemplaza) la vista `precios_pml` en una conexión existente."""
    con.execute(_SQL_VISTA)
    return con


def conectar(db_path=DB_PATH, read_only=True):
    """Abre la base de PML y deja lista la vista `precios_pml` con horas corregidas."""
    return crear_vista(duckdb.connect(db_path, read_only=read_only))
