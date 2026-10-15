// Dual-handle time-span slider (two native range inputs: keyboard operable, aria-valuetext) + presets.
import { mesLargo } from '../../../assets/js/format.js';
import { presetSpans } from './span-data.js';

export const spanText = (from, to) => `${mesLargo(from)} to ${mesLargo(to)}`;

/** months: ['2020-01', ...]; span: {from,to} | null (= preset l12); onChange(span|null). */
export function mountRangeSlider(el, { months, win, span, onChange }) {
  const n = months.length, presets = presetSpans(months, win);
  const cur = span || { from: win.desde, to: win.hasta };
  let a = Math.max(0, months.indexOf(cur.from)), b = Math.max(a, months.indexOf(cur.to) < 0 ? n - 1 : months.indexOf(cur.to));
  el.innerHTML = `<fieldset class="span" aria-label="Time span">
    <div class="presets" role="group" aria-label="Span presets">${presets.map((p) => `<button type="button" class="chip-btn" data-p="${p.id}" aria-pressed="false">${p.label}</button>`).join('')}</div>
    <div class="range"><div class="track"></div><div class="fill" id="sp-fill"></div>
      <input type="range" id="sp-a" min="0" max="${n - 1}" step="1" aria-label="Span start month">
      <input type="range" id="sp-b" min="0" max="${n - 1}" step="1" aria-label="Span end month"></div>
    <p class="span-text mono" id="sp-text" role="status" aria-live="polite"></p>
</fieldset>`;
  const A = el.querySelector('#sp-a'), B = el.querySelector('#sp-b'), fill = el.querySelector('#sp-fill'), text = el.querySelector('#sp-text');
  const isPreset = (p) => months[a] === p.from && months[b] === p.to;
  const paint = () => {
    A.value = a; B.value = b;
    A.setAttribute('aria-valuetext', mesLargo(months[a])); B.setAttribute('aria-valuetext', mesLargo(months[b]));
    fill.style.left = `${(a / (n - 1)) * 100}%`; fill.style.width = `${((b - a) / (n - 1)) * 100}%`;
    text.textContent = `${spanText(months[a], months[b])} (${b - a + 1} months)`;
    el.querySelectorAll('[data-p]').forEach((btn) => btn.setAttribute('aria-pressed', String(isPreset(presets.find((p) => p.id === btn.dataset.p)))));
  };
  const emit = () => {
    const isDefault = months[a] === win.desde && months[b] === win.hasta;
    onChange(isDefault ? null : { from: months[a], to: months[b] });
  };
  A.addEventListener('input', () => { a = +A.value; if (a > b) b = a; paint(); emit(); });
  B.addEventListener('input', () => { b = +B.value; if (b < a) a = b; paint(); emit(); });
  el.querySelectorAll('[data-p]').forEach((btn) => btn.addEventListener('click', () => {
    const p = presets.find((x) => x.id === btn.dataset.p);
    a = months.indexOf(p.from); b = months.indexOf(p.to); paint(); emit();
  }));
  paint();
}
