// Map: one persistent deck.gl Deck (2D MapView, no tiles). Layers: states, regions, no-data nodes, nodes by metric, selection ring.
import { METRICS, domainOf, position, colorOf, RAMP } from './metrics.js';
import { featureBounds, featureContains } from './geo.js';

const MEXICO = [-118.6, 14.4, -86.6, 32.8];
const LIM = { lon: [-122, -83], lat: [12, 35] };
const SAND = [232, 162, 102, 255];
const hexa = (h, a = 255) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(a);

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export function loadDeck() {
  if (window.deck) return Promise.resolve(window.deck);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/deckgl/deck.min.js', import.meta.url).href;
    s.onload = () => (window.deck ? res(window.deck) : rej(new Error('deck global missing')));
    s.onerror = () => rej(new Error('deck.gl failed to load'));
    document.head.append(s);
  });
}

const CONTROLLER = { keyboard: true, doubleClickZoom: true, inertia: false, touchRotate: false, dragRotate: false };

export function createMapView({ deck, container, geo, atlas, callbacks }) {
  const { nodes } = atlas;
  const withData = nodes.filter((n) => n.has), noData = nodes.filter((n) => !n.has);
  let metric = 'vf';
  let dom = domainOf(atlas.nodes, metric);
  let sel = [], areaKey = null, hover = null;
  let scoreOf = null, scoreData = null; // Score view: id -> score map, with its nodes split once (not per refresh)
  let padding = { top: 72, right: 40, bottom: 40, left: 40 };
  let vs = null;
  const view = new deck.MapView({ repeat: false });

  const fit = (b, pad = padding, extra = {}) => {
    const w = Math.max(32, container.clientWidth || 1000), h = Math.max(32, container.clientHeight || 700);
    // padding must leave room for the content (tiny mini card, short phones)
    const sx = Math.min(1, (w - 16) / ((pad.left || 0) + (pad.right || 0) || 1)), sy = Math.min(1, (h - 16) / ((pad.top || 0) + (pad.bottom || 0) || 1));
    const p = { left: (pad.left || 0) * sx, right: (pad.right || 0) * sx, top: (pad.top || 0) * sy, bottom: (pad.bottom || 0) * sy };
    const vp = new deck.WebMercatorViewport({ width: w, height: h });
    const f = vp.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: p, maxZoom: extra.maxZoom || 12 });
    return { longitude: f.longitude, latitude: f.latitude, zoom: f.zoom, pitch: 0, bearing: 0, minZoom: 2.5, maxZoom: 13 };
  };
  const clamp = (v) => ({ ...v, longitude: Math.min(LIM.lon[1], Math.max(LIM.lon[0], v.longitude)), latitude: Math.min(LIM.lat[1], Math.max(LIM.lat[0], v.latitude)) });
  const setVS = (next, ms = 0) => {
    vs = clamp(next);
    callbacks.onHover(null);
    if (ms && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0;
    inst.setProps({ viewState: ms ? { ...vs, transitionDuration: ms, transitionInterpolator: new deck.FlyToInterpolator() } : vs });
  };

  const inArea = (n) => {
    if (!areaKey) return true;
    return areaKey.kind === 'state' ? n.state === areaKey.id : areaKey.kind === 'region' ? n.region === areaKey.id : true;
  };
  const selectedNodes = () => nodes.filter((n) => sel.some((s) => s.kind === 'node' && s.id === n.id));
  const areaSet = () => new Set(sel.filter((s) => s.kind === 'state' || s.kind === 'region').map((s) => `${s.kind}:${s.id}`));
  const nodeActive = (n) => !sel.length || sel.some((s) => s.kind === 'national' || (s.kind === 'node' && s.id === n.id) || (s.kind === 'state' && s.id === n.state) || (s.kind === 'region' && s.id === n.region));

  function layers() {
    const areas = areaSet();
    const L = deck;
    const fillState = (f) => (areas.has(`state:${f.properties.key}`) || areas.has(`region:${f.properties.region}`) ? hexa('#18211B') : hexa('#111813'));
    return [
      new L.GeoJsonLayer({ id: 'states', data: geo.states, pickable: true, stroked: true, filled: true, getFillColor: fillState, getLineColor: (f) => (areas.has(`state:${f.properties.key}`) ? [232, 162, 102, 230] : [240, 232, 210, 36]), lineWidthUnits: 'pixels', getLineWidth: (f) => (areas.has(`state:${f.properties.key}`) ? 2 : 1),
        updateTriggers: { getFillColor: [sel], getLineColor: [sel], getLineWidth: [sel] }, autoHighlight: true, highlightColor: [240, 232, 210, 14] }),
      new L.GeoJsonLayer({ id: 'regions', data: geo.regions, pickable: false, stroked: true, filled: false, getLineColor: [240, 232, 210, 92], lineWidthUnits: 'pixels', getLineWidth: 1.5 }),
      new L.ScatterplotLayer({ id: 'nodata', data: scoreData ? scoreData.off : noData, pickable: true, getPosition: (n) => [n.lon, n.lat], getRadius: 2000, radiusUnits: 'meters', radiusMinPixels: 1.5, radiusMaxPixels: 5,
        getFillColor: hexa('#3A453E', 200) }),
      new L.ScatterplotLayer({ id: 'nodes', data: scoreData ? scoreData.on : withData, pickable: true, getPosition: (n) => [n.lon, n.lat], getRadius: 2500, radiusUnits: 'meters', radiusMinPixels: 2.2, radiusMaxPixels: 9,
        getFillColor: (n) => colorOf(scoreOf ? Math.min(1, scoreOf.get(n.id) / 80) : position(n, metric, dom) ?? 0, RAMP.dot, nodeActive(n) ? 240 : 70),
        updateTriggers: { getFillColor: [metric, sel, scoreData], getPosition: [scoreData] }, transitions: { getFillColor: 350 } }),
      new L.ScatterplotLayer({ id: 'ring', data: [...selectedNodes(), ...(hover && !hover.__none ? [hover] : [])], pickable: false, filled: false, stroked: true,
        getPosition: (n) => [n.lon, n.lat], getRadius: 2500, radiusUnits: 'meters', radiusMinPixels: 6, radiusMaxPixels: 14,
        getLineColor: (n) => (sel.some((s) => s.kind === 'node' && s.id === n.id) ? SAND : [240, 232, 210, 150]), lineWidthUnits: 'pixels', getLineWidth: (n) => (sel.some((s) => s.kind === 'node' && s.id === n.id) ? 2.5 : 1.25),
        updateTriggers: { getData: [sel, hover], getLineColor: [sel], getLineWidth: [sel] } }),
    ];
  }

  const nodeOf = (info) => (info && info.object && (info.layer.id === 'nodes' || info.layer.id === 'nodata') ? info.object : null);
  const inst = new deck.Deck({
    parent: container, views: view, controller: CONTROLLER,
    viewState: fit(MEXICO), layers: layers(), useDevicePixels: Math.min(window.devicePixelRatio || 1, 2),
    onViewStateChange: ({ viewState }) => { vs = clamp(viewState); inst.setProps({ viewState: vs }); },
    getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    onHover: (info) => { const n = nodeOf(info); if (n !== hover) { hover = n; refresh(); } callbacks.onHover(n, info && info.x, info && info.y); },
    onClick: (info) => {
      const n = nodeOf(info);
      if (n) return callbacks.onPickNode(n);
      if (info && info.object && info.layer.id === 'states') callbacks.onPickState(info.object.properties.key);
    },
  });
  vs = inst.props.viewState;
  const refresh = () => inst.setProps({ layers: layers() });

  // the canvas is created by deck/luma asynchronously: label and make it focusable (arrow keys pan, +/- zoom) once it exists
  let interactive = true;
  const prepCanvas = () => {
    const c = container.querySelector('canvas');
    if (!c) return false;
    c.tabIndex = interactive ? 0 : -1;
    if (interactive) c.removeAttribute('aria-hidden'); else c.setAttribute('aria-hidden', 'true'); // the mini card is a link, not a map
    if (interactive) c.setAttribute('role', 'application'); else c.removeAttribute('role');
    c.setAttribute('aria-label', 'Map of Mexico. Arrow keys pan, plus and minus zoom.');
    return true;
  };
  if (!prepCanvas()) { const mo = new MutationObserver(() => { if (prepCanvas()) mo.disconnect(); }); mo.observe(container, { childList: true, subtree: true }); }

  const inst2 = {
    setMetric(m) { metric = m; dom = domainOf(atlas.nodes, m); refresh(); return dom; },
    domain: () => dom,
    setSelection(list) { sel = list; refresh(); },
    /** colour nodes by a score map (id -> 0..100); null returns to the metric colouring. Nodes absent from the map are drawn as no-data. */
    setScores(m) {
      scoreOf = m;
      scoreData = m ? { on: nodes.filter((n) => m.has(n.id)), off: nodes.filter((n) => !m.has(n.id)) } : null;
      refresh();
    },
    setPadding(p) { padding = p; },
    redraw() { inst.redraw('resize'); },
    zoomBy(d) { setVS({ ...vs, zoom: Math.min(13, Math.max(2.5, vs.zoom + d)) }, 350); },
    reset(ms = 700) { setVS(fit(MEXICO), ms); },
    flyToBounds(b, ms = 700, maxZoom = 12) { setVS(fit(b, padding, { maxZoom }), ms); },
    flyToNode(n, ms = 700) { setVS({ ...vs, longitude: n.lon, latitude: n.lat, zoom: Math.max(vs.zoom, 7) }, ms); },
    setInteractive(on, opts = {}) {
      interactive = on;
      inst.setProps({ controller: on ? { ...CONTROLLER, ...opts } : false });
      prepCanvas();
      requestAnimationFrame(prepCanvas); // deck re-applies canvas attributes when the controller changes
    },
    flyToArea(kind, id) {
      const col = kind === 'state' ? geo.states : geo.regions;
      const f = col.features.find((x) => x.properties.key === id);
      if (f) this.flyToBounds(featureBounds(f));
    },
    refresh,
    destroy() { inst.finalize(); },
  };
  return inst2;
}
export { featureContains };
