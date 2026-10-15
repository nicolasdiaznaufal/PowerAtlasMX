// Searchable combobox (ARIA 1.2 pattern): National / Region / State / Node. Keyboard: arrows, Enter, Esc, Home/End.
const LIMIT = 40;
const KIND_LABEL = { national: 'National', region: 'Region', state: 'State', node: 'Node' };

/** entries: [{kind,id,label,sub,hay}] */
export function buildEntries(geo, nodes) {
  const e = [{ kind: 'national', id: 'ALL', label: 'National', sub: 'All nodes', hay: 'national all mexico' }];
  for (const f of geo.regions.features) e.push({ kind: 'region', id: f.properties.key, label: title(f.properties.key), sub: 'Region', hay: f.properties.key.toLowerCase() });
  for (const f of geo.states.features) e.push({ kind: 'state', id: f.properties.key, label: f.properties.name, sub: `State · ${f.properties.ab}`, hay: `${f.properties.name} ${f.properties.key} ${f.properties.ab}`.toLowerCase() });
  for (const n of nodes) e.push({ kind: 'node', id: n.id, label: n.name, sub: `${n.id} · ${n.muni || ''}`, hay: `${n.id} ${n.name} ${n.muni || ''}`.toLowerCase(), noData: !n.has });
  return e;
}
const title = (s) => s.charAt(0) + s.slice(1).toLowerCase();

export function filterEntries(entries, q, limit = LIMIT) {
  q = q.trim().toLowerCase();
  if (!q) return entries.filter((x) => x.kind !== 'node').slice(0, limit);
  const starts = [], has = [];
  for (const x of entries) {
    const i = x.hay.indexOf(q);
    if (i === 0 || x.hay.includes(` ${q}`)) starts.push(x); else if (i > 0) has.push(x);
    if (starts.length >= limit) break;
  }
  return [...starts, ...has].slice(0, limit);
}

export function createSelector({ entries, onPick, id = 'sel' }) {
  const root = document.createElement('div');
  root.className = 'selector';
  root.innerHTML = `<label class="mono" for="${id}-in">Find a place</label>
    <input id="${id}-in" role="combobox" aria-expanded="false" aria-controls="${id}-lb" aria-autocomplete="list" aria-haspopup="listbox" autocomplete="off" spellcheck="false" placeholder="National, region, state, node id or name">
    <ul id="${id}-lb" role="listbox" aria-label="Places" hidden></ul>`;
  const input = root.querySelector('input'), lb = root.querySelector('ul');
  let items = [], active = -1;
  const setOpen = (o) => { lb.hidden = !o; input.setAttribute('aria-expanded', String(o)); if (!o) { active = -1; input.removeAttribute('aria-activedescendant'); } };
  const mark = () => {
    [...lb.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) { input.setAttribute('aria-activedescendant', lb.children[active].id); lb.children[active].scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const render = () => {
    items = filterEntries(entries, input.value);
    lb.innerHTML = items.length ? '' : '<li class="empty" role="presentation">No match</li>';
    items.forEach((x, i) => {
      const li = document.createElement('li');
      li.id = `${id}-o${i}`; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
      li.innerHTML = `<span class="k mono">${KIND_LABEL[x.kind]}</span><span class="t"></span><span class="s"></span>`;
      li.querySelector('.t').textContent = x.label; li.querySelector('.s').textContent = x.noData ? `${x.sub} · no data` : x.sub;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(x); });
      lb.append(li);
    });
    active = -1; setOpen(true);
  };
  const pick = (x) => { onPick(x); input.value = ''; setOpen(false); };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setOpen(false));
  input.addEventListener('keydown', (e) => {
    const n = items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (lb.hidden) render(); active = n ? (active + 1) % n : -1; mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = n ? (active <= 0 ? n - 1 : active - 1) : -1; mark(); }
    else if (e.key === 'Home' && !lb.hidden) { e.preventDefault(); active = n ? 0 : -1; mark(); }
    else if (e.key === 'End' && !lb.hidden) { e.preventDefault(); active = n - 1; mark(); }
    else if (e.key === 'Enter') { if (!lb.hidden && items[active >= 0 ? active : 0]) { e.preventDefault(); pick(items[active >= 0 ? active : 0]); } }
    else if (e.key === 'Escape') { if (!lb.hidden) { e.preventDefault(); setOpen(false); } else input.value = ''; }
  });
  return { el: root, input };
}
