// Canvas map of Mexico: deck geometry (32 states, region outlines), pre-projected once, ~2,500 node markers.
// Performance design (measured in web/README.md):
//  * geometry decoded once into Path2D objects in viewBox units (1173 x 740); a redraw is transform + fill/stroke only
//  * base layer (fills, borders, outlines, nodes, labels) is drawn on demand; hover/selection live on a second canvas
//  * node hit-testing: uniform grid index (cell = 14 viewBox units), nearest marker within a radius, O(1) cells per move
//  * state hit-testing: bbox prefilter + isPointInPath on a 1x1 scratch canvas
//  * no layout reads in the hot path (size cached on ResizeObserver), draws coalesced with requestAnimationFrame
//  * lazy: nothing is decoded or drawn until init() is called (the page does it when the section scrolls into view)
export const PX_LON = 40 * Math.cos((24 * Math.PI) / 180);
export const PX_LAT = 40;
export const LON0 = -118.6, LAT0 = 32.9;
export const ll2xy = (lon, lat) => [(lon - LON0) * PX_LON, (LAT0 - lat) * PX_LAT];
export const xy2ll = (x, y) => [x / PX_LON + LON0, LAT0 - y / PX_LAT];

/** Decode one delta-coded ring (ints = viewBox px * scale) to a Float32Array [x0,y0,x1,y1,...]. */
export function decodeRing(flat, scale) {
  const out = new Float32Array(flat.length);
  let x = 0, y = 0;
  for (let i = 0; i < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; out[i] = x / scale; out[i + 1] = y / scale; }
  return out;
}
/** Even-odd point in rings (pure; used by tests and by the geography checks). */
export function pointInRings(rings, x, y) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
/** Uniform grid index over points: build once, query nearest within r. Pure (tested). */
export class GridIndex {
  constructor(xs, ys, w, h, cell = 14) {
    this.cell = cell; this.nx = Math.ceil(w / cell) + 1; this.ny = Math.ceil(h / cell) + 1;
    this.xs = xs; this.ys = ys; this.cells = new Map();
    for (let i = 0; i < xs.length; i++) {
      if (!Number.isFinite(xs[i])) continue;
      const k = Math.floor(ys[i] / cell) * this.nx + Math.floor(xs[i] / cell);
      const a = this.cells.get(k); if (a) a.push(i); else this.cells.set(k, [i]);
    }
  }
  nearest(x, y, r) {
    const c = this.cell, cx = Math.floor(x / c), cy = Math.floor(y / c), span = Math.ceil(r / c);
    let best = -1, bd = r * r;
    for (let gy = cy - span; gy <= cy + span; gy++) for (let gx = cx - span; gx <= cx + span; gx++) {
      const a = this.cells.get(gy * this.nx + gx);
      if (!a) continue;
      for (const i of a) { const dx = this.xs[i] - x, dy = this.ys[i] - y, d = dx * dx + dy * dy; if (d <= bd) { bd = d; best = i; } }
    }
    return best;
  }
}
const hex = (s) => s.match(/\w\w/g).map((x) => parseInt(x, 16));
export function mix(a, b, t) {
  const pa = hex(a.replace('#', '')), pb = hex(b.replace('#', ''));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
export const lum = (h) => { const p = hex(h.replace('#', '')).map((v) => v / 255); return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; };
export const clamp01 = (t) => Math.max(0, Math.min(1, t));
const LAB_FIX = { OCCIDENTAL: [-30, 10], CENTRAL: [8, 22], ORIENTAL: [40, 40], NORESTE: [0, 20], NOROESTE: [-30, 40], NORTE: [25, 30], PENINSULAR: [-22, 0] };

export class GeoMap {
  /**
   * opts: {labels, fontSize, nodes:[{x,y}], interactive, nodeRadius}
   * Callbacks: onHover({kind:'node'|'state', ...}|null, clientX, clientY), onClick(...)
   */
  constructor(host, geo, opts = {}) {
    this.host = host; this.geo = geo; this.o = { labels: true, fontSize: 20, interactive: true, nodeRadius: 3.2, ...opts };
    this.W = geo.vb[0]; this.H = geo.vb[1];
    this.stats = { init: 0, draws: [], hits: [] };
    const t0 = performance.now();
    this.states = geo.states.map((s) => {
      const rings = s.r.map((r) => decodeRing(r, geo.scale));
      const path = new Path2D();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const r of rings) {
        path.moveTo(r[0], r[1]);
        for (let i = 2; i < r.length; i += 2) { path.lineTo(r[i], r[i + 1]); if (r[i] < x0) x0 = r[i]; if (r[i] > x1) x1 = r[i]; if (r[i + 1] < y0) y0 = r[i + 1]; if (r[i + 1] > y1) y1 = r[i + 1]; }
        path.closePath();
      }
      return { k: s.k, n: s.n, ab: s.ab, c: s.c, rings, path, bbox: [x0, y0, x1, y1] };
    });
    this.byKey = new Map(this.states.map((s) => [s.k, s]));
    this.regionPaths = {};
    for (const [c, rs] of Object.entries(geo.regions)) {
      const p = new Path2D();
      for (const f of rs) { const r = decodeRing(f, geo.scale); p.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]); p.closePath(); }
      this.regionPaths[c] = p;
    }
    this.fill = { level: 'region', color: () => null, label: () => '' };
    this.dots = null; this.sel = { region: null, state: null, node: -1 }; this.hover = null;
    this.size = { w: 0, h: 0, k: 1, dpr: 1 };
    const mk = (cls) => { const c = document.createElement('canvas'); c.className = cls; c.setAttribute('aria-hidden', 'true'); return c; };
    this.cBase = mk('gm-base'); this.cTop = mk('gm-top');
    host.classList.add('gm-host'); host.appendChild(this.cBase); host.appendChild(this.cTop);
    this.ctx = this.cBase.getContext('2d'); this.ctop = this.cTop.getContext('2d');
    this.scratch = document.createElement('canvas').getContext('2d');
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this._q = false;
    if (this.o.interactive) this._bind();
    this.stats.init = performance.now() - t0;
    this.resize();
  }
  setNodes(nodes) {      // nodes: {x:Float32Array,y:Float32Array}
    this.nodes = nodes;
    this.index = new GridIndex(nodes.x, nodes.y, this.W, this.H, 14);
  }
  setFill(f) { this.fill = f; this.draw(); }
  setExtra(fn) { this.extra = fn; this.draw(); }   // fn(ctx, {W,H}) draws in viewBox units over fills and outlines
  setDots(d) { this.dots = d; this.draw(); }   // {color:(i)=>css|null, radius?}
  setSelected(s) { this.sel = { ...this.sel, ...s }; this.drawTop(); }
  resize() {
    const w = this.host.clientWidth; if (!w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), h = Math.round((w * this.H) / this.W);
    this.size = { w, h, k: w / this.W, dpr };
    for (const c of [this.cBase, this.cTop]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = `${w}px`; c.style.height = `${h}px`; }
    this.host.style.height = `${h}px`;
    this.draw();
  }
  draw() { if (this._q) return; this._q = true; requestAnimationFrame(() => { this._q = false; this._draw(); }); }
  _draw() {
    const t0 = performance.now(), { w, h, k, dpr } = this.size; if (!w) return;
    const ctx = this.ctx, css = getComputedStyle(this.host);
    const bg = css.getPropertyValue('--bg').trim() || '#232E26', nodata = css.getPropertyValue('--map-nodata').trim() || '#2B3830';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    const dim = !!this.dots;
    ctx.lineJoin = 'round';
    for (const s of this.states) {
      const key = this.fill.level === 'region' ? s.c : s.k;
      const c = s.c === 'BAJA' && this.fill.level === 'region' ? null : this.fill.color(key);
      ctx.globalAlpha = dim ? 0.55 : 1;
      ctx.fillStyle = c || nodata;
      ctx.fill(s.path);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(35,46,38,.55)'; ctx.lineWidth = 0.6;
    for (const s of this.states) ctx.stroke(s.path);
    ctx.strokeStyle = bg; ctx.lineWidth = 2.2;
    for (const c in this.regionPaths) ctx.stroke(this.regionPaths[c]);
    if (this.extra) { ctx.save(); this.extra(ctx, { W: this.W, H: this.H }); ctx.restore(); }
    if (this.dots && this.nodes) {
      const r = this.dots.radius || this.o.nodeRadius, n = this.nodes.x.length;
      // batch by colour: one path per distinct fill
      const buckets = new Map();
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(this.nodes.x[i])) continue;
        const c = this.dots.color(i); if (!c) continue;
        let b = buckets.get(c); if (!b) buckets.set(c, (b = new Path2D()));
        b.moveTo(this.nodes.x[i] + r, this.nodes.y[i]); b.arc(this.nodes.x[i], this.nodes.y[i], r, 0, 6.2832);
      }
      ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(30,40,32,.85)';
      for (const [c, p] of buckets) { ctx.fillStyle = c; ctx.fill(p); ctx.stroke(p); }
    }
    if (this.o.labels && this.fill.level === 'region') this._labels(ctx, bg);
    this.stats.draws.push(performance.now() - t0); if (this.stats.draws.length > 50) this.stats.draws.shift();
    this.drawTop();
  }
  _labels(ctx, bg) {
    const fs = this.o.fontSize, kk = Math.min(fs / 17, 1.6);
    ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    for (const [c, [x0, y0]] of Object.entries(this.geo.labels)) {
      if (c === 'BAJA') continue;
      const col = this.fill.color(c); if (!col) continue;
      const [dx, dy] = (LAB_FIX[c] || [0, 0]).map((z) => z * kk);
      const x = x0 + dx, y = y0 + dy, dark = lum(col) > 0.45;
      const name = this.fill.name ? this.fill.name(c) : c[0] + c.slice(1).toLowerCase();
      ctx.font = `700 ${fs}px "Bricolage Grotesque", sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.fillStyle = dark ? '#1E2820' : '#F0E8D2';
      ctx.strokeText(name, x, y); ctx.fillText(name, x, y);
      const v = this.fill.label(c);
      if (v) { ctx.font = `400 ${fs * 0.9}px "DM Mono", monospace`; ctx.strokeText(v, x, y + fs * 1.15); ctx.fillText(v, x, y + fs * 1.15); }
    }
  }
  drawTop() {
    const { w, h, k, dpr } = this.size; if (!w) return;
    const c = this.ctop;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    c.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    const orange = getComputedStyle(this.host).getPropertyValue('--orange').trim() || '#C07030';
    c.lineJoin = 'round';
    const hi = (s, lw) => { c.strokeStyle = orange; c.lineWidth = lw; c.stroke(s.path); };
    if (this.sel.state && this.fill.level === 'state') { const s = this.byKey.get(this.sel.state); if (s) hi(s, 3); }
    if (this.sel.region && this.fill.level === 'region') {
      c.strokeStyle = orange; c.lineWidth = 3.4; if (this.regionPaths[this.sel.region]) c.stroke(this.regionPaths[this.sel.region]);
    }
    if (this.hover && this.hover.kind === 'state') { const s = this.byKey.get(this.hover.key); if (s) { c.strokeStyle = '#F0E8D2'; c.lineWidth = 1.6; c.stroke(s.path); } }
    const mark = (i, label) => {
      if (i < 0 || !this.nodes || !Number.isFinite(this.nodes.x[i])) return;
      const x = this.nodes.x[i], y = this.nodes.y[i];
      c.beginPath(); c.arc(x, y, 8, 0, 6.2832); c.fillStyle = orange; c.fill(); c.lineWidth = 3; c.strokeStyle = '#232E26'; c.stroke();
      if (label) {
        c.font = '500 18px "DM Mono", monospace'; c.textAlign = x > this.W * 0.7 ? 'right' : 'left'; c.lineWidth = 4; c.strokeStyle = '#232E26'; c.fillStyle = '#F0E8D2';
        const dx = x > this.W * 0.7 ? -14 : 14; c.strokeText(label, x + dx, y - 12); c.fillText(label, x + dx, y - 12);
      }
    };
    mark(this.sel.node, this.sel.nodeLabel);
    if (this.hover && this.hover.kind === 'node') {
      const i = this.hover.i; c.beginPath(); c.arc(this.nodes.x[i], this.nodes.y[i], 7, 0, 6.2832); c.lineWidth = 2.5; c.strokeStyle = '#F0E8D2'; c.stroke();
    }
  }
  /** viewBox coordinates -> {kind:'node'|'state', ...} (timed). */
  hit(vx, vy) {
    const t0 = performance.now();
    let out = null;
    if (this.dots && this.index) {
      const i = this.index.nearest(vx, vy, Math.max(7, 9 / this.size.k * 0.9));
      if (i >= 0) out = { kind: 'node', i };
    }
    if (!out) {
      for (const s of this.states) {
        const b = s.bbox;
        if (vx < b[0] || vx > b[2] || vy < b[1] || vy > b[3]) continue;
        if (this.scratch.isPointInPath(s.path, vx, vy)) { out = { kind: 'state', key: s.k, region: s.c, name: s.n }; break; }
      }
    }
    this.stats.hits.push(performance.now() - t0); if (this.stats.hits.length > 200) this.stats.hits.shift();
    return out;
  }
  _bind() {
    const top = this.cTop;
    const toV = (e) => { const r = top.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * this.W, ((e.clientY - r.top) / r.height) * this.H]; };
    let last = 0;
    top.addEventListener('pointermove', (e) => {
      const now = performance.now(); if (now - last < 16) return; last = now;
      const [x, y] = toV(e); const h = this.hit(x, y);
      const same = (!h && !this.hover) || (h && this.hover && h.kind === this.hover.kind && (h.i === this.hover.i) && (h.key === this.hover.key));
      if (!same) { this.hover = h; this.drawTop(); }
      top.style.cursor = h ? 'pointer' : 'default';
      this.o.onHover && this.o.onHover(h, e.clientX, e.clientY);
    });
    top.addEventListener('pointerleave', () => { this.hover = null; this.drawTop(); this.o.onHover && this.o.onHover(null); });
    top.addEventListener('click', (e) => { const [x, y] = toV(e); const h = this.hit(x, y); if (h && this.o.onClick) this.o.onClick(h); });
  }
  destroy() { this.ro.disconnect(); this.host.innerHTML = ''; }
}
