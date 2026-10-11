// Shared analysis controls: window (last 12 months / previous year) and price basis (nominal / today's pesos).
import { WIN } from '../../../assets/js/names.js';
import { mesLargo } from '../../../assets/js/format.js';
import { WINDOWS } from './explorer-data.js';

/** radiogroup of buttons; arrow keys move and select. */
export function segment(el, items, current, onPick) {
  el.innerHTML = '';
  items.forEach(([k, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.textContent = label; b.setAttribute('aria-checked', String(k === current)); b.tabIndex = k === current ? 0 : -1;
    b.addEventListener('click', () => onPick(k));
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const i = items.findIndex((x) => x[0] === k);
      onPick(items[(i + d + items.length) % items.length][0]);
      requestAnimationFrame(() => el.querySelector('[aria-checked="true"]').focus());
    });
    el.append(b);
  });
}

/** window + basis controls. shell.winId and shell.store.real are shared by Explorer and Revenue. */
export function mountControls(host, shell, onChange) {
  host.innerHTML = `<div class="seg" role="radiogroup" aria-label="Window" id="ct-win"></div>
    <div class="seg" role="radiogroup" aria-label="Price basis" id="ct-real"></div>
    <p class="mono xp-scope">MDA reference price (CENACE) · single-axis tracker · no capacity, CEL or contracts</p>`;
  const base = shell.atlas && shell.atlas.pesosBase ? mesLargo(shell.atlas.pesosBase) : null;
  const draw = () => {
    segment(host.querySelector('#ct-win'), WINDOWS.map((w) => [w, WIN[w].label + (w === 'Y2' ? ' (last 12 months)' : '')]), shell.winId || 'Y2', (w) => { shell.winId = w; draw(); onChange(); });
    segment(host.querySelector('#ct-real'), [['nom', 'Nominal MXN'], ['real', `Today's pesos${base ? ` (${base})` : ''}`]], shell.store.real ? 'real' : 'nom', (k) => { shell.store.setReal(k === 'real'); draw(); onChange(); });
  };
  draw();
  return { destroy() {} };
}
