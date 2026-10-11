// Pure routing logic (no DOM): hash -> {path, list, canonical hash}; selection sync that never writes a stale path.
import { parseSel, serializeSel } from './store.js';

export const ROUTES = ['/', '/map', '/choose', '/explorer', '/revenue'];
const NEEDS_SEL = new Set(['/choose', '/explorer', '/revenue']);
/** `real` (today's pesos) is written as &real=1 only when on; nominal is the default and is omitted. */
export const hrefFor = (path, list, real = false) => {
  if (path === '/' || !(list && list.length)) return `#${path}`;
  return `#${path}?sel=${serializeSel(list)}${real ? '&real=1' : ''}`;
};

/** valid: null (unknown yet) or { node, state, region } predicates.
 *  current: the selection already held; a hash without `sel` inherits it (and is rewritten to carry it).
 *  The landing page ignores `sel` (it is dropped from the URL). */
export function resolveHash(hash, valid = null, current = [], currentReal = false) {
  const [p, q] = String(hash || '').replace(/^#/, '').split('?');
  let path = ROUTES.includes(p || '/') ? (p || '/') : '/';
  const params = new URLSearchParams(q || '');
  const raw = path === '/' ? '' : params.get('sel') || '';
  // an explicit entry (has sel) without real is nominal; a bare hash inherits the held basis
  const real = path === '/' ? currentReal : params.has('real') ? params.get('real') === '1' : raw ? false : currentReal;
  const list = raw ? parseSel(raw, valid) : path === '/' ? [] : current.slice();
  if (NEEDS_SEL.has(path) && !list.length) path = '/map';
  return { path, list, real, hadSel: !!raw, hash: hrefFor(path, list, real) };
}

/** Router state: `cur` is updated BEFORE the store is synced, so the store subscriber always writes the new route. */
export function createRouter({ store, valid = () => null, replace, currentHash = null }) {
  let cur = null;
  // a navigation may be queued behind a running transition: never overwrite a URL that already points elsewhere
  const pathOf = (h) => { const p = String(h || '').replace(/^#/, '').split('?')[0] || '/'; return ROUTES.includes(p) ? p : '/'; };
  store.subscribe((list) => {
    if (!cur || cur === '/') return;
    if (currentHash && pathOf(currentHash()) !== cur) return;
    replace(hrefFor(cur, list, store.real));
  });
  return {
    get path() { return cur; },
    resolve(hash) {
      const r = resolveHash(hash, valid(), store.get(), store.real);
      const prev = cur;
      cur = r.path;
      if (r.hash !== hash) replace(r.hash);
      if (r.path !== '/' && store.real !== r.real) store.setReal(r.real);
      if (r.hadSel && serializeSel(store.get()) !== serializeSel(r.list)) store.set(r.list);
      return { path: r.path, prev, changed: prev !== r.path };
    },
  };
}
