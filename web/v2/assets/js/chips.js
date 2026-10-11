// Selection chips (series colour + number + line-style swatch + remove). Shared by map, choose and analysis views.
import { swatchSVG } from './series-style.js';
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function mountChips(ul, shell, { removable = true } = {}) {
  const render = (list) => {
    ul.innerHTML = '';
    list.forEach((s, i) => {
      const l = shell.label(s);
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot" style="background:${SERIES[i]}" aria-hidden="true">${i + 1}</span><span class="ct"><span class="mono">${esc(l.k)}</span>${esc(l.t)}</span>${swatchSVG(i)}`
        + (removable ? `<button type="button" aria-label="Remove ${esc(l.t)}">×</button>` : '');
      if (removable) li.querySelector('button').addEventListener('click', () => shell.store.remove(s));
      ul.append(li);
    });
  };
  render(shell.store.get());
  const off = shell.store.subscribe(render);
  return { refresh: () => render(shell.store.get()), destroy: off };
}
