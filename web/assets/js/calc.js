// Recalculo de KPIs para cualquier rango de meses a partir de los agregados aditivos (TECNICO.md §3, §4, §6).
// Modulo puro: lo usan el Web Worker, la pagina (respaldo) y las pruebas de node.

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const ymParts = (ym) => [+ym.slice(0, 4), +ym.slice(5, 7)];
export const hoursInMonth = (ym) => { const [y, m] = ymParts(ym); return daysIn(y, m) * 24; };
export const hoursInYear = (y) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 8784 : 8760);

/** Horas posibles de un mes dentro de la ventana de datos del sistema (aggregates.horas_posibles_mes). */
export function horasPosibles(ym, ctx) {
  let h = hoursInMonth(ym);
  if (ym === ctx.desde0) h -= ctx.desfase || 0;
  if (ym > ctx.hasta0) h = ctx.bordes.has(ym) ? 1 : 0;
  return h;
}

/** Disponibilidad de pesos reales: estado del bloque reales y deflactor en cada mes con datos del rango. */
export function realDisponible(model, cfg, desde, hasta) {
  const est = model.realEstadoPorConfig ? model.realEstadoPorConfig[cfg] : model.realEstado;
  if (est !== 'calculado') return { ok: false, motivo: "The real-pesos block is not available for this node." };
  for (let i = 0; i < model.meses.length; i++) {
    const m = model.meses[i];
    if (m < desde || m > hasta) continue;
    let tiene = false;
    for (let h = 0; h < 24; h++) if (model.n[i * 24 + h] > 0) { tiene = true; break; }
    if (tiene && (model.defl[i] === null || model.defl[i] === undefined)) {
      return { ok: false, motivo: `No INPC value for ${m}: nothing is extrapolated. Narrow the period to end by ${'2026-09'} to see today's pesos.` };
    }
  }
  return { ok: true, motivo: null };
}

const emptyHour = () => ({ n: 0, cent: 0, perd: 0, cong: 0, energ: 0, P: 0, I: 0, Ie: 0, Ip: 0, Ic: 0 });

/**
 * KPIs del periodo [desde, hasta] ("YYYY-MM"), configuracion cfg ('fixed'|'tracker').
 * opts.real: pedir pesos reales (se degrada a nominal si no hay deflactor; ver res.real y res.avisoReal).
 */
