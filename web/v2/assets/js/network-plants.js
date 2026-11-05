// Network Atlas: plants and CNE/CRE permit status layer (pure helpers + card). Technology colours are the atlas-sen palette.
const hex = (h, a = 220) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(a);
const TECH = [
  [/fotovolt|solar/i, '#F5B301'], [/e[oó]lic|cin[eé]tica/i, '#1D9E75'], [/hidr/i, '#378ADD'], [/geot/i, '#D85A30'], [/nucle/i, '#7F77DD'],
  [/ciclo combinado/i, '#A98B63'], [/carbo|lecho/i, '#3C332C'], [/turbog|turbina de gas/i, '#C9A227'], [/combusti|motogen/i, '#8A6240'],
  [/cogener/i, '#97C459'], [/termo|vapor|termoval/i, '#7C5C3E'],
];
export const techHex = (t) => (TECH.find(([re]) => re.test(t || '')) || [0, '#B9B6AE'])[1];
export const techColor = (t) => hex(techHex(t));

/** permit-status groups: id -> label. A plant belongs to exactly one (its `st`). */
export const PERMIT_GROUPS = [
  { id: 'ok', label: 'Operating or building', sts: ['operating', 'building'] },
  { id: 'permit', label: 'Project, permit granted', sts: ['permit', 'requested'] },
  { id: 'none', label: 'Project, no permit', sts: ['none'] },
  { id: 'bad', label: 'Revoked, ended, denied, cancelled', sts: ['revoked', 'ended', 'denied', 'cancelled', 'retired'] },
];
export const groupOf = (st) => (PERMIT_GROUPS.find((g) => g.sts.includes(st)) || PERMIT_GROUPS[2]).id;
export const STATUS_TXT = { operating: 'Operating', building: 'Under construction', permit: 'Project with CRE permit', requested: 'Permit requested', none: 'Project without CRE permit',
  revoked: 'Permit revoked', ended: 'Permit ended', denied: 'Permit denied', cancelled: 'Suspended or cancelled', retired: 'Retired' };

export const filterPlants = (plants, groups, q = '') => {
  const k = q.trim().toLowerCase();
  return plants.filter((p) => groups.has(groupOf(p.st)) && (!k || `${p.n} ${p.co} ${p.num || ''}`.toLowerCase().includes(k)));
};

/** ring colour by permit group: none = the layer draws the dot without ring for ok. */
export const ringOf = (p) => ({ ok: [0, 0, 0, 0], permit: [237, 230, 208, 200], none: [156, 153, 133, 220], bad: [214, 80, 70, 255] }[groupOf(p.st)]);
export const radiusOf = (p) => 700 + Math.sqrt(Math.max(p.mw || 5, 1)) * 330;

/** card: `esc` escapes text. Dates are ISO (yyyy-mm-dd) when the CNE list gives them. */
export function plantCard(p, esc) {
  const row = (k, v) => (v ? `<tr><th>${k}</th><td>${v}</td></tr>` : '');
  return `<h2 class="nw-nh">${esc(p.n)} <span class="mono">${esc(p.t || '')}</span></h2><table class="nw-kv">
    ${row('Status', STATUS_TXT[p.st])}${row('Capacity', p.mw == null ? '' : `${p.mw.toLocaleString('en-US')} MW`)}${row('Company', esc(p.co))}
    ${row('State', esc(p.ent))}${row('Commissioning', p.yr || '')}${row('Permit number', esc(p.num || ''))}${row('Modality', esc(p.mlab || p.mod || ''))}
    ${row('Holder', esc(p.holder || ''))}${row('Permit granted', p.grant || '')}${row('Permit expires', p.exp ? `${p.exp} (30-year term, derived)` : '')}</table>`;
}
