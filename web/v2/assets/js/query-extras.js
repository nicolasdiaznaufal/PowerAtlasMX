// URL parts beyond selection and basis (pure): time span (&from=YYYY-MM&to=YYYY-MM) and scenario (&sc=p:50,m:100,y:-10).
export const SCENARIO_LIMITS = { price: [-300, 300], dip: [0, 150], yield: [-30, 30] };
export const NEUTRAL = Object.freeze({ price: 0, dip: 100, yield: 0 });
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/** bounds = {min, max} (available months) clamps both ends; a span entirely outside the data is dropped. */
export function parseSpan(from, to, bounds = null) {
  if (!YM.test(from || '') || !YM.test(to || '') || from > to) return null;
  if (!bounds) return { from, to };
  const f = from < bounds.min ? bounds.min : from, t = to > bounds.max ? bounds.max : to;
  return f > t ? null : { from: f, to: t };
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

// Mounting configuration (&cfg=fijo) and weather variant (&wx=y2019|win); defaults (tracker, mean) are omitted from the URL.
export const WEATHER_YEARS = Array.from({ length: 11 }, (_, i) => 2015 + i);
export const WX_DEFAULT = 'mean', CFG_DEFAULT = 'tracker';
const WX_RE = /^(mean|win|y20(1[5-9]|2[0-5]))$/;
export const parseCfg = (v) => (v === 'fijo' ? 'fijo' : CFG_DEFAULT);
export const parseWx = (v) => (WX_RE.test(v || '') ? v : WX_DEFAULT);

// Main time window = the ONE time control. Y2 (last 12 months) is the default and has no URL part; Y1 and the full history are written as
// &from=YYYY-MM&to=YYYY-MM. Any other span is normalised to one of the three.
export const Y1_SPAN = Object.freeze({ from: '2024-08', to: '2025-07' });
export const FULL_SPAN = Object.freeze({ from: '2020-01', to: '2026-09' });
const monthIdx = (m) => +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1);
/** 'Y1' | 'Y2' | 'ALL' of a stored span. */
export function winOfSpan(span) {
  if (!span) return 'Y2';
  if (span.from === Y1_SPAN.from && span.to === Y1_SPAN.to) return 'Y1';
  return monthIdx(span.to) - monthIdx(span.from) >= 23 ? 'ALL' : 'Y2';
}
/** the span stored for a window ('Y2' -> null). `full` overrides the default full-history bounds (the data's own months). */
export function spanForWin(w, full = null) {
  if (w === 'Y1') return { ...Y1_SPAN };
  if (w === 'ALL') return { ...(full || FULL_SPAN) };
  return null;
}
export const normalizeSpan = (span, full = null) => spanForWin(winOfSpan(span), full);
/** the window whose figures feed the 12-month analysis (typical day, revenue, economics): the full history uses the last 12 months. */
export const dataWin = (w) => (w === 'ALL' ? 'Y2' : w);
