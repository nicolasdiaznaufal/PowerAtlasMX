// DOM and small helpers shared by every section. No framework.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function raf(fn) { let q = false; return (...a) => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(...a); }); }; }

const P = (d) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  ok: P('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>'),
  warn: P('<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18.2v.1"/>'),
  bad: P('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.1"/>'),
  clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  hourglass: P('<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>'),
  ext: P('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
};
const KIND_ICON = { ok: 'ok', warn: 'warn', bad: 'bad', neutral: 'hourglass', info: 'info' };
/** Traffic-light / status chip: icon + text, never colour alone. */
export const sig = (kind, text) => `<span class="sig sig-${kind}">${ICON[KIND_ICON[kind]]}<span>${esc(text)}</span></span>`;
/** External link opened safely. */
export const ext = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`;

/** Tiny pub/sub store. */
export function store(initial) {
  let s = { ...initial };
  const subs = new Set();
  return {
    get: () => s,
    set(patch) { s = { ...s, ...patch }; subs.forEach((f) => f(s, patch)); },
    on(f) { subs.add(f); return () => subs.delete(f); },
  };
}

/** Segmented control helper: wires [aria-pressed] buttons inside el; returns {get,set}. */
export function seg(el, cb) {
  const btns = () => [...el.querySelectorAll('button[data-v]')];
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.disabled || b.getAttribute('aria-pressed') === 'true') return;
    btns().forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    cb(b.dataset.v);
  });
  return {
    get: () => (btns().find((b) => b.getAttribute('aria-pressed') === 'true') || {}).dataset?.v,
    set(v) { btns().forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false')); },
  };
}
export const segHTML = (id, label, items, cur) =>
  `<div class="seg" id="${id}" role="group" aria-label="${esc(label)}">${items.map(([v, t, dis, title]) =>
    `<button type="button" data-v="${v}" aria-pressed="${v === cur}"${dis ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${t}</button>`).join('')}</div>`;
