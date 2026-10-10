// Selection store: up to 3 slots, any mix of node / state / region / national. Synced to the hash query (?sel=).
export const MAX_SEL = 3;
const key = (s) => (s.kind === 'national' ? 'national' : s.kind === 'node' ? s.id : `${s.kind}:${s.id}`);

export function parseSel(str) {
  return (str || '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => {
    if (t === 'national') return { kind: 'national', id: 'ALL' };
    const m = /^(state|region):(.+)$/.exec(t);
    return m ? { kind: m[1], id: decodeURIComponent(m[2]) } : { kind: 'node', id: t };
  }).slice(0, MAX_SEL);
}
export const serializeSel = (list) => list.map((s) => (s.kind === 'national' ? 'national' : s.kind === 'node' ? s.id : `${s.kind}:${encodeURIComponent(s.id)}`)).join(',');

export function createStore(initial = []) {
  let list = initial.slice(0, MAX_SEL);
  const subs = new Set();
  const emit = () => subs.forEach((f) => f(list));
  return {
    get: () => list,
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
