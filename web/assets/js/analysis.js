// English strings for the generated insights in analysis.json (source text is Spanish). Only the insights that describe this
// project's own figures are used (flag `bandera` = true marks a deck comparison and is never displayed).
const f = (v, d = 2) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const n0 = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const MXN = (v) => `${n0(v)} MXN/MWh`;
const REGN = (r) => String(r).charAt(0) + String(r).slice(1).toLowerCase();

/** Insights shown on the page. */
export const shown = (analysis) => ((analysis && analysis.insights) || []).filter((i) => !i.bandera);

/** English text for one generated insight (falls back to the Spanish source, which a test forbids). */
export function insightEn(i) {
  const v = i.valores || {};
  const per = (id) => (id.includes('2024_25') ? 'Aug 2024 – Jun 2025' : 'Aug 2025 – Jun 2026');
  switch (i.id) {
    case 'vf_nacional': return `National VF (tracker, average across nodes) went from ${f(v.vf_2024_25)} to ${f(v.vf_2025_26)} between 2024-25 and 2025-26 (Aug–Jun days).`;
    case 'atajo': return `Valuing energy at the average price overstates revenue by ${n0(v.sobreestimacion_pct)}% nationally in 2025-26.`;
    case 'tendencia': return `VF fell at ${n0(v.pct_nodos_vf_baja)}% of the ${n0(v.n_nodos_comunes)} comparable nodes between 2024-25 and 2025-26 (median change ${f(v.delta_vf_mediana, 3)}).`;
    case 'region_vf': { const [lo, hi] = Object.entries(v).sort((a, b) => a[1] - b[1]); return `In 2025-26 regional VF runs from ${f(lo[1])} (${REGN(lo[0])}) to ${f(hi[1])} (${REGN(hi[0])}).`; }
    case 'nivel_precio': return `The lowest captured price of Aug 2025 – Jun 2026 is Noroeste: ${MXN(v.p_cap_real)} in today's pesos (${MXN(v.p_cap_nominal)} nominal), needing a VF of ${f(v.vf_req_real)} against the deck scenario's LCOE of ${n0(v.lcoe_deck)} MXN/MWh.`;
    case 'pml_le0': return `Most PV energy at PML ≤ 0 in 2025-26 is in Noroeste (${f(v.NOROESTE, 1)}%) and Norte (${f(v.NORTE, 1)}%).`;
    case 'cubren_lcoe_deck_2024_25_ago_jun':
    case 'cubren_lcoe_deck_2025_26_ago_jun':
      return `Deck scenario (LCOE 714 MXN/MWh), ${per(i.id)}: ${n0(v.n_nodos_cubren_lcoe_real)} of ${n0(v.n_nodos)} nodes (${f(v.pct_nodos_cubren_lcoe_real, 1)}%) have a captured price high enough in today's pesos; with nominal prices, ${n0(v.n_nodos_cubren_lcoe_nominal)} (${f(v.pct_nodos_cubren_lcoe_nominal, 1)}%).`;
    case 'cubren_por_region': { const e = Object.entries(v).sort((a, b) => b[1] - a[1])[0]; return `In Aug 2025 – Jun 2026 the region with the most nodes covering the deck-scenario LCOE is ${REGN(e[0])} (${n0(e[1])}% of its nodes, today's pesos).`; }
    case 'sensibilidad': return `Share of nodes covering the LCOE, Aug 2025 – Jul 2026 (today's pesos): ${v.filter((r) => [20, 30, 40, 50].includes(r.lcoe_usd_mwh)).map((r) => `${r.lcoe_usd_mwh} USD → ${n0(r.pct_nodos_cubren_real)}%`).join(', ')}.`;
    case 'pyg_deck_2024_25':
    case 'pyg_deck_2025_26': return `Average 1 MWp tracker plant, ${i.id.includes('2024_25') ? '2024-25' : '2025-26'} (Aug–Jul): energy ${n0(v.energia_mwh_por_mwp)} MWh, revenue ${f(v.ingreso_mxn_por_mwp_real / 1e6)} M MXN (today's pesos), cost at the deck-scenario LCOE ${f(v.costo_mxn_por_mwp / 1e6)} M MXN, margin ${f(v.margen_mxn_por_mwp_real / 1e6)} M MXN (nominal ${f(v.margen_mxn_por_mwp_nominal / 1e6)}).`;
    case 'pyg_regiones_deck_2024_25':
    case 'pyg_regiones_deck_2025_26': {
      const e = Object.entries(v).sort((a, b) => b[1].margen_mxn_por_mwp_real - a[1].margen_mxn_por_mwp_real);
      const [b, w] = [e[0], e[e.length - 1]];
      return `Margin per MWp in ${i.id.includes('2024_25') ? '2024-25' : '2025-26'}: the best is ${REGN(b[0])} (${b[1].margen_mxn_por_mwp_real >= 0 ? '+' : ''}${f(b[1].margen_mxn_por_mwp_real / 1e6)} M MXN) and the worst ${REGN(w[0])} (${f(w[1].margen_mxn_por_mwp_real / 1e6)} M MXN), today's pesos.`;
    }
    case 'ranking': return `Ranking nodes by shortcut revenue or by real revenue gives almost the same national order (Spearman ${f(v.nacional.spearman_atajo_vs_real)}).`;
    case 'tendencia_larga': return `With complete years 2020-2025, the VF slope is negative at ${n0(v.pct_pendiente_negativa)}% of ${n0(v.n_nodos)} nodes (median ${f(v.pendiente_mediana_vf_por_anio, 3)} per year).`;
    default: return i.texto_es;
  }
}
