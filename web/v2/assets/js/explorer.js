// Explorer view: tiles, typical-day price profile (energy / losses / congestion), production, monthly VF and calendar years.
// First slot only for now; the data layer is slot-based so compare (M6) adds slots without touching it.
import { WIN } from '../../../assets/js/names.js';
import { num, mesCorto } from '../../../assets/js/format.js';
import { yearRows, tilesOf, priceBasis, partialNote } from './explorer-data.js';
import { loadEntries } from './compare-data.js';
import { paintExplorerCompare } from './explorer-compare.js';
import { serializeSel } from './store.js';
import { mountControls, segment } from './controls.js';
import { barChart, stackChart, vfAxis } from './svg-charts.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SAND = 'var(--s1)', MUTED = 'var(--c-energy)';

export function mountExplorer(host, { shell }) {
  let view = 'months', ver = 0, dead = false, selKey = serializeSel(shell.store.get());
  const winOf = () => shell.winId || 'Y2';
  host.innerHTML = `
    <div class="xp-ctl" id="xp-ctl"></div>
    <div class="xp-state" id="xp-state" role="status"></div>
    <div id="xp-cmp" hidden></div>
    <div id="xp-body" hidden>
      <p class="xp-warn" id="xp-warn" hidden></p>
      <div class="tiles" id="xp-tiles"></div>
      <div class="xp-cols">
        <section class="xp-card"><h2 class="mono">Typical day, price by hour (nominal MXN)</h2>
          <div class="legend mono"><span><i style="background:var(--c-energy)"></i>System energy</span><span><i style="background:var(--c-losses)"></i>Losses</span><span><i style="background:var(--c-cong)"></i>Congestion</span><span><i class="dash"></i><b id="xp-lb"></b></span><span><i class="dot"></i><b id="xp-lc"></b></span></div>
          <div class="chart" id="xp-day"></div>
          <h2 class="mono">Typical day, solar output by hour</h2>
          <div class="chart" id="xp-prod"></div>
        </section>
        <section class="xp-card"><div class="xp-vhead"><h2 class="mono">Value factor over time (months in nominal MXN)</h2>
          <div class="seg" role="radiogroup" aria-label="Time view" id="xp-view" style="grid-template-columns:repeat(2,1fr)"></div></div>
          <div class="legend mono" id="xp-vleg"></div>
          <div class="chart" id="xp-vf"></div>
          <p class="xp-text" id="xp-text"></p>
          <details><summary class="mono">Data table</summary><div class="tbl" id="xp-table"></div></details>
        </section>
      </div>
    </div>`;
  const q = (s) => host.querySelector(s);

  const ctl = mountControls(q('#xp-ctl'), shell, () => load());
  const drawView = () => segment(q('#xp-view'), [['months', 'Months'], ['years', 'Calendar years']], view, (v) => { view = v; drawView(); if (last) paint(last); });

  let last = null;
  const setState = (kind, html) => { const s = q('#xp-state'); s.hidden = !html; s.className = `xp-state ${kind}`; s.innerHTML = html; q('#xp-body').hidden = kind !== 'ok'; s.setAttribute('aria-busy', String(kind === 'loading')); };

  const setCmp = (on) => { q('#xp-cmp').hidden = !on; if (on) q('#xp-body').hidden = true; };
  let cmpEntries = null;
  async function load() {
    const my = ++ver, slots = shell.store.get();
    if (!slots.length) return;
    selKey = serializeSel(slots);
    setState('loading', 'Loading data…');
    setCmp(false);
    try {
      const entries = await loadEntries(slots, winOf());
      if (my !== ver || dead) return;
      if (slots.length > 1) {
        if (entries.every((e) => e.error)) throw entries[0].error;
        last = null; cmpEntries = entries;
        setState('ok', ''); q('#xp-body').hidden = true; setCmp(true);
        paintExplorerCompare(q('#xp-cmp'), { entries, shell, winId: winOf(), view, onView: (v) => { view = v; paintCmp(); } });
        return;
      }
      const { slot, rec, series, error } = entries[0];
      if (error) throw error;
      if (rec.missing) {
        setState('err', `No data for this selection in ${esc(WIN[winOf()].label)}. ${slot.kind === 'node' ? 'The node is outside the analysis universe for that window.' : ''}`);
        return;
      }
      last = { slot, rec, series };
      setState('ok', '');
      paint(last);
    } catch (e) {
      if (my !== ver || dead) return;
      console.error(e);
      setState('err', `The data could not be loaded. <button type="button" class="btn btn-ghost btn-sm" id="xp-retry">Try again</button>`);
      const r = q('#xp-retry'); if (r) r.addEventListener('click', load);
    }
  }
  const paintCmp = () => { if (cmpEntries) { paintExplorerCompare(q('#xp-cmp'), { entries: cmpEntries, shell, winId: winOf(), view, onView: (v) => { view = v; paintCmp(); } }); } };

  function paint({ slot, rec, series }) {
    const pb = priceBasis(rec, shell.store.real);
    const pn = partialNote(rec), wn = q('#xp-warn'); wn.hidden = !pn; wn.textContent = pn || '';
    q('#xp-tiles').innerHTML = tilesOf(rec, shell.store.real).map((t) => `<div class="tile"><span class="mono">${esc(t.label)}</span><strong>${t.text}</strong><span class="mono u">${esc(t.unit)}</span></div>`).join('');
    const h = rec.hours;
    q('#xp-lb').textContent = `Average ${num(rec.base, 0)}`; q('#xp-lc').textContent = `Captured ${num(rec.cap, 0)}`; // hourly profiles are nominal
    q('#xp-day').innerHTML = h ? stackChart({ ...h, base: rec.base, cap: rec.cap, aria: 'Typical day: price by hour split into energy, losses and congestion, with average and captured price' }) : '<p class="xp-text">No hourly profile for this selection.</p>';
    q('#xp-prod').innerHTML = h ? barChart({ bars: h.y.map((v, i) => ({ v, label: String(i).padStart(2, '0'), color: 'var(--c-prod)', tip: `${String(i).padStart(2, '0')}:00 output: ${num(v, 3)} MWh/MWp` })),
      xEvery: 3, H: 150, fmt: (v) => num(v, 1), aria: 'Typical day: solar output by hour', ytitle: 'MWh per MWp' }) : '';
    const w = WIN[winOf()];
    if (!series) { q('#xp-vf').innerHTML = '<p class="xp-text">No monthly series for this selection.</p>'; q('#xp-table').innerHTML = ''; return; }
    let bars, rows, leg;
    if (view === 'months') {
      bars = series.months.map((m, i) => {
        const inWin = m >= w.desde && m <= w.hasta, v = series.vf[i];
        return { v, label: mesCorto(m), color: inWin ? SAND : MUTED, tip: `${mesCorto(m)}: ${v === null ? 'no data' : num(v, 2)}${inWin ? ' (in window)' : ''}` };
      });
      rows = series.months.map((m, i) => [mesCorto(m), series.vf[i]]);
      leg = `<span><i style="background:${SAND}"></i>${esc(w.label)}</span><span><i style="background:${MUTED}"></i>Other months</span><span><i class="dash"></i>VF of the window: ${num(pb.vf, 2)}${pb.real ? " (today's pesos)" : ' (nominal)'}</span>`;
    } else {
      const ys = yearRows(series, shell.store.real);
      bars = ys.map((y) => ({ v: y.vf, label: y.label, color: SAND, tip: `${y.label}: VF ${num(y.vf, 2)}` }));
      rows = ys.map((y) => [y.label, y.vf]);
      leg = `<span><i style="background:${SAND}"></i>Complete calendar years</span><span><i class="dash"></i>VF of the window: ${num(pb.vf, 2)}</span>`;
    }
    q('#xp-vleg').innerHTML = leg;
    q('#xp-vf').innerHTML = barChart({ bars, hline: { v: pb.vf, label: `Window ${num(pb.vf, 2)}` }, refs: [1], scale: vfAxis(bars.map((b) => b.v).concat([pb.vf])), H: 240, xEvery: view === 'months' ? 12 : 1, aria: view === 'months' ? 'Value factor by month' : 'Value factor by calendar year', ytitle: 'Value factor' });
    q('#xp-table').innerHTML = `<table><thead><tr><th>${view === 'months' ? 'Month' : 'Year'}</th><th class="n">Value factor</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="n">${r[1] === null ? '—' : num(r[1], 2)}</td></tr>`).join('')}</tbody></table>`;
    const l = shell.label(slot);
    const gap = rec.vf - rec.vfDay;
    q('#xp-text').innerHTML = `<b>${esc(l.t)}</b> · ${rec.level === 'node' ? `${esc(rec.region || '')} region` : `average of ${num(rec.n, 0)} nodes${rec.vfMedian ? `; median node VF ${num(rec.vfMedian, 2)}` : ''}`}. `
      + `VF ${num(pb.vf, 2)} over ${esc(w.label)}: solar hours sell at ${num((1 - pb.vf) * 100, 0)}% below the all-hours average price.${Math.abs(gap) < 0.015 ? '' : ' Seasons matter: the typical-day VF is ' + num(rec.vfDay, 2) + '.'}`;
  }

  drawView();
  load();
  const off = shell.store.subscribe((l) => { if (serializeSel(l) !== selKey) load(); });
  return { destroy() { dead = true; off(); ctl.destroy(); } };
}
