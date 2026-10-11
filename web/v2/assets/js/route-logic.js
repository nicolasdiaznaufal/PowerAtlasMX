// Pure routing logic (no DOM): hash -> {path, list, canonical hash}; selection sync that never writes a stale path.
import { parseSel, serializeSel } from './store.js';

export const ROUTES = ['/', '/map', '/choose', '/explorer', '/revenue'];
const NEEDS_SEL = new Set(['/choose', '/explorer', '/revenue']);
export const hrefFor = (path, list) => `#${path}${list && list.length && path !== '/' ? `?sel=${serializeSel(list)}` : ''}`;

/** valid: null (unknown yet) or { node, state, region } predicates.
 *  current: the selection already held; a hash without `sel` inherits it (and is rewritten to carry it).
 *  The landing page ignores `sel` (it is dropped from the URL). */
export function resolveHash(hash, valid = null, current = []) {
  const [p, q] = String(hash || '').replace(/^#/, '').split('?');
  let path = ROUTES.includes(p || '/') ? (p || '/') : '/';
  const raw = path === '/' ? '' : new URLSearchParams(q || '').get('sel') || '';
  const list = raw ? parseSel(raw, valid) : path === '/' ? [] : current.slice();
  if (NEEDS_SEL.has(path) && !list.length) path = '/map';
  return { path, list, hadSel: !!raw, hash: hrefFor(path, list) };
}

/** Router state: `cur` is updated BEFORE the store is synced, so the store subscriber always writes the new route. */
export function createRouter({ store, valid = () => null, replace, currentHash = null }) {
  let cur = null;
  // a navigation may be queued behind a running transition: never overwrite a URL that already points elsewhere
  const pathOf = (h) => { const p = String(h || '').replace(/^#/, '').split('?')[0] || '/'; return ROUTES.includes(p) ? p : '/'; };
  store.subscribe((list) => {
    if (!cur || cur === '/') return;
    if (currentHash && pathOf(currentHash()) !== cur) return;
    replace(hrefFor(cur, list));
  });
  return {
    get path() { return cur; },
    resolve(hash) {
      const r = resolveHash(hash, valid(), store.get());
      const prev = cur;
      cur = r.path;
      if (r.hash !== hash) replace(r.hash);
      if (r.hadSel && serializeSel(store.get()) !== serializeSel(r.list)) store.set(r.list);
      return { path: r.path, prev, changed: prev !== r.path };
    },
  };
}
