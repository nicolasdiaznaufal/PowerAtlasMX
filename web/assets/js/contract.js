// Thin adapter over the data contract. Every schema change is absorbed here.
// Supported: schema_version major 1 (1.1.x rebuilds weighted sums; 1.0 publishes them).
export const SUPPORTED_MAJOR = 1;
export const KNOWN_MINOR_MAX = 2;

export class SchemaError extends Error {}

export const ANALYSIS_MAJOR = 1;
export const ANALYSIS_MINOR_MAX = 1;
/** analysis.json guard (schema 1.1.0): throws SchemaError on another major; returns a warning string for a newer minor. */
export function checkAnalysisSchema(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || ''));
  if (!m) throw new SchemaError(`analysis schema_version missing or unreadable: ${version}`);
  if (+m[1] !== ANALYSIS_MAJOR) throw new SchemaError(`Analysis schema ${version} is not supported (expected ${ANALYSIS_MAJOR}.x).`);
  return +m[2] > ANALYSIS_MINOR_MAX ? `Analysis schema ${version} is newer than the known ${ANALYSIS_MAJOR}.${ANALYSIS_MINOR_MAX}; some figures may be missing.` : null;
}

/** Checks schema_version. Returns {ok, version, aviso}; throws SchemaError if the major version differs. */
export function checkSchema(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || ''));
  if (!m) throw new SchemaError(`schema_version missing or unreadable: ${version}`);
  const major = +m[1], minor = +m[2];
  if (major !== SUPPORTED_MAJOR) {
    throw new SchemaError(`Schema ${version} is not supported by this version of the app (expected ${SUPPORTED_MAJOR}.x).`);
  }
  let aviso = null;
  if (minor > KNOWN_MINOR_MAX) aviso = `Schema ${version} is newer than the known ${SUPPORTED_MAJOR}.${KNOWN_MINOR_MAX}; reading is attempted but some figures may be missing.`;
  if (minor < 1) aviso = `Schema ${version} predates 1.1: hours of the day may be on a local clock, not CDMX.`;
  return { ok: true, version, aviso };
}

const arr = (a, name) => {
  if (!Array.isArray(a)) throw new SchemaError(`Array ${name} is missing from the node.`);
  return a;
};

/** Normaliza un JSON de nodo a un modelo interno con arreglos tipados. */
export function adaptNode(raw) {
  checkSchema(raw.schema_version);
  const a = raw.agregados;
  if (!a) throw new SchemaError('Node without an aggregates block.');
  const meses = arr(a.meses, 'agregados.meses');
  const L = meses.length * 24;
  const f64 = (x, name) => { const v = arr(x, name); if (v.length !== L) throw new SchemaError(`${name}: length ${v.length} != ${L}`); return Float64Array.from(v); };
  const n = f64(a.n_horas, 'n_horas'), le0 = f64(a.n_pml_le0, 'n_pml_le0'), cent = f64(a.sum_pml_cent, 'sum_pml_cent');
  const perd = f64(a.sum_perdidas_cent, 'sum_perdidas_cent'), cong = f64(a.sum_congestion_cent, 'sum_congestion_cent');
  let resid, energ;
  if (a.sum_residuo_cent) {
    resid = f64(a.sum_residuo_cent, 'sum_residuo_cent');
    energ = new Float64Array(L);
    for (let k = 0; k < L; k++) energ[k] = cent[k] - perd[k] - cong[k] - resid[k]; // enteros exactos
  } else if (a.sum_energia_cent) { // esquema 1.0: publicada
    energ = f64(a.sum_energia_cent, 'sum_energia_cent');
    resid = new Float64Array(L);
    for (let k = 0; k < L; k++) resid[k] = cent[k] - perd[k] - cong[k] - energ[k];
  } else throw new SchemaError('Neither sum_residuo_cent nor sum_energia_cent: energy cannot be rebuilt.');
  const py = a.perfil_y || {};
  const y = {};
  for (const c of ['fixed', 'tracker']) {
    if (py[c]) { if (py[c].length !== 288) throw new SchemaError(`perfil_y.${c} must have 288 values`); y[c] = Float64Array.from(py[c]); }
  }
  if (!Object.keys(y).length) throw new SchemaError('Node without perfil_y.');
  const defl = Array.isArray(a.deflactor_inpc) ? a.deflactor_inpc.slice() : meses.map(() => null);
  return {
    id: raw.id, nombre: raw.nombre, sistema: raw.sistema, region: raw.region,
    meses, bordes: new Set(a.meses_borde || []),
    n, le0, cent, perd, cong, resid, energ, y, defl,
    realEstado: (name => (raw.kpis && raw.kpis[name] && raw.kpis[name].reales ? raw.kpis[name].reales.estado : 'no_disponible'))('tracker'),
    realEstadoPorConfig: Object.fromEntries(['fixed', 'tracker'].map((c) => [c, raw.kpis && raw.kpis[c] && raw.kpis[c].reales ? raw.kpis[c].reales.estado : 'no_disponible'])),
    desfase: a.reloj && a.reloj.desfase_a_cdmx_horas ? a.reloj.desfase_a_cdmx_horas : 0,
  };
}

/** Contexto de calculo a partir del indice y el modelo del nodo. */
export function ctxFor(index, model) {
  const pd = index.periodo_datos;
  const bordes = new Set([...(pd.meses_borde[model.sistema] || []), ...model.bordes]);
  return {
    umbralMes: index.umbral_mes_completo ?? 1,
    umbralAnio: index.umbral_anio_completo ?? 1,
    desde0: pd.desde, hasta0: pd.hasta, bordes, desfase: model.desfase,
  };
}

export async function fetchJSON(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
