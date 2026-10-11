// Explorer view: tiles, typical-day price profile (energy / losses / congestion), production, monthly VF and calendar years.
// First slot only for now; the data layer is slot-based so compare (M6) adds slots without touching it.
import { WIN } from '../../../assets/js/names.js';
import { num } from '../../../assets/js/format.js';
import { mesCorto } from '../../../assets/js/format.js';
import { WINDOWS, loadSources, recordFor, seriesFor, yearRows, tilesOf } from './explorer-data.js';
import { barChart, stackChart } from './svg-charts.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SAND = 'var(--s1)', MUTED = 'var(--c-energy)';

export function mountExplorer(host, { shell }) {
  let winId = 'Y2', view = 'months', ver = 0, dead = false;
  host.innerHTML = `
    <div class="xp-ctl">
      <div class="seg" role="radiogroup" aria-label="Window" id="xp-win" style="grid-template-columns:repeat(2,1fr)"></div>
      <p class="mono xp-scope">MDA reference price (CENACE) · nominal MXN · single-axis tracker · no capacity, CEL or contracts</p>
    </div>
    <div class="xp-state" id="xp-state" role="status"></div>
    <div id="xp-body" hidden>
      <div class="tiles" id="xp-tiles"></div>
      <div class="xp-cols">
        <section class="xp-card"><h2 class="mono">Typical day, price by hour</h2>
          <div class="legend mono"><span><i style="background:var(--c-energy)"></i>System energy</span><span><i style="background:var(--c-losses)"></i>Losses</span><span><i style="background:var(--c-cong)"></i>Congestion</span><span><i class="dash"></i><b id="xp-lb"></b></span><span><i class="dot"></i><b id="xp-lc"></b></span></div>
          <div class="chart" id="xp-day"></div>
          <h2 class="mono">Typical day, solar output by hour</h2>
          <div class="chart" id="xp-prod"></div>
        </section>
        <section class="xp-card"><div class="xp-vhead"><h2 class="mono">Value factor over time</h2>
          <div class="seg" role="radiogroup" aria-label="Time view" id="xp-view" style="grid-template-columns:repeat(2,1fr)"></div></div>
          <div class="legend mono" id="xp-vleg"></div>
          <div class="chart" id="xp-vf"></div>
          <p class="xp-text" id="xp-text"></p>
          <details><summary class="mono">Data table</summary><div class="tbl" id="xp-table"></div></details>
        </section>
      </div>
    </div>`;
  const q = (s) => host.querySelector(s);

  const segment = (el, items, current, onPick) => {
    el.innerHTML = '';
    items.forEach(([k, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.textContent = label; b.setAttribute('aria-checked', String(k === current)); b.tabIndex = k === current ? 0 : -1;
      b.addEventListener('click', () => onPick(k));
      b.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const i = items.findIndex((x) => x[0] === k), n = items[(i + d + items.length) % items.length][0];
        onPick(n);
        requestAnimationFrame(() => el.querySelector('[aria-checked="true"]').focus());
      });
      el.append(b);
    });
  };
  const drawSegs = () => {
    segment(q('#xp-win'), WINDOWS.map((w) => [w, WIN[w].label + (w === 'Y2' ? ' (last 12 months)' : '')]), winId, (w) => { winId = w; drawSegs(); load(); });
    segment(q('#xp-view'), [['months', 'Months'], ['years', 'Calendar years']], view, (v) => { view = v; drawSegs(); if (last) paint(last); });
  };

  let last = null;
  const setState = (kind, html) => { const s = q('#xp-state'); s.hidden = !html; s.className = `xp-state ${kind}`; s.innerHTML = html; q('#xp-body').hidden = kind !== 'ok'; s.setAttribute('aria-busy', String(kind === 'loading')); };

  async function load() {
    const my = ++ver, slot = shell.store.get()[0];
    if (!slot) return;
    setState('loading', 'Loading data…');
    try {
      const src = await loadSources(slot);
      if (my !== ver || dead) return;
      const rec = recordFor(src, slot, winId), series = seriesFor(src, slot);
      if (rec.missing) {
        setState('err', `No data for this selection in ${esc(WIN[winId].label)}. ${slot.kind === 'node' ? 'The node is outside the analysis universe for that window.' : ''}`);
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

  function paint({ slot, rec, series }) {
    q('#xp-tiles').innerHTML = tilesOf(rec).map((t) => `<div class="tile"><span class="mono">${esc(t.label)}</span><strong>${t.text}</strong><span class="mono u">${esc(t.unit)}</span></div>`).join('');
    const h = rec.hours;
    q('#xp-lb').textContent = `Average ${num(rec.base, 0)}`; q('#xp-lc').textContent = `Captured ${num(rec.cap, 0)}`;
    q('#xp-day').innerHTML = h ? stackChart({ ...h, base: rec.base, cap: rec.cap, aria: 'Typical day: price by hour split into energy, losses and congestion, with average and captured price' }) : '<p class="xp-text">No hourly profile for this selection.</p>';
    q('#xp-prod').innerHTML = h ? barChart({ bars: h.y.map((v, i) => ({ v, label: String(i).padStart(2, '0'), color: 'var(--c-prod)', tip: `${String(i).padStart(2, '0')}:00 output: ${num(v, 3)} MWh/MWp` })),
      xEvery: 3, H: 150, fmt: (v) => num(v, 1), aria: 'Typical day: solar output by hour', ytitle: 'MWh per MWp' }) : '';
    const w = WIN[winId];
    if (!series) { q('#xp-vf').innerHTML = '<p class="xp-text">No monthly series for this selection.</p>'; q('#xp-table').innerHTML = ''; return; }
    let bars, rows, leg;
    if (view === 'months') {
      bars = series.months.map((m, i) => {
        const inWin = m >= w.desde && m <= w.hasta, v = series.vf[i];
        return { v, label: mesCorto(m), color: inWin ? SAND : MUTED, tip: `${mesCorto(m)}: ${v === null ? 'no data' : num(v, 2)}${inWin ? ' (in window)' : ''}` };
      });
      rows = series.months.map((m, i) => [mesCorto(m), series.vf[i]]);
      leg = `<span><i style="background:${SAND}"></i>${esc(w.label)}</span><span><i style="background:${MUTED}"></i>Other months</span><span><i class="dash"></i>VF of the window: ${num(rec.vf, 2)}</span>`;
    } else {
      const ys = yearRows(series);
      bars = ys.map((y) => ({ v: y.vf, label: y.label, color: SAND, tip: `${y.label}: VF ${num(y.vf, 2)}` }));
      rows = ys.map((y) => [y.label, y.vf]);
      leg = `<span><i style="background:${SAND}"></i>Complete calendar years</span><span><i class="dash"></i>VF of the window: ${num(rec.vf, 2)}</span>`;
    }
    q('#xp-vleg').innerHTML = leg;
    q('#xp-vf').innerHTML = barChart({ bars, hline: { v: rec.vf, label: `Window ${num(rec.vf, 2)}` }, yMax: 1, H: 240, xEvery: view === 'months' ? 12 : 1, aria: view === 'months' ? 'Value factor by month' : 'Value factor by calendar year', ytitle: 'Value factor' });
    q('#xp-table').innerHTML = `<table><thead><tr><th>${view === 'months' ? 'Month' : 'Year'}</th><th class="n">Value factor</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="n">${r[1] === null ? '—' : num(r[1], 2)}</td></tr>`).join('')}</tbody></table>`;
    const l = shell.label(slot);
    const gap = rec.vf - rec.vfDay;
    q('#xp-text').innerHTML = `<b>${esc(l.t)}</b> · ${rec.level === 'node' ? `${esc(rec.region || '')} region` : `average of ${num(rec.n, 0)} nodes${rec.vfMedian ? `; median node VF ${num(rec.vfMedian, 2)}` : ''}`}. `
      + `VF ${num(rec.vf, 2)} over ${esc(w.label)}: solar hours sell at ${num((1 - rec.vf) * 100, 0)}% below the all-hours average price.${Math.abs(gap) < 0.015 ? '' : ' Seasons matter: the typical-day VF is ' + num(rec.vfDay, 2) + '.'}`;
  }

  drawSegs();
  load();
  return { destroy() { dead = true; } };
}
