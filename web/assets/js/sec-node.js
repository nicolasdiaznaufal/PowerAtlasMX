// Node sheet (period selector, edge-month handling, additive recompute in the worker) and compare.
import { D, loadSheet, loadProfiles, loadSeriesNodes } from './data.js';
import { Engine } from './engine.js';
import { ctxFor } from './contract.js';
import { evaluate, verdict, DECK_FX } from './finmodel.js';
import { make, baseOptions, axisTitle, hourAxis, yWidth, col, H } from './charts.js';
import { $, esc, seg, segHTML, sig, ICON } from './util.js';
import { num, mesLargo, monthRange, addMonths, notaReloj, hhmm, millones, pct } from './format.js';
import { Picker, nodeLab, assumpBarHTML, assumpLabel } from './common.js';
import { renderMath } from './tex.js';
import { clockFoot } from './sec-story.js';

const f0 = (v) => num(v, 0), f2 = (v) => num(v, 2);
const pad = (h) => String(h).padStart(2, '0');

export async function initNode(ctx) {
  const root = $('#node-root');
  const engine = new Engine(D.index);
  const months = monthRange(D.index.periodo_datos.desde, D.index.periodo_datos.hasta);
  root.innerHTML = `<div class="row" style="gap:16px"><div id="nd-pick"></div>
      ${segHTML('nd-cfg', 'Mounting', [['tracker', 'Single-axis tracker'], ['fixed', 'Fixed tilt']], ctx.S.get().cfg)}</div>
    <div class="row"><label class="muted" for="nd-from">From</label><select id="nd-from">${months.map((m) => `<option value="${m}">${mesLargo(m)}</option>`).join('')}</select>
      <label class="muted" for="nd-to">to</label><select id="nd-to">${months.map((m) => `<option value="${m}">${mesLargo(m)}</option>`).join('')}</select>
      <div class="seg" id="nd-pre" role="group" aria-label="Period presets"><button type="button" data-v="all">All data</button><button type="button" data-v="l12">Last 12 months</button><button type="button" data-v="y25">2025</button><button type="button" data-v="ytd">2026 to date</button></div></div>
    <div id="nd-body"></div>`;
  const picker = Picker($('#nd-pick'), { levels: ['node'], init: { level: 'node', key: [...D.available][0] || '01AAN-85' }, id: 'nd', onChange: (l, k) => { id = k; load(); } });
  let id = [...D.available][0] || '01AAN-85', desde = months[0], hasta = months[months.length - 1], ver = 0, charts = {};
  $('#nd-from').value = desde; $('#nd-to').value = hasta;
  const lastComplete = () => { const b = new Set(D.index.periodo_datos.meses_borde.SIN || []); let m = months.length - 1; while (b.has(months[m])) m--; return months[m]; };
  seg($('#nd-cfg'), (v) => { ctx.setCfg(v); });
  seg($('#nd-pre'), (v) => {
    const end = lastComplete();
    if (v === 'all') { desde = months[0]; hasta = months[months.length - 1]; }
    if (v === 'l12') { hasta = end; desde = addMonths(end, -11); }
    if (v === 'y25') { desde = '2025-01'; hasta = '2025-12'; }
    if (v === 'ytd') { desde = '2026-01'; hasta = end; }
    $('#nd-from').value = desde; $('#nd-to').value = hasta; compute();
  });
  $('#nd-from').addEventListener('change', (e) => { desde = e.target.value; if (desde > hasta) { hasta = desde; $('#nd-to').value = hasta; } compute(); });
  $('#nd-to').addEventListener('change', (e) => { hasta = e.target.value; if (hasta < desde) { desde = hasta; $('#nd-from').value = desde; } compute(); });
  let sheet = null;
  async function load() {
    const my = ++ver;
    const body = $('#nd-body');
    if (!D.available.has(id)) {
      body.innerHTML = `<div class="callout info"><p><b>${esc(nodeLab(id))}</b> has no sheet in this package.</p><p>Sheets available here: ${[...D.available].map((k) => `<button type="button" class="btn btn-ghost" data-open-node="${esc(k)}">${esc(k)}</button>`).join(' ')}</p><p class="muted">Its explorer, map and compare figures are still available.</p></div>`;
      return;
    }
    body.innerHTML = '<p class="muted">Loading the node…</p>';
    try { sheet = await loadSheet(id); await engine.addNode(sheet.raw); } catch (e) { body.innerHTML = `<div class="callout bad">${esc(e.message)}</div>`; return; }
    if (my !== ver) return;
    compute();
  }
  async function compute() {
    if (!sheet) return;
    const my = ++ver, cfg = ctx.S.get().cfg, real = ctx.S.get().real;
    const res = await engine.compute(sheet.raw.id, cfg, desde, hasta, real);
    if (my !== ver) return;
    render(sheet.raw, res);
  }
  function render(raw, res) {
    const set = ctx.set(), st = ctx.status(), index = D.index;
    const unit = res.real ? `today's pesos (${mesLargo(index.pesos_reales.base_mes)})` : 'nominal pesos';
    const warn = [];
    if (res.mesesConDatos < 12) warn.push(`<div class="callout" role="alert">${sig('warn', `Low confidence: only ${res.mesesConDatos} months of data in the selected period (minimum 12).`)}</div>`);
    if (raw.renombrado_a) warn.push(`<div class="callout info"><b>Retired code.</b> Renamed <b>${esc(raw.renombrado_a)}</b>; its history sits in two series.</div>`);
    if (raw.renombre_de) warn.push(`<div class="callout info"><b>Renamed node.</b> It used to be <b>${esc(raw.renombre_de)}</b>; this file only has the series after the change.</div>`);
    const edge = res.mensual.filter((m) => m.borde && m.n > 0).map((m) => m.mes);
    if (edge.length) warn.push(`<div class="callout">${sig('warn', `Edge month in the period: ${edge.map(mesLargo).join(', ')}`)} On the CDMX clock it has very few hours, so it never counts as a complete month.</div>`);
    if (res.realSolicitado && !res.real) warn.push(`<div class="callout" role="alert">${sig('warn', "Today's pesos unavailable: nominal prices are shown.")} ${esc(res.avisoReal || '')}</div>`);
    const clk = notaReloj(index, raw.sistema, 'en', raw);
    if (clk && clk.prominente) warn.push(`<div class="callout clock" role="note"><b>This node's hours are on the CDMX clock, not on its local time.</b><p>${esc(clk.texto)}</p><p>${esc(clk.explicacion || '')}</p><p>Its solar noon falls at <b>${hhmm(raw.mediodia_solar_cdmx)} CDMX</b>; the sun is tracked correctly even though the clock is shifted.</p></div>`);
    // finance with the active set
    const ia = res.ingresoAnual.mediana;
    const place = ia ? { pcap: ia.I / ia.P, pml: ia.B, vf: ia.VF, yf: ia.P } : { pcap: res.C, pml: res.B, vf: res.VF, yf: null };
    const ev = evaluate({ ...set, mounting: cfg(ctx) }, place, !res.real);
    const finRows = [];
    const ok = st.level === 'complete' && ia;
    const v = ok ? verdict(ev.lcoe, place.pcap, set.band_pct) : null;
    finRows.push(['Verdict', v ? sig({ ok: 'ok', warn: 'warn', bad: 'bad' }[v], { ok: 'Covers its cost, under your assumptions', warn: 'Near its cost, under your assumptions', bad: 'Below its cost, under your assumptions' }[v]) : sig('neutral', st.level === 'complete' ? 'Needs a complete year in the period' : 'No verdict: assumptions incomplete or deck scenario')]);
    finRows.push(['LCOE (MXN/MWh)', ev.lcoe == null ? '—' : f0(ev.lcoe)]);
    finRows.push(['Margin vs LCOE (MXN/MWh)', ev.margin == null ? '—' : num(ev.margin, 0)]);
    finRows.push(['IRR', ev.irr == null ? '—' : `${num(ev.irr * 100, 1)} %`]);
    finRows.push(['NPV (M MXN per MWp)', ev.npvMwp == null ? '—' : num(ev.npvMwp / 1e6, 2)]);
    finRows.push(['Break-even PPA (= LCOE)', ev.lcoe == null ? '—' : f0(ev.lcoe)]);
    finRows.push(['Break-even PML base (= LCOE / VF)', ev.beBase == null ? '—' : f0(ev.beBase)]);
    const vfmin = res.vfMinMensual;
    const tiles = [['Captured price · MXN/MWh', f0(res.C)], ['Average price · MXN/MWh', f0(res.B)], ['Value factor', f2(res.VF)], ['PV energy at PML ≤ 0', pct(res.pctE0, 2)],
      ['Lowest monthly VF', vfmin ? `${f2(vfmin.VF)}<small>${mesLargo(vfmin.mes)}</small>` : '—'], ['Revenue · MXN/MWp-yr (median complete year)', ia ? millones(ia.I) : '—'], ['Months with data', `${res.mesesConDatos} / ${res.mesesEnRango}`]];
    const hrs = res.hora;
    $('#nd-body').innerHTML = `
      <div class="panel"><div class="row" style="justify-content:space-between"><div><h3>${esc(raw.nombre)}</h3><div class="muted">${esc(raw.id)} · ${esc(raw.municipio || '')}${raw.entidad ? ', ' + esc(raw.entidad) : ''} · ${esc(raw.sistema)} · ${esc(raw.region || '')} · load zone ${esc(raw.zona_carga || '—')}</div></div>
        <div class="row">${res.mesesConDatos < 12 || raw.calidad.confianza === 'baja' ? sig('warn', 'Low confidence') : sig('ok', 'High confidence')}<button type="button" class="btn btn-ghost" data-add-compare="${esc(raw.id)}">Add to compare</button></div></div>
        <p class="fine">Data ${esc(raw.calidad.primera_fecha || '—')} to ${esc(raw.calidad.ultima_fecha || '—')} · location: ${esc(raw.coord_precision || '—')} · ${res.cfg === 'tracker' ? 'single-axis tracker' : 'fixed tilt'} · ${esc(unit)} · period ${esc(res.desde)} to ${esc(res.hasta)}</p></div>
      ${warn.join('')}
      <div class="stats">${tiles.map(([l, v2]) => `<div class="stat"><span>${esc(l)}</span><strong>${v2}</strong></div>`).join('')}</div>
      <div class="grid g2">
        <div class="panel"><span class="lbl accent">Finance · ${esc(assumpLabel(ctx))}</span>
          <table><tbody>${finRows.map(([l, v2]) => `<tr><td>${esc(l)}</td><td class="n" style="font-family:var(--font-body)">${v2}</td></tr>`).join('')}</tbody></table>
          <p class="fine">${st.level === 'complete' ? 'Plant at this node’s median complete year. Not validated by REPSA.' : 'REPSA’s own assumptions are pending. Enter yours in Assumptions to see IRR, NPV and LCOE.'}</p></div>
        <div class="panel"><span class="lbl accent">Quality and basis</span>
          <table><tbody>
            <tr><td>Congestion basis</td><td class="n">${num(res.basisCongestion, 1)} MXN/MWh</td></tr>
            <tr><td>Losses basis</td><td class="n">${num(res.basisPerdidas, 1)} MXN/MWh</td></tr>
            <tr><td>Missing hours</td><td class="n">${pct(res.pctFaltantes, 1)}</td></tr>
            <tr><td>Weather</td><td class="n" style="font-family:var(--font-body)">${esc(raw.clima.fuente || '')}</td></tr></tbody></table>
          <p class="fine">Typical year ${esc((raw.clima.anios_baseline || []).join('–'))} by month and hour applied to each real hour of price.</p></div>
      </div>
      <div class="grid g2">
        <div class="stack"><h4>Typical day · ${esc(res.desde)} to ${esc(res.hasta)}</h4><div class="chart" style="height:280px"><canvas id="nd-c1" role="img" aria-label="Typical day: price by hour, average and captured price, with production"></canvas></div>${clockFoot(raw.sistema)}</div>
        <div class="stack"><h4>Revenue by hour, split by component</h4><div class="chart" style="height:280px"><canvas id="nd-c2" role="img" aria-label="Average revenue by hour split into energy, losses and congestion"></canvas></div>${clockFoot(raw.sistema)}</div>
        <div class="stack"><h4>VF by month</h4><div class="chart" style="height:250px"><canvas id="nd-c3" role="img" aria-label="Value factor by month"></canvas></div>${clockFoot(raw.sistema)}</div>
        <div class="stack"><h4>Price by month</h4><div class="chart" style="height:250px"><canvas id="nd-c4" role="img" aria-label="Base and captured price by month"></canvas></div>${clockFoot(raw.sistema)}</div>
      </div>
      <h4>By year</h4><div class="scroll-x"><table><thead><tr><th>Year</th><th class="n">Coverage</th><th class="n">MWh/MWp</th><th class="n">Base</th><th class="n">VF</th><th class="n">Revenue · MXN/MWp</th><th>Status</th></tr></thead><tbody>
        ${res.anual.map((a) => `<tr><td>${a.anio}</td><td class="n">${pct(a.cobertura_pct, 1)}</td><td class="n">${f0(a.P)}</td><td class="n">${f0(a.B)}</td><td class="n">${a.VF == null ? '—' : f2(a.VF)}</td><td class="n">${millones(a.I)}</td><td>${a.completo ? sig('ok', 'Complete year') : sig('warn', `Partial: ${num(a.cobertura_pct, 0)} % of hours`)}</td></tr>`).join('')}</tbody></table></div>
      <p class="fine">Amounts in ${esc(unit)}. A partial year is shown with its coverage and is never annualised.</p>`;
    drawCharts(raw, res);
  }
  const cfg = (c) => c.S.get().cfg;
  let drawVer = 0;
  async function drawCharts(raw, res) {
    const myDraw = ++drawVer;
    const c = col(); Object.values(charts).forEach((x) => x && x.destroy()); charts = {};
    const hrs = res.hora, sol = raw.mediodia_solar_cdmx;
    const mk = async (cid, cfgc) => {
      const el = $('#' + cid);
      if (myDraw !== drawVer || !el) return null;
      const ch = await make(el, cfgc);
      if (myDraw !== drawVer) { ch.destroy(); return null; }
      charts[cid] = ch; return ch;
    };
    const c1 = await mk('nd-c1', { data: { labels: H, datasets: [
      { type: 'bar', label: 'Production', data: hrs.map((h) => h.y), backgroundColor: c.sun, yAxisID: 'y2', barPercentage: 0.8, order: 3 },
      { type: 'line', label: 'PML', data: hrs.map((h) => h.pml), borderColor: c.ink, borderWidth: 2.5, pointRadius: 0, tension: 0.25, order: 1 },
      { type: 'line', label: 'Average', data: H.map(() => res.B), borderColor: c.ink2, borderDash: [7, 5], borderWidth: 2, pointRadius: 0, order: 1 },
      { type: 'line', label: 'Captured', data: H.map(() => res.C), borderColor: c.orange, borderDash: [7, 5], borderWidth: 2.5, pointRadius: 0, order: 1 }] },
      options: baseOptions({ interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { display: false }, ticks: { color: c.ink2 } }, y: { grid: { color: c.line }, ticks: { color: c.ink2 } },
        y2: { position: 'right', grid: { display: false }, min: 0, ticks: { color: c.ink2 } } } }) });
    if (!c1) return;
    hourAxis(c1); axisTitle(c1, `Hour of day (start, CDMX clock) · solar noon ${hhmm(sol)}`, 'MXN/MWh');
    const stack = (k) => hrs.map((h) => h[k]);
    const c2 = await mk('nd-c2', { type: 'bar', data: { labels: H, datasets: [
      { label: 'Energy', data: stack('ingE'), backgroundColor: c.energy, stack: 's' }, { label: 'Losses', data: stack('ingP'), backgroundColor: c.losses, stack: 's' },
      { label: 'Congestion', data: stack('ingC'), backgroundColor: c.cong, stack: 's' },
      { type: 'line', label: 'Shortcut (average price)', data: stack('atajo'), borderColor: c.ink, borderDash: [3, 4], borderWidth: 2, pointRadius: 0 }] },
      options: baseOptions({ interaction: { mode: 'index', intersect: false } }) });
    if (!c2) return;
    c2.options.scales.x.stacked = true; c2.options.scales.y.stacked = true; hourAxis(c2); axisTitle(c2, 'Hour of day (start, CDMX clock)', 'MXN per MWp in that hour'); yWidth(c2, 70);
    const ms = res.mensual, lab = ms.map((m) => m.mes);
    const tk = (v, i) => (lab[i] && lab[i].endsWith('-01') ? lab[i].slice(0, 4) : '');
    const c3 = await mk('nd-c3', { type: 'line', data: { labels: lab, datasets: [{ label: 'VF', data: ms.map((m) => m.VF), borderColor: c.cream, borderWidth: 2, pointRadius: 3,
      pointBackgroundColor: ms.map((m) => (m.completo ? c.cream : c.bg)), pointBorderColor: c.cream, spanGaps: false }] }, options: baseOptions() });
    if (!c3) return;
    c3.options.scales.x.ticks.callback = tk; c3.options.scales.x.ticks.autoSkip = false; c3.options.scales.x.ticks.maxRotation = 0; axisTitle(c3, 'Month (CDMX clock); hollow = partial or edge', 'VF');
    const c4 = await mk('nd-c4', { type: 'line', data: { labels: lab, datasets: [
      { label: 'Captured', data: ms.map((m) => m.C), borderColor: c.orange, borderWidth: 2.5, pointRadius: 0 },
      { label: 'Base', data: ms.map((m) => m.B), borderColor: c.ink2, borderDash: [5, 4], borderWidth: 2, pointRadius: 0 }] }, options: baseOptions() });
    if (!c4) return;
    c4.options.scales.x.ticks.callback = tk; c4.options.scales.x.ticks.autoSkip = false; c4.options.scales.x.ticks.maxRotation = 0; axisTitle(c4, 'Month (CDMX clock)', `MXN/MWh · ${res.real ? "today's pesos" : 'nominal'}`);
    [c1, c2, c3, c4].forEach((x) => x.update());
  }
  ctx.onRefresh(() => { if (sheet) compute(); });
  ctx.openNode = (nid) => { id = nid; picker.set('node', nid); load(); document.getElementById('node').scrollIntoView(); };
  ctx.syncCfg = () => { const s = $('#nd-cfg'); if (s) s.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === ctx.S.get().cfg))); };
  await load();
}

