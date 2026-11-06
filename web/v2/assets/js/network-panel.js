// Network Atlas: markup of the floating panels (atlas-sen layout). Pure string builders, no DOM access.
import { KV_BANDS, METRICS, LINE_LEGEND } from './network-core.js';
import { PERMIT_GROUPS, TECHS, EXPIRY, SIZES } from './network-plants.js';

const chip = (attr, id, label, on) => `<button type="button" class="nw-chip" data-${attr}="${id}" aria-pressed="${on}">${label}</button>`;
const seg = (id, attr, items, cur) => `<div class="nw-seg" id="${id}">${items.map(([v, l]) => chip(attr, v, l, v === cur)).join('')}</div>`;
const opts = (items) => items.map((v) => `<option value="${v}">${v === 'all' ? 'All' : v}</option>`).join('');
const sw = (id, label, on, color, extra = '') => `<label class="nw-row"><i class="nw-dot" style="background:${color}"></i><span>${label}</span><input type="checkbox" id="${id}"${on ? ' checked' : ''}>${extra}</label>`;

export function titleCard() {
  return `<div class="nw-title"><p class="mono">NETWORK ATLAS · REPSA</p><h1>National Electric System</h1><p class="nw-sub" id="nw-sub"></p></div>`;
}

export function legendCard() {
  return `<div class="nw-legend"><h2 class="mono">LINES (KV)</h2>
    ${LINE_LEGEND.map(([t, c]) => `<div class="nw-lg"><i style="background:${c}"></i>${t}</div>`).join('')}
    <h2 class="mono">SUBSTATIONS</h2>
    <div class="nw-lg"><i class="nw-ring"></i>Transmission · 400/230 kV (approx.)</div><div class="nw-lg"><i class="nw-dot" style="background:#E8A266"></i>Sub-transmission · 69-161 kV</div><div class="nw-lg"><i class="nw-dot sm" style="background:#F4E6C4"></i>Distribution · 34.5 kV or less</div>
    <div id="nw-lgx"></div><p class="hint">Location of substations is approximate. Medium-voltage networks are not drawn: they do not exist in OpenStreetMap.</p></div>`;
}

export function panel(S, regions, ptypes, nodeBlock) {
  return `<aside class="nw-panel" aria-label="Layers and filters">
    <label class="nw-row"><span>International interconnections</span><input type="checkbox" id="nw-ties"></label>
    <div class="nw-hd"><h2 class="mono">GENERATION · FILTERS</h2><span class="mono"><button type="button" id="nw-all">All</button> · <button type="button" id="nw-none">None</button></span></div>
    <div id="nw-techs">${TECHS.map((t) => `<label class="nw-row"><i class="nw-dot" style="background:${t[3]}"></i><span>${t[1]}</span><b class="mono" data-n="${t[0]}"></b><input type="checkbox" data-t="${t[0]}" checked></label>`).join('')}</div>
    <h3 class="mono">Market</h3>${seg('nw-mkt', 'k', [['all', 'All'], ['MEM', 'MEM'], ['Legado', 'Legacy']], 'all')}
    <h3 class="mono">Permit type</h3><select id="nw-pt" aria-label="Permit type"><option value="all">All</option>${ptypes.map((v) => `<option>${v}</option>`).join('')}</select>
    <h3 class="mono">Permit expiry (grant + 30 y)</h3>${seg('nw-exp', 'e', EXPIRY, 'all')}
    <h3 class="mono">Plant size</h3>${seg('nw-mw', 'w', SIZES, '0')}
    <h3 class="mono">Region</h3><select id="nw-reg" aria-label="Region">${opts(['all', ...regions])}</select>
    <h3 class="mono">Permit status</h3><div class="nw-seg" id="nw-pg">${PERMIT_GROUPS.map((g) => chip('g', g.id, g.label, true)).join('')}</div>
    <input id="nw-q" type="search" placeholder="Search plant, company, permit" aria-label="Search plants" autocomplete="off">
    <p class="hint mono" id="nw-pn"></p>
    <div class="nw-hd"><h2 class="mono">MAP LAYERS</h2></div>
    ${sw('nw-lines', 'Transmission lines', S.lines, '#7C8AA0')}
    <div class="nw-seg nw-ind" id="nw-bands">${KV_BANDS.map((b) => chip('b', b.id, b.label, true)).join('')}</div>
    ${sw('nw-subs', 'Substations (OpenStreetMap)', S.subs, '#E8A266')}
    ${sw('nw-arch', 'Archaeological sites', S.arch, '#D8B4FE')}
    ${sw('nw-indig', 'Indigenous localities (40%+ speakers)', S.indig, '#F0A6C8')}
    ${sw('nw-roads', 'Main roads (access)', S.roads, '#9AA39B')}
    ${nodeBlock}
  </aside>`;
}

export function nodeBlock(S, nodeOn) {
  return `${sw('nw-nodes', 'Nodes · battery score (hidden by default)', nodeOn, '#8DA892')}
    <div class="nw-nodes" id="nw-nbox" hidden>
      <div class="nw-seg" id="nw-metric">${Object.entries(METRICS).map(([k, m]) => chip('m', k, m.label, k === S.metric)).join('')}</div>
      <div class="nw-seg" id="nw-sis">${['SIN', 'BCA', 'BCS'].map((s) => chip('s', s, s, true)).join('')}</div>
      <div class="nw-two"><label class="mono">Load nodes<select id="nw-load"><option value="all">All</option><option value="D">Directly modelled</option><option value="I">Indirectly modelled</option></select></label>
      <label class="mono">Generation<select id="nw-gen"><option value="all">All</option><option value="any">Has generation</option><option value="D">Directly modelled</option><option value="I">Indirectly modelled</option></select></label></div>
      <input id="nw-nq" type="search" placeholder="Search node, municipality, state" aria-label="Search nodes" autocomplete="off">
      <div class="nw-ramp" id="nw-ramp" aria-hidden="true"></div><div class="mono nw-rl"><span id="nw-lo"></span><span id="nw-lt"></span><span id="nw-hi"></span></div>
      <div id="nw-card" aria-live="polite"><p class="hint">Click a node for its catalog entry and prices.</p></div>
      <h3 class="mono">Median by <select id="nw-group" aria-label="Group by"><option value="crc">Control region</option><option value="ent">State</option><option value="zot">Transmission zone</option><option value="zd">Distribution zone</option></select></h3><div class="nw-tbl" id="nw-stats"></div>
      <h3 class="mono" id="nw-toph"></h3><ol class="nw-top" id="nw-top"></ol>
    </div>`;
}
