// Daily series (docs/TECNICO.md section 13): decoding of the integer-coded files and 7-day moving averages computed in the browser.
// Pure functions, no DOM, no fetch. A moving average ends on the day itself, skips null days, needs >= 4 valid days of 7, and
// never averages the daily captured price: it is a ratio of SUMS (blow-up days with PML near 0 do not dominate).
export const MIN_DAYS = 4, WINDOW = 7, MIN_SPREAD_HOURS = 12;
export const SOLAR_END = '2026-07-30'; // last day with NASA POWER weather (production fields are null after it)
export const SCALE = { n_horas: 1, pml_avg: 0.1, energia_avg: 0.1, perdidas_avg: 0.01, congestion_avg: 0.01, spread: 0.1, y_day: 1e-4, horas_solares: 1, p_cap_dia: 0.1, vf_dia: 1e-4, ingreso_dia: 0.1, n_nodos: 1 };

const ok = (v) => v !== null && v !== undefined && Number.isFinite(v);
const decodeList = (list, scale) => list.map((v) => (v === null || v === undefined ? null : v * scale));

/** one file (node `daily/1` or area `daily-area/1`) -> { area, start, n, pml:{f:[...]}, tracker:{...}, fijo:{...} } with real units, null = no value. */
export function decodeDoc(doc) {
  const sc = { ...SCALE, ...(doc.scale && !Array.isArray(doc.scale) ? doc.scale : {}) };
  const dec = (blk) => Object.fromEntries(Object.entries(blk).map(([f, l]) => [f, decodeList(l, sc[f] ?? 1)]));
  return { area: doc.schema_version.startsWith('daily-area'), start: doc.start, n: doc.n, pml: dec(doc.pml), tracker: dec(doc.tracker), fijo: dec(doc.fijo) };
}

/** moving average ending at day i, weighted by n (hours of the day), null days skipped, null with fewer than minDays valid days. */
export function ma7(x, n, minDays = MIN_DAYS, w = WINDOW) {
  return x.map((_, i) => {
    let sx = 0, sn = 0, k = 0;
    for (let j = Math.max(0, i - w + 1); j <= i; j++) if (ok(x[j]) && ok(n[j]) && n[j] > 0) { sx += x[j] * n[j]; sn += n[j]; k++; }
    return k >= minDays ? sx / sn : null;
  });
}

/** captured price, 7-day, by ratio of sums over the days where ingreso, y, pml and n are all present. */
export function ma7Ratio(ingreso, y, pml, n, minDays = MIN_DAYS, w = WINDOW) {
  const cap = new Array(ingreso.length).fill(null);
  for (let i = 0; i < ingreso.length; i++) {
    let si = 0, sy = 0, k = 0;
    for (let j = Math.max(0, i - w + 1); j <= i; j++) {
      if (ok(ingreso[j]) && ok(y[j]) && ok(pml[j]) && ok(n[j]) && n[j] > 0) { si += ingreso[j]; sy += y[j]; k++; }
    }
    if (k < minDays || sy <= 0) continue;
    cap[i] = si / sy;
  }
  return { cap };
}

export const dayDiff = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
export const dateOf = (start, i) => new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10) + i)).toISOString().slice(0, 10);
const monthEnd = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);

/** day index range [i0, i1] of the span ({from,to} months) inside a file of n days. */
export function rangeOf(start, n, span) {
  const i0 = Math.max(0, dayDiff(start, `${span.from}-01`)), i1 = Math.min(n - 1, dayDiff(start, monthEnd(span.to)));
  return [i0, Math.max(i0, i1)];
}

/** pesos-of-today factor of every day (by CDMX month); null where the month is unknown. defl = { months, factor }. */
export function dayFactors(start, n, defl) {
  const f = new Map(defl.months.map((m, i) => [m, defl.factor[i]]));
  return Array.from({ length: n }, (_, i) => (f.has(dateOf(start, i).slice(0, 7)) ? f.get(dateOf(start, i).slice(0, 7)) : null));
}

/** every plotted daily series of one decoded file, over all its days: moving averages of 7 days. real -> money in today's pesos (factors). */
export function dailyView(dec, cfg, { real = false, factors = null } = {}) {
  const c = dec[cfg], p = dec.pml, one = new Array(dec.n).fill(1);
  const w = dec.area ? one : p.n_horas;
  const px = (a) => (real && factors ? a.map((v, i) => (ok(v) && ok(factors[i]) ? v * factors[i] : null)) : a);
  const pmlCfg = dec.area ? c.pml_avg : p.pml_avg;
  const nominal = ma7Ratio(c.ingreso_dia, c.y_day, pmlCfg, w);
  const cap = real ? ma7Ratio(px(c.ingreso_dia), c.y_day, pmlCfg, w).cap : nominal.cap;
  const wSpread = dec.area ? one : p.n_horas.map((h) => (ok(h) && h >= MIN_SPREAD_HOURS ? h : 0));
  return {
    cap,
    revenue: ma7(px(c.ingreso_dia), one), hours: ma7(c.horas_solares, one), output: ma7(c.y_day, one), // plain mean of the valid days (TECNICO 13)
    pml: ma7(px(p.pml_avg), w), congestion: ma7(px(p.congestion_avg), w), losses: ma7(px(p.perdidas_avg), w), spread: ma7(px(p.spread), wSpread),
  };
}
