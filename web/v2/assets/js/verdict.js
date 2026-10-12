// "Verdict" pill of the economics cards. Neutral styling on purpose: the wording and an icon carry the meaning, never a colour.
// Appears only for a complete user set, and says so ("under your assumptions"). Wording follows v1.
import { verdict } from '../../../assets/js/finmodel.js';
import { num } from '../../../assets/js/format.js';

const ICON = {
  wait: '<path d="M7 4h10M7 20h10M8 4c0 5 8 5 8 8s-8 3-8 8" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  near: '<path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2"/>',
  below: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2"/>',
};
const pill = (icon, text) => `<span class="pill" role="status"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">${ICON[icon]}</svg>${text}</span>`;

export function verdictPillHTML(st, set, lcoe, pcap) {
  if (st.level !== 'complete') return pill('wait', st.level === 'deck' ? 'No verdict: deck scenario shows coverage of the printed LCOE only' : 'No verdict: assumption set incomplete');
  const v = verdict(lcoe, pcap, set.band_pct);
  if (v === 'ok') return pill('ok', 'Covers its cost, under your assumptions');
  if (v === 'warn') return pill('near', `Within ${num(set.band_pct, 0)} % of its cost, under your assumptions`);
  if (v === 'bad') return pill('below', 'Below its cost, under your assumptions');
  return pill('wait', 'No verdict');
}
