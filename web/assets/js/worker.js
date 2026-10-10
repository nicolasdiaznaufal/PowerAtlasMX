// Web Worker: mantiene los nodos adaptados y calcula periodos bajo demanda (calculo pesado fuera del hilo principal).
import { adaptNode, ctxFor } from './contract.js';
import { compute } from './calc.js';

const nodes = new Map();
let index = null;

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'index') { index = m.index; self.postMessage({ id: m.id, ok: true }); return; }
    if (m.type === 'node') { nodes.set(m.raw.id, adaptNode(m.raw)); self.postMessage({ id: m.id, ok: true }); return; }
    if (m.type === 'compute') {
      const model = nodes.get(m.nodeId);
      if (!model) throw new Error(`nodo no cargado en el worker: ${m.nodeId}`);
      const res = compute(model, m.cfg, m.desde, m.hasta, ctxFor(index, model), { real: m.real });
      self.postMessage({ id: m.id, ok: true, res });
    }
  } catch (e) {
    self.postMessage({ id: m.id, ok: false, error: String(e && e.message ? e.message : e) });
  }
};
