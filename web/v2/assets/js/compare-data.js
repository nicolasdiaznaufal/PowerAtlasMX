// Compare data layer: one entry per selected slot, built with the SAME functions Explorer and Revenue use for a single slot.
import { loadSources, recordFor, seriesFor, tilesOf, revenueOf, partialNote, priceBasis, yearRows } from './explorer-data.js';

/** load every slot independently (a failing slot does not block the others). */
export async function loadEntries(slots, winId) {
  return Promise.all(slots.map(async (slot) => {
    try {
      const src = await loadSources(slot);
      const rec = recordFor(src, slot, winId);
      return rec.missing ? { slot, rec, series: null, missing: true } : { slot, rec, series: seriesFor(src, slot) };
    } catch (error) {
      return { slot, error };
    }
  }));
}

/** same entries from already loaded sources (used by tests and by loadEntries callers that hold the sources). */
export function buildEntries(src, slots, winId) {
  return slots.map((slot) => {
    const rec = recordFor(src, slot, winId);
    return rec.missing ? { slot, rec, series: null, missing: true } : { slot, rec, series: seriesFor(src, slot) };
  });
}

/** one comparison-table row per entry: Explorer tiles + partial-year note (+ revenue figures). Numbers are the tiles' own values. */
export function compareRows(entries, real = false) {
  return entries.map((e, k) => {
    if (e.error || e.missing) return { k, slot: e.slot, ok: false, error: !!e.error, missing: !!e.missing };
    const t = Object.fromEntries(tilesOf(e.rec, real).map((x) => [x.id, x]));
    const rv = revenueOf(e.rec, real);
    return { k, slot: e.slot, ok: true, tiles: t, partial: partialNote(e.rec), rev: rv, basis: priceBasis(e.rec, real) };
  });
}

/** calendar-year VF values aligned to a shared year axis (null where a slot lacks the year). */
export function yearAxis(entries, real = false) {
  const per = entries.map((e) => (e.series ? yearRows(e.series, real) : []));
  const years = [...new Set(per.flatMap((r) => r.map((y) => y.label)))].sort();
  return { years, vals: per.map((rows) => years.map((y) => { const r = rows.find((x) => x.label === y); return r ? r.vf : null; })) };
}
