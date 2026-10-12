// Shared time-zoom of the plots of one card: drag to select a range, double-click or Escape to reset, buttons for keyboard users.
// The pure helpers (index mapping, steps) are unit tested; createZoom wires them to the SVG plots (hover and touch keep working:
// the selection is an extra pointer listener, a drag shorter than MIN_PX is just a hover).
export const MIN_PX = 8, MIN_POINTS = 5;

/** viewBox x -> index of the data point under it (geom = { W, l, r }, n = points shown). */
export function indexAt(x, geom, n) {
  const step = (geom.W - geom.l - geom.r) / n;
  return Math.max(0, Math.min(n - 1, Math.floor((x - geom.l) / step)));
}
/** drag from x0 to x1 (viewBox units, geom.k = viewBox units per screen pixel) -> [i0, i1] shown-indexes or null when too small. */
export function rangeFromDrag(x0, x1, geom, n, pxPerUnit = 1) {
  if (Math.abs(x1 - x0) * pxPerUnit < MIN_PX) return null;
  const a = indexAt(Math.min(x0, x1), geom, n), b = indexAt(Math.max(x0, x1), geom, n);
  return b - a + 1 >= Math.min(MIN_POINTS, n) ? [a, b] : null;
}
/** zoom step around the centre: dir > 0 halves the range (not below MIN_POINTS), dir < 0 doubles it; null = whole series. */
export function stepRange(range, n, dir) {
  const [a, b] = range || [0, n - 1], len = b - a + 1, mid = (a + b) / 2;
  const len2 = dir > 0 ? Math.max(Math.min(MIN_POINTS, n), Math.round(len / 2)) : Math.min(n, len * 2);
  if (len2 >= n) return null;
  let a2 = Math.round(mid - (len2 - 1) / 2);
  a2 = Math.max(0, Math.min(n - len2, a2));
  return [a2, a2 + len2 - 1];
}

/** labels: full array of the group's x labels (dates or months), store: object kept across repaints, key: group id. */
export function createZoom({ labels, store, key, onChange }) {
  const n = labels.length;
  const saved = store && store[key];
  let range = null;
  if (saved) { const a = labels.indexOf(saved.from), b = labels.indexOf(saved.to); if (a >= 0 && b > a) range = [a, b]; }
  const keep = () => { if (store) store[key] = range ? { from: labels[range[0]], to: labels[range[1]] } : null; };
  const set = (r) => { range = r && r[1] - r[0] + 1 < n ? r : null; keep(); onChange(); };
  const api = {
    get range() { return range || [0, n - 1]; },
    get zoomed() { return !!range; },
    set, reset: () => { if (range) set(null); },
    zoomIn: () => set(stepRange(range, n, 1)), zoomOut: () => set(stepRange(range, n, -1)),
    /** the plot shows indexes [range0..range1]; `el` holds its svg, geom the geometry renderChart returned. */
    attach(el, geom, shown) {
      const svg = el && el.querySelector && el.querySelector('svg');
      if (!svg) return;
      const off = api.range[0], vb = (svg.viewBox && svg.viewBox.baseVal) || { width: geom.W, height: 300 };
      let x0 = null, box = null;
      const toX = (ev) => { const r = svg.getBoundingClientRect(); return ((ev.clientX - r.left) / r.width) * (vb.width || geom.W); };
      const pxPer = () => svg.getBoundingClientRect().width / (vb.width || geom.W);
      svg.addEventListener('pointerdown', (ev) => {
        if (ev.button > 0) return;
        x0 = toX(ev);
        box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        box.setAttribute('class', 'zoom-sel'); box.setAttribute('y', 0); box.setAttribute('height', vb.height - 40); box.setAttribute('width', 0); box.setAttribute('x', x0);
        svg.appendChild(box);
      });
      svg.addEventListener('pointermove', (ev) => {
        if (x0 === null || !box) return;
        const x = toX(ev); box.setAttribute('x', Math.min(x0, x)); box.setAttribute('width', Math.abs(x - x0));
      });
      const end = (ev) => {
        if (x0 === null) return;
        const r = rangeFromDrag(x0, toX(ev), geom, shown, pxPer());
        x0 = null; if (box && box.parentNode) box.parentNode.removeChild(box); box = null;
        if (r) set([off + r[0], off + r[1]]);
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', () => { x0 = null; if (box && box.parentNode) box.parentNode.removeChild(box); box = null; });
      svg.addEventListener('dblclick', () => api.reset());
      svg.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') api.reset(); });
    },
    barHTML: () => `<div class="zoom-bar" role="group" aria-label="Time zoom"><span class="mono">Zoom: drag on a plot, double-click to reset</span>
      <button type="button" class="chip-btn" data-z="in">Zoom in</button><button type="button" class="chip-btn" data-z="out">Zoom out</button><button type="button" class="chip-btn" data-z="reset">Reset</button></div>`,
    wire(root) {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => { const a = b.dataset.z; if (a === 'in') api.zoomIn(); else if (a === 'out') api.zoomOut(); else api.reset(); }));
      if (api._keyed) return;
      api._keyed = true;
      const esc = (ev) => { if (!root.isConnected) { document.removeEventListener('keydown', esc); return; } if (ev.key === 'Escape' && range && !document.getElementById('assump')) api.reset(); };
      document.addEventListener('keydown', esc);
    },
  };
  return api;
}
