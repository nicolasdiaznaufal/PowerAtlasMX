// Shared skeleton of the Explorer and Revenue views: loading / error states, entries for every slot, side indicators,
// repaint on selection, window, basis and width changes. A view supplies { mainHTML(ctx), draw(root, ctx) }.
import { WIN } from '../../../assets/js/names.js';
import { loadEntries } from './compare-data.js';
import { loadSourcesCtx } from './solar-data.js';
import { loadSources } from './explorer-data.js';
import { serializeSel } from './store.js';
import { mountControls } from './controls.js';
import { indicatorsHTML } from './indicators.js';
import { areaTablesHTML, wireAreaTables } from './area-tables.js';
import { COPY } from './copy.js';
import { getJSON } from './json.js';
import { solarUrls, isDefaultCtx } from './solar-data.js';
import { scenarioEntries } from './scenario.js';
import { isNeutral } from './query-extras.js';
import { mountScenarioPanel } from './scenario-panel.js';
import { mountRangeSlider } from './range-slider.js';
import { summaryRows, summaryHTML } from './span-summary.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function mountView({ host, side, shell, view, build }) {
  let ctxKey = `${shell.store.cfg}|${shell.store.wx}`, ver = 0, dead = false, raw = null, entries = null, ctxExtra = {}, selKey = serializeSel(shell.store.get()), spanMounted = false, sumVer = 0;
  const sorts = { state: { key: 'vf', dir: -1 }, region: { key: 'vf', dir: -1 } };
  const winOf = () => shell.winId || 'Y2';
  host.innerHTML = `<p class="an-intro">${esc(COPY[view].intro)} <span class="mono draft">Draft copy</span></p>
    <div id="vb-span"></div>
    <div class="xp-state" id="vb-state" role="status"></div><div id="vb-body" hidden></div>`;
  side.innerHTML = `<div id="vb-ctl"></div><div id="vb-scn"></div><div id="vb-ind" class="inds"></div><div id="vb-irr" class="inds"></div>`;
  const scn = mountScenarioPanel(side.querySelector('#vb-scn'), shell.store);
  const q = (s) => host.querySelector(s);
  const ctl = mountControls(side.querySelector('#vb-ctl'), shell, () => load());
  const state = (kind, html) => { const s = q('#vb-state'); s.hidden = !html; s.className = `xp-state ${kind}`; s.innerHTML = html; s.setAttribute('aria-busy', String(kind === 'loading')); q('#vb-body').hidden = kind !== 'ok'; };

  function mountSpan() {
    const ok = raw && raw.find((e) => e.series);
    if (spanMounted || !ok) return;
    spanMounted = true;
    mountRangeSlider(q('#vb-span'), { months: ok.series.months, win: WIN[winOf()], span: shell.store.span, onChange: (sp) => shell.store.setSpan(sp) });
  }

  async function paintSummary(real, w) {
    const my = ++sumVer, el = q('#sr-summary');
    if (!el) return;
    el.textContent = 'Loading span summary…';
    const rows = await summaryRows(entries, shell, shell.store.span, w, real);
    if (my !== sumVer || dead || !q('#sr-summary')) return;
    q('#sr-summary').innerHTML = summaryHTML(rows, shell, shell.store.span, w, real, isDefaultCtx({ cfg: shell.store.cfg, wx: shell.store.wx }));
  }

  function paint() {
    if (!raw) return;
    entries = scenarioEntries(raw, shell.store.scenario);
    const real = shell.store.real, w = WIN[winOf()], ctx = { entries, shell, winId: winOf(), real, w, view: ctxExtra };
    side.querySelector('#vb-ind').innerHTML = indicatorsHTML(entries, shell, view);
    const body = q('#vb-body');
    const national = shell.store.get()[0] && shell.store.get()[0].kind === 'national' && ctxExtra.analysis;
    const banner = isNeutral(shell.store.scenario) ? '' : '<div class="sim-banner" role="note"><span class="badge">Simulated</span><span>These values are a what-if on the typical day, not published data. Published values are shown as ghost lines and as the change next to each indicator.</span></div>';
    const note15 = shell.store.wx === 'y2015' && ctxExtra.note2015 ? `<p class="xp-warn" role="note">${esc(ctxExtra.note2015)}</p>` : '';
    const ctxLine = `<p class="mono ctxline">${shell.store.cfg === 'fijo' ? 'Fixed tilt' : 'Single-axis tracker'} · ${esc(COPY.wxLabel(shell.store.wx))}</p>`;
    body.innerHTML = ctxLine + note15 + banner + build.mainHTML(ctx) + (national ? '<div id="vb-areas"></div>' : '');
    build.draw(body, ctx, { repaint: paint, state: ctxExtra, side });
    paintSummary(real, w);
    if (national) {
      const el = body.querySelector('#vb-areas');
      const drawAreas = () => {
        el.innerHTML = areaTablesHTML(ctxExtra.analysis, winOf(), real, sorts, { src: ctxExtra.src, ctx: { cfg: shell.store.cfg, wx: shell.store.wx } });
        wireAreaTables(el, sorts, drawAreas, (slot) => shell.store.set([slot, ...shell.store.get().slice(1).filter((s) => !(s.kind === slot.kind && s.id === slot.id))]));
      };
      drawAreas();
    }
  }

  async function load() {
    const my = ++ver, slots = shell.store.get();
    if (!slots.length) return;
    selKey = serializeSel(slots);
    ctxKey = `${shell.store.cfg}|${shell.store.wx}`;
    spanMounted = false; // the presets depend on the window
    state('loading', shell.store.cfg === 'fijo' || shell.store.wx !== 'mean' ? 'Loading fixed-tilt / weather-variant data…' : 'Loading data…');
    try {
      const ctx = { cfg: shell.store.cfg, wx: shell.store.wx };
      const [list, src] = await Promise.all([loadEntries(slots, winOf(), ctx), slots[0].kind === 'national' ? loadSourcesCtx({ kind: 'national', id: 'ALL' }, ctx) : Promise.resolve(null)]);
      if (my !== ver || dead) return;
      if (list.every((e) => e.error)) throw list[0].error;
      raw = list; ctxExtra.analysis = src && src.analysis; ctxExtra.src = src;
      ctxExtra.note2015 = null;
      if (!isDefaultCtx(ctx) && ctx.wx === 'y2015') {
        try {
          const v = await getJSON(solarUrls(ctx).vs), cnt = (win) => v.data.y2015[win].p_cap.filter((x) => x !== null && x !== undefined).length;
          const raw15 = v.note_2015 || '';
          ctxExtra.note2015 = raw15 ? `${raw15} ${cnt('Y1').toLocaleString('en-US')} nodes have data in Y1 and ${cnt('Y2').toLocaleString('en-US')} in Y2.` : null;
        } catch { /* note is informative */ }
      }
      mountSpan();
      if (list.length === 1 && list[0].missing) {
        entries = null;
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
  const off = shell.store.subscribe((l) => {
    if (serializeSel(l) !== selKey || `${shell.store.cfg}|${shell.store.wx}` !== ctxKey) load();
    else paint();
  });
  let timer = 0, lastW = host.clientWidth;
  const onResize = () => { clearTimeout(timer); timer = setTimeout(() => { if (host.clientWidth !== lastW) { lastW = host.clientWidth; paint(); } }, 150); };
  window.addEventListener('resize', onResize);
  return { destroy() { dead = true; off(); ctl.destroy(); scn.destroy(); window.removeEventListener('resize', onResize); clearTimeout(timer); } };
}