/* ---------- Compare ---------- */
export async function initCompare(ctx) {
  const root = $('#compare-root');
  root.innerHTML = `<div class="row"><div id="cp-pick"></div><button type="button" class="btn" id="cp-add">Add node</button></div>
    <div id="cp-chips" class="row"></div><div id="cp-body"></div>`;
  let list = [], cur = '08NCM-115', charts = {};
  const pk = Picker($('#cp-pick'), { levels: ['node'], init: { level: 'node', key: cur }, id: 'cp', onChange: (l, k) => { cur = k; } });
  const add = (id) => { if (!D.byId.has(id) || list.includes(id)) return; if (list.length >= 4) list.shift(); list.push(id); render(); };
  ctx.addCompare = add;
  $('#cp-add').addEventListener('click', () => add(pk.get().key));
  $('#cp-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { list = list.filter((x) => x !== b.dataset.rm); render(); } });
  let cver = 0;
  async function render() {
    const my = ++cver;
    const real = ctx.S.get().real, cfg = ctx.S.get().cfg, c = col();
    $('#cp-chips').innerHTML = list.map((id) => `<span class="sig sig-neutral">${esc(id)} <button type="button" data-rm="${esc(id)}" aria-label="Remove ${esc(id)}" style="background:none;border:0;color:inherit;cursor:pointer">×</button></span>`).join('');
    const body = $('#cp-body');
    if (list.length < 2) { body.innerHTML = '<p class="muted">Add at least two nodes to compare them.</p>'; return; }
    const rows = list.map((id) => { const n = D.byId.get(id), k = n.kpis && n.kpis[cfg]; return { id, n, k }; });
    const g = (k, a, b) => (k ? (real && k[b] != null ? k[b] : k[a]) : null);
    const sist = [...new Set(rows.map((r) => r.n.sistema))];
    body.innerHTML = `<div class="scroll-x"><table><thead><tr><th>Node</th><th>Region</th><th class="n">Captured</th><th class="n">Average</th><th class="n">VF</th><th class="n">PV energy PML ≤ 0</th><th></th></tr></thead><tbody>
      ${rows.map(({ id, n, k }) => `<tr><td>${esc(id)}<br><span class="muted" style="font-size:13px">${esc(n.nombre)}, ${esc(n.entidad || '')}</span></td><td>${esc(n.region || '—')}</td>
        <td class="n">${k ? f0(g(k, 'precio_capturado_mxn_mwh', 'precio_capturado_real_mxn_mwh')) : '—'}</td><td class="n">${k ? f0(g(k, 'precio_base_mxn_mwh', 'precio_base_real_mxn_mwh')) : '—'}</td>
        <td class="n">${k ? f2(g(k, 'vf', 'vf_real')) : '—'}</td><td class="n">${k ? num(k.pct_energia_pml_le0, 2) + ' %' : '—'}</td>
        <td>${D.available.has(id) ? `<button type="button" class="btn btn-ghost" data-open-node="${esc(id)}">Sheet</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="fine">Full period ${esc(D.index.periodo_datos.desde)} to ${esc(D.index.periodo_datos.hasta)}, ${cfg === 'tracker' ? 'single-axis tracker' : 'fixed tilt'}, ${real ? "today's pesos" : 'nominal pesos'}.</p>
      <div class="grid g2"><div class="stack"><h4>Average day, Aug 2025 – Jul 2026 (nominal)</h4><div class="chart" style="height:260px"><canvas id="cp-c1" role="img" aria-label="Average-day PML by hour of the compared nodes"></canvas></div></div>
        <div class="stack"><h4>VF by month</h4><div class="chart" style="height:260px"><canvas id="cp-c2" role="img" aria-label="Monthly value factor of the compared nodes"></canvas></div></div></div>
      ${sist.map((s) => clockFoot(s)).join('')}
      ${sist.some((s) => s !== 'SIN') ? '<div class="callout clock"><b>Baja California systems on the same clock.</b> BCA and BCS hours are shown on the CDMX clock (UTC−6), so their hours appear shifted against their local time.</div>' : ''}`;
    const [prof, ser] = await Promise.all([loadProfiles(), loadSeriesNodes()]);
    if (my !== cver) return;
    const pal = [c.orange, c.cream, c.sun, c.losses];
    Object.values(charts).forEach((x) => x && x.destroy()); charts = {};
    const miss = [];
    const ds1 = [], ds2 = [];
    list.forEach((id, i) => {
      const p = prof && prof.nodes[id] && prof.nodes[id].Y2, s = ser && ser.nodes[id];
      if (p) ds1.push({ label: id, data: p[0], borderColor: pal[i], borderWidth: 2.5, pointRadius: 0, tension: 0.25 }); else miss.push(id);
      if (s) ds2.push({ label: id, data: s.m, borderColor: pal[i], borderWidth: 2, pointRadius: 0, spanGaps: true });
    });
    charts.a = await make($('#cp-c1'), { type: 'line', data: { labels: H, datasets: ds1 }, options: baseOptions({ interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true, labels: { color: c.ink2 } }, tooltip: baseOptions().plugins.tooltip } }) });
    if (my !== cver) { charts.a.destroy(); charts = {}; return; }
    hourAxis(charts.a); axisTitle(charts.a, 'Hour of day (start, CDMX clock)', 'MXN/MWh');
    charts.b = await make($('#cp-c2'), { type: 'line', data: { labels: ser ? ser.months : [], datasets: ds2 }, options: baseOptions({ interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true, labels: { color: c.ink2 } }, tooltip: baseOptions().plugins.tooltip } }) });
    charts.b.options.scales.x.ticks.callback = (v, i) => (ser.months[i].endsWith('-01') ? ser.months[i].slice(0, 4) : ''); charts.b.options.scales.x.ticks.autoSkip = false; charts.b.options.scales.x.ticks.maxRotation = 0;
    axisTitle(charts.b, 'Month (CDMX clock)', 'VF');
    if (my !== cver) { Object.values(charts).forEach((x) => x && x.destroy()); charts = {}; return; }
    charts.a.update(); charts.b.update();
    if (miss.length) body.insertAdjacentHTML('beforeend', `<p class="fine">No explorer profile for ${miss.map(esc).join(', ')} (outside the analysis universe).</p>`);
  }
  ctx.onRefresh(render);
  render();
}
