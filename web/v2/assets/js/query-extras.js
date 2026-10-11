// URL parts beyond selection and basis (pure): time span (&from=YYYY-MM&to=YYYY-MM) and scenario (&sc=p:50,m:100,y:-10).
export const SCENARIO_LIMITS = { price: [-300, 300], dip: [0, 150], yield: [-30, 30] };
export const NEUTRAL = Object.freeze({ price: 0, dip: 100, yield: 0 });
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

export function parseSpan(from, to) {
  if (!YM.test(from || '') || !YM.test(to || '') || from > to) return null;
  return { from, to };
}
export const spanEquals = (a, b) => (!a && !b) || (!!a && !!b && a.from === b.from && a.to === b.to);

/** 'p:50,m:120,y:-10' -> {price, dip, yield}; unknown or invalid tokens are ignored; null when neutral or empty. */
export function parseScenario(str) {
  const sc = { ...NEUTRAL };
  const map = { p: 'price', m: 'dip', y: 'yield' };
  for (const t of String(str || '').split(',')) {
    const [k, v] = t.split(':');
    const n = Number(v);
    if (map[k] && v !== undefined && v !== '' && Number.isFinite(n)) sc[map[k]] = clamp(Math.round(n), SCENARIO_LIMITS[map[k]]);
  }
  return isNeutral(sc) ? null : sc;
}
export const isNeutral = (sc) => !sc || (sc.price === NEUTRAL.price && sc.dip === NEUTRAL.dip && sc.yield === NEUTRAL.yield);
export const serializeScenario = (sc) => (isNeutral(sc) ? '' : `p:${sc.price},m:${sc.dip},y:${sc.yield}`);
export const scenarioEquals = (a, b) => serializeScenario(a) === serializeScenario(b);
