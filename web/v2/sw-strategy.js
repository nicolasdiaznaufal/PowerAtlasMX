// Pure routing of requests to cache strategies for the v2 service worker (also loaded by node tests).
(function (root) {
  /** pathname + request mode -> 'navigate' | 'static' | 'data' | 'bypass' */
  function strategyFor(pathname, mode) {
    if (pathname === '/v2/sw.js' || pathname === '/v2/sw-strategy.js') return 'bypass';          // always fresh: the update flow
    if (mode === 'navigate' && pathname.indexOf('/v2/') === 0) return 'navigate';                // cached shell of this release, network only when missing
    if (pathname.indexOf('/v2/') === 0) return 'static';                                         // v2 app files: cache-first within the release
    if (pathname.indexOf('/assets/js/') === 0 || pathname === '/assets/geo/mx.json' || pathname.indexOf('/assets/vendor/katex/') === 0) return 'static'; // v1 pure modules, geometry and the KaTeX files of the appendix (precached with the release)
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
  /** keep at most `max` EVICTABLE entries (oldest inserted first out); entries that are not evictable are pinned. Never throws. */
  function trimCache(cachesApi, name, max, evictable) {
    return cachesApi.open(name).then(function (c) {
      return c.keys().then(function (ks) {
        var cand = ks.filter(function (k) { return !evictable || evictable(typeof k === 'string' ? k : k.url); });
        var extra = cand.slice(0, Math.max(0, cand.length - max));
        return Promise.all(extra.map(function (k) { return c.delete(k); })).then(function () { return extra.length; });
      });
    }).catch(function () { return 0; });
  }
  /** pinned: index/analysis/series/profiles and the per-config scalars. evictable: per-variant files (4-5 MB each). */
  function evictableUrl(url) { return /\/solar_v2\/(variants|variant_extra)\//.test(url) || /\/derived\/scores\.json$/.test(url); }
  /** daily series files (about 80-100 KB gz each, node or area): evictable, never precached, bounded separately from the variants. */
  function dailyUrl(url) { return /\/solar_v2\/daily\//.test(url); }
  const api = { strategyFor: strategyFor, staleCaches: staleCaches, storeResponse: storeResponse, trimCache: trimCache, evictableUrl: evictableUrl, dailyUrl: dailyUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.swStrategy = api;
})(typeof self !== 'undefined' ? self : this);
