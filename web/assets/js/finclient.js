// Client of finworker.js, with a main-thread fallback (same pure functions) when workers are unavailable.
import { runEval } from './finworker.js';

export class FinClient {
  constructor(url = 'data/analysis/analysis_nodos.json') {
    this.url = url; this.seq = 0; this.pending = new Map(); this.mode = 'worker'; this.meta = null; this.nodos = null;
    this.ready = this._init();
  }
  async _init() {
    try {
      this.w = new Worker(new URL('./finworker.js', import.meta.url), { type: 'module' });
      this.w.onmessage = (ev) => {
        const p = this.pending.get(ev.data.id);
        if (!p) return;
        this.pending.delete(ev.data.id);
        ev.data.ok ? p.resolve(ev.data) : p.reject(new Error(ev.data.error));
      };
      this.w.onerror = () => { this.mode = 'main'; };
      this.meta = await this._post({ type: 'init', url: this.url });
    } catch (e) {
      this.mode = 'main';
      const r = await fetch(this.url, { credentials: 'same-origin' });
      this.nodos = await r.json();
      this.meta = { ids: this.nodos.ids, region: this.nodos.region, entidad: this.nodos.entidad, windows: Object.keys(this.nodos.ventanas) };
    }
    return this.meta;
  }
  _post(msg) { return new Promise((resolve, reject) => { const id = ++this.seq; this.pending.set(id, { resolve, reject }); this.w.postMessage({ ...msg, id }); }); }
  /** -> {mode, threshold, national, region, state, margin, lcoe} | {mode:null} ; latest call wins (older ones resolve null). */
  async evaluate(set, winKey, nominal) {
    await this.ready;
    const tok = ++this.token || (this.token = 1);
    let out;
    if (this.mode === 'worker') out = (await this._post({ type: 'eval', set, winKey, nominal })).res;
    else out = runEval(this.nodos, { set, winKey, nominal });
    return tok === this.token ? out : null;
  }
}
