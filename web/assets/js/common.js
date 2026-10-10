// Shared UI pieces: node picker (node | state | region | national), node labels, assumption bar, area records.
import { D, loadProfiles, loadNodos, nodeWin, areaStat, areaProfile, areaMonthly, loadSeriesAreas, loadSeriesNodes } from './data.js';
import { REGIONS, RN, ST, stName, regName, WIN } from './names.js';
import { esc, $ } from './util.js';
import { num } from './format.js';

export const nodeLab = (id) => {
  const n = D.byId.get(id);
  return n ? `${id} · ${n.nombre}${n.municipio ? ' · ' + n.municipio : ''}${n.entidad ? ', ' + n.entidad : ''}` : id;
};
export function parseNode(s) {
  s = (s || '').trim(); if (!s) return null;
  const k = s.split('·')[0].trim().toUpperCase();
  if (D.byId.has(k)) return k;
  const u = s.toUpperCase();
  for (const id of D.byId.keys()) if (nodeLab(id).toUpperCase().includes(u)) return id;
  return null;
}
let listBuilt = false;
export function buildNodeList() {
  if (listBuilt) return; listBuilt = true;
  const dl = $('#nodeList'), fr = document.createDocumentFragment();
  [...D.byId.keys()].sort().forEach((id) => { const o = document.createElement('option'); o.value = nodeLab(id); fr.appendChild(o); });
  dl.appendChild(fr);
}
export const statesWithData = () => {
  const a = D.analysis; const c = a && a.ventanas.deck_2025_26 && a.ventanas.deck_2025_26.por_config.tracker;
  return c ? Object.keys(c.estados).sort((x, y) => stName(x).localeCompare(stName(y))) : [];
};

/** Picker: levels subset of ['node','state','region','national']. get() -> {level,key}. */
export function Picker(root, { levels = ['node', 'state', 'region', 'national'], init, onChange, id }) {
  buildNodeList();
  let level = init.level, key = init.key;
  const memo = { node: '08NCM-115', state: 'YUCATAN', region: 'PENINSULAR', national: 'ALL' }; memo[level] = key;
  const names = { node: 'Node', state: 'State', region: 'Region', national: 'National' };
  const uid = id || 'pk' + Math.random().toString(36).slice(2, 7);
  root.classList.add('pick');
  root.innerHTML = `<div class="seg" role="group" aria-label="Level">${levels.map((l) => `<button type="button" data-v="${l}">${names[l]}</button>`).join('')}</div>
    <input type="text" list="nodeList" id="${uid}-n" aria-label="Node" placeholder="Type a node code, substation, municipality or state" autocomplete="off">
    <select id="${uid}-s" aria-label="State or region"></select>`;
  const segEl = root.querySelector('.seg'), inp = root.querySelector('input'), sel = root.querySelector('select');
  function fill() {
    segEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === level)));
    inp.hidden = level !== 'node'; sel.hidden = level === 'node' || level === 'national';
    if (level === 'node') inp.value = nodeLab(key);
    else if (level !== 'national') {
      const opts = level === 'state' ? statesWithData().map((e) => [e, stName(e)]) : REGIONS.map((c) => [c, RN[c]]);
      sel.innerHTML = opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
      sel.value = key;
    }
  }
  segEl.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.dataset.v === level) return;
    memo[level] = key; level = b.dataset.v; key = memo[level]; fill(); onChange(level, key);
  });
  const go = () => { const k = parseNode(inp.value); if (k && k !== key) { key = k; inp.value = nodeLab(k); onChange(level, key); } };
  inp.addEventListener('change', go);
  inp.addEventListener('input', () => { const k = inp.value.split('·')[0].trim(); if (D.byId.has(k) && inp.value === nodeLab(k)) go(); });
  sel.addEventListener('change', () => { key = sel.value; onChange(level, key); });
  if (levels.length === 1) segEl.hidden = true;
  fill();
  return { get: () => ({ level, key }), set(l, k) { level = l; key = k; memo[l] = k; fill(); } };
}

