// Persistent map shell: ONE deck.gl map element for the whole session (never remounted).
// Owns the shared state: atlas, geometry, selection store, colour metric. Views only attach overlays.
import { loadAtlas } from './atlas.js';
import { loadGeo, featureBounds } from './geo.js';
import { createStore, MAX_SEL } from './store.js';
import { createMapView, loadDeck, webglAvailable } from './map-view.js';
import { domainOf } from './metrics.js';

const MEXICO = [-118.6, 14.4, -86.6, 32.8];
const title = (s) => (s || '').charAt(0) + (s || '').slice(1).toLowerCase();
export const PAD = {
  full: () => (window.innerWidth < 760 ? { top: 72, right: 12, bottom: 300, left: 12 } : { top: 72, right: 40, bottom: 40, left: 400 }),
  choose: () => (window.innerWidth < 760 ? { top: 72, right: 24, bottom: 320, left: 24 } : { top: 80, right: 80, bottom: 300, left: 80 }),
  mini: () => ({ top: 16, right: 16, bottom: 16, left: 16 }),
};

let shell = null;
export function getShell() {
  if (shell) return shell;
  const host = document.getElementById('maphost');
  const box = host.querySelector('.map-canvas');
  const s = shell = {
    host, store: createStore(), metric: 'vf', mv: null, atlas: null, geo: null, byId: new Map(), mode: 'hidden',
    hoverFn: null, metricFns: new Set(), failed: false, started: null,
    /** begin loading data and the map (idempotent). Resolves when the map is usable (or failed). */
    init() {
      if (s.started) return s.started;
      s.data = Promise.all([loadAtlas(), loadGeo()]).then(([a, g]) => { s.atlas = a; s.geo = g; a.nodes.forEach((n) => s.byId.set(n.id, n)); return s; });
      s.started = s.data.then(async () => {
        const a = s.atlas, g = s.geo;
        if (!s.hasGL) { s.failed = true; return s; }
        try {
          const deck = await loadDeck();
          s.mv = createMapView({ deck, container: box, geo: g, atlas: a, callbacks: {
            onHover: (n, x, y) => s.hoverFn && s.hoverFn(n, x, y),
            onPickNode: (n) => s.toggleNode(n),
            onPickState: (k) => s.pick({ kind: 'state', id: k, label: k }),
          } });
          s.mv.setPadding(PAD[s.mode === 'mini' ? 'mini' : 'full']());
          s.mv.reset(0);
          s.mv.setMetric(s.metric);
          s.mv.setSelection(s.store.get());
          s.store.subscribe((l) => s.mv && s.mv.setSelection(l));
        } catch (e) { console.error(e); s.failed = true; }
        return s;
      }).catch((e) => { console.error(e); s.failed = true; s.error = e; return s; });
      return s.started;
    },
    /** atlas + geometry only (enough to validate ids); does not wait for deck.gl. */
    dataReady() { s.init(); return s.data.catch(() => s); },
    setMetric(k) { s.metric = k; return s.mv ? s.mv.setMetric(k) : null; },
    domain: () => (s.mv ? s.mv.domain() : s.atlas ? domainOf(s.atlas.nodes, s.metric) : null),
    toggleNode(n) { const r = s.store.toggle({ kind: 'node', id: n.id }); if (!r) s.say(`Up to ${MAX_SEL} selections.`); return r; },
    say(t) { if (s.sayFn) s.sayFn(t); },
    /** add a place from the selector; flies the camera there. returns false when the selection is full. */
    pick(x) {
      if (!s.store.add({ kind: x.kind, id: x.id })) { s.say(`Up to ${MAX_SEL} selections. Remove one first.`); return false; }
      s.say(`${x.label} added.`);
      if (!s.mv || s.mode === 'mini') return true; // analysis pages refit the mini-map to the whole selection
      if (x.kind === 'node') { const n = s.byId.get(x.id); if (n) s.mv.flyToNode(n); }
      else if (x.kind === 'national') s.mv.reset();
      else s.mv.flyToArea(x.kind, x.id);
      return true;
    },
    label(sel) {
      if (sel.kind === 'national') return { t: 'National', k: 'National' };
      if (sel.kind === 'region') return { t: title(sel.id), k: 'Region' };
      if (sel.kind === 'state') { const f = s.geo && s.geo.states.features.find((x) => x.properties.key === sel.id); return { t: f ? f.properties.name : title(sel.id), k: 'State' }; }
      const n = s.byId.get(sel.id); return { t: n ? n.name : sel.id, k: `Node · ${sel.id}` };
    },
    /** bounds [w,s,e,n] of the whole selection (national or empty = Mexico). */
    selectionBounds() {
      const sel = s.store.get();
      let b = null;
      const add = (c) => { b = b ? [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])] : c.slice(); };
      for (const x of sel) {
        if (x.kind === 'national') return MEXICO;
        if (x.kind === 'node') { const n = s.byId.get(x.id); if (n) add([n.lon - 0.25, n.lat - 0.2, n.lon + 0.25, n.lat + 0.2]); }
        else if (s.geo) { const f = (x.kind === 'state' ? s.geo.states : s.geo.regions).features.find((y) => y.properties.key === x.id); if (f) add(featureBounds(f)); }
      }
      return b || MEXICO;
    },
    /** point the camera at the selection for the current mode. ms = transition time. */
    fit(ms = 700, padKey = null) {
      if (!s.mv) return;
      s.mv.setPadding(PAD[padKey || (s.mode === 'mini' ? 'mini' : 'full')]());
      s.mv.flyToBounds(s.selectionBounds(), ms, 7);
    },
    /** host layout mode: hidden | full | mini. Instant; animation is the caller's job. */
    setMode(m) {
      s.mode = m;
      s.host.classList.toggle('is-hidden', m === 'hidden');
      s.host.classList.toggle('is-mini', m === 'mini');
      if (s.mv) s.mv.setInteractive(m === 'full');
    },
  };
  return s;
}
export const frames = (n = 2) => new Promise((r) => { const f = (k) => (k <= 0 ? r() : requestAnimationFrame(() => f(k - 1))); f(n); });
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
