// Network Atlas: plants and CNE/CRE permit status layer (pure helpers + card). Technology colours are the atlas-sen palette.
const hex = (h, a = 220) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(a);
const TECH = [   // id, label, test, atlas-sen colour (first match wins)
  ['pv', 'Photovoltaic', /fotovolt|solar/i, '#F5B301'], ['wind', 'Wind', /e[oó]lic|cin[eé]tica/i, '#1D9E75'], ['hydro', 'Hydroelectric', /hidr/i, '#378ADD'],
  ['geo', 'Geothermal', /geot/i, '#D85A30'], ['nuc', 'Nuclear', /nucle/i, '#7F77DD'], ['cc', 'Combined cycle', /ciclo combinado/i, '#A98B63'],
  ['coal', 'Coal', /carbo|lecho/i, '#3C332C'], ['tg', 'Gas turbine', /turbog|turbina de gas/i, '#C9A227'], ['ice', 'Internal combustion', /combusti|motogen/i, '#8A6240'],
  ['cog', 'Cogeneration', /cogener/i, '#97C459'], ['th', 'Thermal (steam)', /termo|vapor|termoval/i, '#7C5C3E'],
];
const OTHER = ['other', 'Other', null, '#B9B6AE'];
export const TECHS = [...TECH, OTHER];
export const techFam = (t) => (TECH.find((x) => x[2].test(t || '')) || OTHER)[0];
export const techHex = (t) => (TECH.find((x) => x[2].test(t || '')) || OTHER)[3];
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

/** expiry buckets (CNE grant + 30 years): plants without a date never match a bucket. */
export const EXPIRY = [['all', 'All'], ['lt2035', 'before 2035'], ['2035', '2035-2039'], ['2040', '2040+']];
const expOk = (e, b) => b === 'all' || (!!e && (b === 'lt2035' ? e < '2035' : b === '2035' ? e >= '2035' && e < '2040' : e >= '2040'));
export const SIZES = [['0', 'All'], ['50', '>50'], ['200', '>200'], ['500', '>500 MW']];
export const permitType = (p) => p.mlab || (p.mod && p.mod !== 'No definida' ? p.mod : '') || '';

/** f: { groups:Set, techs:Set, mkt:'all'|'MEM'|'Legado', ptype:'all'|string, exp:string, mw:number, reg:'all'|string, q:string } */
export const filterPlants = (plants, f, q = '') => {
  if (f instanceof Set) f = { groups: f };   // legacy call: (plants, groups, q)
  const k = (f.q ?? q).trim().toLowerCase();
  return plants.filter((p) => (!f.groups || f.groups.has(groupOf(p.st))) && (!f.techs || f.techs.has(techFam(p.t)))
    && (!f.mkt || f.mkt === 'all' || p.mkt === f.mkt) && (!f.ptype || f.ptype === 'all' || permitType(p) === f.ptype)
    && expOk(p.exp, f.exp || 'all') && (p.mw || 0) >= (f.mw || 0) && (!f.reg || f.reg === 'all' || p.reg === f.reg)
    && (!k || `${p.n} ${p.co} ${p.num || ''}`.toLowerCase().includes(k)));
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
