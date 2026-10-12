// Explorer: PML decomposition by hour (prominent), value factor over time (month / year), comparison table for several slots.
import { WIN } from '../../../assets/js/names.js';
import { mountView } from './view-base.js';
import { isNeutral } from './query-extras.js';
import { decompSectionHTML, drawDecomp } from './decomposition.js';
import { irradianceCardHTML, paintIrradiance, nodeSolar, shouldLoadIrradiance } from './irradiance.js';
import { loadIrradiance } from './solar-data.js';
import { esc as escH, nameOf } from './compare-ui.js';
import { num } from '../../../assets/js/format.js';
import { seriesCardHTML, paintSeries } from './series-card.js';
import { dailyCardHTML, mountDaily } from './daily-card.js';
import { mapsCardHTML, mountMaps } from './maps-card.js';
import { compareRows } from './compare-data.js';
import { columnLabels } from './compare-data.js';
import { tableHTML, esc, NA_HTML } from './compare-ui.js';

export function mountExplorer(host, { shell, side }) {
  let seriesView = 'months';
  return mountView({
    host, side, shell, view: 'explorer',
    build: {
      mainHTML: ({ entries }) => `${decompSectionHTML(entries, shell)}${dailyCardHTML('explorer')}${seriesCardHTML()}${mapsCardHTML()}${irradianceCardHTML(entries.map((e) => e.slot), !!shell.showClear)}${entries.length > 1 ? '<section class="xp-card" id="cmp-table"></section>' : ''}`,
      draw(root, { entries, winId, real, w }, { repaint, side }) {
        drawDecomp(root, entries);
        const ctx = { cfg: shell.store.cfg, wx: shell.store.wx };
        const irr = async () => {
          const clearOn = !!shell.showClear;
          try {
            const data = await loadIrradiance(ctx, clearOn);
            if (!root.isConnected) return;
            paintIrradiance(root, { entries, shell, winId, ...ctx, data, clearOn });
            const box = side.querySelector('#vb-irr');
            if (box) box.innerHTML = entries.filter((e) => e.slot.kind === 'node' && !e.error && !e.missing).map((e) => {
              const s = nodeSolar({ id: e.slot.id, ...ctx, winId, vfile: data.vfile, clear: clearOn ? data.clear : null });
              return s ? `<section class="ind"><div class="ind-head"><b>${escH(nameOf(shell, e))}</b><span class="mono">solar resource</span></div><div class="ind-grid">
                <div class="ind-item"><span class="mono">Global horizontal</span><strong>${num(s.annual.ghi, 0)}</strong><span class="mono u">kWh/m² per year</span></div>
                <div class="ind-item"><span class="mono">Plane of array</span><strong>${num(s.annual.poa, 0)}</strong><span class="mono u">kWh/m² per year, ${ctx.cfg === 'fijo' ? 'fixed tilt' : 'tracker'}</span></div>
                ${s.loss && s.loss.poa !== null ? `<div class="ind-item"><span class="mono">Cloud loss vs clear sky</span><strong>${num(s.loss.poa, 1)}%</strong><span class="mono u">irradiance, reference only</span></div>` : ''}</div></section>` : '';
            }).join('');
          } catch (e) { if (root.isConnected) { const b = root.querySelector('#irr-body'); if (b) b.innerHTML = '<p class="xp-text">Irradiance could not be loaded.</p>'; } }
        };
        const chk = root.querySelector('#irr-clear');
        if (chk) chk.addEventListener('change', () => { shell.showClear = chk.checked; irr(); });
        const card = root.querySelector('#irr-card');
        const hasNode = entries.some((e) => e.slot.kind === 'node' && !e.error && !e.missing);
        if (!hasNode) { /* area-only selection: no solar_v2 request */ }
        else if (shouldLoadIrradiance(ctx, false, hasNode) || !card || typeof IntersectionObserver === 'undefined') irr();
        else {
          const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); irr(); } }, { rootMargin: '0px' });
          io.observe(card);
        }
        mountDaily(root, { entries, shell, winId, view: 'explorer' });
        mountMaps(root, { shell, winId });
        paintSeries(root, { entries, shell, winId, view: seriesView, onView: (v) => { seriesView = v; repaint(); } });
        if (entries.length > 1) {
          const L = columnLabels(real, !isNeutral(shell.store.scenario), { cfg: shell.store.cfg, wx: shell.store.wx }), rows = compareRows(entries, real);
          const cols = [{ h: L.base, get: (r) => r.tiles.base.text }, { h: L.cap, get: (r) => r.tiles.cap.text }, { h: L.vf, get: (r) => (r.na ? NA_HTML : r.tiles.vf.text) }, { h: L.z, get: (r) => r.tiles.z.text }, { h: L.vfDay, get: (r) => (r.na ? NA_HTML : r.tiles.vfDay.text) }];
          root.querySelector('#cmp-table').innerHTML = `<h2 class="mono">${esc(L.heading(w.label))}</h2>${tableHTML(rows, entries, shell, cols)}`;
        }
      },
    },
  });
}
void WIN;
