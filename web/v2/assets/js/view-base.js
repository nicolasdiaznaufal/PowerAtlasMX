// Shared skeleton of the Explorer and Revenue views: loading / error states, entries for every slot, side indicators,
// repaint on selection, window, basis and width changes. A view supplies { mainHTML(ctx), draw(root, ctx) }.
import { WIN } from '../../../assets/js/names.js';
import { loadEntries } from './compare-data.js';
import { loadSources } from './explorer-data.js';
import { serializeSel } from './store.js';
import { mountControls } from './controls.js';
import { indicatorsHTML } from './indicators.js';
import { areaTablesHTML, wireAreaTables } from './area-tables.js';
import { COPY } from './copy.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function mountView({ host, side, shell, view, build }) {
  let ver = 0, dead = false, entries = null, ctxExtra = {}, selKey = serializeSel(shell.store.get());
  const sorts = { state: { key: 'vf', dir: -1 }, region: { key: 'vf', dir: -1 } };
  const winOf = () => shell.winId || 'Y2';
  host.innerHTML = `<p class="an-intro">${esc(COPY[view].intro)} <span class="mono draft">Draft copy</span></p>
    <div class="xp-state" id="vb-state" role="status"></div><div id="vb-body" hidden></div>`;
  side.innerHTML = `<div id="vb-ctl"></div><div id="vb-ind" class="inds"></div>`;
  const q = (s) => host.querySelector(s);
  const ctl = mountControls(side.querySelector('#vb-ctl'), shell, () => load());
  const state = (kind, html) => { const s = q('#vb-state'); s.hidden = !html; s.className = `xp-state ${kind}`; s.innerHTML = html; s.setAttribute('aria-busy', String(kind === 'loading')); q('#vb-body').hidden = kind !== 'ok'; };

  function paint() {
    if (!entries) return;
    const real = shell.store.real, w = WIN[winOf()], ctx = { entries, shell, winId: winOf(), real, w, view: ctxExtra };
    side.querySelector('#vb-ind').innerHTML = indicatorsHTML(entries, shell, view);
    const body = q('#vb-body');
    const national = shell.store.get()[0] && shell.store.get()[0].kind === 'national' && ctxExtra.analysis;
    body.innerHTML = build.mainHTML(ctx) + (national ? '<div id="vb-areas"></div>' : '');
    build.draw(body, ctx, { repaint: paint, state: ctxExtra });
    if (national) {
      const el = body.querySelector('#vb-areas');
      const drawAreas = () => {
        el.innerHTML = areaTablesHTML(ctxExtra.analysis, winOf(), real, sorts);
        wireAreaTables(el, sorts, drawAreas, (slot) => shell.store.set([slot, ...shell.store.get().slice(1).filter((s) => !(s.kind === slot.kind && s.id === slot.id))]));
      };
      drawAreas();
    }
  }

  async function load() {
    const my = ++ver, slots = shell.store.get();
    if (!slots.length) return;
    selKey = serializeSel(slots);
    state('loading', 'Loading data…');
    try {
      const [list, src] = await Promise.all([loadEntries(slots, winOf()), slots[0].kind === 'national' ? loadSources({ kind: 'national', id: 'ALL' }) : Promise.resolve(null)]);
      if (my !== ver || dead) return;
      if (list.every((e) => e.error)) throw list[0].error;
      entries = list; ctxExtra.analysis = src && src.analysis;
      if (list.length === 1 && list[0].missing) {
        side.querySelector('#vb-ind').innerHTML = '';
        state('err', `No data for this selection in ${esc(WIN[winOf()].label)}. ${slots[0].kind === 'node' ? 'The node is outside the analysis universe for that window.' : ''}`);
        return;
      }
      state('ok', '');
      paint();
    } catch (e) {
      if (my !== ver || dead) return;
      console.error(e);
      state('err', 'The data could not be loaded. <button type="button" class="btn btn-ghost btn-sm" id="vb-retry">Try again</button>');
      const r = q('#vb-retry'); if (r) r.addEventListener('click', load);
    }
  }

  load();
  const off = shell.store.subscribe((l) => { if (serializeSel(l) !== selKey) load(); else paint(); });
  let timer = 0, lastW = host.clientWidth;
  const onResize = () => { clearTimeout(timer); timer = setTimeout(() => { if (host.clientWidth !== lastW) { lastW = host.clientWidth; paint(); } }, 150); };
  window.addEventListener('resize', onResize);
  return { destroy() { dead = true; off(); ctl.destroy(); window.removeEventListener('resize', onResize); clearTimeout(timer); } };
}
