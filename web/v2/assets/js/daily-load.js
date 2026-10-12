// Daily files: lazy fetch with a bounded in-memory cache. Files are 80-100 KB gzipped each (node or area); the browser keeps at most
// MAX_FILES decoded (about 0.4 MB each); the service worker keeps at most DATA_DAILY of them on disk (evictable, never precached).
import { decodeDoc } from './daily-math.js';
import { getJSON } from './json.js';

export const DAILY_BASE = '../data/solar_v2/daily/';
export const MAX_FILES = 8;
const files = new Map(); // url -> Promise<decoded>, insertion order = age

/** file of a slot: node -> nodes/{id}.json; national -> areas/ALL.json; region/state -> areas/{kind}-{NAME}.json (non-alphanumerics become _). */
export function dailyUrl(slot) {
  if (!slot) return null;
  const safe = (s) => String(s).replace(/[^A-Za-z0-9]/g, '_');
  if (slot.kind === 'node') return `${DAILY_BASE}nodes/${slot.id}.json`;
  if (slot.kind === 'national') return `${DAILY_BASE}areas/ALL.json`;
  if (slot.kind === 'region' || slot.kind === 'state') return `${DAILY_BASE}areas/${slot.kind}-${safe(slot.id)}.json`;
  return null;
}

/** lazy gate: the files are requested only for a selection with at least one usable slot AND once the card is on screen. */
export const shouldLoadDaily = (visible, hasSlot) => !!visible && !!hasSlot;

/** bounded cache: oldest entry out when over `max`. Failed fetches are dropped so the next paint retries. */
export function remember(map, key, make, max = MAX_FILES) {
  if (map.has(key)) { const p = map.get(key); map.delete(key); map.set(key, p); return p; } // refresh age
  const p = make();
  p.catch(() => map.delete(key));
  map.set(key, p);
  while (map.size > max) map.delete(map.keys().next().value);
  return p;
}

export const loadDaily = (slot) => {
  const url = dailyUrl(slot);
  return url ? remember(files, url, () => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); }).then(decodeDoc)) : Promise.resolve(null);
};
export const loadDeflator = () => getJSON(`${DAILY_BASE}deflator_mensual.json`);
