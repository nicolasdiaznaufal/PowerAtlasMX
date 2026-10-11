// National scope: all states and all regions ranked, sortable; a row click sets the analysed slot. Published area fields only.
import { WIN, stName, regName } from '../../../assets/js/names.js';
import { num } from '../../../assets/js/format.js';
import { esc } from './compare-ui.js';

const mil = (v) => (v === null || v === undefined ? '—' : num(v / 1e6, 2));
export const COLUMNS = [
  { k: 'name', h: 'Name', text: true },
  { k: 'base', h: 'Average price', unit: 'MXN/MWh' },
  { k: 'cap', h: 'Captured price', unit: 'MXN/MWh' },
  { k: 'vf', h: 'Value factor' },
  { k: 'rev', h: 'Revenue per MWp per year', unit: 'M MXN' },
  { k: 'n', h: 'Nodes' },
];

/** rows for one level from analysis.json (window winId, tracker). real = today's pesos fields. */
export function areaRows(analysis, winId, level, real) {
  const c = analysis.ventanas[WIN[winId].key].por_config.tracker;
  const src = level === 'state' ? c.estados : c.regiones;
  return Object.entries(src).map(([id, s]) => {
    const base = real && s.pml_medio_real != null ? s.pml_medio_real : s.pml_medio, cap = real && s.p_cap_real != null ? s.p_cap_real : s.p_cap;
    return { id, level, name: level === 'state' ? stName(id) : regName(id), base, cap, vf: base ? cap / base : null,
      rev: real && s.ingreso_real_mxn_por_mwp != null ? s.ingreso_real_mxn_por_mwp : s.ingreso_mxn_por_mwp, n: s.n_nodos };
  });
}
export function sortRows(rows, key, dir = -1) {
  const t = rows.slice();
  t.sort((a, b) => (key === 'name' ? dir * a.name.localeCompare(b.name) : dir * ((a[key] ?? -Infinity) - (b[key] ?? -Infinity))) || a.name.localeCompare(b.name));
  return t;
}
const fmt = (c, r) => (c.k === 'name' ? esc(r.name) : c.k === 'rev' ? mil(r.rev) : c.k === 'vf' ? num(r.vf, 2) : c.k === 'n' ? num(r.n, 0) : num(r[c.k], 0));

export function areaTablesHTML(analysis, winId, real, sorts) {
  const pesos = real ? "today's pesos" : 'nominal';
  return ['state', 'region'].map((level) => {
    const s = sorts[level], rows = sortRows(areaRows(analysis, winId, level, real), s.key, s.dir);
    const head = COLUMNS.map((c) => `<th class="${c.text ? '' : 'n'}" aria-sort="${s.key === c.k ? (s.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="sort" data-level="${level}" data-key="${c.k}">${esc(c.h)}${c.unit ? ` <span class="u">${esc(c.unit)}${c.k === 'rev' || c.k === 'base' || c.k === 'cap' ? `, ${pesos}` : ''}</span>` : ''}</button></th>`).join('');
    const body = rows.map((r) => `<tr class="pick-row" tabindex="0" data-level="${level}" data-id="${esc(r.id)}"><td>${esc(r.name)}</td>${COLUMNS.slice(1).map((c) => `<td class="n">${fmt(c, r)}</td>`).join('')}</tr>`).join('');
    return `<section class="xp-card"><h2 class="mono">${level === 'state' ? 'All states' : 'All regions'}, ${esc(WIN[winId].label)} · ${esc(pesos)}</h2>
      <p class="xp-text">Published area figures. Click a row to analyse that ${level}. Click a heading to sort.</p><div class="tbl cmp tall"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
  }).join('');
}

/** wire sorting and row picks inside root. onPick({kind,id}); onSort(level,key,dir). */
export function wireAreaTables(root, sorts, onSort, onPick) {
  root.querySelectorAll('button.sort').forEach((b) => b.addEventListener('click', () => {
    const level = b.dataset.level, key = b.dataset.key, s = sorts[level];
    sorts[level] = { key, dir: s.key === key ? -s.dir : (key === 'name' ? 1 : -1) };
    onSort();
  }));
  root.querySelectorAll('tr.pick-row').forEach((tr) => {
    const go = () => onPick({ kind: tr.dataset.level, id: tr.dataset.id });
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
