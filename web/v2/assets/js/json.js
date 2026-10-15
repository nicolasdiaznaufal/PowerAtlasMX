// Cached JSON fetch (one request per URL for the whole session; failed fetches are retried next time).
const cache = new Map();
export function getJSON(url) {
  if (!cache.has(url)) {
    const p = fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url);
}
