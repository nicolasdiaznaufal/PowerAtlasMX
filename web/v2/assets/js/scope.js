// Analysis scope: Node | State | Region | National, applied to the first slot. Pure logic + a small segmented control.
import { segment } from './controls.js';
import { COPY } from './copy.js';

export const LEVELS = ['node', 'state', 'region', 'national'];
export const LEVEL_LABEL = { node: 'Node', state: 'State', region: 'Region', national: 'National' };
const rank = (kind) => LEVELS.indexOf(kind);

/** ctx = { nodeInfo(id) -> {state, region} | null, stateRegion(key) -> region | null }. memo = finer slots seen on the way up. */
export function chainOf(slot, ctx, memo = {}) {
  const c = { ...memo };
  c[slot.kind] = slot.kind === 'national' ? { kind: 'national', id: 'ALL' } : { kind: slot.kind, id: slot.id };
  if (slot.kind === 'node') {
    const n = ctx.nodeInfo(slot.id);
    if (n) { c.state = { kind: 'state', id: n.state }; c.region = { kind: 'region', id: n.region }; }
  } else if (slot.kind === 'state') {
    const r = ctx.stateRegion(slot.id);
    if (r) c.region = { kind: 'region', id: r };
  }
  c.national = { kind: 'national', id: 'ALL' };
  return c;
}

/** the slot to analyse at `kind`, or null when it cannot be derived (finer than the current one and never visited). */
export function targetFor(slot, kind, ctx, memo = {}) {
  const c = chainOf(slot, ctx, rank(kind) < rank(slot.kind) ? memo : {});
  return c[kind] || null;
}

export function scopeOptions(slot, ctx, memo = {}) {
  return LEVELS.map((kind) => ({ kind, current: kind === slot.kind, enabled: !!targetFor(slot, kind, ctx, memo) }));
}

/** keeps the finer slots seen, so "Node" is available again after going up. */
export function remember(memo, slot, ctx) {
  const c = chainOf(slot, ctx, memo), out = { ...memo };
  for (const k of LEVELS) if (c[k] && rank(k) <= rank(slot.kind)) out[k] = c[k];
  return out;
}

export function mountScope(el, shell) {
  let memo = {};
  const ctx = {
    nodeInfo: (id) => { const n = shell.byId.get(id); return n ? { state: n.state, region: n.region } : null; },
    stateRegion: (k) => { const f = shell.geo && shell.geo.states.features.find((x) => x.properties.key === k); return f ? f.properties.region : null; },
  };
  el.innerHTML = `<div class="mono lbl" id="sc-lbl">Analyse at the level of</div><div class="seg seg4" role="radiogroup" aria-labelledby="sc-lbl" id="sc-seg"></div><p class="hint" id="sc-note"></p>`;
  const seg = el.querySelector('#sc-seg');
  const draw = () => {
    const slot = shell.store.get()[0];
    if (!slot) return;
    const opts = scopeOptions(slot, ctx, memo);
    segment(seg, opts.map((o) => [o.kind, LEVEL_LABEL[o.kind], !o.enabled, o.enabled ? '' : 'Pick a node first']), slot.kind, (kind) => {
      const cur = shell.store.get()[0], t = targetFor(cur, kind, ctx, memo);
      if (!t || kind === cur.kind) return;
      memo = remember(memo, cur, ctx);
      const rest = shell.store.get().slice(1).filter((s) => !(s.kind === t.kind && s.id === t.id));
      shell.store.set([t, ...rest]);
    });
    el.querySelector('#sc-note').textContent = COPY.scopeNote;
  };
  draw();
  const off = shell.store.subscribe(() => draw());
  return { destroy: off, draw };
}
