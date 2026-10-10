// Pure routing logic (no DOM): hash -> {path, list, canonical hash}; selection sync that never writes a stale path.
import { parseSel, serializeSel } from './store.js';

export const ROUTES = ['/', '/map', '/choose', '/explorer', '/revenue'];
const NEEDS_SEL = new Set(['/choose', '/explorer', '/revenue']);
export const hrefFor = (path, list) => `#${path}${list && list.length && path !== '/' ? `?sel=${serializeSel(list)}` : ''}`;

/** valid: null (unknown yet) or { node, state, region } predicates. */
export function resolveHash(hash, valid = null) {
  const [p, q] = String(hash || '').replace(/^#/, '').split('?');
  let path = ROUTES.includes(p || '/') ? (p || '/') : '/';
  const raw = new URLSearchParams(q || '').get('sel') || '';
  const list = parseSel(raw, valid);
  if (NEEDS_SEL.has(path) && !list.length) path = '/map';
  return { path, list, hadSel: !!raw, hash: hrefFor(path, list) };
}

/** Router state: `cur` is updated BEFORE the store is synced, so the store subscriber always writes the new route. */
export function createRouter({ store, valid = () => null, replace }) {
  let cur = null;
  store.subscribe((list) => { if (cur && cur !== '/') replace(hrefFor(cur, list)); });
  return {
    get path() { return cur; },
    resolve(hash) {
      const r = resolveHash(hash, valid());
      const prev = cur;
      cur = r.path;
      if (r.hash !== hash) replace(r.hash);
      if (r.hadSel && serializeSel(store.get()) !== serializeSel(r.list)) store.set(r.list);
      return { path: r.path, prev, changed: prev !== r.path };
    },
  };
}
