// Explorer: PML decomposition by hour (prominent), value factor over time (month / year), comparison table for several slots.
import { WIN } from '../../../assets/js/names.js';
import { mountView } from './view-base.js';
import { decompSectionHTML, drawDecomp } from './decomposition.js';
import { seriesCardHTML, paintSeries } from './series-card.js';
import { compareRows } from './compare-data.js';
import { columnLabels } from './compare-data.js';
import { tableHTML, esc } from './compare-ui.js';

export function mountExplorer(host, { shell, side }) {
  let seriesView = 'months';
  return mountView({
    host, side, shell, view: 'explorer',
    build: {
      mainHTML: ({ entries }) => `${decompSectionHTML(entries, shell)}${seriesCardHTML()}${entries.length > 1 ? '<section class="xp-card" id="cmp-table"></section>' : ''}`,
      draw(root, { entries, winId, real, w }, { repaint }) {
        drawDecomp(root, entries);
        paintSeries(root, { entries, shell, winId, view: seriesView, onView: (v) => { seriesView = v; repaint(); } });
        if (entries.length > 1) {
          const L = columnLabels(real), rows = compareRows(entries, real);
          const cols = [{ h: L.base, get: (r) => r.tiles.base.text }, { h: L.cap, get: (r) => r.tiles.cap.text }, { h: L.vf, get: (r) => r.tiles.vf.text }, { h: L.z, get: (r) => r.tiles.z.text }, { h: L.vfDay, get: (r) => r.tiles.vfDay.text }];
          root.querySelector('#cmp-table').innerHTML = `<h2 class="mono">${esc(L.heading(w.label))}</h2>${tableHTML(rows, entries, shell, cols)}`;
        }
      },
    },
  });
}
void WIN;
