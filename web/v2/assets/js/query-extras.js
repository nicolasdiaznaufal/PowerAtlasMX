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
// Weather is fixed to the yearly mean 2015-2025: old &wx= values are accepted and ignored (the URL is rewritten without them).
export const parseWx = () => WX_DEFAULT;

// The time span (&from=YYYY-MM&to=YYYY-MM) is the ONE time control; no span = the last 12 months (the Y2 window, nothing in the URL).
// Figures that exist per 12-month window only (typical day, revenue, economics, coverage) use the window that contains or overlaps the span end.
export const Y1_SPAN = Object.freeze({ from: '2024-08', to: '2025-07' });
export const FULL_SPAN = Object.freeze({ from: '2020-01', to: '2026-09' });
const monthIdx = (m) => +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1);
/** 'Y1' when the span lies inside Aug 2024 - Jul 2025, otherwise 'Y2'. */
export function windowOfSpan(span) {
  if (span && span.from >= Y1_SPAN.from && span.to <= Y1_SPAN.to) return 'Y1';
  return 'Y2';
}
/** published area figures also exist for the full history: a span of two years or more uses them on the maps. */
export function mapWinOfSpan(span) {
  if (span && monthIdx(span.to) - monthIdx(span.from) >= 23) return 'ALL';
  return windowOfSpan(span);
}
/** true when the span is exactly the window the 12-month figures come from (no note needed). */
export function spanIsWindow(span) {
  return !span || (span.from === Y1_SPAN.from && span.to === Y1_SPAN.to);
}
