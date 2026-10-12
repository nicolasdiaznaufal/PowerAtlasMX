// Selection chips (series colour + number + line-style swatch + remove). Shared by map, choose and analysis views.
import { swatchSVG } from './series-style.js';
import { announce } from './live.js';
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** index of the chip to focus after removing chip i (list now has newLen chips); -1 when none are left. */
export const nextFocusIndex = (i, newLen) => (newLen <= 0 ? -1 : Math.min(i, newLen - 1));
export const removedMessage = (name, n, max = 16) => `Removed ${name}; ${n} of ${max} slots`;

export function mountChips(ul, shell, { removable = true, focusable = false } = {}) {
  const render = (list) => {
    ul.innerHTML = '';
    ul.classList.toggle('dense', list.length > 6);
    if (shell.focusIdx >= list.length) shell.focusIdx = 0;
    list.forEach((s, i) => {
      const l = shell.label(s);
      const li = document.createElement('li');
      const tip = `${l.k}${l.d ? ` · ${l.d}` : ''}`;
      li.innerHTML = `<span class="dot" style="background:${SERIES[i % 3]}" aria-hidden="true">${i + 1}</span>${focusable && list.length > 1
        ? `<button type="button" class="ct" title="${esc(tip)}" aria-pressed="${i === (shell.focusIdx || 0)}">${esc(l.t)}</button>`
        : `<span class="ct" title="${esc(tip)}">${esc(l.t)}</span>`}${list.length > 6 ? '' : swatchSVG(i)}`
        + (removable ? `<button type="button" aria-label="Remove ${esc(l.t)}">×</button>` : '');
      const pick = li.querySelector('button.ct');
      if (pick) pick.addEventListener('click', () => { shell.focusIdx = i; shell.store.set(shell.store.get().slice()); });
      if (removable) li.querySelector('button[aria-label]').addEventListener('click', () => {
        shell.store.remove(s); // re-renders synchronously
        const n = shell.store.get().length, j = nextFocusIndex(i, n);
        announce(removedMessage(l.t, n), { priority: true });
        const target = j >= 0 ? ul.querySelectorAll('button[aria-label]')[j] : document.getElementById('add-btn') || document.querySelector('h1');
        if (target) { if (!target.hasAttribute('tabindex') && target.tagName === 'H1') target.tabIndex = -1; target.focus({ preventScroll: true }); }
      });
      ul.append(li);
    });
  };
  render(shell.store.get());
  const off = shell.store.subscribe(render);
  return { refresh: () => render(shell.store.get()), destroy: off };
}
