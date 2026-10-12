// v1 canvas map (geomap.js GeoMap) wired to v2 data: node dots from the atlas, ramp colours, hover box. Used by the Explorer maps
// and the Revenue coverage card. The deck.gl map of the shell is untouched.
import { GeoMap, ll2xy } from '../../../assets/js/geomap.js';
import { rampColor } from '../../../assets/js/sec-map-pure.js';
import { RN } from '../../../assets/js/names.js';

export { rampColor, RN };
/** Float32 viewBox coordinates aligned with nodos.ids (NaN where the atlas has no coordinates). */
export function nodeXY(nodos, byId) {
  const x = new Float32Array(nodos.ids.length).fill(NaN), y = new Float32Array(nodos.ids.length).fill(NaN);
  nodos.ids.forEach((id, i) => { const n = byId.get(id); if (n && n.lat != null) { const [a, b] = ll2xy(n.lon, n.lat); x[i] = a; y[i] = b; } });
  return { x, y };
}
/** label size in viewBox units so names stay about 13 px on screen at any width. */
export const labelSize = (w) => Math.max(18, Math.min(34, (13 * 1173) / Math.max(200, w)));

export function createCanvasMap(host, raw, opts) {
  host.classList.add('gm-theme');
  return new GeoMap(host, raw, opts);
}

/** floating readout inside `wrap` (same look as the chart hover box). */
export function tipFor(wrap) {
  const box = document.createElement('div');
  box.className = 'hv-box mono map-tip'; box.hidden = true; box.setAttribute('aria-hidden', 'true');
  wrap.style.position = 'relative'; wrap.appendChild(box);
  return (html, cx, cy) => {
    if (!html) { box.hidden = true; return; }
    const r = wrap.getBoundingClientRect(), x = cx - r.left, y = cy - r.top;
    box.innerHTML = html; box.hidden = false;
    box.style.left = `${Math.min(x + 12, r.width - 200)}px`; box.style.top = `${Math.max(0, y - 8)}px`; box.style.transform = 'none';
  };
}

/** selection of the first slot -> what GeoMap highlights. */
export function selectionOf(slot, shell, nodos) {
  const none = { region: null, state: null, node: -1, nodeLabel: '' };
  if (!slot) return none;
  if (slot.kind === 'node') {
    const n = shell.byId.get(slot.id);
    return { region: n ? n.region : null, state: n ? n.state : null, node: nodos ? nodos.ids.indexOf(slot.id) : -1, nodeLabel: slot.id };
  }
  if (slot.kind === 'state') {
    const f = shell.geo && shell.geo.states.features.find((x) => x.properties.key === slot.id);
    return { ...none, state: slot.id, region: f ? f.properties.region : null };
  }
  if (slot.kind === 'region') return { ...none, region: slot.id };
  return none;
}
