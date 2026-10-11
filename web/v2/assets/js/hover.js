// One shared hover/focus readout for every SVG chart: vertical guide + small box with the values of the nearest x point.
// A chart builder calls setHover(spec) while it builds; renderChart() then calls attachHover on the rendered element.
// spec = { vbW, H, xs: [x in viewBox units], at(i) -> { title, items: [{ name, color, text }] } }
let pending = null;
export const setHover = (spec) => { pending = spec; };
export const takeHover = () => { const s = pending; pending = null; return s; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function boxHTML(d) {
  return `<b>${esc(d.title)}</b>${d.items.map((it) => `<span class="hv-row">${it.color ? `<i style="background:${it.color}"></i>` : ''}<em>${esc(it.name)}</em><strong>${esc(it.text)}</strong></span>`).join('')}`;
}

/** nearest index of x among the sorted positions xs. */
export function nearest(xs, x) {
  let best = 0, bd = Infinity;
  xs.forEach((v, i) => { const d = Math.abs(v - x); if (d < bd) { bd = d; best = i; } });
  return best;
}

export function attachHover(el, spec) {
  const svg = el && el.querySelector('svg');
  if (!svg || !el.classList || !spec || !spec.xs.length) return;
  el.classList.add('hv-host');
  const guide = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  guide.setAttribute('class', 'hv-guide'); guide.setAttribute('y1', 0); guide.setAttribute('y2', spec.H - 40); guide.setAttribute('visibility', 'hidden');
  svg.appendChild(guide);
  const box = document.createElement('div');
  box.className = 'hv-box mono'; box.setAttribute('aria-hidden', 'true'); box.hidden = true;
  el.appendChild(box);
  svg.setAttribute('tabindex', '0'); svg.classList.add('hv-svg');
  let cur = 0;
  const show = (i) => {
    cur = Math.max(0, Math.min(spec.xs.length - 1, i));
    const x = spec.xs[cur], pct = (x / spec.vbW) * 100;
    guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.setAttribute('visibility', 'visible');
    box.innerHTML = boxHTML(spec.at(cur)); box.hidden = false;
    box.style.left = `${pct}%`; box.classList.toggle('flip', pct > 55);
  };
  const hide = () => { guide.setAttribute('visibility', 'hidden'); box.hidden = true; };
  const fromEvent = (ev) => { const r = svg.getBoundingClientRect(); show(nearest(spec.xs, ((ev.clientX - r.left) / r.width) * spec.vbW)); };
  svg.addEventListener('pointermove', fromEvent);
  svg.addEventListener('pointerdown', fromEvent);
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('focus', () => show(cur));
  svg.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight') { show(cur + 1); ev.preventDefault(); } else if (ev.key === 'ArrowLeft') { show(cur - 1); ev.preventDefault(); }
    else if (ev.key === 'Home') { show(0); ev.preventDefault(); } else if (ev.key === 'End') { show(spec.xs.length - 1); ev.preventDefault(); } else if (ev.key === 'Escape') hide();
  });
}
