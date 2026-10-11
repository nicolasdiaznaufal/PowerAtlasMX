// Pure routing of requests to cache strategies for the v2 service worker (also loaded by node tests).
(function (root) {
  /** pathname + request mode -> 'navigate' | 'static' | 'data' | 'bypass' */
  function strategyFor(pathname, mode) {
    if (pathname === '/v2/sw.js' || pathname === '/v2/sw-strategy.js') return 'bypass';          // always fresh: the update flow
    if (mode === 'navigate' && pathname.indexOf('/v2/') === 0) return 'navigate';                // network first, cached shell offline
    if (pathname.indexOf('/v2/') === 0) return 'static';                                         // v2 app files: stale-while-revalidate
    if (pathname.indexOf('/assets/js/') === 0 || pathname === '/assets/geo/mx.json') return 'static'; // v1 pure modules + geometry reused by v2
    if (pathname.indexOf('/data/') === 0) return 'data';                                         // JSON: network first, offline fallback only
    return 'bypass';
  }
  const api = { strategyFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.swStrategy = api;
})(typeof self !== 'undefined' ? self : this);
