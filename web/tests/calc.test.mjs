// Reconstruction and period aggregation against each node's published full-period KPIs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { adaptNode, ctxFor, checkSchema, SchemaError } from '../assets/js/contract.js';
import { compute, hoursInMonth, horasPosibles } from '../assets/js/calc.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const index = JSON.parse(readFileSync(join(dataDir, 'index.json'), 'utf8'));
const files = readdirSync(join(dataDir, 'nodes')).filter((f) => f.endsWith('.json'));
const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12));
// El contrato publica los KPIs redondeados a 6 decimales: tolerancia = max(rel 1e-6 si tol<=1e-6 ..., 2e-6 absoluto).
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= 2e-6 || rel(a, b) <= Math.max(tol, 1e-6), `${msg}: ${a} vs ${b} (rel ${rel(a, b)})`);

test('real nodes with sheets are present', () => { assert.ok(files.length >= 15); });

for (const f of files) {
  const raw = JSON.parse(readFileSync(join(dataDir, 'nodes', f), 'utf8'));
  const model = adaptNode(raw);
  const ctx = ctxFor(index, model);
  const { desde, hasta } = index.periodo_datos;
  for (const cfg of ['fixed', 'tracker']) {
    const pub = raw.kpis[cfg];
    test(`${raw.id} ${cfg}: full period nominal = published`, () => {
      const r = compute(model, cfg, desde, hasta, ctx, { real: false });
      assert.equal(r.n, pub.n_horas);
      close(r.B, pub.precio_base_mxn_mwh, 1e-9, 'B');
      close(r.C, pub.precio_capturado_mxn_mwh, 1e-9, 'C');
      close(r.VF, pub.vf, 1e-9, 'VF');
      close(r.I, pub.ingreso_mxn_por_mwp, 1e-9, 'ingreso');
      close(r.P, pub.produccion_mwh_por_mwp, 1e-9, 'produccion');
      close(r.pctE0, pub.pct_energia_pml_le0, 1e-8, '%E0');
      close(r.pctHorasLe0, pub.pct_horas_pml_le0, 1e-8, '%horas<=0');
      close(r.E0, pub.mwh_por_mwp_en_riesgo, 1e-8, 'E0');
      close(r.C_e, pub.precio_capturado_energia, 1e-8, 'C energia');
      close(r.B_e, pub.precio_base_energia, 1e-8, 'B energia');
      close(r.basisCongestion, pub.basis_congestion_mxn_mwh, 1e-8, 'basis congestion');
      close(r.deltaVsEnergia, pub.delta_capturado_vs_energia_mxn_mwh, 1e-7, 'delta vs energia');
      // descomposicion exacta I = P x B x VF
      close(r.I, r.P * r.B * r.VF, 1e-12, 'identity I = P*B*VF');
      assert.equal(r.horasEsperadas, pub.cobertura.horas_esperadas);
      assert.equal(r.mesesConDatos, pub.cobertura.meses_con_datos);
      close(r.pctFaltantes, pub.cobertura.pct_horas_faltantes, 1e-8, 'pct faltantes');
    });
    test(`${raw.id} ${cfg}: annual revenue, trend and lowest monthly VF`, () => {
      const r = compute(model, cfg, desde, hasta, ctx, { real: false });
      const ia = pub.ingreso_anual;
      assert.deepEqual(r.anualCompletos, ia.anios_completos);
      assert.equal(r.ingresoAnual.m, ia.m);
      if (ia.m) {
        for (const [k, kk] of [['peor', 'peor'], ['mediana', 'mediana'], ['mejor', 'mejor']]) {
          assert.equal(r.ingresoAnual[k].anio, ia[kk].anio, k);
          close(r.ingresoAnual[k].I, ia[kk].ingreso_mxn_por_mwp, 1e-9, `ingreso ${k}`);
          close(r.ingresoAnual[k].VF, ia[kk].vf, 1e-9, `vf ${k}`);
        }
      }
      if (pub.vf_tendencia.pendiente_vf_por_anio === null) assert.equal(r.vfTendencia.pendiente, null);
      else close(r.vfTendencia.pendiente, pub.vf_tendencia.pendiente_vf_por_anio, 1e-8, 'tendencia VF');
      if (pub.vf_minimo_mensual.mes) {
        assert.equal(r.vfMinMensual.mes, pub.vf_minimo_mensual.mes);
        close(r.vfMinMensual.VF, pub.vf_minimo_mensual.vf, 1e-8, 'VF minimo mensual');
      }
      for (const a of pub.anual) {
        const mine = r.anual.find((x) => x.anio === a.anio);
        assert.ok(mine, `anio ${a.anio}`);
        assert.equal(mine.completo, a.completo, `completo ${a.anio}`);
        assert.equal(mine.n, a.n_horas);
        close(mine.I, a.ingreso_mxn_por_mwp, 1e-9, `ingreso ${a.anio}`);
        close(mine.cobertura_pct, a.cobertura_pct, 1e-6, `cobertura ${a.anio}`);
      }
    });
    test(`${raw.id} ${cfg}: real pesos = published`, () => {
      const pr = pub.reales;
      const r = compute(model, cfg, desde, hasta, ctx, { real: true });
      assert.equal(pr.estado, 'calculado');
      assert.equal(r.real, true);
      close(r.B, pr.precio_base_mxn_mwh, 1e-9, 'B real');
      close(r.C, pr.precio_capturado_mxn_mwh, 1e-9, 'C real');
      close(r.VF, pr.vf, 1e-9, 'VF real');
      close(r.I, pr.ingreso_mxn_por_mwp, 1e-9, 'ingreso real');
      close(r.C_e, pr.precio_capturado_energia, 1e-8, 'C energia real');
      close(r.basisCongestion, pr.basis_congestion_mxn_mwh, 1e-8, 'basis real');
    });
  }
}

