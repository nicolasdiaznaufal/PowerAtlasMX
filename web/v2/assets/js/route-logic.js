// Pure routing logic (no DOM): hash -> {path, list, canonical hash}; selection sync that never writes a stale path.
import { parseSel, serializeSel } from './store.js';
import { parseSpan, parseScenario, serializeScenario, spanEquals, scenarioEquals, parseCfg, parseWx, normalizeSpan } from './query-extras.js';

export const ROUTES = ['/', '/map', '/choose', '/explorer', '/revenue', '/appendix'];
/** routes with no selection or analysis state: they never carry ?sel and never touch the store (landing, appendix). */
const BARE = (p) => p === '/' || p === '/appendix';
const NEEDS_SEL = new Set(['/choose', '/explorer', '/revenue']);
/** `real` (today's pesos) is written as &real=1 only when on; nominal is the default and is omitted. */
export const hrefFor = (path, list, real = false, extras = null) => {
  if (BARE(path) || !(list && list.length)) return `#${path}`;
  const x = extras || {}, sc = serializeScenario(x.sc);
  return `#${path}?sel=${serializeSel(list)}${real ? '&real=1' : ''}${x.span ? `&from=${x.span.from}&to=${x.span.to}` : ''}${sc ? `&sc=${sc}` : ''}${x.cfg === 'fijo' ? '&cfg=fijo' : ''}${x.wx && x.wx !== 'mean' ? `&wx=${x.wx}` : ''}`;
};

/** valid: null (unknown yet) or { node, state, region } predicates.
 *  current: the selection already held; a hash without `sel` inherits it (and is rewritten to carry it).
 *  The landing page ignores `sel` (it is dropped from the URL). */
export function resolveHash(hash, valid = null, current = [], currentReal = false, currentExtras = null) {
  const [p, q] = String(hash || '').replace(/^#/, '').split('?');
  let path = ROUTES.includes(p || '/') ? (p || '/') : '/';
  const params = new URLSearchParams(q || '');
  const raw = BARE(path) ? '' : params.get('sel') || '';
  // an explicit entry (has sel) without real is nominal; a bare hash inherits the held basis
  const real = BARE(path) ? currentReal : params.has('real') ? params.get('real') === '1' : raw ? false : currentReal;
  const list = raw ? parseSel(raw, valid) : BARE(path) ? [] : current.slice();
  if (NEEDS_SEL.has(path) && !list.length) path = '/map';
  // span and scenario follow the same rule as the basis: explicit entry -> exactly what the URL says; bare hash -> inherit
  const cur = currentExtras || {};
  const inherit = BARE(path) || !raw;
  const full = valid && valid.months ? { from: valid.months.min, to: valid.months.max } : null;
  const span = BARE(path) ? cur.span || null : params.has('from') || params.has('to') ? normalizeSpan(parseSpan(params.get('from'), params.get('to'), valid && valid.months), full) : inherit ? cur.span || null : null;
  const sc = BARE(path) ? cur.sc || null : params.has('sc') ? parseScenario(params.get('sc')) : inherit ? cur.sc || null : null;
  const cfg = BARE(path) ? cur.cfg || 'tracker' : params.has('cfg') ? parseCfg(params.get('cfg')) : inherit ? cur.cfg || 'tracker' : 'tracker';
  const wx = BARE(path) ? cur.wx || 'mean' : params.has('wx') ? parseWx(params.get('wx')) : inherit ? cur.wx || 'mean' : 'mean';
  return { path, list, real, span, sc, cfg, wx, hadSel: !!raw, hash: hrefFor(path, list, real, { span, sc, cfg, wx }) };
}

/** Router state: `cur` is updated BEFORE the store is synced, so the store subscriber always writes the new route. */
export function createRouter({ store, valid = () => null, replace, currentHash = null }) {
  let cur = null;
  // a navigation may be queued behind a running transition: never overwrite a URL that already points elsewhere
  const pathOf = (h) => { const p = String(h || '').replace(/^#/, '').split('?')[0] || '/'; return ROUTES.includes(p) ? p : '/'; };
  let applying = false; // while a hash is being applied, no intermediate URL may be written (a reload could capture it)
  store.subscribe((list) => {
    if (applying || !cur || BARE(cur)) return;
    if (currentHash && pathOf(currentHash()) !== cur) return;
    replace(hrefFor(cur, list, store.real, store.extras));
  });
  return {
    get path() { return cur; },
    resolve(hash) {
      const r = resolveHash(hash, valid(), store.get(), store.real, store.extras);
      const prev = cur;
      cur = r.path;
      if (r.hash !== hash) replace(r.hash);
      applying = true;
      try {
        store.batch(() => {
          if (!BARE(r.path) && store.real !== r.real) store.setReal(r.real);
          if (!BARE(r.path) && !spanEquals(store.span, r.span)) store.setSpan(r.span);
          if (!BARE(r.path) && !scenarioEquals(store.scenario, r.sc)) store.setScenario(r.sc);
          if (!BARE(r.path) && store.cfg !== r.cfg) store.setCfg(r.cfg);
          if (!BARE(r.path) && store.wx !== r.wx) store.setWx(r.wx);
          if (r.hadSel && serializeSel(store.get()) !== serializeSel(r.list)) store.set(r.list);
        });
      } finally { applying = false; }
      return { path: r.path, prev, changed: prev !== r.path };
    },
  };
}
