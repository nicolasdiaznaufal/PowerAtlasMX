// analysis.json integration: schema guard, English dictionary for the insights that are displayed, area stats readable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { insightEn, shown } from '../assets/js/analysis.js';
import { checkAnalysisSchema, SchemaError } from '../assets/js/contract.js';
import { WIN, REGIONS, ST } from '../assets/js/names.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const a = JSON.parse(readFileSync(join(dir, 'analysis', 'analysis.json'), 'utf8'));
const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const SPANISH = /\b(nodos?|ago|promedio|nacional|nuestro|reproducido|energia|sobreestim|baja|del|entre)\b/i;

test('schema guards: index 1.2.0, analysis 1.1.0, another major is refused', () => {
  assert.equal(index.schema_version, '1.2.0');
  assert.equal(a.schema_version, '1.1.0');
  assert.equal(checkAnalysisSchema(a.schema_version), null);
  assert.ok(checkAnalysisSchema('1.4.0'));
  assert.throws(() => checkAnalysisSchema('2.0.0'), SchemaError);
  assert.throws(() => checkAnalysisSchema(''), SchemaError);
});
test('every displayed insight renders in English (i18n dictionary has no Spanish leak) and flagged ones are never shown', () => {
  const s = shown(a);
  assert.ok(s.length >= 14);
  assert.ok(s.every((i) => !i.bandera));
  for (const i of s) {
    const t = insightEn(i);
    assert.ok(t.length > 20, i.id);
    assert.ok(!SPANISH.test(t.replace(/Peninsular|Noroeste|Norte|Oriental|Central|Occidental|Noreste/g, '')), `Spanish leak: ${t}`);
  }
});
test('names: every state key of the analysis has a display name and the regions match', () => {
  const w = a.ventanas[WIN.Y2.key].por_config.tracker;
  for (const k of Object.keys(w.estados)) assert.ok(ST[k], `no display name for ${k}`);
  assert.deepEqual(Object.keys(w.regiones).sort(), REGIONS.slice().sort());
});
test('windows and real/nominal variants exist for both deck windows', () => {
  for (const k of ['Y1', 'Y2']) {
    const n = a.ventanas[WIN[k].key].por_config.tracker.nacional;
    for (const f of ['p_cap_real', 'pml_medio_real', 'vf', 'y_f_mwh_por_mwp', 'pct_nodos_cubren_lcoe_real', 'pct_nodos_cubren_lcoe_nominal']) assert.ok(f in n, `${k} ${f}`);
  }
});
