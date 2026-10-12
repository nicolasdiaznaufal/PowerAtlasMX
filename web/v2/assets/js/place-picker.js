// Place picker of the economics cards: Node | State | Region | National tabs + the searchable selector (v1 Picker).
// Local to the card (like v1); it starts from, and follows, the first selected slot of the page.
import { regName, stName } from '../../../assets/js/names.js';
import { segment } from './controls.js';
import { buildEntries, createSelector } from './selector.js';
import { scopeOptions, targetFor, remember, LEVEL_LABEL } from './scope.js';

export function placeName(shell, p) {
  if (!p) return '';
  if (p.kind === 'node') { const n = shell.byId.get(p.id); return n ? `${p.id} · ${n.name} · ${n.muni || ''}, ${n.state || ''}` : p.id; }
  if (p.kind === 'state') return `${stName(p.id)} (state)`;
  if (p.kind === 'region') return `${regName(p.id)} (region)`;
  return 'National (SIN)';
}
export const placeKey = (p) => (p ? `${p.kind}:${p.id}` : '');
const ctxOf = (shell) => ({
  nodeInfo: (id) => { const n = shell.byId.get(id); return n ? { state: n.state, region: n.region } : null; },
  stateRegion: (k) => { const f = shell.geo && shell.geo.states.features.find((x) => x.properties.key === k); return f ? f.properties.region : null; },
});

/** host: element; ui: { place, memo } kept by the caller across repaints; onChange(place). */
export function mountPlacePicker(host, { shell, ui, id, onChange }) {
  const ctx = ctxOf(shell);
  if (!shell._entries) shell._entries = buildEntries(shell.geo, shell.atlas.nodes);
  host.innerHTML = `<div class="seg seg4 pp-tabs" role="radiogroup" aria-label="Analysis level" id="pk-${id}-lv"></div>
    <p class="pp-cur" id="pk-${id}-cur"></p><div id="pk-${id}-sel"></div>`;
  const draw = () => {
    const opts = scopeOptions(ui.place, ctx, ui.memo);
    segment(host.querySelector(`#pk-${id}-lv`), opts.map((o) => [o.kind, LEVEL_LABEL[o.kind], !o.enabled, o.enabled ? '' : 'Pick a node first']), ui.place.kind, (kind) => {
      const t = targetFor(ui.place, kind, ctx, ui.memo);
      if (!t || kind === ui.place.kind) return;
      ui.memo = remember(ui.memo, ui.place, ctx); ui.place = t; draw(); onChange(t);
    });
    host.querySelector(`#pk-${id}-cur`).textContent = placeName(shell, ui.place);
  };
  const sel = createSelector({ entries: shell._entries, id: `${id}-s`, onPick: (x) => {
    const t = { kind: x.kind, id: x.id };
    ui.memo = remember(ui.memo, ui.place, ctx); ui.memo = remember(ui.memo, t, ctx); ui.place = t; draw(); onChange(t);
  } });
  host.querySelector(`#pk-${id}-sel`).appendChild(sel.el);
  draw();
}
