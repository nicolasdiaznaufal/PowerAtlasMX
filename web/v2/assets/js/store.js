// Selection store: up to 16 slots, any mix of node / state / region / national. Synced to the hash query (?sel=).
import { spanEquals, scenarioEquals, isNeutral, parseCfg, parseWx } from './query-extras.js';
export const MAX_SEL = 16;
const key = (s) => (s.kind === 'national' ? 'national' : s.kind === 'node' ? s.id : `${s.kind}:${s.id}`);

/** Parse ?sel=. valid (optional) = { node(id), state(key), region(key) } predicates: unknown ids are dropped.
 *  Duplicates are dropped and the result is capped at MAX_SEL, in order. */
export function parseSel(str, valid = null) {
  const out = [], seen = new Set();
  for (const t of (str || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    let s;
    if (t === 'national') s = { kind: 'national', id: 'ALL' };
    else {
      const m = /^(state|region):(.+)$/.exec(t);
      if (m) { let id = m[2]; try { id = decodeURIComponent(id); } catch { /* keep raw */ } s = { kind: m[1], id }; }
      else s = { kind: 'node', id: t };
    }
    if (valid && valid[s.kind] && !valid[s.kind](s.id)) continue;
    const k = key(s);
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
    if (out.length >= MAX_SEL) break;
  }
  return out;
}
export const serializeSel = (list) => list.map((s) => (s.kind === 'national' ? 'national' : s.kind === 'node' ? s.id : `${s.kind}:${encodeURIComponent(s.id)}`)).join(',');

export function createStore(initial = []) {
  let list = initial.slice(0, MAX_SEL);
  let real = false; // price basis: false = nominal MXN, true = today's pesos
  let span = null;  // {from, to} months, or null = the 12-month window
  let scenario = null; // {price, dip, yield} or null = real values
  let cfg = 'tracker'; // mounting: 'tracker' | 'fijo'
  let wx = 'mean';     // weather: 'mean' | 'y2015'..'y2025' | 'win'
  const subs = new Set();
  let batching = 0, dirty = false;
  const emit = () => { if (batching) { dirty = true; return; } subs.forEach((f) => f(list)); };
  return {
    get: () => list,
    get real() { return real; },
    setReal(v) { v = !!v; if (v !== real) { real = v; emit(); } },
    /** run several setters and notify subscribers once (no in-between state is ever observed or loaded). */
    batch(fn) { batching++; try { fn(); } finally { batching--; } if (!batching && dirty) { dirty = false; emit(); } },
    get span() { return span; },
    setSpan(v) { const n = v && v.from && v.to ? { from: v.from, to: v.to } : null; if (!spanEquals(n, span)) { span = n; emit(); } },
    get scenario() { return scenario; },
    setScenario(v) { const n = isNeutral(v) ? null : { ...v }; if (!scenarioEquals(n, scenario)) { scenario = n; emit(); } },
    get cfg() { return cfg; },
    setCfg(v) { v = parseCfg(v); if (v !== cfg) { cfg = v; emit(); } },
    get wx() { return wx; },
    setWx(v) { v = parseWx(v); if (v !== wx) { wx = v; emit(); } },
    /** the URL extras of this store, for hrefFor */
    get extras() { return { span, sc: scenario, cfg, wx }; },
    has: (s) => list.some((x) => key(x) === key(s)),
    /** returns false when full */
    add(s) { if (list.some((x) => key(x) === key(s))) return true; if (list.length >= MAX_SEL) return false; list = [...list, s]; emit(); return true; },
    remove(s) { list = list.filter((x) => key(x) !== key(s)); emit(); },
    toggle(s) { return this.has(s) ? (this.remove(s), true) : this.add(s); },
    clear() { list = []; emit(); },
    set(next) { list = next.slice(0, MAX_SEL); emit(); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}