test('partial periods: two halves add up exactly (additivity)', () => {
  const raw = JSON.parse(readFileSync(join(dataDir, 'nodes', '01AAN-85.json'), 'utf8'));
  const m = adaptNode(raw), ctx = ctxFor(index, m);
  const all = compute(m, 'tracker', '2020-01', '2026-09', ctx);
  const a = compute(m, 'tracker', '2020-01', '2023-06', ctx), b = compute(m, 'tracker', '2023-07', '2026-09', ctx);
  assert.equal(a.n + b.n, all.n);
  close(a.I + b.I, all.I, 1e-12, 'additive revenue');
  close(a.P + b.P, all.P, 1e-12, 'additive production');
  // B combinado = ponderado por horas
  close((a.B * a.n + b.B * b.n) / all.n, all.B, 1e-12, 'B ponderado');
});

test('BCA: edge month 2026-10 has 1 h, Jan 2020 has 742 possible h; never complete', () => {
  const raw = JSON.parse(readFileSync(join(dataDir, 'nodes', '07CFP-400.json'), 'utf8'));
  const m = adaptNode(raw), ctx = ctxFor(index, m);
  assert.equal(horasPosibles('2020-01', ctx), 742);
  assert.equal(horasPosibles('2026-10', ctx), 1);
  const r = compute(m, 'tracker', '2024-06', '2026-10', ctx);
  const oct = r.mensual.find((x) => x.mes === '2026-10');
  assert.equal(oct.n, 1);
  assert.equal(oct.completo, false);
  assert.equal(oct.borde, true);
  // real requested with an edge month lacking INPC: falls back to nominal with a notice
  const rr = compute(m, 'tracker', '2024-06', '2026-10', ctx, { real: true });
  assert.equal(rr.real, false);
  assert.match(rr.avisoReal, /INPC/);
});

test('period < 12 months of data: mesesConDatos drives the low-confidence notice', () => {
  const raw = JSON.parse(readFileSync(join(dataDir, 'nodes', '01AAN-85.json'), 'utf8'));
  const m = adaptNode(raw), ctx = ctxFor(index, m);
  const r = compute(m, 'tracker', '2025-01', '2025-08', ctx);
  assert.equal(r.mesesConDatos, 8);
  assert.ok(r.mesesConDatos < 12);
  assert.deepEqual(r.anualCompletos, []);
});

test('node 03EGM-230 (gap): 2023 is not a complete year', () => {
  const raw = JSON.parse(readFileSync(join(dataDir, 'nodes', '03EGM-230.json'), 'utf8'));
  const m = adaptNode(raw), ctx = ctxFor(index, m);
  const r = compute(m, 'fixed', '2020-01', '2026-09', ctx);
  assert.equal(r.anual.find((a) => a.anio === 2023).completo, false);
});

test('schema_version: guard', () => {
  assert.equal(checkSchema('1.1.0').ok, true);
  assert.equal(checkSchema('1.2.0').aviso, null);
  assert.match(checkSchema('1.3.0').aviso, /newer/);
  assert.match(checkSchema('1.0.0').aviso, /predates/);
  assert.throws(() => checkSchema('2.0.0'), SchemaError);
  assert.throws(() => checkSchema(undefined), SchemaError);
  assert.throws(() => adaptNode({ schema_version: '3.0.0' }), SchemaError);
});

test('adaptNode rejects arrays with inconsistent length', () => {
  const raw = JSON.parse(readFileSync(join(dataDir, 'nodes', '01AAN-85.json'), 'utf8'));
  raw.agregados.n_horas = raw.agregados.n_horas.slice(1);
  assert.throws(() => adaptNode(raw), SchemaError);
});

test('hoursInMonth', () => { assert.equal(hoursInMonth('2024-02'), 29 * 24); assert.equal(hoursInMonth('2025-02'), 28 * 24); });
