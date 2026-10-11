// Revenue view: hour-by-hour production x price for the typical day and what it adds up to per MWp per year.
// Same data layer and same record as Explorer, so price, production and VF can never differ between the two views.
import { WIN } from '../../../assets/js/names.js';
import { num } from '../../../assets/js/format.js';
import { loadSources, recordFor, revenueOf, tilesOf } from './explorer-data.js';
import { mountControls } from './controls.js';
import { barChart, pairChart, stackChart } from './svg-charts.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mil = (v) => num(v / 1e6, 2);

export function mountRevenue(host, { shell }) {
  let ver = 0, dead = false;
  const winOf = () => shell.winId || 'Y2';
  host.innerHTML = `
    <div class="xp-ctl" id="rv-ctl"></div>
    <div class="xp-state" id="rv-state" role="status"></div>
    <div id="rv-body" hidden>
      <div class="tiles" id="rv-tiles"></div>
      <div class="xp-cols">
        <section class="xp-card"><h2 class="mono">Typical day, production × price</h2>
          <div class="legend mono"><span><i style="background:var(--ink-3)"></i>Shortcut: every hour at the average price</span><span><i style="background:var(--s1)"></i>Hour by hour</span></div>
          <div class="chart" id="rv-hours"></div>
          <p class="xp-text" id="rv-text"></p>
          <details><summary class="mono">Data table</summary><div class="tbl" id="rv-table"></div></details>
        </section>
        <section class="xp-card"><h2 class="mono">Price by hour (nominal MXN)</h2>
          <div class="legend mono"><span><i style="background:var(--c-energy)"></i>System energy</span><span><i style="background:var(--c-losses)"></i>Losses</span><span><i style="background:var(--c-cong)"></i>Congestion</span><span><i class="dash"></i><b id="rv-lb"></b></span><span><i class="dot"></i><b id="rv-lc"></b></span></div>
          <div class="chart" id="rv-day"></div>
          <h2 class="mono">Solar output by hour</h2>
          <div class="chart" id="rv-prod"></div>
        </section>
      </div>
    </div>`;
  const q = (s) => host.querySelector(s);
  const ctl = mountControls(q('#rv-ctl'), shell, () => load());
  const setState = (kind, html) => { const s = q('#rv-state'); s.hidden = !html; s.className = `xp-state ${kind}`; s.innerHTML = html; q('#rv-body').hidden = kind !== 'ok'; s.setAttribute('aria-busy', String(kind === 'loading')); };

  async function load() {
    const my = ++ver, slot = shell.store.get()[0];
    if (!slot) return;
    setState('loading', 'Loading data…');
    try {
      const src = await loadSources(slot);
      if (my !== ver || dead) return;
      const rec = recordFor(src, slot, winOf());
      if (rec.missing) { setState('err', `No data for this selection in ${esc(WIN[winOf()].label)}.`); return; }
      setState('ok', '');
      paint(slot, rec);
    } catch (e) {
      if (my !== ver || dead) return;
      console.error(e);
      setState('err', 'The data could not be loaded. <button type="button" class="btn btn-ghost btn-sm" id="rv-retry">Try again</button>');
      const r = q('#rv-retry'); if (r) r.addEventListener('click', load);
    }
  }

  function paint(slot, rec) {
    const real = shell.store.real, rv = revenueOf(rec, real), t = Object.fromEntries(tilesOf(rec, real).map((x) => [x.id, x]));
    const unit = rv.real ? "MXN/MWh, today's pesos" : 'MXN/MWh';
    const cards = [
      ['Revenue per MWp per year', mil(rv.total), `M MXN${rv.real ? ", today's pesos" : ''}`],
      ['Shortcut revenue', mil(rv.shortcut), 'M MXN, every hour at the average price'],
      ['Shortcut overstates by', rv.over === null ? '—' : num(rv.over, 0), '%'],
      ['Average price', t.base.text, unit], ['Captured price', t.cap.text, unit], ['Value factor', t.vf.text, 'captured ÷ average'],
    ];
    q('#rv-tiles').innerHTML = cards.map(([l, v, u]) => `<div class="tile"><span class="mono">${esc(l)}</span><strong>${v}</strong><span class="mono u">${esc(u)}</span></div>`).join('');
    const h = rec.hours, hr = rv.hours;
    const hh = (i) => String(i).padStart(2, '0');
    if (h && hr) {
      q('#rv-hours').innerHTML = pairChart({ a: hr.shortcut, b: hr.real, ca: 'var(--ink-3)', cb: 'var(--s1)', aria: 'Typical day: revenue of 1 MWp by hour, shortcut versus hour by hour', ytitle: 'MXN per MWp, per day', unit: 'MXN per MWp' });
      q('#rv-day').innerHTML = stackChart({ ...h, base: rec.base, cap: rec.cap, aria: 'Typical day: price by hour split into energy, losses and congestion' });
      q('#rv-lb').textContent = `Average ${num(rec.base, 0)}`; q('#rv-lc').textContent = `Captured ${num(rec.cap, 0)}`;
      q('#rv-prod').innerHTML = barChart({ bars: h.y.map((v, i) => ({ v, label: hh(i), color: 'var(--c-prod)', tip: `${hh(i)}:00 output: ${num(v, 3)} MWh/MWp` })), xEvery: 3, H: 150, fmt: (v) => num(v, 1), aria: 'Typical day: solar output by hour', ytitle: 'MWh per MWp' });
      q('#rv-table').innerHTML = `<table><thead><tr><th>Hour</th><th class="n">Output, MWh/MWp</th><th class="n">Price, MXN/MWh</th><th class="n">Shortcut, MXN</th><th class="n">Hour by hour, MXN</th></tr></thead><tbody>${h.y.map((y, i) => `<tr><td>${hh(i)}:00</td><td class="n">${num(y, 3)}</td><td class="n">${num(h.pml[i], 0)}</td><td class="n">${num(hr.shortcut[i], 0)}</td><td class="n">${num(hr.real[i], 0)}</td></tr>`).join('')}</tbody></table>`;
    } else {
      ['#rv-hours', '#rv-day', '#rv-prod', '#rv-table'].forEach((s) => { q(s).innerHTML = ''; });
    }
    const l = shell.label(slot);
    q('#rv-text').innerHTML = `<b>${esc(l.t)}</b>, ${esc(WIN[winOf()].label)}. At the captured price of ${num(rv.cap, 0)} ${unit}, 1 MWp makes ${mil(rv.total)} M MXN a year`
      + `${rv.yf ? ` from ${num(rv.yf, 0)} kWh/kWp` : ''}. Counting every hour at the average price would book ${mil(rv.shortcut)} M MXN, ${rv.over === null ? '' : `${num(rv.over, 0)}% more`}. `
      + `The bars follow the typical day and are scaled so the day adds up to the yearly figure.`;
  }

  load();
  return { destroy() { dead = true; ctl.destroy(); } };
}
