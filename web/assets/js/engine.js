// Cliente del Web Worker de calculo, con respaldo en el hilo principal si el worker no arranca (p. ej. file://).
import { adaptNode, ctxFor } from './contract.js';
import { compute } from './calc.js';

export class Engine {
  constructor(index) {
    this.index = index; this.seq = 0; this.pending = new Map(); this.models = new Map(); this.sent = new Set();
    this.mode = 'worker';
    try {
      this.w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.w.onmessage = (ev) => {
        const p = this.pending.get(ev.data.id);
        if (!p) return;
        this.pending.delete(ev.data.id);
        ev.data.ok ? p.resolve(ev.data.res) : p.reject(new Error(ev.data.error));
      };
      this.w.onerror = () => { this.mode = 'main'; this._flushToMain(); };
      this._post({ type: 'index', index });
    } catch (e) { this.mode = 'main'; }
  }
  _post(msg) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq; this.pending.set(id, { resolve, reject });
      this.w.postMessage({ ...msg, id });
    });
  }
  _flushToMain() { for (const [, p] of this.pending) p.reject(new Error('worker')); this.pending.clear(); }
  async addNode(raw) {
    if (!this.models.has(raw.id)) this.models.set(raw.id, adaptNode(raw)); // validacion de esquema en el hilo principal tambien
    if (this.mode === 'worker' && !this.sent.has(raw.id)) {
      try { await this._post({ type: 'node', raw }); this.sent.add(raw.id); } catch (e) { this.mode = 'main'; }
    }
  }
  async compute(nodeId, cfg, desde, hasta, real) {
    if (this.mode === 'worker') {
      try { return await this._post({ type: 'compute', nodeId, cfg, desde, hasta, real }); } catch (e) { this.mode = 'main'; }
    }
    const m = this.models.get(nodeId);
    return compute(m, cfg, desde, hasta, ctxFor(this.index, m), { real });
  }
}
