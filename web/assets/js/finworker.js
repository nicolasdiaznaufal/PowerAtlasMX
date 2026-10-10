// Web Worker for the assumption-driven profitability tables. Loads analysis_nodos.json itself (keeps 1.3 MB of JSON off the main thread)
// and re-evaluates the whole node universe with finmodel.js every time the assumptions, window or price basis change.
import { evaluateUniverse, usdToMxn } from './finmodel.js';
import { thresholdMode } from './params.js';

let nodos = null;
let ids = null;

function colsFor(winKey, nominal) {
  const w = nodos.ventanas[winKey];
  if (!w) return null;
  const pc = nominal ? w.p_cap : w.p_cap_real, pm = nominal ? w.pml_medio : w.pml_medio_real;
  return { pcap: pc, pml: pm, vf: w.vf, yf: w.y_f || pc.map(() => null), region: nodos.region, entidad: nodos.entidad };
}

export function runEval(nodosJson, { set, winKey, nominal }) {
  nodos = nodosJson;
  const cols = colsFor(winKey, nominal);
  if (!cols) return { error: `window ${winKey} not found` };
  const tm = thresholdMode(set, nominal);
  if (!tm.mode) return { mode: null, error: null };
  const thr = tm.mode === 'target' ? usdToMxn(set.target_lcoe_usd, set.fx) : null;
  // a window without annual yield (Aug-Jun windows) cannot give an own LCOE
  if (tm.mode === 'own' && !w12(nodos, winKey)) return { mode: 'own', error: 'This window has no annual yield; pick a 12-month window.' };
  const r = evaluateUniverse(set, cols, { nominal, mode: tm.mode, thresholdMxn: thr });
  return { mode: tm.mode, threshold: thr, ...r };
}
const w12 = (n, k) => !!(n.ventanas[k] && n.ventanas[k].y_f);

if (typeof self !== 'undefined' && typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = async (ev) => {
    const m = ev.data;
    try {
      if (m.type === 'init') {
        const r = await fetch(m.url, { credentials: 'same-origin' });
        nodos = await r.json(); ids = nodos.ids;
        self.postMessage({ id: m.id, ok: true, ids, region: nodos.region, entidad: nodos.entidad, windows: Object.keys(nodos.ventanas) });
      } else if (m.type === 'eval') {
        const res = runEval(nodos, m);
        const transfer = [];
        if (res.margin) transfer.push(res.margin.buffer, res.lcoe.buffer);
        self.postMessage({ id: m.id, ok: true, res }, transfer);
      }
    } catch (e) { self.postMessage({ id: m.id, ok: false, error: String(e && e.message ? e.message : e) }); }
  };
}
