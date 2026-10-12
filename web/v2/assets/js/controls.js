// Shared analysis controls: window (last 12 months / previous year) and price basis (nominal / today's pesos).
import { WIN } from '../../../assets/js/names.js';
import { mesLargo } from '../../../assets/js/format.js';
import { COPY } from './copy.js';

/** radiogroup of buttons; arrow keys move and select. */
export function segment(el, items, current, onPick) {
  el.innerHTML = '';
  items.forEach(([k, label, disabled, title]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.textContent = label; b.setAttribute('aria-checked', String(k === current)); b.tabIndex = k === current ? 0 : -1;
    if (disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); if (title) b.title = title; }
    b.addEventListener('click', () => { if (!disabled) onPick(k); });
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const i = items.findIndex((x) => x[0] === k);
      let j = i;
      for (let n = 0; n < items.length; n++) { j = (j + d + items.length) % items.length; if (!items[j][2]) break; }
      onPick(items[j][0]);
      requestAnimationFrame(() => el.querySelector('[aria-checked="true"]').focus());
    });
    el.append(b);
  });
}

/** price basis and mounting. The time span is the one time control (range-slider.js, mounted by view-base); weather is fixed to the yearly mean. */
export function mountControls(host, shell, onChange) {
  host.innerHTML = `<div class="seg" role="radiogroup" aria-label="Price basis" id="ct-real"></div>
    <div class="seg" role="radiogroup" aria-label="Mounting" id="ct-mount" title="${COPY.mountNote}"></div>
    <p class="sr" id="ct-live" role="status" aria-live="polite"></p>`;
  const base = shell.atlas && shell.atlas.pesosBase ? mesLargo(shell.atlas.pesosBase) : null;
  const drawReal = () => segment(host.querySelector('#ct-real'), [['nom', 'Nominal MXN'], ['real', `Today's pesos${base ? ` (${base})` : ''}`]], shell.store.real ? 'real' : 'nom', (k) => {
    shell.store.setReal(k === 'real'); drawReal(); onChange();
  });
  const mount = () => segment(host.querySelector('#ct-mount'), [['tracker', 'Single-axis tracker'], ['fijo', 'Fixed tilt', false, COPY.fixedTip]], shell.store.cfg, (k) => {
    shell.store.setCfg(k); mount(); host.querySelector('#ct-live').textContent = `${k === 'fijo' ? 'Fixed tilt' : 'Single-axis tracker'} selected`;
  });
  mount(); drawReal();
  const off = shell.store.subscribe(() => {
    const chk = host.querySelector('#ct-mount [aria-checked="true"]');
    if (!chk || (shell.store.cfg === 'fijo') !== /Fixed/.test(chk.textContent)) mount();
  });
  return { destroy() { off(); } };
}
