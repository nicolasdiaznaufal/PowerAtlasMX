// Comparison layout: one plot per place in a grid that fits the page. 1 place -> 1 cell, 2-4 -> 2x2, 5-9 -> 3x3, 10-16 -> 4x4.
import { esc } from './compare-ui.js';

export const MAX_GRID = 16;
const vw = () => (typeof window === 'undefined' ? 1200 : window.innerWidth);
const vh = () => (typeof window === 'undefined' ? 900 : window.innerHeight);

/** columns for n places; on phones the grid never goes beyond 2 columns (1 up to 4 places) so the text stays readable. */
export function gridCols(n, width = vw()) {
  const c = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  return width < 560 ? (n <= 4 ? 1 : 2) : c;
}
export const gridRows = (n, width = vw()) => Math.ceil(Math.max(1, n) / gridCols(n, width));
/** plot height of a cell so the whole grid is seen in one view: `full` for one place, shrinking with the number of rows. */
export function cellHeight(n, full = 300, { min = 110, reserve = 200, height = vh(), width = vw() } = {}) {
  if (n <= 1) return full;
  const rows = gridRows(n, width), avail = Math.max(360, height - reserve);
  return Math.round(Math.max(min, Math.min(full * 0.85, avail / rows - 40)));
}
/** cells: [{ title, id }] -> grid markup; each cell holds `<div class="chart" data-cell="id">`. A single place has no caption. */
export function gridHTML(cells, width = vw()) {
  const cols = gridCols(cells.length, width), one = cells.length <= 1;
  return `<div class="pgrid cols-${cols}" style="--cols:${cols}">${cells.map((c) => `<figure class="pcell">${one ? '' : `<figcaption>${esc(c.title)}</figcaption>`}<div class="chart" data-cell="${esc(c.id)}"></div></figure>`).join('')}</div>`;
}
export const isGrid = (n) => n > 1;