export function compute(model, cfg, desde, hasta, ctx, opts = {}) {
  const y = model.y[cfg];
  if (!y) throw new Error(`Configuration ${cfg} not available for node ${model.id}`);
  const wantReal = !!opts.real;
  const rd = wantReal ? realDisponible(model, cfg, desde, hasta) : { ok: false, motivo: null };
  const real = wantReal && rd.ok;
  const T = { n: 0, nle0: 0, cent: 0, perd: 0, cong: 0, energ: 0, P: 0, I: 0, E0: 0, Ie: 0, Ip: 0, Ic: 0, centE: 0 };
  const hour = Array.from({ length: 24 }, emptyHour);
  const heatN = Array.from({ length: 12 }, () => new Float64Array(24));
  const heatC = Array.from({ length: 12 }, () => new Float64Array(24));
  const mensual = [];
  const anualMap = new Map();
  const rango = [];
  let mesesConDatos = 0, horasEsperadas = 0;
  const mesIdx = new Map(model.meses.map((m, i) => [m, i]));

  // todos los meses del rango (aunque el nodo no tenga datos) para cobertura esperada
  for (let m = desde; m <= hasta; m = nextMonth(m)) rango.push(m);
  for (const ym of rango) {
    horasEsperadas += horasPosibles(ym, ctx);
    const i = mesIdx.get(ym);
    const mo = ymParts(ym)[1];
    const anio = ymParts(ym)[0];
    const f = real ? model.defl[i] : 1;
    const M = { mes: ym, n: 0, cent: 0, P: 0, I: 0, E0: 0, nle0: 0 };
    if (i !== undefined) {
      for (let h = 0; h < 24; h++) {
        const k = i * 24 + h, nn = model.n[k];
        if (!nn) continue;
        const yy = y[(mo - 1) * 24 + h];
        const c = model.cent[k], p = model.perd[k], g = model.cong[k], e = model.energ[k];
        M.n += nn; M.cent += c * f; M.P += yy * nn; M.I += (yy * c / 100) * f; M.E0 += yy * model.le0[k]; M.nle0 += model.le0[k];
        T.n += nn; T.nle0 += model.le0[k]; T.cent += c * f; T.perd += p * f; T.cong += g * f; T.energ += e * f;
        T.P += yy * nn; T.I += (yy * c / 100) * f; T.E0 += yy * model.le0[k];
        T.Ie += (yy * e / 100) * f; T.Ip += (yy * p / 100) * f; T.Ic += (yy * g / 100) * f;
        const H = hour[h];
        H.n += nn; H.cent += c * f; H.perd += p * f; H.cong += g * f; H.energ += e * f; H.P += yy * nn;
        H.I += (yy * c / 100) * f; H.Ie += (yy * e / 100) * f; H.Ip += (yy * p / 100) * f; H.Ic += (yy * g / 100) * f;
        heatN[mo - 1][h] += nn; heatC[mo - 1][h] += c * f;
      }
    }
    const borde = ctx.bordes.has(ym);
    const need = Math.ceil(ctx.umbralMes * hoursInMonth(ym) - 1e-9);
    M.borde = borde;
    M.completo = !borde && M.n >= need;
    M.B = M.n ? M.cent / 100 / M.n : null;
    M.C = M.P ? M.I / M.P : null;
    M.VF = M.B !== null && M.B > 0 && M.C !== null ? M.C / M.B : null;
    if (M.n > 0) mesesConDatos++;
    mensual.push(M);
    let A = anualMap.get(anio);
    if (!A) { A = { anio, n: 0, cent: 0, P: 0, I: 0, E0: 0, meses: 0, bordes: 0, esperadas: 0, nle0: 0 }; anualMap.set(anio, A); }
    A.n += M.n; A.cent += M.cent; A.P += M.P; A.I += M.I; A.E0 += M.E0; A.nle0 += M.nle0; A.meses++; if (borde) A.bordes++;
  }
  const B = T.n ? T.cent / 100 / T.n : null;
  const C = T.P ? T.I / T.P : null;
  const res = {
    cfg, real, realSolicitado: wantReal, avisoReal: wantReal && !real ? rd.motivo : null,
    desde, hasta, mesesEnRango: rango.length, mesesConDatos, horasEsperadas,
    n: T.n, pctFaltantes: horasEsperadas ? 100 * (1 - T.n / horasEsperadas) : null,
    P: T.P, I: T.I, B, C, VF: B !== null && B > 0 && C !== null ? C / B : null,
    E0: T.E0, pctE0: T.P ? 100 * T.E0 / T.P : null, pctHorasLe0: T.n ? 100 * T.nle0 / T.n : null,
    B_e: T.n ? T.energ / 100 / T.n : null, B_p: T.n ? T.perd / 100 / T.n : null, B_c: T.n ? T.cong / 100 / T.n : null,
    C_e: T.P ? T.Ie / T.P : null, C_p: T.P ? T.Ip / T.P : null, C_c: T.P ? T.Ic / T.P : null,
  };
  res.basisCongestion = res.C_c;
  res.basisPerdidas = res.C_p;
  res.deltaVsEnergia = res.C !== null && res.C_e !== null ? res.C - res.C_e : null;

  // anual
  res.anual = [...anualMap.values()].sort((a, b) => a.anio - b.anio).map((A) => {
    const hrs = hoursInYear(A.anio);
    const mesesAnio = rango.filter((m) => +m.slice(0, 4) === A.anio).length;
    const need = Math.ceil(ctx.umbralAnio * hrs - 1e-9);
    const completo = mesesAnio === 12 && A.bordes === 0 && A.n >= need;
    const B_ = A.n ? A.cent / 100 / A.n : null, C_ = A.P ? A.I / A.P : null;
    return {
      anio: A.anio, completo, cobertura_pct: 100 * A.n / hrs, n: A.n, P: A.P, I: A.I, B: B_, C: C_,
      VF: B_ !== null && B_ > 0 && C_ !== null ? C_ / B_ : null, pctE0: A.P ? 100 * A.E0 / A.P : null, E0: A.E0,
    };
  });
  const comp = res.anual.filter((a) => a.completo && a.VF !== null);
  const compIng = res.anual.filter((a) => a.completo);
  const ord = [...compIng].sort((a, b) => a.I - b.I);
  res.anualCompletos = compIng.map((a) => a.anio);
  res.ingresoAnual = ord.length ? {
    m: ord.length, peor: ord[0], mediana: ord[Math.floor((ord.length - 1) / 2)], mejor: ord[ord.length - 1],
  } : { m: 0, peor: null, mediana: null, mejor: null };
  res.vfTendencia = (() => {
    if (comp.length < 3) return { m: comp.length, pendiente: null };
    const xs = comp.map((a) => a.anio), ys = comp.map((a) => a.VF);
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxy = 0, sxx = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
    return { m: comp.length, pendiente: sxy / sxx, anios: xs, vf: ys };
  })();
  const mc = mensual.filter((m) => m.completo && m.VF !== null);
  res.vfMinMensual = mc.length ? mc.reduce((a, b) => (b.VF < a.VF ? b : a)) : null;
  res.mensual = mensual;

  // dia tipico
  res.hora = hour.map((H, h) => ({
    h, n: H.n,
    pml: H.n ? H.cent / 100 / H.n : null, perd: H.n ? H.perd / 100 / H.n : null, cong: H.n ? H.cong / 100 / H.n : null,
    ener: H.n ? H.energ / 100 / H.n : null,
    y: H.n ? H.P / H.n : 0,                 // MWh/MWp medio en esa hora del dia
    ingreso: H.n ? H.I / H.n : 0,          // MXN/MWp por hora (media de y*PML)
    ingE: H.n ? H.Ie / H.n : 0, ingP: H.n ? H.Ip / H.n : 0, ingC: H.n ? H.Ic / H.n : 0,
    atajo: H.n && B !== null ? (H.P / H.n) * B : 0, // energia a precio promedio simple (atajo)
  }));
  res.heat = heatC.map((row, m) => Array.from(row, (c, h) => (heatN[m][h] ? c / 100 / heatN[m][h] : null)));
  return res;
}

function nextMonth(ym) {
  let [y, m] = ymParts(ym);
  m++; if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
