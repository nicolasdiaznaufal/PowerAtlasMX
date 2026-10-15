// Geometry: web/assets/geo/mx.json is pre-projected (ints = px*scale, delta-coded, plate carree).
// Converted once to lon/lat GeoJSON using the file's own projection block, cached in memory.
import { decodeRing } from '../../../assets/js/geomap.js';

/** One delta-coded ring -> [[lon,lat],...] closed. */
export function ringToLonLat(flat, scale, proj) {
  const px = decodeRing(flat, scale);
  const out = [];
  for (let i = 0; i < px.length; i += 2) out.push([proj.lon0 + (px[i] - (proj.x0 || 0)) / proj.sx, proj.lat0 - px[i + 1] / proj.sy]);
  const a = out[0], b = out[out.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  return out;
}

/** Convert the raw file to { states: FeatureCollection, regions: FeatureCollection }. */
export function convertGeo(raw) {
  const mk = (rings, props) => ({ type: 'Feature', properties: props, geometry: { type: 'MultiPolygon', coordinates: rings.map((r) => [ringToLonLat(r, raw.scale, raw.proj)]) } });
  const states = raw.states.map((s) => mk(s.r, { key: s.k, name: s.n, ab: s.ab, region: s.c }));
  const regions = Object.entries(raw.regions).map(([k, rs]) => mk(rs, { key: k }));
  return { states: { type: 'FeatureCollection', features: states }, regions: { type: 'FeatureCollection', features: regions } };
}

export function ringContains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export const featureContains = (f, lon, lat) => f.geometry.coordinates.some((poly) => ringContains(poly[0], lon, lat));

/** [minLon, minLat, maxLon, maxLat] of a feature. */
export function featureBounds(f) {
  let a = 180, b = 90, c = -180, d = -90;
  for (const poly of f.geometry.coordinates) for (const [x, y] of poly[0]) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
  return [a, b, c, d];
}

let cache = null;
export async function loadGeo() {
  if (!cache) cache = fetch('../assets/geo/mx.json').then((r) => r.json()).then(convertGeo);
  return cache;
}
