// Shared analysis controls: window (last 12 months / previous year) and price basis (nominal / today's pesos).
import { WIN } from '../../../assets/js/names.js';
import { mesLargo } from '../../../assets/js/format.js';
import { WINDOWS } from './explorer-data.js';
import { COPY } from './copy.js';
import { WEATHER_YEARS } from './query-extras.js';

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

/** window + basis controls. shell.winId and shell.store.real are shared by Explorer and Revenue. */
export function mountControls(host, shell, onChange) {
  host.innerHTML = `<div class="seg" role="radiogroup" aria-label="Window" id="ct-win"></div>
    <div class="seg" role="radiogroup" aria-label="Price basis" id="ct-real"></div>
    <div class="seg" role="radiogroup" aria-label="Mounting" id="ct-mount" title="${COPY.mountNote}"></div>
    <label class="wx" for="ct-wx"><span class="mono">Weather year</span>
      <select id="ct-wx">${['mean', ...WEATHER_YEARS.map((y) => `y${y}`), 'win'].map((v) => `<option value="${v}">${COPY.wxLabel(v)}</option>`).join('')}</select></label>
    <p class="hint" id="ct-wxnote"></p><p class="sr" id="ct-live" role="status" aria-live="polite"></p>
    <p class="mono xp-scope">MDA reference price (CENACE) · no capacity, CEL or contracts</p>`;
  const base = shell.atlas && shell.atlas.pesosBase ? mesLargo(shell.atlas.pesosBase) : null;
  const draw = () => {
    segment(host.querySelector('#ct-win'), WINDOWS.map((w) => [w, WIN[w].label + (w === 'Y2' ? ' (last 12 months)' : '')]), shell.winId || 'Y2', (w) => { shell.winId = w; draw(); onChange(); });
    segment(host.querySelector('#ct-real'), [['nom', 'Nominal MXN'], ['real', `Today's pesos${base ? ` (${base})` : ''}`]], shell.store.real ? 'real' : 'nom', (k) => { shell.store.setReal(k === 'real'); draw(); onChange(); });
  };
  const mount = () => segment(host.querySelector('#ct-mount'), [['tracker', 'Single-axis tracker'], ['fijo', 'Fixed tilt', false, COPY.fixedTip]], shell.store.cfg, (k) => {
    shell.store.setCfg(k); mount(); host.querySelector('#ct-live').textContent = `${k === 'fijo' ? 'Fixed tilt' : 'Single-axis tracker'} selected`;
  });
  const wx = host.querySelector('#ct-wx');
  wx.value = shell.store.wx;
  wx.addEventListener('change', () => { shell.store.setWx(wx.value); host.querySelector('#ct-live').textContent = `Weather: ${COPY.wxLabel(wx.value)}`; });
  mount();
  draw();
  return { destroy() {} };
}
