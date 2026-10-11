// Pure routing of requests to cache strategies for the v2 service worker (also loaded by node tests).
(function (root) {
  /** pathname + request mode -> 'navigate' | 'static' | 'data' | 'bypass' */
  function strategyFor(pathname, mode) {
    if (pathname === '/v2/sw.js' || pathname === '/v2/sw-strategy.js') return 'bypass';          // always fresh: the update flow
    if (mode === 'navigate' && pathname.indexOf('/v2/') === 0) return 'navigate';                // cached shell of this release, network only when missing
    if (pathname.indexOf('/v2/') === 0) return 'static';                                         // v2 app files: cache-first within the release
    if (pathname.indexOf('/assets/js/') === 0 || pathname === '/assets/geo/mx.json') return 'static'; // v1 pure modules + geometry reused by v2 (precached with the release)
    if (pathname.indexOf('/data/') === 0) return 'data';                                         // JSON: network first, offline fallback only
    return 'bypass';
  }
  /** v2 cache names to delete on activate: every v2-* cache except the current shell and the (version-less) data cache. */
  function staleCaches(keys, shell, data) {
    return keys.filter(function (k) { return k.indexOf('v2-') === 0 && k !== shell && k !== data; });
  }
  var warned = false;
  /** put a copy of res into cache `name`. The clone is taken synchronously, BEFORE any async work, because the page
   *  reads the original body as soon as it is returned. Never throws; warns once per worker lifetime. */
  function storeResponse(cachesApi, name, req, res, warn) {
    if (!res || !res.ok || res.status !== 200) return Promise.resolve(false);
    var copy;
    try { copy = res.clone(); } catch (e) { return report(warn, e); }
    return cachesApi.open(name).then(function (c) { return c.put(req, copy); }).then(function () { return true; }, function (e) { return report(warn, e); });
  }
  function report(warn, e) {
    if (!warned) { warned = true; if (warn) warn('v2 service worker: could not cache a response', e); }
    return Promise.resolve(false);
  }
  /** keep at most `max` entries (oldest inserted first out). Never throws. */
  function trimCache(cachesApi, name, max) {
    return cachesApi.open(name).then(function (c) {
      return c.keys().then(function (ks) {
        var extra = ks.slice(0, Math.max(0, ks.length - max));
        return Promise.all(extra.map(function (k) { return c.delete(k); })).then(function () { return extra.length; });
      });
    }).catch(function () { return 0; });
  }
  const api = { strategyFor: strategyFor, staleCaches: staleCaches, storeResponse: storeResponse, trimCache: trimCache };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.swStrategy = api;
})(typeof self !== 'undefined' ? self : this);
