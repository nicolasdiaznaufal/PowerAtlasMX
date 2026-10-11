// Selection store: up to 3 slots, any mix of node / state / region / national. Synced to the hash query (?sel=).
export const MAX_SEL = 3;
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
  const subs = new Set();
  const emit = () => subs.forEach((f) => f(list));
  return {
    get: () => list,
    get real() { return real; },
    setReal(v) { v = !!v; if (v !== real) { real = v; emit(); } },
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
