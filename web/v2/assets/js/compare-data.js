// Compare data layer: one entry per selected slot, built with the SAME functions Explorer and Revenue use for a single slot.
import { seriesFor, tilesOf, revenueOf, partialNote, annualEquivNote, priceBasis, yearRows } from './explorer-data.js';
import { loadSourcesCtx, recordForCtx } from './solar-data.js';

/** load every slot independently (a failing slot does not block the others). */
export async function loadEntries(slots, winId, ctx = null) {
  return Promise.all(slots.map(async (slot) => {
    try {
      const src = await loadSourcesCtx(slot, ctx);
      const rec = recordForCtx(src, slot, winId, ctx);
      return rec.missing ? { slot, rec, series: null, missing: true } : { slot, rec, series: seriesFor(src, slot) };
    } catch (error) {
      return { slot, error };
    }
  }));
}

/** same entries from already loaded sources (used by tests and by loadEntries callers that hold the sources). */
export function buildEntries(src, slots, winId, ctx = null) {
  return slots.map((slot) => {
    const rec = recordForCtx(src, slot, winId, ctx);
    return rec.missing ? { slot, rec, series: null, missing: true } : { slot, rec, series: seriesFor(src, slot) };
  });
}

/** one comparison-table row per entry: Explorer tiles + partial-year note (+ revenue figures). Numbers are the tiles' own values. */
export function compareRows(entries, real = false) {
  return entries.map((e, k) => {
    if (e.error || e.missing) return { k, slot: e.slot, ok: false, error: !!e.error, missing: !!e.missing };
    const t = Object.fromEntries(tilesOf(e.rec, real).map((x) => [x.id, x]));
    const rv = revenueOf(e.rec, real);
    return { k, slot: e.slot, ok: true, tiles: t, partial: partialNote(e.rec), equiv: annualEquivNote(e.rec), rev: rv, basis: priceBasis(e.rec, real), na: !!e.rec.simNA };
  });
}

/** calendar-year VF values aligned to a shared year axis (null where a slot lacks the year). */
export function yearAxis(entries, real = false) {
  const per = entries.map((e) => (e.series ? yearRows(e.series, real) : []));
  const years = [...new Set(per.flatMap((r) => r.map((y) => y.label)))].sort();
  return { years, vals: per.map((rows) => years.map((y) => { const r = rows.find((x) => x.label === y); return r ? r.vf : null; })) };
}

/** table column headings per price basis (average/captured/VF follow the toggle; spread, <= 0 share and average-day VF are nominal figures). */
export function columnLabels(real, sim = false, ctx = null) {
  const b = real ? "today's pesos" : 'nominal';
  return {
    heading: (win) => `Comparison, ${win} · prices in ${b}${ctx ? ` · ${ctx.cfg === 'fijo' ? 'fixed tilt' : 'single-axis tracker'} · ${ctx.wx === 'mean' ? 'yearly mean weather' : ctx.wx === 'win' ? 'window weather' : `${ctx.wx.slice(1)} weather`}` : ''}`,
    base: `Average price, MXN/MWh (${b})`, cap: `Captured price, MXN/MWh (${b})`, vf: `Value factor (${b})`,
    z: `Output at price ≤ 0, % of energy${sim ? ' (not simulated)' : ''}`, vfDay: 'VF, average day (nominal)',
    revenue: `Revenue per MWp per year, M MXN (${b})`,
  };
}
