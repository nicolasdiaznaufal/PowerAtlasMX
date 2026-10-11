// "What if?" sliders: price shift, midday price dip, solar yield. Simulated badge, reset, live announcements.
import { NEUTRAL, SCENARIO_LIMITS, isNeutral } from './query-extras.js';
import { announce } from './live.js';

const DEFS = [
  { k: 'price', label: 'Price shift', unit: 'MXN/MWh', step: 10, show: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} MXN/MWh`, text: (v) => (v === 0 ? 'no shift' : `${v > 0 ? 'plus' : 'minus'} ${Math.abs(v)} pesos per megawatt hour`) },
  { k: 'dip', label: 'Midday price dip', unit: '', step: 5, show: (v) => (v === 100 ? '100 · as published' : v === 0 ? '0 · no dip' : v > 100 ? `${v} · ${v - 100}% deeper` : `${v} · ${100 - v}% shallower`),
    text: (v) => (v === 100 ? 'as published' : v === 0 ? 'no dip' : v > 100 ? `${v - 100} percent deeper than published` : `${100 - v} percent shallower than published`),
    help: '100 = as published; 0 = no dip; 150 = 50% deeper. This reshapes solar-hour prices only; the day\'s mean price is not held constant.' },
  { k: 'yield', label: 'Solar yield', unit: '%', step: 1, show: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`, text: (v) => (v === 0 ? 'as modelled' : `${v > 0 ? 'plus' : 'minus'} ${Math.abs(v)} percent`) },
];

/** mounts once; store.scenario is the source of truth (URL &sc=...). */
export function mountScenarioPanel(el, store) {
  el.innerHTML = `<fieldset class="scn"><legend class="mono">What if? (simulation)</legend>
    <p class="hint">Move a slider to simulate. Published values come back with Reset.</p>
    ${DEFS.map((d) => `<label class="scn-row" for="sc-${d.k}"><span>${d.label}</span><output id="o-${d.k}" class="mono"></output>
      <input type="range" id="sc-${d.k}" min="${SCENARIO_LIMITS[d.k][0]}" max="${SCENARIO_LIMITS[d.k][1]}" step="${d.step}"${d.help ? ` aria-describedby="sc-${d.k}-help"` : ''}>${d.help ? `<small class="scn-help" id="sc-${d.k}-help">${d.help}</small>` : ''}</label>`).join('')}
    <div class="scn-actions"><span class="badge" id="scn-badge" hidden>Simulated</span><button type="button" class="btn btn-ghost btn-sm" id="scn-reset">Reset to real values</button></div>
    <p class="sr" id="scn-live" role="status" aria-live="polite"></p></fieldset>`;
  const q = (s) => el.querySelector(s), live = q('#scn-live');
  const read = () => ({ price: +q('#sc-price').value, dip: +q('#sc-dip').value, yield: +q('#sc-yield').value });
  let wasNeutral = isNeutral(store.scenario);
  const paint = () => {
    const sc = store.scenario || NEUTRAL;
    for (const d of DEFS) {
      const inp = q(`#sc-${d.k}`);
      if (+inp.value !== sc[d.k]) inp.value = sc[d.k];
      q(`#o-${d.k}`).textContent = d.show(sc[d.k]);
      inp.setAttribute('aria-valuetext', d.text(sc[d.k]));
    }
    q('#scn-badge').hidden = isNeutral(store.scenario);
    q('#scn-reset').disabled = isNeutral(store.scenario);
  };
  for (const d of DEFS) q(`#sc-${d.k}`).addEventListener('input', () => {
    store.setScenario(read());
    const now = isNeutral(store.scenario);
    if (wasNeutral && !now) { live.textContent = ''; setTimeout(() => { live.textContent = 'Simulated values are on. Published values are shown as the change.'; }, 30); }
    wasNeutral = now;
    paint();
  });
  q('#scn-reset').addEventListener('click', () => {
    store.setScenario(null); wasNeutral = true; paint();
    announce('Real values restored', { priority: true });
    q('#sc-price').focus();
  });
  paint();
  const off = store.subscribe(paint); // URL navigation (Back) can change the scenario
  return { destroy: off };
}