/** KPI + hourly record of a node / state / region / national for one deck window (nominal hourly profile). */
export async function areaRecord(level, key, winId, cfg = 'tracker') {
  const winKey = WIN[winId].key;
  if (level === 'node') {
    const [prof, nodos] = await Promise.all([loadProfiles(), loadNodos()]);
    const p = prof && prof.nodes[key] && prof.nodes[key][winId];
    const w = nodeWin(nodos, key, winKey);
    if (!p || !w) return { level, key, missing: true };
    const [pml, per, cg, y] = p;
    return { level, key, n: 1, base: w.pml_medio, cap: w.p_cap, baseReal: w.pml_medio_real, capReal: w.p_cap_real, vf: w.vf, vfDay: w.vf_dia_promedio,
      spread: w.spread_punta_solar, z: w.pct_e0, yf: w.y_f, cong: w.congestion_media, hours: { pml, perdidas: per, congestion: cg, y, energia: pml.map((v, i) => v - per[i] - cg[i]) }, region: w.region, entidad: w.entidad };
  }
  const s = areaStat(winKey, level === 'national' ? 'national' : level, key, cfg);
  const pr = areaProfile(winKey, level === 'national' ? 'national' : level, key, cfg);
  if (!s) return { level, key, missing: true };
  return { level, key, n: s.n_nodos, base: s.pml_medio, cap: s.p_cap, baseReal: s.pml_medio_real, capReal: s.p_cap_real, vf: s.vf, vfDay: s.vf_dia_promedio_media_nodos,
    vfMedian: s.vf_mediana_nodos, spread: s.spread_punta_solar, z: s.pct_e0, yf: s.y_f_mwh_por_mwp, cong: s.congestion_media,
    hours: pr ? { pml: pr.pml_h, perdidas: pr.perdidas_h, congestion: pr.congestion_h, energia: pr.energia_h, y: pr.y_h_mwh_por_mwp } : null };
}
export const areaName = (level, key) => level === 'node' ? `${key} · ${(D.byId.get(key) || {}).nombre || ''}` : level === 'state' ? `${stName(key)} (state)` : level === 'region' ? `${regName(key)} (region)` : 'National (SIN)';

/** Monthly VF series (81 months) for a place: node, state, region or national. */
export async function monthlySeries(level, key) {
  if (level === 'node') { const s = await loadSeriesNodes(); const n = s && s.nodes[key]; return n ? { months: s.months, vf: n.m, years: s.years, y: n.y, ycols: s.y_cols } : null; }
  const s = await loadSeriesAreas(); if (!s) return null;
  const a = level === 'national' ? s.areas.ALL : s.areas[level][key];
  return a ? { months: s.months, vf: a.m, years: s.years, y: a.y, ycols: s.y_cols, nn: a.mn } : null;
}
/** Active-assumptions label used by every profitability block. */
export function assumpLabel(ctx) {
  const st = ctx.status();
  const tag = { deck: 'Deck scenario', partial: 'Under your assumptions (incomplete)', complete: 'Under your assumptions', empty: 'Your assumptions (blank)' }[st.level];
  return tag;
}
export function assumpBarHTML(ctx) {
  const st = ctx.status(), real = ctx.S.get().real;
  const set = ctx.set();
  const parts = [];
  if (set.target_lcoe_usd != null) parts.push(`target LCOE ${num(set.target_lcoe_usd, 0)} USD/MWh`);
  if (set.fx != null) parts.push(`FX ${num(set.fx, 2)}`);
  if (set.capex_usd_kwp != null) parts.push(`capex ${num(set.capex_usd_kwp, 0)} USD/kWp`);
  if (set.rate_pct != null) parts.push(`${real ? 'real' : 'nominal'} rate ${num(set.rate_pct, 2)}%`);
  return `<span class="tag">${esc(assumpLabel(ctx))}</span><span>${esc(parts.join(' · ') || 'no values entered')}</span>
    <span class="muted">${real ? "Today's pesos" : 'Nominal pesos'}</span>
    <button type="button" class="btn btn-ghost" data-open-assump>Edit</button>${st.level === 'deck' ? '<span class="muted">Only the deck’s printed values; no verdict.</span>' : ''}`;
}
