// Format en-US, etiquetas de mes y logica de la nota de reloj. Sin dependencias del DOM (probado en node).
const LOCALE = 'en-US';
const nf = (min, max) => new Intl.NumberFormat(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max });
const NF = { 0: nf(0, 0), 1: nf(1, 1), 2: nf(2, 2), 3: nf(3, 3), 4: nf(4, 4) };
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function num(v, d = 0) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return NF[d].format(v);
}
export const mxn = (v, d = 0) => num(v, d);
export const pct = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${NF[d].format(v)}%`);
export const vf = (v) => num(v, 2);
export function millones(v, d = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${NF[d].format(v / 1e6)} M`;
}
/** "2026-09" -> "sep 2026" */
export function mesLargo(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-');
  return `${MESES[+m - 1]} ${y}`;
}
export const mesCorto = (ym) => `${MESES[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;
export function addMonths(ym, k) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export function monthRange(desde, hasta) {
  const out = [];
  for (let m = desde; m <= hasta; m = addMonths(m, 1)) out.push(m);
  return out;
}
export const hhmm = (h) => {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return `${String(mm === 60 ? hh + 1 : hh).padStart(2, '0')}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`;
};

/**
 * Nota de reloj lista para mostrar (texto del indice, sin reescribirlo).
 * Devuelve { texto, prominente, explicacion } o null si no hay bloque reloj.
 * Se debe mostrar SIEMPRE que haya cifras por hora del dia o por mes.
 */
export function notaReloj(index, sistema, lang = 'en', nodo = null) {
  const s = index && index.reloj && index.reloj.sistemas && index.reloj.sistemas[sistema];
  if (!s) return null;
  const texto = (lang === 'es' ? s.nota_es : s.nota_en) || s.nota_en || s.nota_es;
  const prominente = !!(nodo && nodo.nota_reloj) || (s.desfase_a_cdmx_horas || 0) !== 0;
  let explicacion = null;
  if (sistema === 'BCA') {
    explicacion = 'Baja California (BCA) observes US daylight saving time every year: UTC-8 in winter (CDMX-2 h) and UTC-7 in summer (CDMX-1 h). Everything here is shown on the fixed CDMX clock (UTC-6), so its hours appear shifted +2 h from its local standard time.';
  } else if (sistema === 'BCS') {
    explicacion = 'Baja California Sur (BCS) is on UTC-7 (CDMX-1 h) and, since 30 Oct 2022, has no daylight saving time: it is always CDMX-1. Everything here is shown on the fixed CDMX clock (UTC-6), so its hours appear shifted +1 h.';
  }
  return { texto, prominente, explicacion, desfase: s.desfase_a_cdmx_horas || 0 };
}

/** Pie de pagina de reloj para una lista de sistemas (unicos). */
export function notasReloj(index, sistemas, lang = 'en', nodos = []) {
  const vistos = new Set();
  const out = [];
  for (const s of sistemas) {
    if (vistos.has(s)) continue;
    vistos.add(s);
    const n = notaReloj(index, s, lang, nodos.find((x) => x && x.sistema === s) || null);
    if (n) out.push({ sistema: s, ...n });
  }
  return out;
}

/** Signed number with a true minus: "+12" / "−12". */
export function signed(v, d = 0) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return (v < 0 ? '−' : '+') + NF[d].format(Math.abs(v));
}
export function mn(v, d = 2) { // millions of MXN with a plain M
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return (v < 0 ? '−' : '') + NF[d].format(Math.abs(v) / 1e6);
}
